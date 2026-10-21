import type { Clip } from "./clipboard-core";

export type ClipboardWindowPreferences = {
  position: "center" | "mouse" | "input";
  singleColumn: boolean;
  width: number;
  height: number;
};
export const defaultClipboardWindow: ClipboardWindowPreferences = { position: "center", singleColumn: false, width: 820, height: 560 };
export function normalizeClipboardWindow(raw: Partial<ClipboardWindowPreferences>): ClipboardWindowPreferences {
  const dimension = (v: unknown, fallback: number, min: number, max: number) => typeof v === "number" && Number.isFinite(v) ? Math.max(min, Math.min(max, v)) : fallback;
  return {
    position: raw.position === "mouse" || raw.position === "input" ? raw.position : "center",
    singleColumn: raw.singleColumn === true,
    width: dimension(raw.width, 820, 340, 1600),
    height: dimension(raw.height, 560, 320, 1200),
  };
}
// Send only edits from the secondary window. A stale view must never replace
// newly captured records or roll back unrelated metadata on the history owner.
export function clipboardEdits(before: Clip[], after: Clip[]): { changed: Clip[]; deleted: string[] } {
  const previous = new Map(before.map((clip) => [clip.id, JSON.stringify(clip)]));
  const next = new Set(after.map((clip) => clip.id));
  return {
    changed: after.filter((clip) => previous.get(clip.id) !== JSON.stringify(clip)),
    deleted: before.filter((clip) => !next.has(clip.id)).map((clip) => clip.id),
  };
}
