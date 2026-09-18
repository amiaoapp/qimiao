# TinyCast 功能整合说明

启喵保留自己的 Launchpad 式应用首页，并在同一搜索框内提供命令中心。项目整体采用 AGPL-3.0-or-later，并以 TinyCast 当前公开的数据模型、导入格式与交互行为为兼容目标。兼容层直接运行在启喵自己的 Rust/React/Tauri 进程内，不调用 TinyCast 程序。

## 已接入的第一批能力

- 应用启动、收藏、分类、模糊/拼音搜索与键盘导航（启喵原有能力）
- `Tab` / `Shift+Tab` 在应用、命令、剪贴板之间切换
- 本地剪贴板文本历史，最多 100 条，可关闭
- 安全的四则运算、括号、幂与常用长度/重量/容量换算
- `file:` / `文件:` 搜索本机文件，可在设置里限制搜索目录
- `emoji:` / `表情:` 搜索并复制 Emoji
- `shortcut:` / `捷径:` 搜索并执行 Apple Shortcuts（仅 macOS）
- 九种常用窗口布局：左右/上下半屏、居中、最大化、近似最大化、最大宽度和最大高度
- 锁屏、睡眠、显示器、屏保、媒体、音量、桌面、废纸篓及会话操作；危险操作会二次确认
- `dict:` / `define` / `词典:` 查询词典，以及从命令中心打开日历
- 本地 Quicklinks、Snippets、笔记和无 shell 的自定义命令（右键条目可删除）
- 现有 OpenAI Compatible AI 模式

创建本地命令库条目时可直接在命令模式输入：

- `link: 名称 | https://example.com`
- `snippet: 名称 | 要复用的文本或代码`
- `note: 标题 | 正文`
- `cmd: 名称 | 程序 | 参数`

## 兼容策略

启喵接受自身备份、TinyCast Quicklinks JSON、TinyCast `settings.json` 结构，以及已解密的 Raycast JSON 数据；导入时会转换 Quicklinks、Snippets、Notes、文本剪贴板历史与 Custom Commands，并避免由备份自动开启权限型能力。macOS 可直接读取 TinyCast 的 AppleArchive/LZFSE `.tinycast` 包；Windows/Linux 可导入解包后的 JSON 数据。

下面的能力仍需要平台适配或完整运行时：

- 富文本笔记编辑器与自定义命令表单
- 日历事件/会议、选中文本 Quick Actions、菜单搜索与窗口切换
- 自定义多窗口布局及逐命令快捷键
- 汇率/加密货币在线换算
- Raycast 扩展 React API、OAuth、存储和视图运行时
- 加密 `.rayconfig` 的原生读取

Raycast 扩展并不是普通 JavaScript 插件：它依赖 Raycast 的 React API、存储、权限、OAuth 和视图运行时。启喵将逐项实现兼容 API，并对暂不支持的扩展明确标注，而不是调用 Raycast 或 TinyCast 程序。
