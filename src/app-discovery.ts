// Keep automatic discovery distinct from manual import. The first inventory
// establishes a baseline; later additions are imported, never a full library reset.
export function changedApplications(previous: string[] | null, current: string[]) {
  if (!previous) return { added: [], removed: [] };
  const before = new Set(previous), after = new Set(current);
  return { added: current.filter(path => !before.has(path)), removed: previous.filter(path => !after.has(path)) };
}
