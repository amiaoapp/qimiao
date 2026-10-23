// SPDX-License-Identifier: GPL-3.0-only
// Ported behavior: PasteMemo, Copyright (c) 2026 lifedever. See NOTICE.md.
export type ClipKind =
  | "text"
  | "link"
  | "code"
  | "color"
  | "email"
  | "phone"
  | "image"
  | "file";
export type Clip = {
  id: string;
  text: string;
  kind: ClipKind;
  createdAt: number;
  updatedAt: number;
  lastUsedAt?: number;
  pinned?: boolean;
  favorite?: boolean;
  sensitive?: boolean;
  deletedAt?: number;
  title?: string;
  group?: string;
  sourceApp?: string;
  sourceId?: string;
  html?: string;
  files?: string[];
  imageKey?: string;
  thumbnail?: string;
  width?: number;
  height?: number;
  byteSize?: number;
};
export type ClipOptions = {
  retentionDays: number;
  maxItems: number;
  ignoredApps: string[];
  skipSensitive: boolean;
  rules: {
    cleanTracking: boolean;
    lowercaseEmail: boolean;
    removeBlankLines: boolean;
  };
};
export const defaultClipOptions: ClipOptions = {
  retentionDays: 30,
  maxItems: 1000,
  ignoredApps: [
    "1password",
    "bitwarden",
    "keepassxc",
    "com.apple.passwords",
    "com.apple.keychainaccess",
  ],
  skipSensitive: true,
  rules: { cleanTracking: true, lowercaseEmail: true, removeBlankLines: false },
};
export const clipKindLabels: Record<ClipKind, [string, string]> = {
  text: ["文本", "Text"],
  link: ["链接", "Links"],
  code: ["代码", "Code"],
  color: ["颜色", "Colors"],
  email: ["邮箱", "Email"],
  phone: ["电话", "Phone"],
  image: ["图片", "Images"],
  file: ["文件", "Files"],
};
export function detectClipKind(text: string): ClipKind {
  const value = text.trim();
  if (/^https?:\/\/\S+$/i.test(value)) return "link";
  if (
    /^#[a-f\d]{3}([a-f\d]{3})?([a-f\d]{2})?$/i.test(value) ||
    /^rgba?\(\s*[\d.%,\s]+\)$/.test(value)
  )
    return "color";
  if (/^[\w.+-]+@[\w.-]+\.[a-z]{2,}$/i.test(value)) return "email";
  if (
    /^\+?[\d\s().-]{7,20}$/.test(value) &&
    value.replace(/\D/g, "").length >= 7
  )
    return "phone";
  if (
    /^(import |export |const |let |function |class |def |SELECT |<\?php|#!|\{\s*["'])/im.test(
      value,
    ) ||
    /```/.test(value)
  )
    return "code";
  return "text";
}
export function isSensitiveClip(text: string, source = ""): boolean {
  if (
    /1password|bitwarden|keepass|keychain|com\.apple\.passwords/i.test(source)
  )
    return true;
  if (
    /(?:password|passwd|secret|token|api[_-]?key|private[_-]?key|credential|密码|密钥)\s*[=:："']/i.test(
      text,
    )
  )
    return true;
  if (
    /AKIA[A-Z\d]{16}|gh[pousr]_[\w]{30,}|github_pat_|-----BEGIN.*PRIVATE KEY-----|eyJ[\w-]+\.eyJ[\w-]+\.[\w-]+|Bearer\s+[\w.-]{20,}|xox[bpras]-[\w-]+|sk-(?:proj-)?[\w-]{20,}/.test(
      text,
    )
  )
    return true;
  const value = text.trim();
  if (
    value.length < 8 ||
    value.length > 128 ||
    /\s|[\u3000-\u9fff]|[([{\]"']/.test(value) ||
    detectClipKind(value) !== "text" ||
    /^\/|^[\w.-]+\.[a-z]{2,}$|^\w+(?:[-_]\w+)+$/i.test(value)
  )
    return false;
  const counts = new Map<string, number>();
  const classes = new Set<number>();
  let previous = -1,
    transitions = 0;
  for (const ch of value) {
    counts.set(ch, (counts.get(ch) ?? 0) + 1);
    const cls = /[A-Z]/.test(ch)
      ? 0
      : /[a-z]/.test(ch)
        ? 1
        : /\d/.test(ch)
          ? 2
          : 3;
    classes.add(cls);
    if (previous >= 0 && cls !== previous) transitions++;
    previous = cls;
  }
  let entropy = 0;
  counts.forEach((count) => {
    const p = count / value.length;
    entropy -= p * Math.log2(p);
  });
  return (
    Math.min(entropy / 4, 1) * 40 +
      (transitions / (value.length - 1)) * 35 +
      (classes.size / 4) * 25 >=
    70
  );
}
export function cleanTrackingParams(text: string): string {
  try {
    const url = new URL(text);
    if (!/^https?:$/.test(url.protocol)) return text;
    for (const key of [...url.searchParams.keys()])
      if (/^utm_|^(fbclid|gclid|mc_cid|mc_eid)$/i.test(key))
        url.searchParams.delete(key);
    return url.toString();
  } catch {
    return text;
  }
}
export function applyClipRules(
  text: string,
  options: ClipOptions["rules"],
): string {
  const kind = detectClipKind(text);
  let result = text;
  if (options.cleanTracking && kind === "link")
    result = cleanTrackingParams(result);
  if (options.lowercaseEmail && kind === "email") result = result.toLowerCase();
  if (options.removeBlankLines && kind === "text")
    result = result
      .split(/\r?\n/)
      .filter((line) => line.trim())
      .join("\n");
  return result;
}
export function splitRelayText(text: string, delimiter: string): string[] {
  if (!delimiter) return [];
  const parts = text
    .split(delimiter)
    .map((part) => part.trim())
    .filter(Boolean);
  return parts.length > 1 ? parts : [];
}
export function textClip(text: string, now = Date.now()): Clip {
  return {
    id: crypto.randomUUID(),
    text,
    kind: detectClipKind(text),
    createdAt: now,
    updatedAt: now,
    sensitive: isSensitiveClip(text),
  };
}
export function validateClips(value: unknown): Clip[] {
  if (!Array.isArray(value)) return [];
  const str = (v: unknown, max = 256) =>
    typeof v === "string" ? v.slice(0, max) : undefined;
  const num = (v: unknown) =>
    typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
  return value
    .slice(0, 10000)
    .filter((c): c is Record<string, unknown> =>
      Boolean(c && typeof c === "object"),
    )
    .filter(
      (c) =>
        typeof c.id === "string" &&
        c.id.length > 0 &&
        c.id.length < 160 &&
        typeof c.text === "string" &&
        c.text.length <= 250000 &&
        num(c.updatedAt) !== undefined &&
        num(c.createdAt) !== undefined,
    )
    .map(
      (c): Clip => ({
        id: c.id as string,
        text: c.text as string,
        createdAt: c.createdAt as number,
        updatedAt: c.updatedAt as number,
        kind:
          typeof c.kind === "string" &&
          Object.prototype.hasOwnProperty.call(clipKindLabels, c.kind)
            ? (c.kind as ClipKind)
            : "text",
        pinned: c.pinned === true,
        favorite: c.favorite === true,
        sensitive:
          c.sensitive === true ||
          isSensitiveClip(
            c.text as string,
            `${str(c.sourceId) ?? ""} ${str(c.sourceApp) ?? ""}`,
          ) ||
          Boolean(
            str(c.html, 1000000) && isSensitiveClip(str(c.html, 1000000)!),
          ),
        deletedAt: num(c.deletedAt),
        lastUsedAt: num(c.lastUsedAt),
        title: str(c.title),
        group: str(c.group, 80),
        sourceApp: str(c.sourceApp),
        sourceId: str(c.sourceId),
        thumbnail:
          typeof c.thumbnail === "string" &&
          /^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(c.thumbnail) &&
          c.thumbnail.length < 400000
            ? c.thumbnail
            : undefined,
        imageKey:
          typeof c.imageKey === "string" && /^[a-f\d]{64}$/.test(c.imageKey)
            ? c.imageKey
            : undefined,
        files: Array.isArray(c.files)
          ? c.files
              .filter(
                (p): p is string => typeof p === "string" && p.length < 4096,
              )
              .slice(0, 128)
          : [],
        html: str(c.html, 1000000),
        width: num(c.width),
        height: num(c.height),
        byteSize: num(c.byteSize),
      }),
    );
}
export function mergeClips(
  local: Clip[],
  remote: Clip[],
  options: Pick<ClipOptions, "maxItems" | "retentionDays">,
  now = Date.now(),
): Clip[] {
  const byId = new Map<string, Clip>();
  for (const clip of [...validateClips(local), ...validateClips(remote)]) {
    const previous = byId.get(clip.id);
    if (
      !previous ||
      clip.updatedAt > previous.updatedAt ||
      (clip.updatedAt === previous.updatedAt &&
        clip.deletedAt &&
        !previous.deletedAt)
    )
      byId.set(clip.id, clip);
  }
  const expiry =
    options.retentionDays > 0 ? now - options.retentionDays * 86400000 : 0;
  const all = [...byId.values()].map((clip) =>
    !clip.deletedAt && !clip.pinned && expiry && clip.createdAt < expiry
      ? {
          ...clip,
          deletedAt: now,
          updatedAt: now,
          text: "",
          html: undefined,
          thumbnail: undefined,
          files: [],
        }
      : clip,
  );
  const active = all
    .filter((clip) => !clip.deletedAt)
    .sort(
      (a, b) =>
        Number(b.pinned) - Number(a.pinned) ||
        (b.lastUsedAt ?? b.createdAt) - (a.lastUsedAt ?? a.createdAt),
    );
  const keep = new Set(
    active
      .slice(
        0,
        Math.max(options.maxItems, active.filter((clip) => clip.pinned).length),
      )
      .map((clip) => clip.id),
  );
  return all
    .map((clip) =>
      !clip.deletedAt && !keep.has(clip.id)
        ? {
            ...clip,
            deletedAt: now,
            updatedAt: now,
            text: "",
            html: undefined,
            thumbnail: undefined,
            files: [],
          }
        : clip,
    )
    .filter((clip) => !clip.deletedAt || now - clip.deletedAt < 180 * 86400000)
    .sort((a, b) => b.createdAt - a.createdAt);
}
export function clipsForSync(clips: Clip[], images: boolean): Clip[] {
  return validateClips(clips)
    .filter(
      (c) =>
        c.deletedAt ||
        (!c.sensitive && c.kind !== "file" && (images || c.kind !== "image")),
    )
    .map((c) =>
      c.deletedAt
        ? {
            id: c.id,
            text: "",
            kind: c.kind,
            createdAt: c.createdAt,
            updatedAt: c.updatedAt,
            deletedAt: c.deletedAt,
          }
        : { ...c, html: undefined, files: [] },
    );
}

export function prepareClipboardSync(
  local: Clip[],
  remote: Clip[],
  options: Pick<ClipOptions, "maxItems" | "retentionDays">,
  images: boolean,
) {
  const incoming = clipsForSync(remote, true);
  const merged = mergeClips(
    local,
    incoming.filter((c) => images || c.kind !== "image" || c.deletedAt),
    options,
  );
  const outgoing = clipsForSync(merged, images);
  if (!images) {
    const known = new Set(outgoing.map((c) => c.id));
    outgoing.push(
      ...incoming.filter((c) => c.kind === "image" && !known.has(c.id)),
    );
  }
  return { merged, outgoing, incoming };
}
