# Notices

## qimiao / 启喵

Copyright © 2026 APP Miao.

qimiao is licensed under the GNU Affero General Public License, version 3 or (at your option) any later version. See `LICENSE`.

## TinyCast

Portions of qimiao's command model, import compatibility, placeholder behavior, and feature implementation are adapted from TinyCast:

- Project: <https://github.com/abue-ammar/tinycast>
- Upstream revision used for compatibility work: `7dc4450fa011ccebe72d7f7cec9ff53e05806785`
- Copyright © 2026 Abue Ammar
- License: GNU AGPL-3.0-or-later

Those portions were modified and ported from TinyCast's Swift/AppKit implementation to qimiao's cross-platform Rust, React, TypeScript, and Tauri architecture. qimiao retains its own Launchpad-style application interface and does not require the TinyCast process to run.

TinyCast and Raycast are names of their respective owners. Compatibility does not imply endorsement.

## PasteMemo

Clipboard classification, sensitive-content heuristics, built-in text rules and relay splitting in `src/clipboard-core.ts` are adapted from PasteMemo:

- Project: <https://github.com/lifedever/PasteMemo-app>
- Upstream revision: `100ee8f548314c302ab7ed6391ae919d3b565f51`
- Copyright (c) 2026 lifedever
- License: GNU GPL version 3; see `licenses/PasteMemo-GPL-3.0.txt`
- Adapted from `ClipItem.swift`, `SensitiveDetector.swift`, `BuiltInRules.swift` and `RelaySplitter.swift`; ported to TypeScript and modified for cross-platform history, privacy filtering, retention and synchronization in October 2026.

PasteMemo's GPL-covered portions retain their GPL terms. The combined work is conveyed under AGPLv3 as permitted by GPLv3 section 13; this does not relicense the upstream project. The Rust clipboard transport, WebDAV protocol, React workspace and new cat/arrow artwork are qimiao implementations. PasteMemo's OCR, MCP, SMS bridge, system-wide keyword expansion and rule editor are not included in this port. No separately installed PasteMemo process is required.
