import type { AppItem, CommandTool } from "./types";
import { appSearchIndex, matchesApp, appDisplayName } from "./app-catalog";
import { calculateExpression, convertUnits } from "./command-center";
import {
  findSystemActions,
  availableSystemActions,
  type DesktopPlatform,
  type SystemAction,
} from "./system-actions";

export type CommonCommand = "clipboard" | "commands" | "settings" | "add-app";
export type RecentCommand = { id: string; at: number };
export type CompactResult = {
  id: string;
  title: string;
  subtitle: string;
  section: "history" | "commands" | "results";
  app?: AppItem;
  system?: SystemAction;
  common?: CommonCommand;
  value?: string;
  tool?: CommandTool;
};
const commands: [CommonCommand, string, string, string][] = [
  [
    "clipboard",
    "剪贴板历史",
    "Clipboard History",
    "复制 粘贴 clipboard paste history",
  ],
  [
    "commands",
    "命令中心",
    "Command Center",
    "计算 换算 文件 快捷指令 command calculate files",
  ],
  ["add-app", "添加应用", "Add Applications", "导入 软件 app import add"],
  [
    "settings",
    "设置",
    "Settings",
    "配置 外观 字体 同步 settings preferences sync",
  ],
];
const searchIndexes = new WeakMap<AppItem, string[]>();
function indexFor(app: AppItem) {
  let index = searchIndexes.get(app);
  if (!index) {
    index = appSearchIndex(app);
    searchIndexes.set(app, index);
  }
  return index;
}
export function compactResults(
  apps: AppItem[],
  query: string,
  en: boolean,
  platform: DesktopPlatform,
  tools: CommandTool[],
  history: RecentCommand[],
): CompactResult[] {
  const q = query.trim();
  const common: CompactResult[] = commands
    .filter(
      ([, zh, eng, terms]) =>
        !q ||
        `${zh} ${eng} ${terms}`
          .toLocaleLowerCase()
          .includes(q.toLocaleLowerCase()),
    )
    .map(([id, zh, eng]) => ({
      id: `common:${id}`,
      title: en ? eng : zh,
      subtitle: en ? "Command" : "常用命令",
      section: q ? "results" : "commands",
      common: id,
    }));
  const appItems = apps
    .filter((a) => (q ? matchesApp(indexFor(a), q) : Boolean(a.lastUsed)))
    .sort((a, b) =>
      q
        ? Number(b.favorite) - Number(a.favorite) ||
          (b.lastUsed ?? 0) - (a.lastUsed ?? 0)
        : (b.lastUsed ?? 0) - (a.lastUsed ?? 0),
    )
    .slice(0, q ? 8 : 4)
    .map(
      (app): CompactResult => ({
        id: `app:${app.id}`,
        title: appDisplayName(app, en ? "en" : "zh"),
        subtitle: en ? "Application" : "应用",
        section: q ? "results" : "history",
        app,
      }),
    );
  if (!q) {
    const recent = history
      .slice(0, 4)
      .map((h): CompactResult | undefined => {
        const known = common.find((r) => r.id === h.id);
        const system = availableSystemActions(platform).find(
          (s) => `system:${s.id}` === h.id,
        );
        return known
          ? { ...known, section: "history" as const }
          : system
            ? {
                id: h.id,
                title: en ? system.en : system.zh,
                subtitle: en ? "System command" : "系统指令",
                section: "history" as const,
                system,
              }
            : undefined;
      })
      .filter((r): r is CompactResult => Boolean(r));
    const recentRows = [...appItems, ...recent].slice(0, 5);
    const recentIds = new Set(recentRows.map((r) => r.id));
    return recentRows.concat(common.filter((r) => !recentIds.has(r.id)));
  }
  const value = calculateExpression(q);
  const conversion = convertUnits(q);
  const calc =
    value !== null
      ? String(value)
      : conversion
        ? `${Number(conversion.value.toPrecision(12))} ${conversion.to}`
        : null;
  return [
    ...(calc === null
      ? []
      : [
          {
            id: "calculation",
            title: calc,
            subtitle: en ? "Copy result" : "复制计算结果",
            section: "results" as const,
            value: calc,
          },
        ]),
    ...appItems,
    ...findSystemActions(q, platform).map(
      (system): CompactResult => ({
        id: `system:${system.id}`,
        title: en ? system.en : system.zh,
        subtitle: en ? "System command" : "系统指令",
        section: "results",
        system,
      }),
    ),
    ...common,
    ...tools
      .filter(
        (t) =>
          t.enabled !== false &&
          `${t.title} ${t.alias ?? ""}`
            .toLocaleLowerCase()
            .includes(q.toLocaleLowerCase()),
      )
      .slice(0, 4)
      .map(
        (tool): CompactResult => ({
          id: `tool:${tool.id}`,
          title: tool.title,
          subtitle: en ? "Open in Command Center" : "在命令中心打开",
          section: "results",
          tool,
        }),
      ),
  ].slice(0, 14);
}

/** Hide before starting any potentially slow OS launch. */
export async function launchWithImmediateHide(
  hide: () => Promise<void>,
  launch: () => Promise<void>,
) {
  await hide().catch(() => {});
  await launch();
}
