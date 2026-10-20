import type { AppItem } from "./types";

export type LauncherArrowKey =
  | "ArrowLeft"
  | "ArrowRight"
  | "ArrowUp"
  | "ArrowDown";

/** Move through full-width commands, an optional horizontal shelf and the app grid. */
export function nextLauncherSelection(
  current: number,
  key: LauncherArrowKey,
  commandCount: number,
  shelfCount: number,
  appCount: number,
  columns: number,
) {
  const total = commandCount + shelfCount + appCount;
  if (!total) return 0;
  const safe = Math.max(0, Math.min(current, total - 1));
  const shelfStart = commandCount;
  const appStart = shelfStart + shelfCount;
  const gridColumns = Math.max(1, columns);

  if (safe < commandCount) {
    if (key === "ArrowUp") return Math.max(0, safe - 1);
    if (key === "ArrowDown") return Math.min(total - 1, safe + 1);
    return safe;
  }

  if (safe < appStart) {
    const local = safe - shelfStart;
    if (key === "ArrowLeft") return shelfStart + Math.max(0, local - 1);
    if (key === "ArrowRight")
      return shelfStart + Math.min(shelfCount - 1, local + 1);
    if (key === "ArrowUp") return commandCount ? commandCount - 1 : safe;
    return appCount
      ? appStart + Math.min(local % gridColumns, appCount - 1)
      : safe;
  }

  const local = safe - appStart;
  const column = local % gridColumns;
  if (key === "ArrowLeft")
    return column === 0 ? safe : safe - 1;
  if (key === "ArrowRight")
    return column === gridColumns - 1 || local === appCount - 1
      ? safe
      : safe + 1;
  if (key === "ArrowDown")
    return appStart + Math.min(appCount - 1, local + gridColumns);
  if (local >= gridColumns) return safe - gridColumns;
  if (shelfCount) return shelfStart + Math.min(column, shelfCount - 1);
  return commandCount ? commandCount - 1 : safe;
}

/** Share seven shelf slots between favorites and non-favorite recommendations. */
export function appPageLayout(
  visible: AppItem[],
  pins: AppItem[],
  recommended: AppItem[],
  view: "grid" | "list",
  recommend: boolean,
  searching: boolean,
  page: number,
) {
  const showPins = !searching && pins.length > 0;
  const stackPins = showPins && pins.length > 3;
  const directPins = showPins && !stackPins ? pins : [];
  const pinnedIds = new Set(showPins ? pins.map((app) => app.id) : []);
  const recommendationSlots = 7 - (stackPins ? 1 : directPins.length);
  const suggestions = !searching && recommend && (view === "grid" || showPins)
    ? recommended.filter((app) => !pinnedIds.has(app.id)).slice(0, recommendationSlots)
    : [];
  const topRow = [...directPins, ...suggestions];
  const shelfCount = topRow.length + Number(stackPins);
  const topIds = new Set([...pinnedIds, ...topRow.map((app) => app.id)]);
  const remainder = visible.filter((app) => !topIds.has(app.id));
  const pageSize = shelfCount ? 21 : 28;
  const pageCount =
    view === "list" ? 1 : Math.max(1, Math.ceil(remainder.length / pageSize));
  const safePage = Math.max(0, Math.min(page, pageCount - 1));
  return {
    showPins,
    stackPins,
    shelfCount,
    topRow,
    pageCount,
    pageApps:
      view === "list"
        ? remainder
        : remainder.slice(safePage * pageSize, (safePage + 1) * pageSize),
  };
}
