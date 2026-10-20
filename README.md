# 启喵 / Qimiao

**智能跨平台启动器**

**说明：这个项目就自用了，感觉市面上启动器也挺多，我就不浪费时间造轮子丰富功能了，所以慢更新，自己用着不顺手了再修改。**

> A smart cross-platform launcher by APP Miao.

启喵使用 Tauri 2、Rust、React 和 TypeScript 构建，支持 macOS、Windows 与 Linux。它保留 Launchpad 式应用首页，同时把命令、文件、剪贴板、计算、Emoji、快捷指令与 AI 查询统一到同一个搜索框中。

Qimiao is a Tauri 2 + Rust launcher for macOS, Windows, and Linux. It keeps a Launchpad-style app home while bringing commands, files, clipboard history, calculations, emoji, shortcuts, and AI into one search box.

正式英文名为 **Qimiao**，中文名保留“启喵”。1.0 起安装包统一使用 `Qimiao_` / `qimiao_` 英文名称前缀，避免下载时中文名称被剥离；图标采用猫头与字母 Q。应用标识保持不变，沿用本机已有设置与剪贴板数据。

[下载最新版本 / Download](https://github.com/amiaoapp/qimiao/releases/latest)

## 截图 / Screenshot

<img width="2344" height="1504" alt="image" src="https://github.com/user-attachments/assets/e279ef7c-510a-4219-9aaf-af7b8f4a0dfe" />



## 功能 / Features

- 可选择自动扫描系统应用，也可完全关闭扫描并逐个添加应用；扫描确认可选，刷新会清理已卸载应用
- 收藏与智能推荐共用顶部一排；收藏超过三个时收进第一个堆叠图标，后续位置保留推荐；支持分类横向浏览、中文别名、全拼与首字母搜索及配置备份
- 一键按已有分类整理未分类应用，保留手动分类；列表模式自动收窄窗口
- Launchpad 式分页、纵向列表、键盘二维导航与智能推荐行
- macOS 26+ 原生 `NSGlassEffectView` 液态玻璃，旧系统与其他平台提供视觉回退
- 启动器、剪贴板、命令中心各有独立全局快捷键，菜单栏常驻、失焦或 Esc 隐藏、开机启动
- OpenAI Compatible AI 查询与翻译
- 命令中心：Tab 模式切换、剪贴板历史、文件搜索、内联计算与单位换算、Emoji、Apple 快捷指令
- 原生系统操作与窗口布局命令；剪贴板默认只在本机记录，可选择开启自有 WebDAV 同步
- 参考并移植 PasteMemo 的剪贴板类型识别、敏感过滤、文本清理和接力拆分；支持图片/文件/富文本、置顶分组、编辑导出及接力粘贴
- WebDAV 分别同步剪贴板和软件配置，密码保存在系统密钥库；敏感条目与文件路径不上传，配置恢复不改动密钥和设备设置
- 本地 Quicklinks、Snippets、笔记与自定义命令；支持参数占位符、运行确认、工作目录、输出捕获及配置备份迁移
- macOS 可直接导入 `.tinycast`；JSON 形式的 TinyCast/Raycast 数据可跨平台导入
- 词典入口、常用系统操作及九种窗口布局操作；破坏性操作需要确认
- 中英文界面
- 本机字体搜索、实时预览与切换；界面动效可关闭，并尊重系统减少动态效果偏好
- 顶部留白可拖动窗口，重新唤起时恢复居中稍偏下的位置
- 简洁模式仅保留搜索、最近记录与常用命令；Windows 统一入口手动批量添加应用
- 完整/简洁模式以窗口中心展开收起；剪贴板横向分类、双栏预览、右键菜单与固定粘贴栏
- JSON 格式化、UTF-8 Base64 编解码、时间戳转换；单位换算支持时间、温度和中文常见单位

---

- Optional automatic discovery or a fully manual app list, optional scan review, and automatic cleanup of uninstalled apps
- A persistent favorites shelf on every page, independent of sorting; horizontally navigable categories, Chinese aliases/Pinyin search and configuration backup/restore
- One-click local classification into existing categories, preserving manual assignments; a narrower single-column list view
- Launchpad-style pagination, vertical list view, 2D keyboard navigation, smart recommendations
- Native macOS 26+ `NSGlassEffectView` with polished fallbacks on older macOS, Windows, and Linux
- Custom global hotkeys, menu-bar mode, blur/Escape-to-hide, launch at login
- OpenAI-compatible AI search and translation
- Command Center with Tab mode switching, clipboard history, file search, inline calculations and unit conversions, emoji, and Apple Shortcuts
- Native system/window actions; clipboard history stays local unless you explicitly enable your own WebDAV server
- PasteMemo-adapted clipboard classification, sensitive-content filtering, cleanup rules and relay splitting; images, files, rich text, pins, groups, editing and export
- Separate clipboard/configuration WebDAV sync, native credential storage and conflict-safe writes; sensitive entries and file paths are excluded
- Local Quicklinks, snippets, notes, and custom commands with placeholders, confirmation, working directories, captured output, and backup migration
- Direct `.tinycast` import on macOS, plus cross-platform TinyCast/Raycast JSON migration
- Dictionary entry point, common system actions, and nine window layouts with confirmation for destructive actions
- Chinese and English interface
- Search, preview, and apply locally installed fonts; optional interface animations respect reduced motion
- Drag the window from its top edge; reopening restores the centered, slightly lower position
- Compact mode with search, recents, and common commands; one manual, multi-select app importer on Windows

## 开发 / Development

```bash
npm install
npm run tauri dev
```

回归检查 / Regression checks: `npm test` and `cargo test --manifest-path src-tauri/Cargo.toml --lib`.

## 构建 / Build

```bash
npm run tauri build
```

GitHub Releases 自动构建 Apple Silicon 与 Intel macOS、Windows x64、Linux x64 和 Linux ARM64 安装包。macOS 使用 ad-hoc 签名。

GitHub Releases builds Apple Silicon and Intel macOS, Windows x64, Linux x64, and Linux ARM64 packages. macOS artifacts use ad-hoc signing.

## License

Copyright © 2026 APP Miao.

启喵整体采用 [GNU AGPL-3.0-or-later](LICENSE) 授权。分发修改版或通过网络向用户提供修改版功能时，须按 AGPL 提供对应源代码并保留版权与许可证声明。

qimiao is licensed under [GNU AGPL-3.0-or-later](LICENSE). Modified distributions and modified network deployments must make their corresponding source available under the AGPL and preserve copyright and license notices.

部分命令模型、导入兼容与功能实现移植自 TinyCast。上游版本、版权和修改说明见 [NOTICE.md](NOTICE.md)。

Parts of the command model, import compatibility, and feature behavior are adapted from TinyCast. See [NOTICE.md](NOTICE.md) for the upstream revision, copyright, and modification notes.

剪贴板的部分行为移植自 GPL-3.0 的 [PasteMemo](https://github.com/lifedever/PasteMemo-app)，原有授权与版权声明予以保留。移植范围、隐私限制及同步说明见 [Clipboard and WebDAV](docs/clipboard-and-sync.md)，本项目没有完整移植 PasteMemo 的 OCR、MCP 与 SMS 等外围功能。

Clipboard behavior includes GPLv3-covered PasteMemo adaptations, with upstream licensing preserved. See [Clipboard and WebDAV](docs/clipboard-and-sync.md) for implemented features, limitations, privacy and synchronization behavior; this is not a complete port of PasteMemo's OCR/MCP/SMS integrations.

兼容范围与尚待补齐的平台能力见 [TinyCast compatibility matrix](docs/tinycast-compatibility.md)。
