# 启喵（Qimiao）

**智能跨平台启动器**

[English](README.en.md) · [下载最新版本](https://github.com/amiaoapp/qimiao/releases/latest)

启喵是一款面向 macOS、Windows 和 Linux 的桌面启动器。它以 Launchpad 式应用首页为基础，将应用、命令、文件、剪贴板、计算、Emoji、快捷指令和 AI 查询整合到同一个搜索入口。

软件使用 Tauri 2、Rust、React 和 TypeScript 构建。中文名为“启喵”，英文名为 **Qimiao**；安装包使用 `Qimiao_` 或 `qimiao_` 前缀，应用图标以猫头和字母 Q 为标识。

## 下载

前往 [GitHub Releases](https://github.com/amiaoapp/qimiao/releases/latest) 下载适用于 macOS、Windows 或 Linux 的安装包。

## 功能

- 可选择自动扫描系统应用，也可关闭扫描并手动添加；支持扫描确认和清理已卸载应用。
- Launchpad 式分页、纵向列表、键盘二维导航和智能推荐。
- 收藏与智能推荐共用顶部区域；收藏超过三个时收进第一个堆叠图标，后续位置保留推荐。支持应用分类、中文别名、全拼和首字母搜索，以及配置备份。
- 可拖拽应用图标合并分组、展开分组、重命名分组，也可将应用移出分组。
- 一键按已有分类整理未分类应用，同时保留手动分类；列表模式可自动收窄窗口。
- macOS 26 及以上版本使用原生 `NSGlassEffectView` 液态玻璃效果；旧版 macOS、Windows 和 Linux 提供相应视觉回退。
- 启动器、剪贴板和命令中心支持独立全局快捷键；可驻留菜单栏、失焦或按 Esc 隐藏，并支持开机启动。
- 命令中心支持 Tab 切换模式、剪贴板历史、文件搜索、即时计算和单位换算、Emoji 与 Apple 快捷指令。
- 提供系统操作和窗口布局命令；破坏性操作会要求确认。
- 剪贴板记录默认保存在本机；可选择使用自己的 WebDAV 服务同步剪贴板或软件配置。密码保存在系统密钥库，敏感条目与文件路径不会上传。
- 支持图像、文件和富文本剪贴板内容、敏感信息过滤、清理、置顶分组、编辑、导出及接力粘贴。
- 支持 Quicklinks、文本片段、笔记和自定义命令，包括参数占位符、运行确认、工作目录、输出捕获及配置备份迁移。
- 支持 macOS `.tinycast` 导入，以及跨平台 TinyCast/Raycast JSON 配置导入。
- 支持 OpenAI 兼容的 AI 查询和翻译。
- 提供词典入口、常用系统操作、九种窗口布局操作、JSON 格式化、UTF-8 Base64 编解码、时间戳转换和常见单位换算。
- 支持中英文界面、本机字体搜索与预览；界面动效可关闭，并遵循系统减少动态效果设置。
- 简洁模式保留搜索、最近记录和常用命令；Windows 支持手动批量添加应用。

## 开发

需要 Node.js、Rust 和 Tauri 所需的系统依赖。

```bash
npm install
npm run tauri dev
```

运行回归测试：

```bash
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

## 构建

```bash
npm run tauri build
```

GitHub Releases 工作流会构建 Apple Silicon 与 Intel macOS、Windows x64、Linux x64 和 Linux ARM64 安装包。macOS 构建使用 ad-hoc 签名。

## 许可证与致谢

版权所有 © 2026 APP Miao。

启喵整体采用 [GNU AGPL-3.0-or-later](LICENSE) 授权。分发修改版或通过网络向用户提供修改版功能时，须按 AGPL 提供对应源代码，并保留版权与许可证声明。

部分命令模型、导入兼容与功能实现移植自 TinyCast。上游版本、版权和修改说明见 [NOTICE.md](NOTICE.md)。

剪贴板的部分行为移植自 GPL-3.0 的 [PasteMemo](https://github.com/lifedever/PasteMemo-app)，并保留原有授权与版权声明。移植范围、隐私限制及同步说明见[剪贴板与 WebDAV 文档](docs/clipboard-and-sync.md)；本项目没有完整移植 PasteMemo 的 OCR、MCP 与 SMS 等外围功能。

兼容范围与尚待补齐的平台能力见 [TinyCast 兼容性说明](docs/tinycast-compatibility.md)。
