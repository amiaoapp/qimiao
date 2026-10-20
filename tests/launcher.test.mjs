import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

async function importBundled(path) {
  const { outputFiles } = await build({ entryPoints: [path], bundle: true, write: false, format: "esm", platform: "node" });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}
const catalog = await importBundled("src/app-catalog.ts");
const actions = await importBundled("src/system-actions.ts");
const appearance = await importBundled("src/appearance.ts");
const clipboard = await importBundled("src/clipboard-core.ts");
const layout = await importBundled("src/app-layout.ts");
const sync = await importBundled("src/sync-core.ts");
const compact = await importBundled("src/compact-results.ts");
const commands = await importBundled("src/command-center.ts");
const clipView = await importBundled("src/clipboard-view.ts");
const app = (name, extra = {}) => ({ id: name, name, path: `/Applications/${name}.app`, launchCount: 0, favorite: false, ...extra });

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
