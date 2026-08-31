# 启喵 / qimiao

**智能跨平台启动器**

**说明：这个项目就自用了，感觉市面上启动器也挺多，我就不浪费时间造轮子丰富功能了，所以慢更新，自己用着不顺手了再修改。**

> A smart cross-platform launcher by APP Miao.

启喵使用 Tauri 2、Rust、React 和 TypeScript 构建，支持 macOS、Windows 与 Linux。它把应用启动、中文与拼音搜索、智能推荐和 AI 查询统一到一个轻量窗口中。

qimiao is a Tauri 2 + Rust launcher for macOS, Windows, and Linux. It brings app discovery, bilingual search, recommendations, and AI queries into one lightweight window.

## 截图 / Screenshot

<img width="2344" height="1504" alt="image" src="https://github.com/user-attachments/assets/e279ef7c-510a-4219-9aaf-af7b8f4a0dfe" />



## 功能 / Features

- 可选择自动扫描系统应用，也可完全关闭扫描并逐个添加应用；扫描确认可选，刷新会清理已卸载应用
- 支持收藏、分类横向浏览、中文、全拼与首字母搜索，以及配置备份导入导出
- Launchpad 式分页、纵向列表、键盘二维导航与智能推荐行
- macOS 26+ 原生 `NSGlassEffectView` 液态玻璃，旧系统与其他平台提供视觉回退
- 自定义全局快捷键、菜单栏常驻、失焦或 Esc 隐藏、开机启动
- OpenAI Compatible AI 查询与翻译
- 中英文界面

---

- Optional automatic discovery or a fully manual app list, optional scan review, and automatic cleanup of uninstalled apps
- Favorites, horizontally navigable categories, Chinese/Pinyin/initial search, and portable configuration backup/restore
- Launchpad-style pagination, vertical list view, 2D keyboard navigation, smart recommendations
- Native macOS 26+ `NSGlassEffectView` with polished fallbacks on older macOS, Windows, and Linux
- Custom global hotkeys, menu-bar mode, blur/Escape-to-hide, launch at login
- OpenAI-compatible AI search and translation
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

Copyright © APP喵. All rights reserved.
