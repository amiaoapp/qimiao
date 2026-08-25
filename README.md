# 启喵 / Qimiao

**智能跨平台启动器**

> A smart cross-platform launcher by APP Miao.

启喵使用 Tauri 2、Rust、React 和 TypeScript 构建，支持 macOS、Windows 与 Linux。它把应用启动、中文与拼音搜索、智能推荐、AI 查询和可扩展命令统一到一个轻量窗口中。

Qimiao is a Tauri 2 + Rust launcher for macOS, Windows, and Linux. It brings app discovery, bilingual search, recommendations, AI queries, and extensible commands into one lightweight window.

## 截图 / Screenshot

<img width="2344" height="1504" alt="image" src="https://github.com/user-attachments/assets/e279ef7c-510a-4219-9aaf-af7b8f4a0dfe" />



## 功能 / Features

- 自动扫描并启动系统应用；支持收藏、分类、中文、全拼与首字母搜索
- Launchpad 式分页、纵向列表、键盘二维导航与智能推荐行
- macOS 26+ 原生 `NSGlassEffectView` 液态玻璃，旧系统与其他平台提供视觉回退
- 自定义全局快捷键、菜单栏常驻、失焦隐藏、开机启动
- OpenAI Compatible AI 查询与翻译
- 中英文界面
- SuperCmd 兼容桥：读取已安装的 SuperCmd / Raycast 扩展命令，在启喵中搜索并通过官方 SuperCmd 运行时执行
- 内置 SuperCmd 扩展商店目录，支持从官方商店继续安装扩展

---

- Automatic application discovery, favorites, categories, Chinese/Pinyin/initial search
- Launchpad-style pagination, vertical list view, 2D keyboard navigation, smart recommendations
- Native macOS 26+ `NSGlassEffectView` with polished fallbacks on older macOS, Windows, and Linux
- Custom global hotkeys, menu-bar mode, blur-to-hide, launch at login
- OpenAI-compatible AI search and translation
- Chinese and English interface
- SuperCmd compatibility bridge for discovering and launching installed SuperCmd/Raycast extension commands
- Built-in access to the official SuperCmd extension catalog

## SuperCmd 兼容说明 / Compatibility

启喵不会把 Electron/Node 运行时打进 Tauri 安装包。扩展命令由用户安装的 SuperCmd 官方运行时执行，因此可继续使用 SuperCmd 的 Raycast API 兼容层、权限和插件数据。若尚未安装 SuperCmd，启喵会打开其官方下载页。

Qimiao keeps its Tauri architecture and delegates compatible extension execution to an installed official SuperCmd runtime. This preserves SuperCmd's Raycast API shim, permissions, and extension data without embedding a second desktop runtime.

SuperCmd is an independent MIT-licensed project. See [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

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

Copyright © APP喵. All rights reserved.
