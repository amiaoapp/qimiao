# Notices

## Liquid Glass React

The background-only SVG refraction and RGB separation in `src/LiquidGlassSurface.tsx` are adapted from <https://github.com/rdev/liquid-glass-react>, `src/index.tsx` (upstream blob `a0e6b7242d2c66c598eecdfbe33815d996621571`). Qimiao uses its own rounded-rectangle displacement map, window layout, native macOS material, and reduced-transparency fallback.

Copyright 2025 MAX ROVENSKY

Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

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
