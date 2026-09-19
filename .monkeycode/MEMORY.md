# User Instruction Memory

This file records user instructions, preferences, and teachings for reference in future interactions.

## Format

### User Instruction Entry
User instruction entries should follow this format:

[User Instruction Summary]
- Date: [YYYY-MM-DD]
- Context: [Mentioned scenario or time]
- Instructions:
  - [Content of user teaching or instruction, described line by line]

### Project Knowledge Entry
Entries discovered by the Agent during task execution should follow this format:

[Project Knowledge Summary]
- Date: [YYYY-MM-DD]
- Context: Discovered by Agent while performing [specific task description]
- Category: [Operations & Deployment|Build Methods|Testing Methods|Troubleshooting & Debugging|Workflow & Collaboration|Environment Configuration]
- Instructions:
  - [Specific knowledge points, described line by line]

## Deduplication Strategy
- Before adding a new entry, check for similar or identical instructions.
- If a duplicate is found, skip the new entry or merge it with the existing one.
- When merging, update the context or date information.
- This helps avoid redundant entries and keeps the memory file tidy.

## Entries

[提交确认偏好]
- Date: 2026-09-19
- Context: 用户要求合并后直接提交、推送并发布，下次无需询问
- Instructions:
  - 合并完成并检查后，直接提交相关文件、推送远程并发布版本，跟进发布结果，无需重复征求确认。

[版本递进要求]
- Date: 2026-09-19
- Context: 用户纠正本次交付仍沿用 rc-11
- Instructions:
  - 后续新增改动交付需递进版本号与 versionCode，即使上一版本发布失败也不沿用已打标签版本。本次从 rc-11（210）递进至 rc-12（211）。

[版本号规则]
- Date: 2026-08-16
- Context: 交付 RoleplayHub 套壳 APK 时
- Instructions:
  - 版本号采用三段式语义化 `Beta-x.y.z`，各段 0–9，到 9 进位，禁止出现 `Beta-1.2.10` 这类写法（应进位为 `Beta-1.3.0`）。
  - `versionCode` 与版本号同源对应：`Beta-1.3.6` → `136`，`Beta-1.3.7` → `137`，即去掉 `Beta-` 前缀与小数点后拼接。

[APK 交付与前端资源同步规范]
- Date: 2026-08-16
- Context: 构建并交付套壳 APK 时
- Instructions:
  - 交付 APK 到 `/workspace/release/RoleplayHub-Beta-<versionName>.apk`，删除同目录旧版本 APK。
  - 前端资源必须同步并 diff 校验两处：`/workspace/assets/...` 与 `/workspace/android-app/app/src/main/assets/www/...`（含 `index.html`、`assets/`、`character/`、`novel/`）。

[文件下载与图片保存行为]
- Date: 2026-08-16
- Context: 套壳 App 内下载/保存文件与图片
- Instructions:
  - 文件下载保存到 `/storage/emulated/0/Download/`，生成图片保存到 `/storage/emulated/0/Download/RPHub/`。
  - 下载使用自定义前台通知（DownloadService），不使用系统 `DownloadManager`。

[WebView 与全屏行为]
- Date: 2026-08-16
- Context: 套壳 App 的 WebView 渲染与沉浸式全屏
- Instructions:
  - 生成式 HTML iframe 保留 `allow-same-origin`。
  - iframe 高度控制保留三通道：`window.frameElement`、父窗口 onload、postMessage。
  - 聊天全屏底部黑条为用户设备 ROM 系统行为，不再继续修复。

[Git 操作红线]
- Date: 2026-08-16
- Context: 重建 android-app 过程中
- Instructions:
  - 禁止执行会删除未追踪源码的 `git clean -fd` 类命令。

[构建与签名环境]
- Date: 2026-08-16
- Context: Discovered by Agent while rebuilding the android-app shell project
- Category: Build Methods
- Instructions:
  - 构建命令：`export JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64 && export ANDROID_HOME=/opt/android-sdk && export ANDROID_SDK_ROOT=/opt/android-sdk && cd /workspace/android-app && /opt/gradle-8.7/bin/gradle clean assembleRelease -x lintVitalRelease --no-daemon`
  - 签名材料：`/workspace/android-app/roleplayhub-release.keystore` + `keystore.properties`（`keyAlias=roleplayhub`，storeFile 默认取 `roleplayhub-release.keystore`）。
  - 签名仅启用 V2（`enableV1Signing=false`、`enableV2Signing=true`），minSdk 24 / targetSdk 34 / compileSdk 34，AGP 8.3.2 / Kotlin 1.9.22。

[远程仓库与发布工作流]
- Date: 2026-08-17
- Context: 绑定 GitHub 远程仓库后
- Category: Workflow & Collaboration
- Instructions:
  - 远程仓库：`git@github.com:FeiXiaoQiu/RoleplayHub-Android.git`（origin），本地 `master` 对应远程 `main`。
  - 推送走 SSH over 443：SSH config 已配 `Host github.com → ssh.github.com:443`，私钥 `~/.ssh/id_ed25519_rphub`，GitHub 部署密钥（含写权限）已生效，不使用 token。
  - 发布流程：先本地构建验证（无问题）→ 再触发 GitHub Actions 工作流构建 → 发 release。
