export const TASK_NAVIGATION = [
  { id: "overview", label: "任务总览", description: "目标、范围、运行状态与模型配置" },
  { id: "sessions", label: "执行会话", description: "查看主 Agent、规划和执行工具的全过程" },
  { id: "graph", label: "探索流程", description: "查看任务节点、分支及执行链路" },
  { id: "findings", label: "发现与证据", description: "查看发现、严重程度和关联证据" },
  { id: "assets", label: "关联资产", description: "管理本任务的目标与资产" },
  { id: "coverage", label: "覆盖情况", description: "查看已探索和待覆盖的范围" },
  { id: "intercept", label: "审批与权限", description: "处理工具审批，查看拦截与执行记录" },
  { id: "report", label: "分析报告", description: "查看和导出本任务报告" },
  { id: "retests", label: "复测记录", description: "检查历史发现的复测结果" },
  { id: "broadcast", label: "运行播报", description: "查看运行事件、提醒和播报记录" },
] as const;
