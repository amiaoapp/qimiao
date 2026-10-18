# Clipboard and WebDAV

## Local clipboard workspace

The desktop app reads text, HTML, images and file references using `clipboard-rs`, not shell polling. macOS and Windows use the native change counter to skip unchanged content. Linux uses polling and cannot attribute the source app. Unsupported clipboard formats are ignored.

History supports search, type filters, pinning, favorites, groups, manual entries, editing, deletion, exporting, original/plain-text paste, paste-and-Enter, and a persistent relay queue with newline/comma/custom splitting. Arrow keys select; Enter pastes; Shift+Enter pastes and sends Enter; Command/Ctrl+1…9 pastes an indexed item. IME composition is excluded. Automatic paste requires Accessibility/Automation permission on macOS. Windows may block simulated input into elevated apps. Linux automatic paste requires xdotool on an X11-compatible desktop; Wayland users may need manual paste.

Password managers and concealed/transient formats are excluded where the platform exposes them. Text heuristics are best-effort, not a security guarantee. Sensitive entries are excluded from sync even if local recording is enabled. Local disk history is not encrypted; use operating-system disk encryption for sensitive devices. Pinned records are exempt from retention and count cleanup. Deletion markers are retained for 180 days to avoid resurrection during offline merges; devices offline longer than that should clear old local history before rejoining.

Original PNGs are stored on disk under the app's `clipboard/images/` data directory, keyed by SHA-256. JSON history holds thumbnails, not original images. Individual text/HTML, image, pixel and database size limits prevent unbounded loads. Database limit errors are visible in the clipboard workspace; reduce retention or the record limit before retrying. Clearing history does not erase original image caches or external files; uninstall/data-directory removal is required to erase the complete local cache.

The PasteMemo adaptation covers history, classification, sensitive-content heuristics, built-in cleanup rules and relay workflows, **not all upstream functionality**. OCR, MCP integration, SMS bridge, global keyword expansion and an arbitrary rule editor are not implemented. See `NOTICE.md` for exact source attribution and license terms.

## WebDAV

Both sync switches are off by default. Enter an existing WebDAV folder's final URL, username and app password in Settings. Test the connection, then separately enable clipboard and/or configuration sync. The app creates `qimiao/clipboard.json`, `qimiao/configuration.json` and optional `qimiao/images/<hash>.png` beneath that folder.

Passwords are kept in the native credential store (macOS Keychain, Windows Credential Manager, Linux Secret Service), or process memory when remembering is disabled. They are not put in browser storage, JSON backups or configuration sync. The server URL and username stay in local settings; ordinary exported backups omit both. Disabling a sync switch does not delete remote files; clearing saved credentials does not delete remote files either.

HTTPS is required except for localhost or an explicit insecure-HTTP opt-in. Transport encryption is not end-to-end encryption: the server stores readable JSON and PNGs. Redirects are refused to protect credentials. Sensitive entries, rich HTML and local file paths are excluded from sync. Images are optional; originals download lazily when copied/exported. There is no upload of arbitrary files referenced on the clipboard.

Clipboard sync merges stable IDs using last-update-wins, with tombstones winning equal timestamps. Concurrent in-flight local edits are merged again after the request. Servers must support ETag or Last-Modified to replace an existing object; writes use If-Match / If-Unmodified-Since, or If-None-Match for new objects. A 412 conflict stops the write and asks the user to retry rather than silently overwriting. Optional periodic history sync runs every 5–120 minutes while the app is running; it does not create a background scheduler outside the app. Review sync errors in Settings.

Configuration sync is explicit upload or reviewed restore. It includes categories, app-category assignments, favorites/pin order, font and appearance, view and sort preferences. Apps are matched by name. Missing apps' assignments are retained for later manual imports; executables and app paths are not transferred. API keys, executable commands, clipboard privacy settings, credentials, startup settings, hotkeys and scan directories remain device-local. Configuration backups remain separate from clipboard history; legacy text histories can still be imported from older backups.

## Favorites

Pinned launcher apps occupy a horizontal shelf on **every** non-search page, including categories and list view. Overflow pins scroll in that shelf. Ordinary pagination and sorting affect only the other apps. During search, the shelf is hidden and matching favorites are ranked before matching ordinary apps. Scans retain pin timestamps and manual categories.
