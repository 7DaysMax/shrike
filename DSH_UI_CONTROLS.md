# DSH 界面迁移：任务导航、模型、思考强度与小助手

## 本次实际实现

- 将原“对话 / 执行过程 / 发现 / 报告”平铺入口改为“对话 + 任务工具”下拉。全部 10 个任务面板均有用途说明，并打开同一真实任务资源；任务详情内部也使用同一导航数据。
- 会话、新建会话、任务主对话、创建任务表单都提供直接模型/思考选择。原备用模型链管理保留，并明确命名为“备用模型链”。
- 迁入上游 DSH 完整 `ModelSelect`、菜单材质、分组、搜索、焦点与键盘逻辑，不用简化的静态模型列表冒充。提供 `/model`、`/effort` 入口，调用同一选择目录。
- 参考 `2768651338/dsh-effort-slider` 的完整 EffortPanel，保留连续拖动、松手吸附、原生键盘、错误/加载/重试状态。拖动写入串行，只有一笔执行中与一笔最新待写，最终档位不被旧响应覆盖。
- 原火焰改成 ARTEX 自有 SVG 小助手：待机、思考、执行，随滑杆位置/强度变化，并遵循减少动态效果偏好。它不是已确认的 Grok 原角色或 3D 资产移植。
- 未公布多档能力的模型不凭空获得五个虚构档位；已知模型使用公开档位，保留显式配置的第三方默认档。DeepSeek 的实际三级为 low / high / max，不额外展示映射到同一实际档位的别名。

## 真正的请求链路

`GET/PUT /api/ui/inference?scope=conversation|task&id=...` 使用原登录鉴权。`ui_inference` 表按 scope/id 持久化，不修改共享模型配置中的思考参数。

普通会话的显式选择优先于旧 Agent 模型绑定；清除选择时在同一事务内清除遗留 profile pin。普通会话当前回复不变，选择对下一轮生效。

任务的直接选择与原故障转移链、UI 设置在同一事务内提交，保留备用顺序。显式任务模型优先于旧角色绑定；任务 UI 选择和实际 main/planner/worker 路由一致。思考设置对后续模型调用生效，进行中的请求不被改写。创建任务时推理设置与任务一起提交，首轮启动前已存在。

请求级 context 传递思考选项；共享 provider、账号鉴权、速率限制和故障转移保持。HTTP transport 按 OpenAI、Responses、Anthropic 协议写入真实字段，录制器保存实际 wire body。跨会话并发隔离、强制关闭思考的压缩调用、模型故障切换后的兼容默认值均有测试。

## 验收

- 前端纯逻辑回归、完整 TypeScript 和静态构建。
- jsdom 组件验证：直接模型、连续拖动、吸附、保存、模型切换、命令入口、原生滑杆键盘、角色动效与 aria 文本。
- 任务下拉验证：10 个入口、用途说明、打开实际任务资源。
- Go 的本地假模型服务验证实际普通会话与任务三个角色的 HTTP 请求均发送 max；共享配置保持 low，并验证数据库持久化、原子回滚和鉴权。
- 精确命令、字面输出、退出码和回滚副本结果见本次 `VERIFICATION.txt`。单元/HTTP 验收不是浏览器逐像素或移动端视觉验收。

## 全量状态

`migration-map.json` 保持 `complete:false`。本次更新模型选择并增加滑杆、任务导航、小助手等接入项；计划审批、结构化问题、交付物/逐轮 review、轨迹、工作流、Cordis 市场与原生桌面桥等此前待接入项仍未全部完成。这份交付不把它们改成完成，不把仅复制源码或存在旧管理页面算成 DSH 功能对等。

## 参考与来源

- [DSH UI model selection](https://github.com/deepseek-ai/deepseek-harness/tree/main/packages/client/ui-model-selection)
- [dsh-effort-slider](https://github.com/2768651338/dsh-effort-slider)（保留 BSD-3-Clause 许可证，按 ARTEX 目录/API 适配并替换火焰动效）
- [DeepSeek thinking](https://api-docs.deepseek.com/guides/thinking_mode/)
- [Claude effort](https://platform.claude.com/docs/en/build-with-claude/effort)

DSH 原始与适配后文件哈希在 `upstream/SOURCE.json`，滑杆来源在 `upstream/model/effort/SOURCE.json`。
