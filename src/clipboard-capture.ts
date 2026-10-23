import {
  applyClipRules, detectClipKind, isSensitiveClip, mergeClips, validateClips,
  type Clip, type ClipOptions,
} from "./clipboard-core";

export type ClipboardCaptureBatch = {
  cursor: number;
  entries: Clip[];
  error: string | null;
  notice: string | null;
  dropped: number;
};

export function acceptClipboardBatch(current: Clip[], entries: Clip[], options: ClipOptions) {
  let clips = current;
  let skipped: "ignored" | "sensitive" | "invalid" | undefined;
  for (const value of entries) {
    const raw = validateClips([value])[0];
    if (!raw) { skipped = "invalid"; continue; }
    const source = `${raw.sourceApp ?? ""} ${raw.sourceId ?? ""}`.toLowerCase();
    if (options.ignoredApps.some((app) => app.trim() && source.includes(app.trim().toLowerCase()))) {
      skipped = "ignored";
      continue;
    }
    const sensitive = raw.sensitive || isSensitiveClip(raw.text, source)
      || Boolean(raw.html && isSensitiveClip(raw.html));
    if (sensitive && options.skipSensitive) { skipped = "sensitive"; continue; }
    const text = applyClipRules(raw.text, options.rules);
    const next = { ...raw, text, kind: raw.kind === "text" ? detectClipKind(text) : raw.kind, sensitive };
    const previous = clips.find((clip) => clip.id === next.id || (!clip.deletedAt
      && clip.kind === next.kind && clip.text === next.text && clip.imageKey === next.imageKey
      && JSON.stringify(clip.files) === JSON.stringify(next.files)));
    const entry = previous ? {
      ...next, id: previous.id, createdAt: previous.createdAt,
      pinned: previous.pinned, favorite: previous.favorite, group: previous.group, title: previous.title,
      deletedAt: undefined, updatedAt: Math.max(previous.updatedAt + 1, next.updatedAt),
      lastUsedAt: next.createdAt,
    } : next;
    clips = mergeClips(clips, [entry], options);
    skipped = undefined;
  }
  return { clips, skipped };
}
