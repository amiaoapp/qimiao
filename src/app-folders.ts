import type { AppItem } from "./types";

export const isFolderEntry = (app: AppItem) => Boolean(app.folder && app.id === `folder:${app.folder.id}`);

/** Collapse library entries only; searching still returns each executable app. */
export function folderEntries(apps: AppItem[], searching = false): AppItem[] {
  if (searching) return apps;
  const seen = new Set<string>();
  return apps.flatMap((app) => {
    if (!app.folder) return [app];
    if (seen.has(app.folder.id)) return [];
    seen.add(app.folder.id);
    return [{ ...app, id: `folder:${app.folder.id}`, name: app.folder.name, path: "", favorite: false }];
  });
}

/** Dropping a folder moves all its members, without changing app categories or pins. */
export function mergeAppFolders(apps: AppItem[], sourceId: string, targetId: string, id: string, name: string): AppItem[] {
  if (sourceId === targetId) return apps;
  const source = apps.find((app) => app.id === sourceId);
  const target = apps.find((app) => app.id === targetId);
  if (!source || !target || (source.folder && source.folder.id === target.folder?.id)) return apps;
  const folder = target.folder ?? source.folder ?? { id, name };
  return apps.map((app) => app.id === sourceId || app.id === targetId ||
    Boolean(source.folder && app.folder?.id === source.folder.id) ||
    Boolean(target.folder && app.folder?.id === target.folder.id)
      ? { ...app, folder } : app);
}

export function renameAppFolder(apps: AppItem[], id: string, name: string): AppItem[] {
  const trimmed = name.trim().slice(0, 40);
  if (!trimmed) return apps;
  return apps.map((app) => app.folder?.id === id ? { ...app, folder: { id, name: trimmed } } : app);
}

export function leaveAppFolder(apps: AppItem[], appId: string): AppItem[] {
  const folderId = apps.find((app) => app.id === appId)?.folder?.id;
  const remaining = apps.filter((app) => app.folder?.id === folderId && app.id !== appId).length;
  return apps.map((app) => app.folder?.id === folderId && (app.id === appId || remaining < 2)
    ? { ...app, folder: undefined } : app);
}
