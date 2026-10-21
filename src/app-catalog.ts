import { pinyin } from "pinyin-pro";
import type { AppItem } from "./types";

// Match an application's own name, never an arbitrary parent directory.
const aliases: [string[], string][] = [
  [["qimiao", "启喵", "启喵 · Qimiao", "Qimiao · 启喵", "qimiao launcher"], "启喵 启动器 launcher"],
  [["terminal", "终端"], "终端 命令行 控制台"],
  [["activity monitor", "活动监视器"], "活动监视器 活动监控 任务管理器 进程 内存 CPU"],
  [["system settings", "system preferences", "系统设置", "系统偏好设置"], "系统设置 系统偏好设置"],
  [["disk utility", "磁盘工具"], "磁盘工具 硬盘 分区"],
  [["console", "控制台"], "控制台 日志"],
  [["screenshot", "截屏", "截图"], "截屏 截图"],
  [["preview", "预览"], "预览 图片 PDF"],
  [["textedit", "文本编辑"], "文本编辑 记事本"],
  [["notes", "备忘录"], "备忘录 笔记"],
  [["reminders", "提醒事项"], "提醒事项 待办"],
  [["calendar", "日历"], "日历 日程"],
  [["calculator", "计算器"], "计算器 计算"],
  [["books", "图书"], "图书 阅读 书籍"],
  [["music", "音乐"], "音乐"],
  [["photos", "照片"], "照片 相册"],
  [["messages", "信息"], "信息 短信"],
  [["mail", "邮件"], "邮件 邮箱"],
  [["maps", "地图"], "地图 导航"],
  [["find my", "查找"], "查找 定位"],
  [["podcasts", "播客"], "播客"],
  [["shortcuts", "快捷指令"], "快捷指令 捷径 自动化"],
  [["automator", "自动操作"], "自动操作 自动化"],
  [["safari", "苹果浏览器"], "浏览器 苹果浏览器"],
  [["google chrome", "chrome", "谷歌浏览器"], "谷歌 谷歌浏览器 浏览器"],
  [["microsoft edge", "edge", "微软浏览器"], "微软浏览器 浏览器"],
  [["firefox", "火狐", "火狐浏览器"], "火狐浏览器 浏览器"],
  [["wechat", "微信"], "微信"],
  [["telegram", "电报"], "电报 聊天"],
  [["visual studio code", "code", "vscode"], "代码 编辑器 开发"],
  [["microsoft word", "word", "winword"], "文字 文档 办公"],
  [["microsoft excel", "excel"], "表格 办公"],
  [["microsoft powerpoint", "powerpoint", "powerpnt"], "演示 幻灯片 办公"],
  [["microsoft onenote", "onenote"], "笔记 办公"],
  [["app store", "应用商店"], "应用商店 软件商店"],
  [["file explorer", "explorer", "文件资源管理器"], "文件资源管理器 文件管理"],
  [["task manager", "taskmgr", "任务管理器"], "任务管理器 进程"],
  [["snipping tool", "snippingtool", "截图工具"], "截图工具 截屏"],
  [["notepad", "记事本"], "记事本 文本 编辑器"],
  [["paint", "mspaint", "画图"], "画图 绘图"],
  [["windows calculator", "calc"], "计算器 计算 calculator"],
  [["microsoft remote desktop", "remote desktop connection", "mstsc", "远程桌面连接"], "远程桌面 远程连接"],
  [["facetime", "通话"], "视频通话"],
  [["voice memos", "语音备忘录"], "语音备忘录 录音"],
  [["quicktime player", "quicktime 播放器"], "视频 播放器"],
  [["keychain access", "钥匙串访问", "钥匙串访问工具"], "钥匙串 密码"],
  [["font book", "字体册"], "字体 字体册"],
  [["image capture", "图像捕捉"], "图像捕捉 扫描"],
  [["tencent qq", "qq"], "腾讯 QQ 聊天"],
  [["dingtalk", "钉钉"], "钉钉 聊天 办公"],
  [["feishu", "飞书"], "飞书 聊天 办公"],
  [["neteasemusic", "netease cloud music", "网易云音乐"], "网易云音乐 音乐"],
  [["baidunetdisk", "baidu netdisk", "百度网盘"], "百度网盘 网盘"],
];

const normalizeSearchText = (value: string) => value.normalize("NFKC").toLowerCase();
const normalizeName = (value: string) => normalizeSearchText(value)
  .replace(/\.(app|exe|lnk|desktop)$/i, "").replace(/[\s._·•–—-]/g, "");
const namesFor = (app: AppItem) => [app.name, app.path.split(/[\\/]/).pop() ?? ""]
  .map(normalizeName);

export function appAliases(app: AppItem): string {
  const names = namesFor(app);
  return aliases.filter(([keys]) => keys.some((key) => names.includes(normalizeName(key))))
    .map(([keys, value]) => `${keys.join(" ")} ${value}`).join(" ");
}

export function appDisplayName(app: AppItem, language: "zh" | "en"): string {
  if (language === "en") return app.name;
  const names = namesFor(app);
  // Built-in system apps have stable localized Chinese names. Third-party
  // product names remain exactly as the application provided them.
  const systemNames = ["terminal", "activity monitor", "system settings", "system preferences", "disk utility", "console", "screenshot", "preview", "textedit", "notes", "reminders", "calendar", "calculator", "books", "music", "photos", "messages", "mail", "maps", "find my", "podcasts", "shortcuts", "automator"];
  if (!names.some((name) => systemNames.some((systemName) => normalizeName(systemName) === name))) return app.name;
  const systemEntry = aliases.find(([keys]) => keys.some((key) => names.includes(normalizeName(key))));
  return systemEntry?.[1].split(" ")[0] ?? app.name;
}

export function appSearchIndex(app: AppItem): string[] {
  const filename = app.path.split(/[\\/]/).pop()?.replace(/\.(app|exe|lnk|desktop)$/i, "") ?? "";
  const text = normalizeSearchText(`${app.name} ${filename} ${app.searchTerms ?? ""} ${appAliases(app)}`);
  return [text, pinyin(text, { toneType: "none" }), pinyin(text, { pattern: "first", toneType: "none" })]
    .map((value) => normalizeSearchText(value).replace(/\s/g, ""));
}

export const matchesApp = (index: string[], query: string) => {
  const words = normalizeSearchText(query).trim().split(/\s+/).filter(Boolean);
  return words.every((word) => index.some((value) => value.includes(word)));
};

type CategoryRule = { categories: string; apps: RegExp; metadata: RegExp };
const rules: CategoryRule[] = [
  { categories: "开发 编程 developer development coding", apps: /\b(xcode|terminal|iterm|code|vscode|cursor|docker|postman|insomnia|git|github|sourcetree|jetbrains|intellij|pycharm|webstorm|android studio|sublime|zed|eclipse|termora)\b|终端|开发|编程|代码/i, metadata: /developer|development|ide|terminal/ },
  { categories: "修图 剪辑 图像 图片 摄影 photo image", apps: /photoshop|lightroom|affinity|pixelmator|photomator|final cut|premiere|davinci|capcut|剪映|修图|piclite|照片|相册|图像|image|photo|gimp|剪辑|视频编辑/i, metadata: /photography|graphics|video/ },
  { categories: "创意 设计 创作 design creative graphics", apps: /figma|sketch|blender|cinema|illustrator|affinity|canva|photoshop|pixelmator|keynote|procreate|omni[gG]raffle|设计|绘画|建模/i, metadata: /graphics-design|graphics|design/ },
  { categories: "影视 音乐 视频 播放 娱乐 休闲 media music video audio entertainment", apps: /\b(iina|vlc|music|spotify|itunes|quicktime|handbrake|audacity|logic|garageband|podcasts|tv|infuse)\b|音乐|影视|视频|播放|播客|哔哩|爱奇艺|优酷|网易云/i, metadata: /music|video|audio|entertainment/ },
  { categories: "游戏 娱乐 game gaming entertainment", apps: /steam|epic games|minecraft|gamehub|chess|国际象棋|游戏|playcover|geforce|battle\.net|gog|unity/i, metadata: /games|game|entertainment/ },
  { categories: "办公 学习 效率 财务 productivity office education finance", apps: /\b(word|excel|powerpoint|onenote|pages|numbers|keynote|notion|obsidian|notes|reminders|calendar|things|omnifocus|todo|budgetflow|anki|pdf|wps|chatgpt|claude|gemini)\b|笔记|记事|备忘|提醒|日历|待办|阅读|图书|日语|单词|会议|学习|办公|财务/i, metadata: /productivity|education|finance|office/ },
  { categories: "社交 通讯 聊天 social communication", apps: /wechat|微信|qq|telegram|discord|slack|teams|zoom|messages|facetime|signal|whatsapp|邮件|mail|聊天|通讯|飞书|钉钉/i, metadata: /social-networking|communication|chat|email/ },
  { categories: "上传 下载 网盘 传输 download upload transfer cloud", apps: /onedrive|dropbox|icloud|百度网盘|夸克网盘|云盘|网盘|迅雷|transmission|motrix|qbittorrent|aria|fdm|download|syncthing|爱传送|localsend|filezilla/i, metadata: /file-transfer|p2p/ },
  { categories: "网络 浏览 网站 运营 internet web browser", apps: /safari|chrome|firefox|edge|arc|brave|opera|browser|浏览器|clash|surge|quantumult|shadowrocket|vpn|网站|seo|wordpress/i, metadata: /network|web-browser/ },
  { categories: "优化 美化 系统 工具 utilities utility system tools", apps: /cleaner|uninstaller|better|karabiner|loop|rectangle|raycast|tinycast|qimiao|启喵|finder|settings|activity monitor|disk utility|console|terminal|系统|监视器|控制台|磁盘|工具|清理|卸载|壁纸|wallpaper|pixpin|screenshot|calculator|计算器/i, metadata: /utilities|utility|system/ },
  { categories: "信息 阅读 书籍 news reading books", apps: /books|reader|readwise|reeder|rss|news|kindle|calibre|z-library|图书|阅读|书籍|新闻/i, metadata: /books|news|reference/ },
];

export function suggestCategory(app: AppItem, categories: string[]): string | undefined {
  const text = `${app.name} ${app.path.split(/[\\/]/).pop() ?? ""} ${appAliases(app)}`;
  const metadata = `${app.appCategory ?? ""}`.toLocaleLowerCase();
  const scores = categories.map((category, order) => {
    const tokens = category.toLocaleLowerCase().split(/[\s、/与和及&-]+/).filter(Boolean);
    let score = 0;
    for (const rule of rules) {
      const relevant = tokens.some((token) => token.length > 1 && rule.categories.includes(token))
        || rule.categories.split(" ").some((token) => category.toLocaleLowerCase().includes(token));
      if (!relevant) continue;
      // A specific purpose (development, media, etc.) outranks the generic
      // “tools” category when the app has no platform category metadata yet.
      if (rule.apps.test(text)) score += rule.categories.startsWith("优化") ? 3 : 6;
      if (metadata && rule.metadata.test(metadata)) score += 9;
    }
    if (category.length > 1 && text.toLocaleLowerCase().includes(category.toLocaleLowerCase())) score += 12;
    return { category, score, order };
  }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score || a.order - b.order);
  return scores[0]?.category;
}

export function categorizeApps(apps: AppItem[], categories: string[]): AppItem[] {
  return apps.map((app) => app.category && categories.includes(app.category)
    ? app
    : { ...app, category: suggestCategory(app, categories) });
}
