import assert from "node:assert/strict";
import test from "node:test";
import { build } from "esbuild";

async function importBundled(path) {
  const { outputFiles } = await build({ entryPoints: [path], bundle: true, write: false, format: "esm", platform: "node" });
  return import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);
}
const catalog = await importBundled("src/app-catalog.ts");
const actions = await importBundled("src/system-actions.ts");
const app = (name, extra = {}) => ({ id: name, name, path: `/Applications/${name}.app`, launchCount: 0, favorite: false, ...extra });

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
