---
name: reverse-native
description: 需要分析原生二进制（ELF / PE / Mach-O / .so / .dylib / 固件里的可执行体）时调用该skill。
---

# 原生二进制逆向（Native RE）

在**已授权的隔离环境**内，把「这个程序怎么工作」讲清楚：入口 → 关键函数 → 数据流 → 结论。
产物是**带地址/函数名/行号的证据**，不是感觉。

## 工具（按优先级）

| 场景 | 工具 |
| --- | --- |
| 首选：伪代码 + 交叉引用 + 调用图 | `mcp__rea__*`（REA，provider=ghidra / ida / hopper） |
| 轻量、无 GUI、批量看函数/字符串 | `mcp__radare2__*`（r2mcp） |
| 跑起来看行为 / hook | `command`（bash + gdb / ltrace / strace / frida） |

REA 的 provider 由部署方配置；调用前先确认可用 provider（Ghidra 免费，IDA 需授权，Hopper 商业）。

## 流程

1. **定性**：`file`、`strings -n 8`、`readelf -h/-s`（或 `otool -l` / `objdump -p`），确认架构、是否 strip、有没有加壳特征（UPX 段名、熵值）。
2. **建索引**：交给 REA/r2 做分析，列出 functions / imports / exports / strings 命中点，得到地址空间地图。
3. **沿问题走，不要漫游**：先由任务目标反推开问，例如「这个二进制把上传的文件写到哪」「校验逻辑用什么密钥」。
4. **取伪代码 + 交叉引用**：只对命中的 3~5 个函数取伪代码，记录 `函数名@地址` 与调用者链。
5. **动态验证**：能跑就跑（`strace -f -e trace=openat,write,connect`），用实际 syscall/网络行为印证静态结论。
6. **落证据**：`report_finding` / 证据库里写「结论 + 地址 + 反编译片段」，不要贴整段伪代码。

## 边界

- 只在隔离 lab、对已授权样本动刀；不碰真实生产、不投递到外网。
- 反调试/反虚拟化检测**可以**在 lab 里绕过用于分析；不要在任务里攻击宿主环境。
- 加壳样本先脱壳再谈逻辑，脱壳失败就如实记录，不要用「大概是这样」代替证据。

## 常见坑

- strip 后没有符号：靠 import 表 + 字符串 + 调用约定反推，别硬猜函数名。
- Go/Rust 二进制函数多且名字长：优先看 `main.` / `::` 命名空间，从 `main.main` 往下 2~3 层。
- 静态链接的 libc：`strings` 会非常脏，用函数规模 + xref 过滤。
