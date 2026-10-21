# Qimiao

**Your apps, commands, and ideas—one effortless starting point.**

[简体中文](README.md) · [Download the latest release](https://github.com/amiaoapp/qimiao/releases/latest)

Qimiao is a productivity launcher for macOS, Windows, and Linux. Open it with a hotkey to find apps, files, or commands, then move naturally into clipboard history, quick calculations, emoji, shortcuts, or AI queries. Less window-hunting, fewer interruptions—a single place to get moving.

Qimiao is built with Tauri 2, Rust, React, and TypeScript. Its Chinese name is “启喵.” Installers use the `Qimiao_` or `qimiao_` filename prefix, and the app icon pairs a cat-head mark with the letter Q.

## Download

Download an installer for macOS, Windows, or Linux from [GitHub Releases](https://github.com/amiaoapp/qimiao/releases/latest). Search supports Chinese and English, as well as Pinyin and initials.

## Preview

![Qimiao launcher interface preview](https://github.com/user-attachments/assets/e279ef7c-510a-4219-9aaf-af7b8f4a0dfe)

## Features

- Choose automatic system-app discovery or turn it off and add apps manually. Scans can be reviewed before applying, and uninstalled apps can be cleaned up.
- Launchpad-style pages, a vertical list view, two-dimensional keyboard navigation, and smart recommendations.
- Favorites and recommendations share the top area. More than three favorites collapse into the first stack icon, leaving the following positions for recommendations. Includes app categories, Chinese aliases, Pinyin and initial-letter search, and configuration backup.
- Drag app icons together to create groups, expand groups, rename them, or move apps back out.
- Organize uncategorized apps into existing categories in one step without changing manual assignments. List mode can automatically narrow the window.
- Native `NSGlassEffectView` liquid-glass effects on macOS 26 and later, with visual fallbacks for older macOS versions, Windows, and Linux.
- Separate global hotkeys for the launcher, clipboard, and Command Center; menu-bar mode, hide-on-blur or Escape, and launch at login.
- Command Center with Tab-based mode switching, clipboard history, file search, inline calculations and unit conversions, emoji, and Apple Shortcuts.
- System actions and window-layout commands, with confirmation for destructive operations.
- Clipboard history stays local by default. Optionally sync clipboard data or app configuration with your own WebDAV server. Credentials are stored in the system keychain, and sensitive entries and file paths are excluded from uploads.
- Clipboard support for images, files, and rich text, plus sensitive-content filtering, cleanup, pins, groups, editing, export, and relay paste.
- Quicklinks, text snippets, notes, and custom commands with parameter placeholders, run confirmation, working directories, captured output, and configuration backup and migration.
- Import `.tinycast` files on macOS, or import TinyCast/Raycast JSON configurations across platforms.
- OpenAI-compatible AI queries and translation.
- Dictionary entry point, common system actions, nine window layouts, JSON formatting, UTF-8 Base64 encoding and decoding, timestamp conversion, and common unit conversions.
- Chinese and English interface; search and preview locally installed fonts. Interface animations can be disabled and respect the system's reduced-motion preference.
- Compact mode keeps search, recents, and common commands. Windows also supports manually adding multiple apps at once.

## Development

Node.js, Rust, and the system dependencies required by Tauri are needed.

```bash
npm install
npm run tauri dev
```

Run the regression tests:

```bash
npm test
cargo test --manifest-path src-tauri/Cargo.toml --lib
```

## Build

```bash
npm run tauri build
```

The GitHub Releases workflow builds installers for Apple Silicon and Intel Macs, Windows x64, Linux x64, and Linux ARM64. macOS builds use ad-hoc signing.

## License and acknowledgements

Copyright © 2026 APP Miao.

Qimiao as a whole is licensed under [GNU AGPL-3.0-or-later](LICENSE). If you distribute a modified version or make modified functionality available over a network, you must provide the corresponding source under the AGPL and retain copyright and license notices.

Parts of the command model, import compatibility, and feature implementation are adapted from TinyCast. See [NOTICE.md](NOTICE.md) for the upstream revision, copyright, and modification notes.

Some clipboard behavior is adapted from [PasteMemo](https://github.com/lifedever/PasteMemo-app), which is licensed under GPL-3.0; its original license and copyright notices are preserved. See [Clipboard and WebDAV](docs/clipboard-and-sync.md) for the adaptation scope, privacy limits, and sync behavior. This is not a complete port of PasteMemo's peripheral OCR, MCP, or SMS features.

See the [TinyCast compatibility notes](docs/tinycast-compatibility.md) for platform compatibility and capabilities that are not yet implemented.
