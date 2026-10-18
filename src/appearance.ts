export const SYSTEM_FONT_STACK = '-apple-system, BlinkMacSystemFont, "Segoe UI Variable", "Segoe UI", "PingFang SC", "Microsoft YaHei UI", sans-serif';

export function fontStackFor(family: unknown): string {
  if (typeof family !== "string") return SYSTEM_FONT_STACK;
  const name = family.replace(/[\u0000-\u001f\u007f]/g, "").trim().slice(0, 160);
  return name ? `${JSON.stringify(name)}, ${SYSTEM_FONT_STACK}` : SYSTEM_FONT_STACK;
}
