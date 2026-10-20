import type { Clip } from "./clipboard-core";

export function clipboardCategory(clip: Clip): string {
  if (clip.kind !== "file") return clip.kind;
  const extensions = (clip.files ?? []).map((path) => path.split(/[\\/]/).pop()?.split(".").pop()?.toLowerCase());
  if (extensions.length && extensions.every((ext) => ext && ["zip", "rar", "7z", "tar", "gz", "bz2", "xz"].includes(ext))) return "archive";
  if (extensions.length && extensions.every((ext) => ext && ["exe", "msi", "app", "dmg", "pkg", "deb", "rpm", "appimage"].includes(ext))) return "application";
  if (extensions.length && extensions.every((ext) => ext && ["pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "txt", "md", "csv", "rtf", "odt"].includes(ext))) return "document";
  return "other";
}

export function clipRelativeTime(time: number, en: boolean, now = Date.now()): string {
  const elapsed = Math.max(0, now - time);
  if (elapsed < 60000) return en ? "Just now" : "刚刚";
  const minutes = Math.floor(elapsed / 60000);
  if (minutes < 60) return en ? `${minutes}m ago` : `${minutes} 分钟前`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return en ? `${hours}h ago` : `${hours} 小时前`;
  const days = Math.floor(hours / 24);
  return days < 7 ? (en ? `${days}d ago` : `${days} 天前`) : new Date(time).toLocaleDateString();
}

export function clipLink(text: string): URL | null {
  try { const url = new URL(text.trim()); return ["http:", "https:"].includes(url.protocol) ? url : null; } catch { return null; }
}
