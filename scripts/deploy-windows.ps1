#Requires -RunAsAdministrator
<#
.SYNOPSIS
  SHRIKE 一键部署脚本（Windows Server / Windows 10 均可）。
.DESCRIPTION
  在目标机本地做四件事，全部落在 C:\SHRIKE 下，不污染系统盘其它位置：
    1) 下载便携版 PostgreSQL 16（EDB 官方 binaries zip，不装服务、不动注册表里的实例）
    2) initdb 建库 + 建 shrike 用户（随机密码，最后打印出来）
    3) 下载 SHRIKE 发布包（内嵌前端，单二进制）
    4) 注册计划任务（开机启动，SYSTEM 身份）+ 放行防火墙 8787，然后拉起
  幂等：已存在的 pgdata/config.json/程序目录都会复用。
.EXAMPLE
  Set-ExecutionPolicy Bypass -Scope Process -Force
  irm https://raw.githubusercontent.com/7DaysMax/shrike/main/scripts/deploy-windows.ps1 | iex
#>

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$Root      = "C:\SHRIKE"
$PgVersion = "16.10"
$PgZip     = "https://get.enterprisedb.com/postgresql/postgresql-$PgVersion-1-windows-x64-binaries.zip"
$AppVer    = if ($env:SHRIKE_VERSION) { $env:SHRIKE_VERSION } else { "2.3.1" }
$AppZip    = "https://github.com/7DaysMax/shrike/releases/download/v$AppVer/shrike-$AppVer-windows-amd64.zip"
$AppDir    = Join-Path $Root "app"
$PgDir     = Join-Path $Root "pg"
$PgData    = Join-Path $Root "pgdata"
$Port      = 5432
$HttpPort  = 8787

function Step($msg) { Write-Host "[*] $msg" -ForegroundColor Cyan }
function Ok($msg)   { Write-Host "[+] $msg" -ForegroundColor Green }
function Warn($msg) { Write-Host "[!] $msg" -ForegroundColor Yellow }

Step "准备目录 $Root"
New-Item -ItemType Directory -Force -Path $Root, $AppDir | Out-Null

# ---------------------------------------------------------------- PostgreSQL
if (Test-Path (Join-Path $PgDir "bin\initdb.exe")) {
  Ok "PostgreSQL 已存在，跳过下载"
} else {
  Step "下载 PostgreSQL $PgVersion（约 330 MB，官方 portable 包）"
  $tmp = Join-Path $env:TEMP "pg-bin.zip"
  Invoke-WebRequest -Uri $PgZip -OutFile $tmp -UseBasicParsing
  Step "解压到 $PgDir"
  Expand-Archive -Path $tmp -DestinationPath $Root -Force
  if (Test-Path (Join-Path $Root "pgsql")) { Move-Item (Join-Path $Root "pgsql") $PgDir -Force }
  Remove-Item $tmp -Force
  Ok "PostgreSQL 就绪"
}

# ---------------------------------------------------------------- SHRIKE
$exe = Get-ChildItem -Path $AppDir -Recurse -Filter "shrike.exe" -ErrorAction SilentlyContinue | Select-Object -First 1
if ($exe) {
  Ok "SHRIKE 程序已存在：$($exe.FullName)"
} else {
  Step "下载 SHRIKE v$AppVer"
  $tmp = Join-Path $env:TEMP "shrike.zip"
  Invoke-WebRequest -Uri $AppZip -OutFile $tmp -UseBasicParsing
  Step "解压"
  $stage = Join-Path $env:TEMP "shrike-stage"
  Remove-Item $stage -Recurse -Force -ErrorAction SilentlyContinue
  Expand-Archive -Path $tmp -DestinationPath $stage -Force
  $inner = Get-ChildItem $stage -Directory | Select-Object -First 1
  Copy-Item (Join-Path $inner.FullName "*") $AppDir -Recurse -Force
  Remove-Item $tmp, $stage -Recurse -Force
  $exe = Get-ChildItem -Path $AppDir -Recurse -Filter "shrike.exe" | Select-Object -First 1
  Ok "SHRIKE 就绪：$($exe.FullName)"
}
$AppRoot = $exe.DirectoryName

# ---------------------------------------------------------------- 数据库初始化
$cfgPath = Join-Path $AppRoot "config.json"
if (Test-Path (Join-Path $PgData "PG_VERSION")) {
  Ok "pgdata 已存在，跳过 initdb"
  if (Test-Path $cfgPath) {
    $DbPass = (Get-Content $cfgPath -Raw | ConvertFrom-Json).database.password
  }
} else {
  Step "initdb（用户 shrike，scram-sha-256）"
  $DbPass = -join ((48..57) + (97..122) | Get-Random -Count 24 | ForEach-Object { [char]$_ })
  $pwfile = Join-Path $env:TEMP "pgpw.txt"
  Set-Content -Path $pwfile -Value $DbPass -NoNewline -Encoding ascii
  & (Join-Path $PgDir "bin\initdb.exe") -D $PgData -U shrike -A scram-sha-256 --pwfile=$pwfile -E UTF8 | Out-Null
  Remove-Item $pwfile -Force
  Ok "initdb 完成"
}

# 启动（若未在跑）
$running = $false
try { & (Join-Path $PgDir "bin\pg_isready.exe") -h 127.0.0.1 -p $Port | Out-Null; $running = ($LASTEXITCODE -eq 0) } catch {}
if (-not $running) {
  Step "启动 PostgreSQL（127.0.0.1:$Port）"
  & (Join-Path $PgDir "bin\pg_ctl.exe") -D $PgData -l (Join-Path $Root "pg.log") `
      -o "-p $Port -c listen_addresses=127.0.0.1" start | Out-Null
  Start-Sleep -Seconds 3
}

# 建库（已存在会报错，忽略）
$env:PGPASSWORD = $DbPass
& (Join-Path $PgDir "bin\createdb.exe") -h 127.0.0.1 -p $Port -U shrike shrike 2>$null
$env:PGPASSWORD = $null

# ---------------------------------------------------------------- 写配置
if (-not (Test-Path $cfgPath)) {
  Step "生成 $cfgPath"
  $skills = (Get-ChildItem -Path $AppRoot -Recurse -Directory -Filter "skills" | Select-Object -First 1).FullName
  $cfg = [ordered]@{
    database = [ordered]@{
      host = "127.0.0.1"; port = $Port; user = "shrike"
      password = $DbPass; dbname = "shrike"; sslmode = "disable"
    }
    skill_dir = $skills
  }
  $cfg | ConvertTo-Json -Depth 5 | Set-Content -Path $cfgPath -Encoding utf8
  Ok "配置已写入"
}

# ---------------------------------------------------------------- 防火墙 + 开机自启
Step "放行防火墙 TCP $HttpPort"
if (-not (Get-NetFirewallRule -DisplayName "SHRIKE $HttpPort" -ErrorAction SilentlyContinue)) {
  New-NetFirewallRule -DisplayName "SHRIKE $HttpPort" -Direction Inbound -Protocol TCP `
    -LocalPort $HttpPort -Action Allow -Profile Any | Out-Null
}

Step "注册计划任务（开机以 SYSTEM 启动）"
$bat = Join-Path $AppRoot "start.bat"
if (-not (Test-Path $bat)) { $bat = $exe.FullName }
schtasks /Create /TN "SHRIKE" /TR "cmd /c `"$bat`"" /SC ONSTART /RU SYSTEM /RL HIGHEST /F | Out-Null
schtasks /Run /TN "SHRIKE" | Out-Null

# ---------------------------------------------------------------- 自检
Step "等待服务就绪"
$ok = $false
for ($i = 0; $i -lt 30; $i++) {
  Start-Sleep -Seconds 2
  try {
    $r = Invoke-WebRequest -Uri "http://127.0.0.1:$HttpPort/api/health" -UseBasicParsing -TimeoutSec 3
    if ($r.StatusCode -eq 200) { $ok = $true; break }
  } catch {}
}

$ips = (Get-NetIPAddress -AddressFamily IPv4 | Where-Object { $_.IPAddress -notlike "127.*" -and $_.IPAddress -notlike "169.254.*" }).IPAddress
Write-Host ""
if ($ok) {
  Ok "SHRIKE 已启动"
} else {
  Warn "服务未在 60s 内就绪，看日志：$Root\pg.log 与 $AppRoot\shrike.log（计划任务：schtasks /Query /TN SHRIKE）"
}
Write-Host ""
Write-Host "  访问地址（本机）  : http://127.0.0.1:$HttpPort" -ForegroundColor White
foreach ($ip in $ips) { Write-Host "  访问地址（局域网/公网）: http://${ip}:$HttpPort" -ForegroundColor White }
Write-Host ""
Write-Host "  数据库            : postgres://shrike:$DbPass@127.0.0.1:$Port/shrike" -ForegroundColor DarkGray
Write-Host "  程序目录          : $AppRoot" -ForegroundColor DarkGray
Write-Host "  配置              : $cfgPath" -ForegroundColor DarkGray
Write-Host ""
Write-Host "  首次访问会让你设置管理员密码（用户名固定 SHRIKE）。" -ForegroundColor Yellow
Write-Host "  管理员密码忘了：在 $AppRoot 下执行 .\reset-password.ps1（或直接用平台自带的 reset-password.sh 等价 SQL）" -ForegroundColor DarkGray
