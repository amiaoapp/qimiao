import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { build } from "esbuild";

async function importBundled(path) {
  const { outputFiles } = await build({ entryPoints: [path], bundle: true, write: false, format: "esm", platform: "node" });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}
const catalog = await importBundled("src/app-catalog.ts");
const actions = await importBundled("src/system-actions.ts");
const appearance = await importBundled("src/appearance.ts");
const clipboard = await importBundled("src/clipboard-core.ts");
const capture = await importBundled("src/clipboard-capture.ts");
const appVersion = await importBundled("src/app-version.ts");
const layout = await importBundled("src/app-layout.ts");
const sync = await importBundled("src/sync-core.ts");
const compact = await importBundled("src/compact-results.ts");
const commands = await importBundled("src/command-center.ts");
const clipView = await importBundled("src/clipboard-view.ts");
const glass = await importBundled("src/liquid-glass.ts");
const folders = await importBundled("src/app-folders.ts");
const hotkeys = await importBundled("src/hotkeys.ts");
const clipWindow = await importBundled("src/clipboard-window-state.ts");
const app = (name, extra = {}) => ({ id: name, name, path: `/Applications/${name}.app`, launchCount: 0, favorite: false, ...extra });

test("displayed and update-check version comes from release metadata", () => {
  const packageInfo = JSON.parse(readFileSync("package.json", "utf8"));
  const lock = JSON.parse(readFileSync("package-lock.json", "utf8"));
  const tauri = JSON.parse(readFileSync("src-tauri/tauri.conf.json", "utf8"));
  const cargoVersion = readFileSync("src-tauri/Cargo.toml", "utf8").match(/^version = "([^"]+)"/m)?.[1];
  assert.equal(appVersion.APP_VERSION, packageInfo.version);
  for (const version of [lock.version, lock.packages[""].version, tauri.version, cargoVersion]) {
    assert.equal(version, appVersion.APP_VERSION);
  }
});

test("queued clipboard copies survive delayed delivery, repeat copies and long text", () => {
  const options = { ...clipboard.defaultClipOptions, retentionDays: 0 };
  const now = Date.now();
  const text = { ...clipboard.textClip("Chrome copied text", now), id: "text", files: [] };
  const image = { ...clipboard.textClip("", now + 1), kind: "image", id: "image", imageKey: "a".repeat(64), files: [] };
  const longText = { ...clipboard.textClip("这是一段比较长的复制内容。".repeat(23000), now + 2), id: "long", files: [] };
  const first = capture.acceptClipboardBatch([], [text, image, longText], options);
  assert.equal(first.skipped, undefined);
  assert.equal(first.clips.length, 3);
  assert.equal(first.clips.find((clip) => clip.id === "long").text, longText.text);
  const edited = first.clips.map((clip) => clip.id === "text" ? { ...clip, pinned: true, group: "工作" } : clip);
  const copiedAgain = { ...text, createdAt: now + 5000, updatedAt: now + 5000 };
  const repeated = capture.acceptClipboardBatch(edited, [copiedAgain], options);
  assert.equal(repeated.clips.length, 3);
  assert.equal(repeated.clips.find((clip) => clip.id === "text").lastUsedAt, now + 5000);
  assert.equal(repeated.clips.find((clip) => clip.id === "text").pinned, true);
  assert.equal(repeated.clips.find((clip) => clip.id === "text").group, "工作");
});

test("clipboard privacy exclusions report why an entry was skipped and do not block later copies", () => {
  const now = Date.now();
  const make = (text, extra = {}) => ({ ...clipboard.textClip(text, now), ...extra });
  const options = { ...clipboard.defaultClipOptions, retentionDays: 0 };
  assert.equal(capture.acceptClipboardBatch([], [make("password=secret")], options).skipped, "sensitive");
  assert.equal(capture.acceptClipboardBatch([], [make("text", { sourceApp: "Bitwarden" })], options).skipped, "ignored");
  assert.equal(capture.acceptClipboardBatch([], [make("text", { createdAt: undefined })], options).skipped, "invalid");
  const result = capture.acceptClipboardBatch([], [make("password=secret"), make("QQ 复制的正常文本")], options);
  assert.equal(result.skipped, undefined);
  assert.deepEqual(result.clips.map((clip) => clip.text), ["QQ 复制的正常文本"]);
  assert.equal(capture.acceptClipboardBatch([], [make("password=secret")], { ...options, skipSensitive: false }).clips.length, 1);
});

test("clipboard byte sizes preserve original image bytes and do not invent missing file sizes", () => {
  assert.equal(clipView.formatBytes(0), "0 B");
  assert.equal(clipView.formatBytes(1024), "1 KB");
  assert.equal(clipView.formatBytes(1536), "1.5 KB");
  assert.equal(clipView.formatBytes(5 * 1024 ** 2), "5 MB");
  assert.equal(clipView.formatBytes(3 * 1024 ** 3), "3 GB");
  for (const invalid of [undefined, null, -1, NaN, Infinity]) assert.equal(clipView.formatBytes(invalid), "");
  const text = clipboard.textClip("微信复制");
  assert.equal(clipView.clipByteSize(text), 12);
  const image = { ...text, kind: "image", byteSize: 1536, width: 500, height: 300 };
  assert.equal(clipView.clipByteSize(clipboard.validateClips([image])[0]), 1536);
  assert.equal(clipboard.validateClips([{ ...image, byteSize: Infinity }])[0].byteSize, undefined);
  const files = { ...text, kind: "file", files: ["/a.txt", "/b.txt"] };
  const info = new Map([["/a.txt", { path: "/a.txt", byteSize: 1024 }], ["/b.txt", { path: "/b.txt", byteSize: 0 }]]);
  assert.equal(clipView.clipByteSize(files, info), 1024);
  info.delete("/b.txt");
  assert.equal(clipView.clipByteSize(files, info), undefined);
  for (const byteSize of [null, -1, NaN, Infinity]) {
    info.set("/b.txt", { path: "/b.txt", byteSize });
    assert.equal(clipView.clipByteSize(files, info), undefined);
  }
  assert.equal(clipView.clipByteSize({ ...files, files: [] }, info), undefined);
});

test("liquid refraction keeps the centre neutral and bends opposite edges symmetrically", () => {
  assert.deepEqual(glass.refractionPixel(460, 300, 920, 600, 24), [128, 128, 128, 255]);
  const left = glass.refractionPixel(1, 300, 920, 600, 24);
  const right = glass.refractionPixel(919, 300, 920, 600, 24);
  assert.ok(left[0] < 128 && right[0] > 128);
  assert.equal(left[0] + right[0], 256);
  assert.equal(left[1], 128);
  for (const [x, y] of [[0, 0], [1, 1], [20, 20], [460, 599]]) {
    assert.ok(glass.refractionPixel(x, y, 920, 600, 24).every((channel) => Number.isFinite(channel) && channel >= 0 && channel <= 255));
  }
});

test("clipboard window edits preserve new captures and concurrent unrelated metadata", () => {
  const a = clipboard.textClip("First entry");
  const b = { ...clipboard.textClip("Second entry"), id: "second" };
  const newCapture = { ...clipboard.textClip("New capture"), id: "new" };
  const current = [a, { ...b, title: "Changed by owner", updatedAt: b.updatedAt + 5 }, newCapture];
  const edits = clipWindow.clipboardEdits([a, b], [{ ...a, pinned: true, updatedAt: a.updatedAt + 10 }, b]);
  assert.equal(edits.changed.length, 1);
  assert.deepEqual(edits.deleted, []);
  const merged = clipboard.mergeClips(current, edits.changed, clipboard.defaultClipOptions);
  assert.equal(merged.find((c) => c.id === a.id).pinned, true);
  assert.equal(merged.find((c) => c.id === b.id).title, "Changed by owner");
  assert.ok(merged.some((c) => c.id === newCapture.id));
  const removed = clipWindow.clipboardEdits([a, b], [b]);
  assert.deepEqual(removed.deleted, [a.id]);
});

test("clipboard placement and dimensions recover safely from invalid saved values", () => {
  assert.deepEqual(clipWindow.normalizeClipboardWindow({ position: "unknown", width: NaN, height: Infinity }), clipWindow.defaultClipboardWindow);
  assert.deepEqual(clipWindow.normalizeClipboardWindow({ position: "mouse", singleColumn: true, width: 1, height: 99999 }), { position: "mouse", singleColumn: true, width: 340, height: 1200 });
  assert.equal(clipWindow.normalizeClipboardWindow({ position: "input" }).position, "input");
});

test("physical Ctrl and Command recordings stay distinct, including punctuation and Option characters", () => {
  const key = { key: "k", code: "KeyK", metaKey: false, ctrlKey: true, altKey: false, shiftKey: false };
  assert.equal(hotkeys.recordedHotkey(key, true), "Control+KeyK");
  assert.equal(hotkeys.recordedHotkey({ ...key, ctrlKey: false, metaKey: true }, true), "Command+KeyK");
  assert.equal(hotkeys.recordedHotkey({ ...key, metaKey: true }, true), "Command+Control+KeyK");
  assert.equal(hotkeys.recordedHotkey({ ...key, key: "`", code: "Backquote" }, true), "Control+Backquote");
  assert.equal(hotkeys.recordedHotkey({ ...key, key: "+", code: "Equal", shiftKey: true }, true), "Control+Shift+Equal");
  assert.equal(hotkeys.recordedHotkey({ ...key, key: "˚", altKey: true }, true), "Control+Alt+KeyK");
  assert.equal(hotkeys.recordedHotkey({ ...key, key: "Control", code: "ControlLeft" }, true), null);
  assert.equal(hotkeys.hotkeyLabel("Control+Backquote", true), "Ctrl  +  `");
  assert.equal(hotkeys.hotkeyLabel("Command+KeyK", true), "⌘  +  K");
});

test("dragging merges folders without sweeping up unrelated categories or changing favorites", () => {
  const apps = [app("a", { category: "开发工具", favorite: true }), app("b", { category: "开发工具" }), app("c", { category: "开发工具" }), app("d")];
  const merged = folders.mergeAppFolders(apps, "a", "b", "group1", "工具");
  assert.equal(merged[0].favorite, true);
  assert.equal(merged[0].category, "开发工具");
  assert.equal(merged[1].folder.id, "group1");
  assert.equal(merged[2].folder, undefined);
  assert.equal(folders.folderEntries(merged).length, 3);
  assert.equal(folders.folderEntries(merged, true).length, 4);
  const other = folders.mergeAppFolders(merged, "c", "d", "group2", "娱乐");
  const joined = folders.mergeAppFolders(other, "a", "c", "unused", "unused");
  assert.ok(joined.every((a) => a.folder.id === "group2"));
  assert.ok(folders.renameAppFolder(joined, "group2", "  所有工具  ").every((a) => a.folder.name === "所有工具"));
  assert.equal(folders.leaveAppFolder(merged, "a").filter((a) => a.folder).length, 0);
  const page = layout.appPageLayout(merged, [merged[0]], [merged[1]], "grid", true, false, 0);
  assert.ok(page.pageApps.some(folders.isFolderEntry), "shelf shortcuts must not remove the folder from the library");
  assert.ok(!layout.appPageLayout(merged, [], [], "grid", false, true, 0).pageApps.some(folders.isFolderEntry));
  const portable = sync.readPortableConfiguration(JSON.stringify(sync.portableConfiguration(sync.normalizeSettings({}), merged)));
  assert.deepEqual(sync.applyAppPreferences(apps, portable.apps)[0].folder, merged[0].folder);
});

test("command helpers accept advertised dictionary syntax and preserve quoted arguments", () => {
  assert.equal(commands.dictionaryTerm("dict:hello"), "hello");
  assert.equal(commands.dictionaryTerm("dict: hello world"), "hello world");
  assert.equal(commands.dictionaryTerm("词典：hello"), "hello");
  assert.equal(commands.dictionaryTerm("define hello"), "hello");
  assert.equal(commands.dictionaryTerm("dictionary"), null);
  assert.deepEqual(commands.splitCommandArguments('"hello world" --name \'two words\' "" C:\\Tools\\app.exe'), ["hello world", "--name", "two words", "", "C:\\Tools\\app.exe"]);
  assert.equal(commands.splitCommandArguments('"unfinished'), null);
});

test("unit conversion includes time, Chinese aliases and absolute temperature limits", () => {
  assert.ok(Math.abs(commands.convertUnits("100 c to f").value - 212) < 1e-9);
  assert.ok(Math.abs(commands.convertUnits("32℉ 转 摄氏度").value) < 1e-9);
  assert.equal(commands.convertUnits("2 小时 转 分钟").value, 120);
  assert.equal(commands.convertUnits("1 公斤 转 克").value, 1000);
  assert.equal(commands.convertUnits("1 gb to mb").value, 1024);
  assert.equal(commands.convertUnits("-274 c to k"), null);
  assert.equal(commands.convertUnits("1 m to kg"), null);
});

test("text utilities format JSON, round-trip Unicode Base64 and convert timestamps without execution", () => {
  assert.equal(commands.textUtility('json: {"hello":1}').value, '{\n  "hello": 1\n}');
  const encoded = commands.textUtility("base64: 启喵 Hello 👋").value;
  assert.equal(commands.textUtility(`decode64: ${encoded}`).value, "启喵 Hello 👋");
  assert.equal(commands.textUtility("json: {broken}").action, "input-error");
  assert.equal(commands.textUtility("decode64: %%%").action, "input-error");
  assert.equal(commands.textUtility("time: garbage").action, "input-error");
  assert.ok(commands.textUtility("time: 0").value.includes("1970-01-01T00:00:00.000Z"));
  assert.ok(commands.textUtility("time: now", false, 100000).value.includes("Unix (s): 100"));
  assert.equal(commands.textUtility("cmd: dangerous"), null);
});

test("clipboard file subcategories and previews do not fetch remote or executable URLs", () => {
  for (const [file, kind] of [["C:\\Docs\\REPORT.PDF", "document"], ["/tmp/archive.7z", "archive"], ["/Applications/App.app", "application"], ["/tmp/no-extension", "other"]]) {
    assert.equal(clipView.clipboardCategory({ kind: "file", files: [file] }), kind);
  }
  assert.equal(clipView.clipboardCategory({ kind: "file", files: ["a.pdf", "b.zip"] }), "other");
  assert.equal(clipView.clipboardCategory({ kind: "text" }), "text");
  assert.equal(clipView.clipLink("javascript:alert(1)"), null);
  assert.equal(clipView.clipLink("https://github.com/amiaoapp/qimiao/").hostname, "github.com");
  assert.equal(clipView.clipRelativeTime(1000, false, 61000), "1 分钟前");
  assert.equal(clipView.clipRelativeTime(1000, true, 61000), "1m ago");
});

test("independent hotkeys are normalized and stay device-local", () => {
  const settings = sync.normalizeSettings({ clipboardHotkey: "", commandsHotkey: 123 });
  assert.equal(settings.clipboardHotkey, "");
  assert.equal(settings.commandsHotkey, "CommandOrControl+Shift+K");
  const portable = sync.portableConfiguration(settings, []).settings;
  assert.equal(portable.clipboardHotkey, undefined);
  assert.equal(portable.commandsHotkey, undefined);
});

test("local font stacks are quoted safely and retain system fallbacks", () => {
  assert.equal(appearance.fontStackFor(""), appearance.SYSTEM_FONT_STACK);
  assert.equal(appearance.fontStackFor(null), appearance.SYSTEM_FONT_STACK);
  assert.ok(appearance.fontStackFor("PingFang SC").startsWith('"PingFang SC", '));
  assert.ok(appearance.fontStackFor('Font "Quoted"').startsWith('"Font \\"Quoted\\"", '));
  assert.ok(!appearance.fontStackFor("bad\nfont").includes("\n"));
  assert.ok(appearance.fontStackFor("Missing Font").endsWith(appearance.SYSTEM_FONT_STACK));
});

test("Chinese and pinyin aliases find English system applications", () => {
  for (const [name, query] of [["Terminal", "终端"], ["Terminal", "zhongduan"], ["Terminal", "zd"], ["Activity Monitor", "活动"], ["Activity Monitor", "内存"], ["System Settings", "系统设置"], ["Google Chrome", "谷歌"], ["Microsoft Excel", "表格"]]) {
    assert.ok(catalog.matchesApp(catalog.appSearchIndex(app(name)), query), `${name}: ${query}`);
  }
  assert.equal(catalog.matchesApp(catalog.appSearchIndex(app("NotTerminal")), "终端"), false);
  assert.equal(catalog.matchesApp(catalog.appSearchIndex(app("PicLite")), "终端"), false);
  assert.equal(catalog.appDisplayName(app("Terminal"), "zh"), "终端");
  assert.equal(catalog.appDisplayName(app("Activity Monitor"), "zh"), "活动监视器");
  assert.equal(catalog.appDisplayName(app("Terminal"), "en"), "Terminal");
  assert.equal(catalog.appDisplayName(app("Safari"), "zh"), "Safari");
  assert.equal(catalog.appDisplayName(app("Google Chrome"), "zh"), "Google Chrome");
});

test("Qimiao is searchable by Chinese, English, pinyin and initials in both launcher layouts", () => {
  for (const name of ["Qimiao", "启喵", "启喵 · Qimiao", "Qimiao Launcher", "Ｑｉｍｉａｏ"]) {
    const item = app(name);
    for (const query of ["启喵", "qimiao", "QIMIAO", "qi miao", "qm", "ＱＩＭＩＡＯ", "启喵 qimiao"]) {
      assert.ok(catalog.matchesApp(catalog.appSearchIndex(item), query), `${name}: ${query}`);
      for (const en of [false, true]) {
        assert.ok(compact.compactResults([item], query, en, "macos", [], []).some((result) => result.app?.id === item.id), `compact ${name}: ${query}`);
      }
    }
  }
});

test("localized names, executable basenames and compact English spellings work in both directions", () => {
  for (const [name, query] of [["终端", "terminal"], ["活动监视器", "activity monitor"], ["SystemSettings", "系统设置"], ["系统偏好设置", "preferences"], ["微信", "wechat"], ["WeChat", "weixin"], ["GoogleChrome", "谷歌"], ["谷歌浏览器", "chrome"], ["文件资源管理器", "explorer"], ["Taskmgr", "任务管理器"], ["Notepad", "记事本"], ["记事本", "notepad"], ["Calc", "计算器"], ["Powerpnt", "幻灯片"], ["FaceTime", "视频通话"], ["语音备忘录", "voice memos"], ["钉钉", "dingtalk"], ["BaiduNetdisk", "百度网盘"]]) {
    assert.ok(catalog.matchesApp(catalog.appSearchIndex(app(name)), query), `${name}: ${query}`);
  }
  const renamed = app("My launcher", { path: "C:\\Apps\\Qimiao.exe" });
  assert.ok(catalog.matchesApp(catalog.appSearchIndex(renamed), "启喵"));
  assert.ok(catalog.matchesApp(catalog.appSearchIndex(app("我的软件", { path: "/Applications/OriginalName.app" })), "OriginalName"));
  for (const item of [app("QimiaoHelper"), app("Unrelated", { path: "/Applications/Qimiao/Unrelated.app" })]) {
    assert.equal(catalog.matchesApp(catalog.appSearchIndex(item), "启喵"), false);
  }
});

test("smart classification uses only existing categories and preserves manual choices", () => {
  const categories = ["修图剪辑", "开发工具", "影视音乐", "办公学习", "上传下载", "优化美化", "社交通讯"];
  const applications = [app("Terminal"), app("Adobe Photoshop"), app("Spotify"), app("Microsoft Excel"), app("OneDrive"), app("微信"), app("Mystery")];
  const next = catalog.categorizeApps(applications, categories);
  assert.deepEqual(next.map((item) => item.category), ["开发工具", "修图剪辑", "影视音乐", "办公学习", "上传下载", "社交通讯", undefined]);
  assert.equal(catalog.categorizeApps([app("Terminal", { category: "办公学习" })], categories)[0].category, "办公学习");
  assert.equal(catalog.suggestCategory(app("A", { appCategory: "public.app-category.developer-tools" }), ["开发工具"]), "开发工具");
  assert.equal(catalog.suggestCategory(app("Terminal"), ["修图剪辑"]), undefined);
  assert.equal(applications[0].category, undefined);
  assert.equal(catalog.suggestCategory(app("Terminal"), ["效率工具", "开发工具", "创意设计", "娱乐休闲"]), "开发工具");
});

test("system actions match Chinese in both UI languages and distinguish display power", () => {
  for (const [query, id] of [["关机", "shut-down"], ["待机", "sleep"], ["睡眠", "sleep"], ["休眠", "hibernate"], ["熄屏", "sleep-displays"], ["重启", "restart"], ["锁屏", "lock"]]) {
    assert.ok(actions.findSystemActions(query, "windows").some((action) => action.id === id), query);
  }
  assert.equal(actions.findSystemActions("熄屏", "windows")[0].id, "sleep-displays");
  assert.equal(actions.findSystemActions("休眠", "macos").length, 0);
  assert.equal(actions.findSystemActions("", "macos").length, 0);
  assert.equal(actions.findSystemActions("关机", "macos")[0].confirm, true);
});

test("favorites occupy the same shelf on every page and in list mode", () => {
  const pins = [app("Pinned Z", {favorite:true}),app("Pinned A",{favorite:true})];
  const apps = [...pins,...Array.from({length:72},(_,n)=>app(`App ${n}`))];
  for (const sorted of [apps,[...apps].reverse()]) {
    for (let page=0;page<4;page++) {
      const result=layout.appPageLayout(sorted,pins,[],"grid",false,false,page);
      assert.deepEqual(result.topRow,pins);
      assert.ok(!result.pageApps.some((a)=>a.favorite));
      assert.equal(result.pageCount,4);
    }
  }
  assert.equal(layout.appPageLayout(apps,pins,[],"list",false,false,0).pageApps.length,72);
  assert.equal(layout.appPageLayout(apps,pins,[],"grid",false,true,0).topRow.length,0);
  assert.equal(layout.appPageLayout([],pins,[],"grid",false,false,5).topRow.length,2);
});

test("favorites share the shelf with recommendations and collapse only above three", () => {
  for (const count of [0, 1, 3, 4, 12]) {
    const pins = Array.from({ length: count }, (_, i) => app(`Pinned ${i}`, { favorite: true }));
    const suggestions = Array.from({ length: 40 }, (_, i) => app(`Suggestion ${i}`));
    const apps = [...pins, ...suggestions];
    for (const page of [0, 1]) {
      const result = layout.appPageLayout(apps, pins, apps, "grid", true, false, page);
      assert.equal(result.stackPins, count > 3);
      assert.equal(result.shelfCount, 7);
      assert.equal(result.topRow.filter((item) => !item.favorite).length, count > 3 ? 6 : 7 - count);
      assert.equal(result.topRow.filter((item) => item.favorite).length, count > 3 ? 0 : count);
      const shelfIds = new Set([...pins, ...result.topRow].map((item) => item.id));
      assert.ok(result.pageApps.every((item) => !shelfIds.has(item.id)));
    }
    const searching = layout.appPageLayout(apps, pins, apps, "grid", true, true, 0);
    assert.equal(searching.stackPins, false);
    assert.equal(searching.shelfCount, 0);
    assert.ok(searching.pageApps.some((item) => item.id === apps[0].id));
    const disabled = layout.appPageLayout(apps, pins, apps, "grid", false, false, 0);
    assert.equal(disabled.shelfCount, count > 3 ? 1 : count);
    assert.ok(disabled.topRow.every((item) => item.favorite));
  }
});

test("arrow navigation crosses commands, the pinned shelf and the app grid", () => {
  const move = layout.nextLauncherSelection;
  assert.equal(move(0, "ArrowDown", 2, 0, 8, 7), 1);
  assert.equal(move(1, "ArrowDown", 2, 0, 8, 7), 2);
  assert.equal(move(2, "ArrowRight", 2, 0, 8, 7), 3);
  assert.equal(move(8, "ArrowRight", 2, 0, 8, 7), 8);
  assert.equal(move(2, "ArrowUp", 2, 0, 8, 7), 1);
  assert.equal(move(0, "ArrowDown", 0, 3, 14, 7), 3);
  assert.equal(move(4, "ArrowUp", 0, 3, 14, 7), 1);
  assert.equal(move(10, "ArrowDown", 0, 0, 14, 7), 13);
});

test("clipboard rules, type detection and relay splitting follow PasteMemo behavior", () => {
  for(const [text,kind] of [["https://example.test/","link"],["#ff8800","color"],["User@EXAMPLE.com","email"],["+1 212 555 8888","phone"],["const a = 1;","code"],["你好，启喵","text"]]) assert.equal(clipboard.detectClipKind(text),kind);
  assert.equal(clipboard.applyClipRules("https://example.test/a?utm_source=news&ok=1&fbclid=foo",clipboard.defaultClipOptions.rules),"https://example.test/a?ok=1");
  assert.equal(clipboard.applyClipRules("User@EXAMPLE.COM",clipboard.defaultClipOptions.rules),"user@example.com");
  assert.deepEqual(clipboard.splitRelayText(" A\n\nB\nC ","\n"),["A","B","C"]);
  assert.deepEqual(clipboard.splitRelayText("one",","),[]);
});
const clip=(id,text,extra={})=>({id,text,kind:"text",createdAt:1000,updatedAt:1000,...extra});
test("sync never serializes sensitive content, file paths, rich HTML or arbitrary fields", () => {
  assert.equal(clipboard.isSensitiveClip("password=abcdef"),true);
  assert.equal(clipboard.isSensitiveClip("safe text","Bitwarden"),true);
  assert.equal(clipboard.isSensitiveClip("日常工作备忘录"),false);
  const result=clipboard.clipsForSync([clip("a","hello",{html:"<b>hello</b>",secret:"hidden"}),clip("b","password=abcdef"),clip("c","x",{kind:"file",files:["/private/path"]}),clip("d","",{html:"token=secretvalue"}),clip("e","deleted secret",{deletedAt:2000})],true);
  assert.deepEqual(result.map((c)=>c.id),["a","e"]);
  assert.ok(!JSON.stringify(result).includes("hidden"));
  assert.ok(!JSON.stringify(result).includes("private"));
  assert.ok(!JSON.stringify(result).includes("<b>"));
  assert.equal(result[1].text,"");
  assert.deepEqual(clipboard.validateClips([clip("safe","normal",{group:{bad:true},sourceApp:1,kind:"__proto__"})])[0].group,undefined);
  assert.equal(clipboard.validateClips([clip("safe","normal",{kind:"__proto__"})])[0].kind,"text");
});
test("merge retains edits, pins and tombstones; deletion wins a simultaneous tie", () => {
  const options={maxItems:2,retentionDays:0};
  const a=clip("a","old"),b=clip("b","pinned",{pinned:true}),c=clip("c","third",{createdAt:3000});
  const result=clipboard.mergeClips([a,b,c],[clip("a","new",{updatedAt:4000})],options,5000);
  assert.equal(result.find((c)=>c.id==="b").pinned,true);
  const deleted=clipboard.mergeClips([a],[clip("a","",{deletedAt:1000})],options,2000);
  assert.equal(deleted[0].deletedAt,1000);
  assert.equal(clipboard.mergeClips(deleted,[a],options,2000)[0].deletedAt,1000);
  const older=clip("p","keep",{pinned:true});
  assert.equal(clipboard.mergeClips([older],[],{maxItems:1,retentionDays:7},30*86400000)[0].deletedAt,undefined);
});
test("opting out of image sync does not delete another device's image history",()=>{
  const image=clip("image","",{kind:"image",imageKey:"a".repeat(64),createdAt:Date.now(),updatedAt:Date.now()});
  const result=clipboard.prepareClipboardSync([clip("local","hello")],[image],{retentionDays:0,maxItems:100},false);
  assert.equal(result.merged.some((c)=>c.id==="image"),false);
  assert.equal(result.outgoing.find((c)=>c.id==="image").imageKey,"a".repeat(64));
});
test("portable configuration excludes secrets and executable actions and cannot weaken device privacy", () => {
  const settings=sync.normalizeSettings({apiKey:"never-upload",webdav:{password:"never-upload",url:"https://private.example/"},hotkey:"Alt+K",autoStart:true});
  const config=sync.portableConfiguration(settings,[app("Terminal",{category:"开发工具",favorite:true,pinnedAt:123})]);
  const text=JSON.stringify(config);
  assert.ok(!text.includes("never-upload"));assert.ok(!text.includes("private.example"));assert.ok(!text.includes("/Applications/"));
  const parsed=sync.readPortableConfiguration(JSON.stringify({...config,settings:{...config.settings,apiKey:"evil",webdav:{url:"https://evil"},clipboardOptions:{skipSensitive:false},autoStart:true},commands:[{content:"bad"}]}));
  for(const key of ["apiKey","webdav","clipboardOptions","autoStart"]) assert.equal(parsed.settings[key],undefined);
  assert.equal(sync.applyAppPreferences([app("terminal")],parsed.apps)[0].favorite,true);
  assert.equal(sync.applyAppPreferences([app("Other")],parsed.apps)[0].favorite,false);
});
test("malformed legacy options cannot start a tight sync loop or break capture filters",()=>{
  const normalized=sync.normalizeSettings({webdav:{intervalMinutes:NaN,password:"not-persisted"},clipboardOptions:{ignoredApps:"bad",maxItems:-1,rules:{cleanTracking:"bad"}}});
  assert.equal(normalized.webdav.intervalMinutes,15);
  assert.equal(normalized.webdav.password,undefined);
  assert.ok(Array.isArray(normalized.clipboardOptions.ignoredApps));
  assert.equal(normalized.clipboardOptions.maxItems,100);
  assert.equal(normalized.clipboardOptions.rules.cleanTracking,true);
});
test("compact launcher shows recent apps and common commands without an app grid",()=>{
  const items=[app("Terminal",{lastUsed:200}),app("Safari",{lastUsed:300}),app("Unused")];
  const results=compact.compactResults(items,"",false,"macos",[],[{id:"common:clipboard",at:400}]);
  assert.deepEqual(results.filter((r)=>r.app).map((r)=>r.app.name),["Safari","Terminal"]);
  assert.ok(results.some((r)=>r.section==="commands"&&r.common==="add-app"));
  assert.ok(results.some((r)=>r.section==="history"&&r.common==="clipboard"));
  assert.equal(new Set(results.map((r)=>r.id)).size,results.length);
  assert.equal(compact.compactResults(items,"终端",false,"macos",[],[])[0].app.name,"Terminal");
  assert.equal(compact.compactResults(items,"3*(7+1)",true,"windows",[],[])[0].value,"24");
  assert.ok(compact.compactResults([],"关机",false,"windows",[],[]).some((r)=>r.system?.confirm));
  assert.deepEqual(compact.compactResults([],"nonexistent-query",true,"windows",[],[]),[]);
});
test("app launch hides the launcher before waiting for the OS, and propagates failures",async()=>{
  const order=[];let finish;
  const running=compact.launchWithImmediateHide(async()=>{order.push("hide");},()=>{order.push("launch");return new Promise((resolve)=>finish=resolve);});
  await new Promise((r)=>setImmediate(r));
  assert.deepEqual(order,["hide","launch"]);finish();await running;
  await assert.rejects(()=>compact.launchWithImmediateHide(async()=>{},async()=>{throw new Error("missing app");}),/missing app/);
});
