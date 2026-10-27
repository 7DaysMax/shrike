# DSH 对话界面源码迁移

## 已接入

- 侧栏使用 DSH 原 SidebarRoot 样式与品牌 / 新会话 / 面板入口 / 会话区域 / 设置区域结构；文件、终端和浏览器不再在侧栏与顶栏重复堆叠。业务管理入口集中在「更多」，功能仍在。
- 顶栏使用 DSH 原 ConversationRoot 的 header、titleRow、headerActions 与 tabs 结构；普通对话和任务工作会话只留一个标题栏。旧任务详情 URL 默认进入工作会话，`view=manage` 保留完整管理与归档。
- 直接引入 DSH MarkdownText、增量解析器、语法高亮、代码工具条、自动换行、GFM 表格、公式、脚注、图片预览与灯箱、链接处理源文件及原样式；不是用打字动画伪装流式。
- 直接引入 UserMessageBubble、ReasoningRow、DisclosureRow、TextShimmer、MessageIconActions 与日历时钟、剪贴板控制源文件；保留 194 个原图标 symbol。
- 任务主输入与普通对话使用同一 DSH 输入框；保留附件、拖放、粘贴、命令、旁路提问、停止、发送队列、草稿与模型选择。
- 工具输入与输出继续来自原执行记录，使用 DSH DisclosureRow 和代码渲染器展示，保留审批定位与详情。

上游文件与 SHA-256 清单位于 `web/src/components/dsh/upstream/SOURCE.json`。保留 MIT LICENSE。适配改动仅涉及本地导入、React 19 / Node TypeScript 类型、Next CSS Modules 全局规则提升、自己的数据与能力适配。

## 真流式链路

原链路在 agent/capture.go 的缓冲区把 text/thinking 留到工具调用或终态才发出。现在 UI 会话通过 WithLiveCapture 显式启用有界临时帧：

1. 首个文字 / 推理块立即发出；后续快照按 40ms 节流，内容累计而非重复追加。
2. GET `/api/ui/live?scope=conversation|task&id=...` 走现有认证的 SSE，断线后立即返回当前累计快照。
3. 前端按 revision 和 stream_id 替换同一个消息节点；真实落库后用数据库 seq 对账，最终结果只保留一条。
4. 中间 token 不写数据库、不计入 usage；停止时先落库已有部分文字，再写原停止状态。
5. 现有执行引擎、审批、原始活动历史、任务关联与模型故障转移没有被替换。

## 验证边界

自动化覆盖首段早于终态、最终落库不重复、断线快照、停止保留部分输出、主会话分段隔离、Markdown 完整内容渲染与活动 HTML 排除。浏览器工具在本轮返回本地浏览器关闭，截图和手机视觉结果不计为通过。

这份交付针对侧栏、顶栏和对话输出链路；不把其他 DSH Host 专有插件事件或未接入后端功能标作完成。
