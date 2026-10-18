import type { AppItem } from "./types";

/** Pinned apps occupy a stable shelf on every page, independent of sorting. */
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
  const topRow = showPins
    ? pins
    : recommend && view === "grid"
      ? recommended
      : [];
  const topIds = new Set(topRow.map((app) => app.id));
  const remainder = visible.filter((app) => !topIds.has(app.id));
  const pageSize = topRow.length ? 21 : 28;
  const pageCount =
    view === "list" ? 1 : Math.max(1, Math.ceil(remainder.length / pageSize));
  const safePage = Math.max(0, Math.min(page, pageCount - 1));
  return {
    showPins,
    topRow,
    pageCount,
    pageApps:
      view === "list"
        ? remainder
        : remainder.slice(safePage * pageSize, (safePage + 1) * pageSize),
  };
}
