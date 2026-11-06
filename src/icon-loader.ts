// Share in-flight work across pages; neither a hidden WebView nor a failed
// native icon extraction should leave an application tile spinning forever.
export function createIconLoader(load: (path: string, name: string) => Promise<string>, options: { concurrency?: number; timeoutMs?: number; retryMs?: number } = {}) {
  const cache = new Map<string, { promise: Promise<string>; expires: number }>();
  const queue: (() => void)[] = [];
  let active = 0;
  const pump = () => { while (active < (options.concurrency ?? 3) && queue.length) queue.shift()!(); };
  return (path: string, name: string): Promise<string> => {
    const existing = cache.get(path);
    if (existing && existing.expires > Date.now()) return existing.promise;
    const entry = { expires: Infinity, promise: Promise.resolve("") };
    entry.promise = new Promise<string>((resolve) => {
      queue.push(() => {
        active++;
        let settled = false;
        const finish = (value: string) => {
          if (settled) return;
          settled = true; clearTimeout(timer);
          const valid = value.startsWith("data:image/") ? value : "";
          entry.expires = Date.now() + (valid ? 5 * 60_000 : options.retryMs ?? 30_000);
          active--; resolve(valid); pump();
        };
        const timer = setTimeout(() => finish(""), options.timeoutMs ?? 8_000);
        Promise.resolve().then(() => load(path, name)).then(finish, () => finish(""));
      });
    });
    cache.set(path, entry); pump();
    // Bound memory for long-running installations and refreshes.
    if (cache.size > 1024) for (const [key, value] of cache) {
      if (value.expires !== Infinity) { cache.delete(key); break; }
    }
    return entry.promise;
  };
}
