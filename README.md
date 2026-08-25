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
- 启喵原生扩展运行时：直接下载、安装、索引和运行 Raycast 格式扩展，不调用 SuperCmd 或 Raycast 程序
- 内置扩展商店、快捷触发键、插件资源与本地存储；支持 List、Grid、Detail、Form、Action 等常用 Raycast API

---

- Automatic application discovery, favorites, categories, Chinese/Pinyin/initial search
- Launchpad-style pagination, vertical list view, 2D keyboard navigation, smart recommendations
- Native macOS 26+ `NSGlassEffectView` with polished fallbacks on older macOS, Windows, and Linux
- Custom global hotkeys, menu-bar mode, blur-to-hide, launch at login
- OpenAI-compatible AI search and translation
- Chinese and English interface
- First-party extension runtime that installs and runs Raycast-format bundles inside Qimiao without launching SuperCmd or Raycast
- Built-in extension catalog, command triggers, assets, local storage, and common Raycast APIs including List, Grid, Detail, Form, and Action

## 扩展兼容说明 / Extension compatibility

启喵把扩展安装到自己的应用数据目录，并在 Tauri WebView 内通过受控的 React / Raycast API 兼容层运行预构建扩展包。当前优先兼容 UI、网络、剪贴板、资源读取和本地存储类扩展；依赖未实现 Node 原生模块或特定 macOS 自动化能力的命令会显示清晰的兼容性错误，不会静默调用其他启动器。

Qimiao installs extensions into its own app-data directory and executes prebuilt bundles through a controlled React/Raycast API layer inside the Tauri WebView. UI, network, clipboard, asset, and local-storage extensions are the initial compatibility focus. Commands that need unsupported native Node modules or macOS automation surface an explicit compatibility error and never delegate to another launcher.

The extension manifest and bundle format are compatible with the Raycast ecosystem. The community catalog currently follows the public SuperCmd catalog contract. SuperCmd is an independent MIT-licensed project; see [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).

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
