---
name: reverse-android
description: 需要分析 Android APK / DEX / native .so / 加固样本时调用该skill。
---

# Android 逆向（APK / DEX / SO）

目标：把 APK 的**通信、鉴权、加密、风控**讲清楚，并给出可复现的 hook 方案。

## 工具

| 阶段 | 工具 |
| --- | --- |
| 拆包 / 资源 / manifest | `mcp__rea__*`（REA → JADX / Apktool provider）、`command`（apktool / unzip） |
| Java/Kotlin 反编译、调用链 | REA（JADX provider）或 `mcp__jadx__*`（jadx-mcp-server，需本机 jadx-gui 带插件在跑） |
| native 逻辑 | `reverse-native` skill + REA（Ghidra/IDA provider） |
| 运行时 hook / 脱壳 | `command`（frida）|
| 设备侧 | `command`（adb）|

## 流程

1. **静态定性**：manifest（包名、权限、`usesCleartextTraffic`、networkSecurityConfig）、签名、加固特征（`libjiagu`、`libDexHelper`、`libmsaoaidsec` 等）。
2. **入口扫**：Application 子类、`attachBaseContext`、启动 Activity；确认有没有壳（`classes.dex` 数量异常 / 头几个 dex 很小 = 正常）。
3. **定位关键逻辑**：搜索 `OkHttp`/`Retrofit` 初始化、`Interceptor`、`encrypt`/`sign`/`signature`、`SSLContext`/`X509TrustManager`、`NativeUtils`（`native` 方法声明）。
4. **native 下钻**：`.so` 交给 `reverse-native`；JNI 用 `RegisterNatives` 或 `Java_包名_类名_方法名` 定位。
5. **动态验证**：frida `Java.perform` hook 关键方法，`console.log` 明文/密钥；需要脱壳时按样本的壳类型走（frida-dexdump / 定制 `dexFile` dump）。
6. **落证据**：加密算法、密钥来源、签名字段拼接顺序，写进 finding；hook 脚本作为证据附件。

## 边界

- 只分析 lab 里放进去的样本；不装到真实手机、不连生产账号。
- 绕过 SSL Pinning / 证书校验**只用于**抓取该 App 自身流量做分析，抓到的流量进 `traffic` 库即可。
- 不对第三方服务发起攻击；不重打包后分发。

## 常见坑

- 加固样本直接 JADX 只有壳代码：先脱壳，别在壳上浪费时间。
- `jadx` 反编译失败的方法：切 smali 看寄存器，或让 native 侧回答。
- 混淆后类名是 `a.b.c`：靠字符串常量、`strings.xml`、资源 ID 反查。
