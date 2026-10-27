---
name: reverse-js-app
description: 需要分析 Electron / 打包后的 JS 应用 / asar / sourcemap 时调用该skill。
---

# JS / Electron 应用逆向

目标：从打包产物还原出**接口、IPC 通道、本地文件读写**，回答「这个按钮点了之后到底发生了什么」。

## 工具

| 阶段 | 工具 |
| --- | --- |
| 静态还原（asar / bundle / sourcemap） | REA：`analyze-javascript-application`（无需启动 App） |
| 浏览器侧行为（点击 → 请求） | `playwright-cli` skill + 平台自带流量录制 |
| 运行时 | `command`（node / electron `--inspect`） |

## 流程

1. **拿到产物**：Electron 的 `app.asar`（macOS `Contents/Resources/`、Windows `resources\`、Linux `/opt/<app>/resources/`），或浏览器工程的 `*.js` + `*.map`。
2. **还原结构**：REA 静态跑一遍，得到模块关系、preload API、IPC 通道名、被保留的源码位置。
3. **定位功能点**：按 UI 文案（`i18n` 里的中文/英文 key）反查组件 → hook → IPC → 主进程 handler。
4. **看真实请求**：用流量录制抓页面 XHR/fetch，把「请求」和「代码里拼参数的函数」对上。
5. **动态验证**：`electron --inspect` 断点，或直接 node 里 require 被抽出来的模块单测其纯函数。
6. **落证据**：接口路径 + 参数构造 + 落盘路径（`app.getPath('downloads')` 之类）。

## 边界

- 只分析已授权的构建产物；不改客户端做绕过后再连真实账号。
- 反混淆得到的关键算法可以记录，但不要把整包源码外传。
- 页面行为分析走平台代理，别在宿主上装根证书给其它进程用。

## 常见坑

- asar 里混了 `node_modules` 原生模块：`.node` 文件交给 `reverse-native`。
- bundle 被 terser 压过：sourcemap 在就赢一半，不在就靠字符串与结构特征。
- Electron 有 contextIsolation 时，renderer 拿不到 Node API：重点看 `preload.js` 暴露的桥。
