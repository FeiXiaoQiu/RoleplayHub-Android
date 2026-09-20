<p align="center">
  <img src="android-app/app/src/main/res/mipmap-xxxhdpi/ic_launcher.png" width="112" height="112" alt="Roleplay Hub 秘境来信图标">
</p>

<h1 align="center">Roleplay Hub</h1>

<p align="center">每一次对话，都通往一个新故事。</p>

[![License: CC BY-NC 4.0](https://img.shields.io/badge/License-CC%20BY--NC%204.0-lightgrey.svg)](https://creativecommons.org/licenses/by-nc/4.0/)
[![Vue](https://img.shields.io/badge/Vue-3-4FC08D.svg?logo=vue.js)](https://vuejs.org/)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind_CSS-38B2AC?logo=tailwind-css&logoColor=white)](https://tailwindcss.com/)
[![DaisyUI](https://img.shields.io/badge/DaisyUI-5A0EF8?logo=daisyui&logoColor=white)](https://daisyui.com/)

> **一款纯前端运行的本地角色扮演（Roleplay）对话和角色卡生成工具。**

**【免责与授权声明】**  
本项目基于 **[CC BY-NC 4.0（知识共享-署名-非商业性使用 4.0 国际许可协议）](./LICENSE)** 开源。**明确禁止任何形式的商业化使用（包括但不限于：作为收费服务提供、打包在付费产品中售卖、在产品内植入广告盈利等）。** 任何使用者必须遵守该协议，尊重原作者的署名权。对于违反协议的商业行为，保留追究法律责任的权利。

---

## Android 更新记录

### 2.0.0-rc-17（versionCode 216） · 2026-09-20

- 恢复 rc-16 之前的导航玻璃背景、卡组模糊、阴影插值和完整动画时长、幅度、尺寸；保留 reduced-motion 无障碍设置。
- 导航开关状态由导航组件订阅，直接同步主区域 inert，避免开关导航重复执行根模板；保留返回键、焦点恢复与页面切换。
- 卡组沿用原有五张可见窗口，将世界书/正则计数与拖动位置解耦；数据编辑仍响应更新，持久化顺序保持。
- 新增离线同数据重复 profiling、真实鼠标左右滑动/点击回归及原视觉 CSS 对照；进入功能页仍有原 DOM 挂载成本，Android GPU 与触屏流畅度需真机验收。

### 2.0.0-rc-16（versionCode 215） · 2026-09-20

- 移动端导航保留渐变玻璃配色，采用高不透明度背景，避免背景模糊与缩放叠加；缩短移动端导航过渡，减少动态效果模式同步取消导航等待。
- 卡组保留立体位移、透明度与背景交叉淡入，移除滤镜和大阴影插值；移动端降低背景模糊，列表模式按需卸载隐藏卡组。
- 弹层限制为位移与透明度过渡，补充卡组、弹层及消息的 reduced-motion 支持；角色切换先让加载状态绘制，再执行原有持久化流程。
- 保留供应商绑定、保存顺序、角色切换竞态保护、返回键和完整备份。离线浏览器验证范围与 Android 真机 GPU 表现不同，供应商网络耗时单独评估。

### 2.0.0-rc-15（versionCode 214） · 2026-09-19

- 三个聊天模型槽位分别持久化模型、供应商和 API 地址绑定；设置切换供应商仅改变编辑对象，聊天、重试与工具续写保持绑定连接。
- 空配置、已删除供应商或地址变更明确报错；旧字符串槽位按升级时保存的供应商迁移，历史供应商无法还原时需重新选择模型。
- 正文处理按文本及生成状态复用结果，流式仅保留最近版本；已完成正文缓存最多 16 条、262144 字符预算，保留 60ms 增量刷新。
- 保留原聊天自动保存及 Markdown/COT 缓存行为。优化减少本地重复处理；供应商首字延迟与网络传输速度保持由服务端及网络决定。
- 沿用签名及 rc-14 返回键、完整备份逻辑；覆盖升级与移动设备流畅度仍需真机验收。

### 2.0.0-rc-14（versionCode 213） · 2026-09-19

- 数据备份点击“导出数据”直接导出完整备份（含图片），移除精简/完整二级选择；继续沿用权限申请与下载目录保存流程。
- Android 返回键逐级关闭确认框、弹窗、侧栏、全屏及子页面；角色卡工坊与小说工具优先关闭内部弹层，主页面回到聊天根页面后才允许退出。
- 原生返回回调仅在 JS 明确报告根页面时回退 WebView 历史或退出；JS 未就绪、异常、Promise 结果保留页面，退出分发后恢复回调，避免再次打开应用后直接退出。
- 移除备份桥接脚本提前声明的根页面返回兜底，统一由业务页面提供同步返回协议；同步根 Web 与 APK 内置资源。
- 沿用 rc-13 图标与签名配置；真机系统返回手势、权限授权和完整备份恢复仍需设备验收。

### 2.0.0-rc-13（versionCode 212） · 2026-09-19

- 桌面图标采用 5 号「秘境来信」，使用墨紫背景、丁香白对话框、门与星光。
- 更新 mdpi、hdpi、xhdpi、xxhdpi、xxxhdpi 的标准、圆形与 adaptive 前景 PNG；adaptive 前景保留 66dp 圆形安全区。
- 补充 Android 圆形图标声明；沿用 rc-12 的功能与上游 1.9.6 Preview 基线。相同签名下支持覆盖升级，保留应用数据。
- 发布说明同时维护于 `.github/workflows/release.yml`。

## 核心特性 (Features)

Roleplay Hub 致力于提供流畅、私密且功能强大的本地化AI Roleplay体验。

- 角色卡、世界书、正则脚本和多用户资料管理
- 总结记忆与向量记忆，可按角色和剧情分支独立保存
- 剧情分支创建、切换、回档、重命名和完整导入导出
- UI 模板变量分析与对话状态展示
- 自动生图、单张重新生成和多套内置画师风格
- 角色卡生成、万相广场与“墨韵 · 造梦”在线工具

## 快速开始 (Quick Start)

本项目无需复杂的 Node.js 环境或依赖安装，即开即用！

### 1. 下载与运行
1. 点击项目主页绿色的 `Code` 按钮，选择 `Download ZIP`。
2. 将下载的 ZIP 压缩包解压到您的本地任意文件夹中。
3. 双击打开 `index.html` 文件，即可在浏览器（推荐 Chrome / Edge / Firefox）中启动 Roleplay Hub。

*(注：如果您遇到跨域或本地文件读取权限问题，可以尝试使用 VS Code 的 `Live Server` 插件，或简单的本地服务器工具来运行该目录。但在绝大多数现代浏览器中，双击 index.html 即可正常使用所有核心功能。)*

### 2. 初始化设置
1. 打开应用后，点击侧边栏（或顶部菜单）的**设置 (Settings)** 选项。
2. 选择自定义配置，填入您自己的或第三方提供的 API 节点 (`API URL`)。
3. 填入对应的 `API Key`，并输入或选择您想使用的 `模型名称 (Model)`。
4. 在**角色管理**界面，导入您的角色卡文件（或点击新建角色并手动填写设定）。
5. 回到对话界面，开始属于您的 Roleplay 旅程

---

## 目录结构 (Directory Structure)

```text
Roleplay-Hub/
├── index.html                     # 主界面与脚本加载入口
├── character/                     # 角色卡生成工具
│   └── index.html
├── novel/                         # 墨韵 · 造梦
│   └── index.html
├── assets/
│   ├── css/
│   │   └── styles.css             # 全局样式
│   └── js/
│       ├── built-in-content.js    # 默认预设、模式提示词、画师串与更新公告
│       ├── core-utils.js          # 通用工具、角色卡处理与基础配置
│       ├── data-services.js       # 存储、记忆、上下文、分支与 UI 状态
│       ├── runtime-services.js    # API 请求、消息渲染与运行状态
│       ├── ui-components.js       # 选择器、侧边栏、弹窗与页面组件
│       └── app.js                 # 主业务入口与页面状态
└── README.md                      # 项目说明
```

### 代码组织说明

页面会按照上方顺序加载 JavaScript 文件，请不要随意调整依赖顺序。

- 修改默认预设、各模式提示词、生图画师串或工具说明时，统一编辑 `built-in-content.js`。
- 更新公告固定放在 `built-in-content.js` 最底部，方便查找和替换。
- 可复用界面统一放在 `ui-components.js`，业务数据处理放在 `data-services.js`。
- 项目没有构建步骤，修改后刷新浏览器即可验证。

---

## 协议与许可 (License)

本项目严格遵守以下开源协议：

**[Creative Commons Attribution-NonCommercial 4.0 International (CC BY-NC 4.0)](https://creativecommons.org/licenses/by-nc/4.0/deed.zh-hans)**

* **您可以**：自由地共享（在任何媒介以任何形式复制、发行本作品）与演绎（修改、转换或以本作品为基础进行创作）。
* **您必须**：
  * **署名 (Attribution)**：给出适当的署名，提供指向本许可协议的链接，同时标明是否对原始作品作了修改。
  * **非商业性使用 (NonCommercial)**：**您不得将本作品或演绎作品用于任何商业目的。** 禁止任何形式的售卖、付费订阅集成或利用本项目进行广告牟利。
* 若要获取本项目的商业授权，请直接联系项目原作者。

详细许可条款请参见根目录下的 [`LICENSE`](./LICENSE) 文件。
