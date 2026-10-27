#!/usr/bin/env bash
#
# install-re-toolkit.sh —— 安装「逆向工具包」本机依赖
#
# SHRIKE 侧只是把 MCP 入口注册好了（系统 → MCP → rea），真正的分析引擎装在
# 跑 Agent 的那台机器上。本脚本把这些装齐，并按 REA 的要求输出环境变量。
#
#   macOS   : 走 Homebrew（需已装 brew）
#   Linux   : 走 apt / dnf / pacman（自动识别）
#
# 用法：
#   ./install-re-toolkit.sh              # 装全套
#   ./install-re-toolkit.sh --minimal    # 只装 Node + JADX + apktool（APK/JS 场景）
#   ./install-re-toolkit.sh --dry-run    # 只打印将执行的命令
#
# 装完把脚本最后打印的 export 那几行加进 shell profile，并重启 SHRIKE。

set -euo pipefail

MINIMAL=0
DRY=0
for a in "$@"; do
  case "$a" in
    --minimal) MINIMAL=1 ;;
    --dry-run) DRY=1 ;;
    -h|--help) sed -n '2,20p' "$0" | sed 's/^# \{0,1\}//'; exit 0 ;;
    *) echo "未知参数: $a" >&2; exit 2 ;;
  esac
done

info() { printf '\033[36m[re-toolkit]\033[0m %s\n' "$*"; }
warn() { printf '\033[33m[re-toolkit]\033[0m %s\n' "$*" >&2; }
die()  { printf '\033[31m[re-toolkit]\033[0m %s\n' "$*" >&2; exit 1; }
run()  { if [ "$DRY" = 1 ]; then echo "  + $*"; else "$@"; fi; }

need() { command -v "$1" >/dev/null 2>&1; }

OS="$(uname -s)"
info "目标系统: $OS (minimal=$MINIMAL dry-run=$DRY)"

# ---------------------------------------------------------------- Node.js 22+
if need node; then
  NODE_V="$(node -v | sed 's/^v//')"
  MAJOR="${NODE_V%%.*}"
  if [ "$MAJOR" -lt 22 ] 2>/dev/null; then
    warn "Node $NODE_V 太旧，REA 需要 22.23.4+ / 24.22.1+ / 26.12.1+"
    [ "$OS" = "Darwin" ] && run brew install node
  else
    info "Node $NODE_V OK"
  fi
else
  warn "未安装 Node"
  [ "$OS" = "Darwin" ] && run brew install node
fi

# ---------------------------------------------------------------- 包管理器
if [ "$OS" = "Darwin" ]; then
  need brew || die "需要 Homebrew：https://brew.sh"
  PKG="brew install"
  run brew install jadx apktool radare2 binwalk wireshark 2>/dev/null || warn "部分包装失败，可单独重试"
  if [ "$MINIMAL" = 0 ]; then
    run brew install --cask temurin@21 || warn "JDK 21 安装失败，请手动装（Ghidra 需要 JDK 21+ 且含 javac）"
  fi
else
  if need apt-get; then PKG="sudo apt-get install -y"
  elif need dnf; then PKG="sudo dnf install -y"
  elif need pacman; then PKG="sudo pacman -S --noconfirm"
  else die "无 apt/dnf/pacman，请手动安装 jadx apktool radare2 binwalk tshark"; fi
  info "用 $PKG"
  $PKG jadx apktool radare2 binwalk tshark 2>/dev/null || warn "部分包装失败，请按发行版单独安装"
  if [ "$MINIMAL" = 0 ]; then
    $PKG openjdk-21-jdk-headless 2>/dev/null || warn "JDK 21 装失败，Ghidra 需要它"
  fi
fi

# ---------------------------------------------------------------- Ghidra（原生二进制）
if [ "$MINIMAL" = 0 ]; then
  GHIDRA_DIR="${GHIDRA_INSTALL_DIR:-$HOME/.local/share/ghidra}"
  if [ -x "$GHIDRA_DIR/ghidraRun" ] || [ -d "$GHIDRA_DIR/support" ]; then
    info "Ghidra 已存在: $GHIDRA_DIR"
  else
    warn "下载 Ghidra 12.1.4（约 400MB，解压后 1.2GB）到 $GHIDRA_DIR"
    run mkdir -p "$(dirname "$GHIDRA_DIR")"
    TMPZIP="$(mktemp -t ghidra).zip"
    run curl -L --fail -o "$TMPZIP" \
      "https://github.com/NationalSecurityAgency/ghidra/releases/download/Ghidra_12.1.4_build/ghidra_12.1.4_PUBLIC_20250826.zip" \
      || warn "Ghidra 下载失败，请手动从 releases 下载后设置 GHIDRA_INSTALL_DIR"
    if [ "$DRY" = 0 ] && [ -s "$TMPZIP" ]; then
      unzip -q "$TMPZIP" -d "$(dirname "$GHIDRA_DIR")"
      GHIDRA_DIR="$(dirname "$GHIDRA_DIR")/$(basename "$(ls -d "$(dirname "$GHIDRA_DIR")"/ghidra_*_PUBLIC | head -1)")"
      rm -f "$TMPZIP"
    fi
  fi
fi

# ---------------------------------------------------------------- frida（动态）
info "安装 frida-tools（python3 -m pip）"
run python3 -m pip install --user -U frida-tools 2>/dev/null || warn "frida-tools 安装失败（可改用 venv）"

# ---------------------------------------------------------------- 自检
info "自检："
for b in node npx jadx apktool r2 tshark frida; do
  if need "$b"; then printf '  ✓ %-10s %s\n' "$b" "$(command -v "$b")"; else printf '  ✗ %-10s 缺失\n' "$b"; fi
done

if [ "$MINIMAL" = 0 ] && need npx; then
  info "REA 自检（首次会下载 npm 包，慢属正常）："
  run npx -y rea-agents@latest doctor --json 2>/dev/null | head -20 || warn "REA doctor 未通过，先跑 npx -y rea-agents@latest setup 看提示"
fi

cat <<'EOF'

—— 接下来 ——

1) 把下面几行加进 ~/.zshrc 或 ~/.bashrc（路径按实际安装位置调整）：

   export JAVA_HOME="$HOME/Library/Java/JavaVirtualMachines/temurin-21/Contents/Home"
   export GHIDRA_INSTALL_DIR="$HOME/.local/share/ghidra"

2) 重启 SHRIKE（或重启桌面端），到「系统 → MCP」确认 `rea` 已启用、工具已缓存。

3) 给需要逆向能力的 agent 勾上 rea 的可见性（worker / planner 默认已授权）。

注意：Ghidra 在 Apple Silicon 上首次使用需要自行编译原生 decompiler，
      见 https://github.com/morluto/rea/blob/main/docs/installation.md
EOF
