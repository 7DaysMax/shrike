#!/usr/bin/env bash
#
# SHRIKE 桌面端打包脚本。
#
#   macOS          → dist/desktop/SHRIKE.app（ad-hoc 签名）+ SHRIKE-<ver>.dmg
#   Windows        → dist/desktop/SHRIKE-<ver>-windows-<arch>.zip（exe + skills）
#   Linux/Windows  → dist/desktop/shrike-desktop[.exe]（运行时依赖 WebKitGTK / WebView2）
#
# 与 cmd/shrike（无头服务端）共用同一套后端与内嵌前端，区别只有两点：
#   1. 监听 127.0.0.1 的随机端口，避免和服务端抢 8787；
#   2. 前端跑在系统 WebView 里，关窗口即退出。
#
# 环境变量：
#   SHRIKE_BUILD_VERSION   版本号（默认 dev），写进 -X main.version 和 Info.plist
#   SHRIKE_SKIP_FRONTEND=1 跳过前端构建，直接复用 server/webui/dist
#   SHRIKE_SKIP_NPM_CI=1   跳过 npm ci（node_modules 已就绪）
#   SHRIKE_DMG=0           不生成 dmg
#   SHRIKE_SIGN_ID         codesign 身份，默认 "-"（ad-hoc，本机可跑，分发需开发者证书）
#   GOOS / GOARCH          交叉目标（默认本机；cgo 交叉编译需要对应平台工具链）

set -euo pipefail
cd "$(dirname "$0")"

VERSION="${SHRIKE_BUILD_VERSION:-dev}"
SIGN_ID="${SHRIKE_SIGN_ID:--}"
GOOS="${GOOS:-$(go env GOOS 2>/dev/null || uname -s | tr '[:upper:]' '[:lower:]')}"
GOARCH="${GOARCH:-$(go env GOARCH 2>/dev/null || uname -m)}"
case "$GOARCH" in
  x86_64) GOARCH=amd64 ;;
  aarch64|arm64) GOARCH=arm64 ;;
esac
OUT_DIR="dist/desktop"

info() { printf '\033[36m[desktop]\033[0m %s\n' "$*"; }
die() { printf '\033[31m[desktop] 出错：\033[0m %s\n' "$*" >&2; exit 1; }

command -v go >/dev/null 2>&1 || die "未检测到 go（桌面端需要 cgo，请安装 Go 1.26+）"
[ -f desktop/icon.icns ] || die "缺少 desktop/icon.icns"

mkdir -p "$OUT_DIR"

# ---------------------------------------------------------------- 前端静态资源
if [ "${SHRIKE_SKIP_FRONTEND:-0}" != "1" ]; then
  command -v npm >/dev/null 2>&1 || die "未检测到 npm（前端静态构建需要 Node.js/npm）"
  if [ ! -d web/node_modules ] || [ "${SHRIKE_SKIP_NPM_CI:-0}" != "1" ]; then
    info "安装前端依赖 (npm ci)"
    ( cd web && npm ci --no-audit --no-fund )
  fi
  info "构建前端 (next build --static)"
  ( cd web && npm run build:static )
  info "同步前端资源到 server/webui/dist"
  mkdir -p server/webui/dist
  if command -v rsync >/dev/null 2>&1; then
    rsync -a --delete web/out/ server/webui/dist/
  else
    rm -rf server/webui/dist && mkdir -p server/webui/dist && cp -R web/out/. server/webui/dist/
  fi
elif [ ! -d server/webui/dist ]; then
  die "SHRIKE_SKIP_FRONTEND=1 但 server/webui/dist 不存在"
fi

# ---------------------------------------------------------------- 桌面端可执行文件
#
# 窗口实现按平台分文件（cmd/shrike-desktop/ui_*.go）：
#   macOS/Linux：webview（cgo）→ 需要 CGO_ENABLED=1 与系统 WebKit
#   Windows    ：Edge/Chrome 的 --app 窗口（纯 Go）→ CGO_ENABLED=0 即可交叉编译
#                产物带 exe 图标与版本信息（cmd/shrike-desktop/rsrc_windows_*.syso，
#                由 go-winres 生成，见本文件末尾的注释）

if [ "$GOOS" = "windows" ]; then
  ARCHS="${SHRIKE_WINDOWS_ARCHS:-amd64,arm64}"
  for arch in ${ARCHS//,/ }; do
    [ -f "cmd/shrike-desktop/rsrc_windows_${arch}.syso" ] || \
      warn "缺少 rsrc_windows_${arch}.syso（图标/版本信息会缺失）：go-winres simply --arch ${arch} --icon desktop/icon-1024.png --manifest gui"
    out="$OUT_DIR/windows-$arch"
    mkdir -p "$out"
    info "编译桌面端 windows/${arch}（version=${VERSION}）"
    CGO_ENABLED=0 GOOS=windows GOARCH="$arch" \
      go build -tags embedui -trimpath \
      -ldflags "-s -w -H windowsgui -X main.version=$VERSION" \
      -o "$out/shrike-desktop.exe" ./cmd/shrike-desktop
    [ -d skills ] && cp -R skills "$out/skills"
    ( cd "$OUT_DIR" && zip -q -r -9 "SHRIKE-$VERSION-windows-$arch.zip" "windows-$arch" )
    info "完成：$OUT_DIR/SHRIKE-$VERSION-windows-$arch.zip"
  done
  exit 0
fi

BIN="$OUT_DIR/shrike-desktop"
info "编译桌面端 (GOOS=$GOOS GOARCH=$GOARCH version=$VERSION)"
CGO_ENABLED=1 GOOS="$GOOS" GOARCH="$GOARCH" \
  go build -tags embedui -trimpath \
  -ldflags "-s -w -X main.version=$VERSION" \
  -o "$BIN" ./cmd/shrike-desktop

if [ "$GOOS" != "darwin" ]; then
  info "完成：$BIN"
  case "$GOOS" in
    linux) info "运行时需要 WebKitGTK：apt install libwebkit2gtk-4.1-dev" ;;
  esac
  exit 0
fi

# ---------------------------------------------------------------- macOS .app
APP="$OUT_DIR/SHRIKE.app"
info "组装 $APP"
rm -rf "$APP"
mkdir -p "$APP/Contents/MacOS" "$APP/Contents/Resources"
mv "$BIN" "$APP/Contents/MacOS/SHRIKE"
cp desktop/icon.icns "$APP/Contents/Resources/icon.icns"
[ -d skills ] && cp -R skills "$APP/Contents/Resources/skills"
sed -e "s/__VERSION__/$VERSION/g" -e "s/__BUILD__/${BUILD_NUMBER:-1}/g" \
  desktop/Info.plist > "$APP/Contents/Info.plist"

info "签名 (identity=$SIGN_ID)"
codesign --force --sign "$SIGN_ID" --timestamp=none "$APP" >/dev/null 2>&1 \
  || die "codesign 失败（可用 SHRIKE_SIGN_ID 指定有效证书）"
codesign --verify --strict "$APP" || die "签名校验失败"

# ---------------------------------------------------------------- dmg
if [ "${SHRIKE_DMG:-1}" != "0" ] && command -v hdiutil >/dev/null 2>&1; then
  STAGE="$OUT_DIR/dmg-stage"
  rm -rf "$STAGE" && mkdir -p "$STAGE"
  cp -R "$APP" "$STAGE/"
  ln -s /Applications "$STAGE/Applications"
  DMG="$OUT_DIR/SHRIKE-$VERSION.dmg"
  rm -f "$DMG"
  info "生成 $DMG"
  # 沙箱/无权限环境下 hdiutil 会失败，但那不该挡住宿主产物 .app
  if ! hdiutil create -quiet -volname "SHRIKE" -srcfolder "$STAGE" -ov -format UDZO "$DMG"; then
    info "dmg 生成失败（权限或沙箱限制）；.app 已就绪，可在正常环境重跑本步骤"
  fi
  rm -rf "$STAGE"
fi

info "完成：$APP"
