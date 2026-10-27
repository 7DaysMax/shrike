# ARTEX 插件宿主 v1

## 当前结论

DSH UI 全量迁移尚未完成，`web/src/lib/dsh/migration-map.json` 保持 `complete:false`。本次交付是可运行的插件宿主与界面贡献协议，不是把“扩展入口”改个名字，也不等于已经把全部 Go 业务实现拆成插件。现有任务、执行、对话、流式输出和自有模型接口保留。

## 已落地

- 后端插件包存储、apiVersion=1 清单校验、依赖检查、安装默认停用、启停、版本选择与旧版本切回。包是 JSON `{manifest,files}`，不要求重建前端。暂未提供插件卸载、签名或市场。
- 前端生命周期内核：依赖启动、贡献优先级、事件、声明式服务调用、AbortSignal、逆序销毁、激活失败清理、错误状态；内置适配器与外部包使用同一注册表。
- 六类界面贡献：`navigation`、`view`、`panel`、`command`、`settings`、`message`。当前消息贡献作用于答复块；工具过程节点和输入框不是已开放插槽。
- 7 个内置模块：宿主、文件、终端、浏览器、任务界面、审批界面、业务设置界面。核心管理入口常驻，其他模块可停用并移除所贡献入口/面板；停用任务界面不会停止执行引擎。旧业务直达路由保留，并非所有路由都由插件路由器控制。
- 设置 → 插件，以及 `/system/extensions/`：安装包、示例、权限/依赖/贡献诊断、启停与版本切换。未保存文件在此 UI 停用前会检查。
- 外部 UI 在独立 opaque-origin iframe 运行，SDK 通过 source + 每次实例 channel 关联宿主请求。会话 Token 和模型密钥不传入插件。包文件由既有登录鉴权保护，服务调用额外检查插件权限。
- 三个宿主服务：`host.tasks.list`（仅 id/name/status）、`host.models.list`（既有公开模型 DTO，无 API Key）、`host.version`。任意 Go 代码执行、任意 API 透传、后台进程不是 v1 的能力。
- 插件状态存储：`ARTEX_PLUGIN_DIR` 可显式指定；默认是任务数据目录的同级 `.artex-plugins`。包版本保存在 `packages/<id>/<version>`，启用版本在 `state.json` 原子持久化，插件目录位于可浏览任务数据目录外。

## 新增一个插件

1. 复制 `web/public/examples/task-board.artex-plugin.json`，修改 ID 和界面。它是可安装的真实示例，不是占位截图。
2. manifest 声明贡献、依赖和权限；files 包含所有 renderer 入口。包最大 8 MiB/128 文件，版本使用 X.Y.Z。命令、导航、视图目标必须是本插件声明的面板。
3. HTML 内嵌 `pluginhost/sdk.js`（opaque iframe 下单文件内嵌是推荐打包方式）。无需给插件提供宿主 Token。
4. 在插件管理中安装，然后显式启用。示例添加“任务看板”导航和 `/task-board` 命令，通过桥接调用真实任务列表。

```js
await window.artex.ready;
const tasks = await window.artex.invoke("host.tasks.list");
// 以 textContent/组件转义方式渲染 tasks；context() 获取宿主提供的上下文。
```

```json
{
  "id":"example.task-board", "name":"任务看板", "version":"1.0.0", "apiVersion":1,
  "dependencies":["artex.core"], "permissions":["host.tasks.list"],
  "contributions":[
    {"point":"panel","id":"board","label":"任务看板","renderer":"ui/index.html"},
    {"point":"navigation","id":"board-nav","label":"任务看板","target":"board"},
    {"point":"command","id":"board-command","label":"任务看板","command":"/task-board","target":"board"}
  ]
}
```

内置清单的单一来源是 `server/plugin_builtin.json`；`npm run generate:plugins` 生成前端镜像，predev/prebuild 自动执行，测试校验一致。增加新的内置 React renderer 时在 `renderers.tsx` 注册适配器；普通外部 HTML 插件无需改此文件。

## “一切可插件化”的后续边界

| 层 | 当前状态 | 下一步接口边界 |
| --- | --- | --- |
| 导航/顶栏视图/侧面板/命令/设置 | 已有统一贡献协议与启停 | 路由、快捷键和输入框动作逐步归入注册表 |
| 消息渲染 | 答复块贡献，原始消息可展开回看 | 工具节点、推理、结构化问答、交付物 |
| 模型 Provider | 保留现有实现，插件可读公开模型清单 | provider 注册/流式请求/取消/用量事件，账号密钥由宿主管理 |
| 工具/MCP/技能 | 原能力保留，已有管理器 | 统一 ToolProvider 描述、执行、取消、审批与输出事件 |
| Agent/任务/工作流 | 原引擎保留，UI 适配器已拆 | AgentFactory、TaskRunner、WorkflowNode 注册与生命周期 |
| 存储/通知/调度/文件后端 | 原实现保留 | 仓库、事件、调度与文件系统适配器 |
| DSH Cordis 生态 | 尚未兼容其全部协议 | 明确依赖 Cordis 后再做兼容适配；不混称为已支持 |

插件化原则：核心负责生命周期、身份、事件、数据契约与恢复；业务适配器承接现有能力，逐层替换，不另建一套脱离当前任务/会话的数据系统。

## 验收与待验收

命令：`npm run test:ui`、`tsc --noEmit`、`npm run build:static -- --webpack`；Go：`go test -race ./pluginhost ./server -run '^TestPlugin'`，并回归原流式/任务融合测试。精确结果由本次 VERIFICATION.txt 记录。浏览器逐像素对照、移动端交互与真实 iframe 视觉验收尚未完成；单元与 HTTP 检查不代替视觉验收。
