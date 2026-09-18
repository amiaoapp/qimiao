# TinyCast compatibility matrix

This document tracks functional and data compatibility against TinyCast revision `7dc4450fa011ccebe72d7f7cec9ff53e05806785`. “Compatible” means the behavior runs inside qimiao; qimiao never launches TinyCast as a helper.

| Area | Status | Current compatibility |
| --- | --- | --- |
| Launcher and app search | Compatible | qimiao keeps its Launchpad grid, fuzzy/Pinyin search, categories, favorites and keyboard navigation. |
| Global launcher shortcut | Compatible | Configurable global shortcut with conflict handling. |
| Quicklinks | Core compatible | Imports TinyCast and Raycast JSON, preserves enablement/pinning/open-with metadata, understands paths, web URLs and deeplinks, and expands common dynamic placeholders. |
| Snippets | Core compatible | Imports TinyCast Markdown frontmatter and Raycast JSON; supports keywords, nested references, arguments, clipboard/date/UUID tokens and common modifier pipelines. |
| Custom commands | Core compatible | Imports TinyCast command records, positional arguments, confirmation, working-directory and output metadata; execution remains shell-free by default. |
| Notes | Data compatible | Imports TinyCast Markdown notes as searchable qimiao command items. A dedicated Markdown editor is not yet present. |
| Clipboard | Text compatible | Captures and searches local text history and imports text entries from `.tinycast`; image/file history and pinning are pending. |
| Calculator | Partial | Safe arithmetic and common unit conversion work; live currency/crypto rates and history are pending. |
| File search | Partial | Scoped cross-platform filename search works; Spotlight ranking and ignore-rule parity are pending. |
| Emoji | Partial | Search and copy work; skin-tone/frequency ranking parity is pending. |
| Apple Shortcuts | Compatible on macOS | Lists and runs shortcuts. Alias/per-shortcut hotkey management is pending. |
| Window management | Core compatible | Nine common placements are implemented cross-platform; persisted custom multi-window layouts remain pending. |
| System actions | Core compatible | Lock, sleep, display, media, volume, desktop, Trash and session actions are available where the host OS exposes them. Destructive actions require confirmation. |
| Backup migration | Core compatible on macOS | Direct `.tinycast` import for settings, Quicklinks, commands, Snippets, Notes and text clipboard history. JSON import works cross-platform. |
| Raycast migration | Partial | Decrypted Raycast JSON maps Quicklinks and Snippets. Encrypted `.rayconfig` support is pending. |
| Calendar/meetings/camera | Partial | Opens the system/web calendar from the command center; event listing, meeting join and camera preview still require native permission adapters. |
| Dictionary | Core compatible | `dict:` / `define` queries open the native macOS Dictionary result, with a web definition fallback on Windows/Linux. |
| Menu search/window switch/quick actions | Pending | Requires platform-specific accessibility adapters. |
| Raycast extensions | Pending | Requires the Raycast React API, storage, OAuth and view runtime; compatibility must be explicit per API. |

The matrix is intentionally strict: a stored field or a similar-looking button is not counted as full compatibility unless its behavior runs end to end.
