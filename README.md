# 启喵 / qimiao

**智能跨平台启动器**

**说明：这个项目就自用了，感觉市面上启动器也挺多，我就不浪费时间造轮子丰富功能了，所以慢更新，自己用着不顺手了再修改。**

> A smart cross-platform launcher by APP Miao.

启喵使用 Tauri 2、Rust、React 和 TypeScript 构建，支持 macOS、Windows 与 Linux。它保留 Launchpad 式应用首页，同时把命令、文件、剪贴板、计算、Emoji、快捷指令与 AI 查询统一到同一个搜索框中。

qimiao is a Tauri 2 + Rust launcher for macOS, Windows, and Linux. It keeps a Launchpad-style app home while bringing commands, files, clipboard history, calculations, emoji, shortcuts, and AI into one search box.

## 截图 / Screenshot

<img width="2344" height="1504" alt="image" src="https://github.com/user-attachments/assets/e279ef7c-510a-4219-9aaf-af7b8f4a0dfe" />



## 功能 / Features

- 可选择自动扫描系统应用，也可完全关闭扫描并逐个添加应用；扫描确认可选，刷新会清理已卸载应用
- 支持收藏、分类横向浏览、中文、全拼与首字母搜索，以及配置备份导入导出
- Launchpad 式分页、纵向列表、键盘二维导航与智能推荐行
- macOS 26+ 原生 `NSGlassEffectView` 液态玻璃，旧系统与其他平台提供视觉回退
- 自定义全局快捷键、菜单栏常驻、失焦或 Esc 隐藏、开机启动
- OpenAI Compatible AI 查询与翻译
- 命令中心：Tab 模式切换、剪贴板历史、文件搜索、内联计算与单位换算、Emoji、Apple 快捷指令
- 原生系统操作与窗口布局命令；文件和剪贴板内容只在本机处理
- 本地 Quicklinks、Snippets、笔记与无 shell 的自定义命令；随配置备份迁移
- macOS 可直接导入 `.tinycast`；JSON 形式的 TinyCast/Raycast 数据可跨平台导入
- 词典入口、常用系统操作及九种窗口布局操作；破坏性操作需要确认
- 中英文界面

---

- Optional automatic discovery or a fully manual app list, optional scan review, and automatic cleanup of uninstalled apps
- Favorites, horizontally navigable categories, Chinese/Pinyin/initial search, and portable configuration backup/restore
- Launchpad-style pagination, vertical list view, 2D keyboard navigation, smart recommendations
- Native macOS 26+ `NSGlassEffectView` with polished fallbacks on older macOS, Windows, and Linux
- Custom global hotkeys, menu-bar mode, blur/Escape-to-hide, launch at login
- OpenAI-compatible AI search and translation
- Command Center with Tab mode switching, clipboard history, file search, inline calculations and unit conversions, emoji, and Apple Shortcuts
- Native system/window actions; file and clipboard data stays on the device
- Local Quicklinks, snippets, notes, and shell-free custom commands, included in configuration backups
- Direct `.tinycast` import on macOS, plus cross-platform TinyCast/Raycast JSON migration
- Dictionary entry point, common system actions, and nine window layouts with confirmation for destructive actions
- Chinese and English interface

## 开发 / Development

```bash
npm install
npm run tauri dev
```

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

兼容范围与尚待补齐的平台能力见 [TinyCast compatibility matrix](docs/tinycast-compatibility.md)。
