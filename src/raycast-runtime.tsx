import * as React from "react";
import * as JsxRuntime from "react/jsx-runtime";
import {
  ArrowLeft,
  ChevronRight,
  Copy,
  ExternalLink,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { ExtensionBundle } from "./types";
import { openExternalUrl } from "./tauri";

type AnyProps = Record<string, any>;
type RuntimeContext = {
  bundle: ExtensionBundle;
  assets: Map<string, string>;
  preferences: Record<string, unknown>;
  push: (element: React.ReactElement) => void;
  pop: () => void;
  close: () => void;
  notify: (message: string) => void;
};
const Context = React.createContext<RuntimeContext | null>(null);
let activeContext: RuntimeContext | null = null;

function flatten(children: React.ReactNode): React.ReactElement[] {
  const result: React.ReactElement[] = [];
  React.Children.forEach(children, (child) => {
    if (!React.isValidElement(child)) return;
    const props = child.props as AnyProps;
    if (
      (child.type as AnyProps).__qMarker === "section" ||
      child.type === React.Fragment
    )
      result.push(...flatten(props.children));
    else result.push(child);
  });
  return result;
}
function iconNode(icon: unknown) {
  if (React.isValidElement(icon)) return icon;
  if (icon && typeof icon === "object" && "source" in icon)
    return iconNode((icon as { source?: unknown }).source);
  if (typeof icon !== "string" || !icon) return <span>⌁</span>;
  if (
    icon.startsWith("data:") ||
    icon.startsWith("http") ||
    icon.startsWith("qimao-asset:")
  )
    return <img src={resolveAsset(icon)} alt="" />;
  return <span>{icon.length < 5 ? icon : "⌁"}</span>;
}
function resolveAsset(value: string) {
  if (!value.startsWith("qimao-asset:")) return value;
  const path = value.slice(13).replace(/^\/+/, "");
  const data = activeContext?.assets.get(path);
  return data ? `data:${mime(path)};base64,${data}` : "";
}
function mime(path: string) {
  const ext = path.split(".").pop()?.toLowerCase();
  return ext === "svg"
    ? "image/svg+xml"
    : ext === "jpg" || ext === "jpeg"
      ? "image/jpeg"
      : ext === "gif"
        ? "image/gif"
        : ext === "webp"
          ? "image/webp"
          : "image/png";
}

function Marker() {
  return null;
}
(Marker as AnyProps).__qMarker = "item";
function Section() {
  return null;
}
(Section as AnyProps).__qMarker = "section";
function EmptyView() {
  return null;
}
(EmptyView as AnyProps).__qMarker = "empty";
function Dropdown() {
  return null;
}
(Dropdown as AnyProps).__qMarker = "dropdown";
function DropdownItem() {
  return null;
}
(DropdownItem as AnyProps).__qMarker = "dropdown-item";

function actionsOf(node: React.ReactNode): React.ReactElement[] {
  return flatten(node).filter(
    (item) => (item.type as AnyProps).__qMarker === "action",
  );
}
async function executeAction(action: React.ReactElement | undefined) {
  if (!action) return;
  const p = {
    ...((action.type as AnyProps).__qDefaults ?? {}),
    ...(action.props as AnyProps),
  };
  try {
    if (p.content !== undefined) {
      await navigator.clipboard.writeText(
        String(typeof p.content === "function" ? p.content() : p.content),
      );
      p.onCopy?.();
      p.onPaste?.();
      activeContext?.notify("已复制到剪贴板");
    } else if (p.url) await openExternalUrl(String(p.url));
    else if (p.target && typeof p.target === "object")
      activeContext?.push(p.target);
    else if (p.onAction) await p.onAction();
    else if (p.onSubmit) await p.onSubmit();
    else if (p.onOpen) await p.onOpen();
  } catch (error) {
    activeContext?.notify(String(error));
  }
}
function selectionKeyboard(
  entries: React.ReactElement[],
  selected: number,
  setSelected: (n: number) => void,
) {
  return (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setSelected(Math.min(entries.length - 1, selected + 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setSelected(Math.max(0, selected - 1));
    } else if (event.key === "Enter") {
      event.preventDefault();
      void executeAction(
        actionsOf((entries[selected]?.props as AnyProps)?.actions)[0],
      );
    }
  };
}

function ListRoot(props: AnyProps) {
  const [search, setSearch] = React.useState("");
  const [selected, setSelected] = React.useState(0);
  const all = flatten(props.children).filter(
    (item) => (item.type as AnyProps).__qMarker === "item",
  );
  const entries = all.filter((item) => {
    const p = item.props as AnyProps;
    return `${p.title ?? ""} ${p.subtitle ?? ""} ${(p.keywords ?? []).join(" ")}`
      .toLowerCase()
      .includes(search.toLowerCase());
  });
  React.useEffect(() => {
    setSelected(0);
    props.onSearchTextChange?.(search);
  }, [search]);
  return (
    <div
      className="ray-list"
      tabIndex={0}
      onKeyDown={selectionKeyboard(entries, selected, setSelected)}
    >
      <div className="ray-search">
        <Search />
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder={props.searchBarPlaceholder ?? "Search…"}
        />
      </div>
      {props.isLoading ? (
        <div className="ray-loading">Loading…</div>
      ) : (
        <div className="ray-items">
          {entries.map((item, index) => {
            const p = item.props as AnyProps;
            return (
              <button
                key={p.id ?? p.title ?? index}
                className={selected === index ? "selected" : ""}
                onMouseEnter={() => setSelected(index)}
                onClick={() => void executeAction(actionsOf(p.actions)[0])}
              >
                {iconNode(p.icon)}
                <div>
                  <strong>{p.title}</strong>
                  {p.subtitle && <small>{p.subtitle}</small>}
                </div>
                {p.accessories?.map((a: AnyProps, i: number) => (
                  <em key={i}>{a.text ?? a.tag?.value}</em>
                ))}
                <ChevronRight />
              </button>
            );
          })}
          {!entries.length && (
            <div className="ray-empty">
              {props.isLoading ? "Loading…" : "No Results"}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
export const List = Object.assign(ListRoot, {
  Item: Marker,
  Section,
  EmptyView,
  Dropdown: Object.assign(Dropdown, { Item: DropdownItem }),
});

function GridRoot(props: AnyProps) {
  const [search, setSearch] = React.useState("");
  const [selected, setSelected] = React.useState(0);
  const entries = flatten(props.children)
    .filter((item) => (item.type as AnyProps).__qMarker === "item")
    .filter((item) =>
      String((item.props as AnyProps).title ?? "")
        .toLowerCase()
        .includes(search.toLowerCase()),
    );
  return (
    <div
      className="ray-grid-root"
      tabIndex={0}
      onKeyDown={selectionKeyboard(entries, selected, setSelected)}
    >
      <div className="ray-search">
        <Search />
        <input
          autoFocus
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            props.onSearchTextChange?.(e.target.value);
          }}
          placeholder={props.searchBarPlaceholder ?? "Search…"}
        />
      </div>
      <div className="ray-grid">
        {entries.map((item, index) => {
          const p = item.props as AnyProps;
          return (
            <button
              key={p.id ?? p.title ?? index}
              className={selected === index ? "selected" : ""}
              onMouseEnter={() => setSelected(index)}
              onClick={() => void executeAction(actionsOf(p.actions)[0])}
            >
              {iconNode(p.content ?? p.icon)}
              <strong>{p.title}</strong>
              {p.subtitle && <small>{p.subtitle}</small>}
            </button>
          );
        })}
      </div>
    </div>
  );
}
export const Grid = Object.assign(GridRoot, {
  Item: Marker,
  Section,
  EmptyView,
  Dropdown: Object.assign(Dropdown, { Item: DropdownItem }),
});

function DetailRoot(props: AnyProps) {
  return (
    <div className="ray-detail">
      <article>{props.markdown ?? props.metadata ?? ""}</article>
    </div>
  );
}
const Metadata = Object.assign(Section, {
  Label: Marker,
  Link: Marker,
  TagList: Object.assign(Section, { Item: Marker }),
  Separator: Marker,
});
const Detail = Object.assign(DetailRoot, { Metadata });
function FormRoot(props: AnyProps) {
  const fields = flatten(props.children).filter(
    (item) => (item.type as AnyProps).__qMarker === "form-field",
  );
  const [values, setValues] = React.useState<Record<string, unknown>>(() =>
    Object.fromEntries(
      fields.map((f) => [
        (f.props as AnyProps).id,
        (f.props as AnyProps).defaultValue ??
          ((f.type as AnyProps).__qDefaults?.type === "checkbox" ? false : ""),
      ]),
    ),
  );
  return (
    <form
      className="ray-form"
      onSubmit={(event) => {
        event.preventDefault();
        const action = actionsOf(props.actions)[0];
        const callback = (action?.props as AnyProps)?.onSubmit;
        void callback?.(values);
      }}
    >
      {fields.map((field, index) => {
        const p = {
          ...((field.type as AnyProps).__qDefaults ?? {}),
          ...(field.props as AnyProps),
        };
        const value = values[p.id] ?? "";
        return (
          <label key={p.id ?? index}>
            <span>{p.title ?? p.label}</span>
            {p.type === "checkbox" ? (
              <input
                type="checkbox"
                checked={Boolean(value)}
                onChange={(e) => {
                  setValues((v) => ({ ...v, [p.id]: e.target.checked }));
                  p.onChange?.(e.target.checked);
                }}
              />
            ) : (
              <input
                type={p.type === "password" ? "password" : "text"}
                value={String(value)}
                placeholder={p.placeholder}
                onChange={(e) => {
                  setValues((v) => ({ ...v, [p.id]: e.target.value }));
                  p.onChange?.(e.target.value);
                }}
              />
            )}
          </label>
        );
      })}
      <button className="primary">Submit</button>
    </form>
  );
}
const formField = (type: string) => {
  const component = (_props: AnyProps) => null;
  (component as AnyProps).__qMarker = "form-field";
  (component as AnyProps).__qDefaults = { type };
  return component;
};
const TextField = formField("text");
const PasswordField = formField("password");
const TextAreaField = formField("textarea");
const CheckboxField = formField("checkbox");
const DropdownField = formField("dropdown");
export const Form = Object.assign(FormRoot, {
  TextField,
  PasswordField,
  TextArea: TextAreaField,
  Checkbox: CheckboxField,
  Dropdown: Object.assign(DropdownField, { Item: DropdownItem }),
  DatePicker: formField("date"),
  FilePicker: formField("file"),
  TagPicker: Object.assign(formField("tags"), { Item: DropdownItem }),
  Separator: Marker,
  Description: Marker,
});

function ActionMarker() {
  return null;
}
(ActionMarker as AnyProps).__qMarker = "action";
const action = (defaults: AnyProps = {}) => {
  const component = (_props: AnyProps) => null;
  (component as AnyProps).__qMarker = "action";
  (component as AnyProps).__qDefaults = defaults;
  return component;
};
export const Action = Object.assign(action(), {
  CopyToClipboard: action({ title: "Copy to Clipboard", icon: "copy" }),
  Paste: action({ title: "Paste", icon: "paste" }),
  OpenInBrowser: action({ title: "Open in Browser", icon: "open" }),
  Open: action(),
  Push: action(),
  SubmitForm: action(),
  ShowInFinder: action(),
  Trash: action(),
  CreateQuicklink: action(),
});
export const ActionPanel = Object.assign(Section, {
  Section,
  Submenu: Object.assign(Section, { Item: ActionMarker }),
});

class Cache {
  namespace: string;
  constructor(options?: AnyProps) {
    this.namespace = options?.namespace ?? "default";
  }
  get(key: string) {
    return (
      localStorage.getItem(`qimao-ext-cache:${this.namespace}:${key}`) ??
      undefined
    );
  }
  set(key: string, value: unknown) {
    localStorage.setItem(
      `qimao-ext-cache:${this.namespace}:${key}`,
      String(value),
    );
  }
  remove(key: string) {
    localStorage.removeItem(`qimao-ext-cache:${this.namespace}:${key}`);
  }
  clear() {
    Object.keys(localStorage)
      .filter((key) => key.startsWith(`qimao-ext-cache:${this.namespace}:`))
      .forEach((key) => localStorage.removeItem(key));
  }
  has(key: string) {
    return this.get(key) !== undefined;
  }
  isEmpty() {
    return !Object.keys(localStorage).some((key) =>
      key.startsWith(`qimao-ext-cache:${this.namespace}:`),
    );
  }
}
const LocalStorage = {
  async getItem(key: string) {
    return (
      localStorage.getItem(
        `qimao-ext:${activeContext?.bundle.command.extensionName}:${key}`,
      ) ?? undefined
    );
  },
  async setItem(key: string, value: unknown) {
    localStorage.setItem(
      `qimao-ext:${activeContext?.bundle.command.extensionName}:${key}`,
      String(value),
    );
  },
  async removeItem(key: string) {
    localStorage.removeItem(
      `qimao-ext:${activeContext?.bundle.command.extensionName}:${key}`,
    );
  },
  async allItems() {
    const prefix = `qimao-ext:${activeContext?.bundle.command.extensionName}:`;
    return Object.fromEntries(
      Object.keys(localStorage)
        .filter((key) => key.startsWith(prefix))
        .map((key) => [key.slice(prefix.length), localStorage.getItem(key)]),
    );
  },
  async clear() {
    const prefix = `qimao-ext:${activeContext?.bundle.command.extensionName}:`;
    Object.keys(localStorage)
      .filter((key) => key.startsWith(prefix))
      .forEach((key) => localStorage.removeItem(key));
  },
};
const Clipboard = {
  async copy(value: unknown) {
    await navigator.clipboard.writeText(String(value));
  },
  async paste(value: unknown) {
    await navigator.clipboard.writeText(String(value));
  },
  async readText() {
    return navigator.clipboard.readText();
  },
  async clear() {
    await navigator.clipboard.writeText("");
  },
};
const Icon = new Proxy({} as Record<string, string>, {
  get: (_, key) => String(key),
});
const Color = new Proxy(
  { PrimaryText: "currentColor" } as Record<string, string>,
  { get: (target, key) => target[String(key)] ?? String(key) },
);
const Keyboard = {
  Shortcut: {
    Common: {
      Copy: { modifiers: ["cmd"], key: "c" },
      Paste: { modifiers: ["cmd"], key: "v" },
      Open: { modifiers: ["cmd"], key: "o" },
    },
  },
};
const Toast = {
  Style: { Success: "success", Failure: "failure", Animated: "animated" },
};
const Image = {
  Mask: { Circle: "circle", RoundedRectangle: "roundedRectangle" },
};
function defaults() {
  return activeContext?.preferences ?? {};
}
function usePromise<T>(fn: () => Promise<T>, deps: unknown[] = []) {
  const [data, setData] = React.useState<T>();
  const [error, setError] = React.useState<unknown>();
  const [isLoading, setLoading] = React.useState(true);
  const revalidate = React.useCallback(() => {
    setLoading(true);
    return fn()
      .then(setData)
      .catch(setError)
      .finally(() => setLoading(false));
  }, deps);
  React.useEffect(() => {
    void revalidate();
  }, deps);
  return { data, error, isLoading, revalidate };
}
function useCachedState<T>(key: string, initial: T) {
  const [value, setValue] = React.useState<T>(() => {
    try {
      return JSON.parse(localStorage.getItem(`qimao-hook:${key}`) ?? "");
    } catch {
      return initial;
    }
  });
  const update = (next: T | ((old: T) => T)) =>
    setValue((old) => {
      const result =
        typeof next === "function" ? (next as (old: T) => T)(old) : next;
      localStorage.setItem(`qimao-hook:${key}`, JSON.stringify(result));
      return result;
    });
  return [value, update] as const;
}
function useNavigation() {
  const ctx = React.useContext(Context);
  return { push: ctx?.push ?? (() => {}), pop: ctx?.pop ?? (() => {}) };
}
const api = {
  React,
  List,
  Grid,
  Detail,
  Form,
  Action,
  ActionPanel,
  Icon,
  Color,
  Image,
  Keyboard,
  Toast,
  Cache,
  LocalStorage,
  Clipboard,
  environment: {
    assetsPath: "/qimao-assets",
    supportPath: "/qimao-support",
    theme: "light",
    isDevelopment: false,
  },
  getPreferenceValues: defaults,
  useNavigation,
  usePromise,
  useCachedPromise: usePromise,
  useCachedState,
  useLocalStorage: useCachedState,
  useFetch: (url: string) =>
    usePromise(() => fetch(url).then((r) => r.json()), [url]),
  showToast: async (input: AnyProps) =>
    activeContext?.notify(input?.message ?? input?.title ?? String(input)),
  showHUD: async (message: string) => activeContext?.notify(message),
  confirmAlert: async () => true,
  open: async (url: string) => openExternalUrl(url),
  closeMainWindow: async () => activeContext?.close(),
  popToRoot: async () => activeContext?.close(),
  launchCommand: async () => {},
  getSelectedText: async () => "",
  getSelectedFinderItems: async () => [],
  getApplications: async () => [],
  getFrontmostApplication: async () => ({ name: "", path: "", bundleId: "" }),
  LaunchType: { UserInitiated: "userInitiated", Background: "background" },
  preferences: {},
  createDeeplink: () => "",
  getFavicon: (url: string) =>
    `https://www.google.com/s2/favicons?domain=${encodeURIComponent(url)}`,
};

class BufferPolyfill extends Uint8Array {
  toString(encoding = "utf8") {
    if (encoding === "base64") {
      let text = "";
      this.forEach((byte) => (text += String.fromCharCode(byte)));
      return btoa(text);
    }
    return new TextDecoder().decode(this);
  }
}
const BufferShim: any = function (value: any, encoding?: string) {
  return BufferShim.from(value, encoding);
};
BufferShim.from = (value: any, encoding?: string) => {
  if (typeof value === "string") {
    if (encoding === "base64")
      return new BufferPolyfill(
        Uint8Array.from(atob(value), (c) => c.charCodeAt(0)),
      );
    return new BufferPolyfill(new TextEncoder().encode(value));
  }
  return new BufferPolyfill(value);
};
BufferShim.alloc = (size: number) => new BufferPolyfill(size);
BufferShim.concat = (parts: Uint8Array[]) => {
  const result = new BufferPolyfill(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  parts.forEach((p) => {
    result.set(p, offset);
    offset += p.length;
  });
  return result;
};
BufferShim.isBuffer = (value: unknown) => value instanceof BufferPolyfill;
BufferShim.prototype = BufferPolyfill.prototype;
class EventEmitter {
  listeners: Record<string, Function[]> = {};
  on(name: string, fn: Function) {
    (this.listeners[name] ??= []).push(fn);
    return this;
  }
  once(name: string, fn: Function) {
    const wrap = (...args: any[]) => {
      this.off(name, wrap);
      fn(...args);
    };
    return this.on(name, wrap);
  }
  off(name: string, fn: Function) {
    this.listeners[name] = (this.listeners[name] ?? []).filter(
      (item) => item !== fn,
    );
    return this;
  }
  emit(name: string, ...args: any[]) {
    (this.listeners[name] ?? []).forEach((fn) => fn(...args));
    return true;
  }
}
class StreamShim extends EventEmitter {
  readable = true;
  writable = true;
  pipe(destination: AnyProps) {
    this.on("data", (chunk: unknown) => destination.write?.(chunk));
    this.on("end", () => destination.end?.());
    return destination;
  }
  write(chunk: unknown) {
    this.emit("data", chunk);
    return true;
  }
  end(chunk?: unknown) {
    if (chunk !== undefined) this.write(chunk);
    this.emit("end");
  }
  push(chunk: unknown) {
    if (chunk === null) this.emit("end");
    else this.emit("data", chunk);
    return true;
  }
  static from(values: Iterable<unknown>) {
    const stream = new StreamShim();
    queueMicrotask(() => {
      for (const value of values) stream.push(value);
      stream.push(null);
    });
    return stream;
  }
}
class StringDecoderShim {
  decoder = new TextDecoder();
  write(value: Uint8Array) {
    return this.decoder.decode(value, { stream: true });
  }
  end(value?: Uint8Array) {
    return value ? this.decoder.decode(value) : this.decoder.decode();
  }
}
const processShim = {
  env: {},
  platform: navigator.platform.toLowerCase().includes("mac")
    ? "darwin"
    : navigator.platform.toLowerCase().includes("win")
      ? "win32"
      : "linux",
  cwd: () => "/qimao-support",
  nextTick: (fn: Function, ...args: unknown[]) =>
    queueMicrotask(() => fn(...args)),
  versions: {},
};
const cryptoShim = {
  randomUUID: () => crypto.randomUUID(),
  randomBytes: (size: number) => {
    const bytes = new Uint8Array(size);
    crypto.getRandomValues(bytes);
    return new BufferPolyfill(bytes);
  },
  webcrypto: crypto,
};
function normalizePath(parts: string[]) {
  const out: string[] = [];
  parts
    .join("/")
    .split("/")
    .forEach((part) => {
      if (!part || part === ".") return;
      if (part === "..") out.pop();
      else out.push(part);
    });
  return `/${out.join("/")}`;
}
const pathShim = {
  join: (...parts: string[]) => normalizePath(parts),
  resolve: (...parts: string[]) => normalizePath(parts),
  dirname: (path: string) => path.split("/").slice(0, -1).join("/") || "/",
  basename: (path: string, ext?: string) => {
    const name = path.split("/").pop() ?? "";
    return ext && name.endsWith(ext) ? name.slice(0, -ext.length) : name;
  },
  extname: (path: string) => {
    const name = path.split("/").pop() ?? "",
      i = name.lastIndexOf(".");
    return i > 0 ? name.slice(i) : "";
  },
  sep: "/",
  delimiter: ":",
  default: null as any,
};
pathShim.default = pathShim;
const fsShim = {
  readFileSync(path: string, options?: AnyProps | string) {
    const relative = String(path)
      .replace(/^.*qimao-assets\/?/, "")
      .replace(/^\/+/, "");
    const data = activeContext?.assets.get(relative);
    if (!data) throw new Error(`Asset not found: ${relative}`);
    const buffer = BufferShim.from(data, "base64");
    return typeof options === "string" || options?.encoding
      ? buffer.toString()
      : buffer;
  },
  existsSync(path: string) {
    const relative = String(path)
      .replace(/^.*qimao-assets\/?/, "")
      .replace(/^\/+/, "");
    return activeContext?.assets.has(relative) ?? false;
  },
  promises: {
    readFile: async (path: string, options?: AnyProps | string) =>
      fsShim.readFileSync(path, options),
  },
};
const unavailable = (name: string) =>
  new Proxy(
    function () {
      throw new Error(
        `This extension needs an unsupported Node module: ${name}`,
      );
    },
    { get: () => unavailable(name) },
  );
function extensionRequire(name: string) {
  if (name === "react") return React;
  if (name === "react/jsx-runtime") return JsxRuntime;
  if (name === "react-dom") return {};
  if (name === "@raycast/api" || name === "@raycast/utils") return api;
  if (name === "fs" || name === "node:fs") return fsShim;
  if (name === "path" || name === "node:path") return pathShim;
  if (name === "buffer") return { Buffer: BufferShim };
  if (name === "events" || name === "node:events")
    return { EventEmitter, default: EventEmitter };
  if (name === "stream" || name === "node:stream")
    return {
      Stream: StreamShim,
      Readable: StreamShim,
      Writable: StreamShim,
      Duplex: StreamShim,
      Transform: StreamShim,
      PassThrough: StreamShim,
      default: StreamShim,
    };
  if (name === "string_decoder" || name === "node:string_decoder")
    return { StringDecoder: StringDecoderShim };
  if (name === "crypto" || name === "node:crypto") return cryptoShim;
  if (name === "url" || name === "node:url")
    return {
      URL,
      URLSearchParams,
      parse: (value: string) => new URL(value),
      format: (value: URL) => value.toString(),
      pathToFileURL: (value: string) => new URL(`file://${value}`),
    };
  if (name === "os" || name === "node:os")
    return {
      homedir: () => "/qimao-support",
      tmpdir: () => "/tmp",
      platform: () =>
        navigator.platform.toLowerCase().includes("mac") ? "darwin" : "browser",
      arch: () => "x64",
      type: () => "Qimiao",
      release: () => "0.9.1",
      hostname: () => "localhost",
      endianness: () => "LE",
      cpus: () => [],
      userInfo: () => ({ username: "qimao", homedir: "/qimao-support" }),
      networkInterfaces: () => ({}),
      constants: { signals: {}, errno: {}, priority: {} },
      EOL: "\n",
    };
  if (name === "util")
    return {
      promisify:
        (fn: Function) =>
        (...args: any[]) =>
          new Promise((resolve, reject) =>
            fn(...args, (error: unknown, value: unknown) =>
              error ? reject(error) : resolve(value),
            ),
          ),
      types: { isPromise: (v: any) => v && typeof v.then === "function" },
    };
  if (name === "assert")
    return Object.assign(
      (condition: unknown, message?: string) => {
        if (!condition) throw new Error(message ?? "Assertion failed");
      },
      {
        strictEqual: (a: unknown, b: unknown) => {
          if (a !== b) throw new Error("Assertion failed");
        },
      },
    );
  if (name === "node-fetch")
    return Object.assign(fetch, {
      default: fetch,
      Headers,
      Request,
      Response,
      FetchError: Error,
    });
  if (name === "process" || name === "node:process") return processShim;
  if (
    [
      "child_process",
      "zlib",
      "http",
      "https",
    ].includes(name)
  )
    return unavailable(name);
  return unavailable(name);
}
function evaluate(bundle: ExtensionBundle) {
  const module = { exports: {} as AnyProps };
  const wrapper = new Function(
    "require",
    "module",
    "exports",
    "process",
    "Buffer",
    "global",
    "__dirname",
    "__filename",
    `${bundle.code}\n//# sourceURL=qimao-extension-${bundle.command.id}.js`,
  );
  wrapper(
    extensionRequire,
    module,
    module.exports,
    processShim,
    BufferShim,
    globalThis,
    bundle.extensionPath,
    `${bundle.extensionPath}/.sc-build/${bundle.command.commandName}.js`,
  );
  const exported = module.exports?.default ?? module.exports;
  if (!exported) throw new Error("The extension command has no default export");
  return exported;
}

class RuntimeBoundary extends React.Component<
  { children: React.ReactNode },
  { error: string }
> {
  state = { error: "" };
  static getDerivedStateFromError(error: Error) {
    return { error: error.message };
  }
  render() {
    return this.state.error ? (
      <div className="ray-error">
        <strong>Extension Error</strong>
        <p>{this.state.error}</p>
      </div>
    ) : (
      this.props.children
    );
  }
}
function initialPreferences(bundle: ExtensionBundle) {
  const defaults = Object.fromEntries(
    bundle.command.preferences.map((preference) => [
      preference.name,
      preference.default ??
        (preference.type === "checkbox"
          ? false
          : (preference.data?.[0]?.value ?? "")),
    ]),
  );
  try {
    return {
      ...defaults,
      ...JSON.parse(
        localStorage.getItem(
          `qimao-ext-prefs:${bundle.command.extensionName}`,
        ) ?? "{}",
      ),
    };
  } catch {
    return defaults;
  }
}
function PreferenceEditor({
  bundle,
  values,
  onChange,
  onSave,
}: {
  bundle: ExtensionBundle;
  values: Record<string, unknown>;
  onChange: (values: Record<string, unknown>) => void;
  onSave: () => void;
}) {
  return (
    <form
      className="ray-preferences"
      onSubmit={(event) => {
        event.preventDefault();
        onSave();
      }}
    >
      <h2>Extension Preferences</h2>
      <p>Configure the values required by this command.</p>
      {bundle.command.preferences.map((preference) => (
        <label key={preference.name}>
          <span>
            <strong>{preference.title ?? preference.label ?? preference.name}</strong>
            {preference.description && <small>{preference.description}</small>}
          </span>
          {preference.type === "checkbox" ? (
            <input
              type="checkbox"
              checked={Boolean(values[preference.name])}
              onChange={(event) =>
                onChange({
                  ...values,
                  [preference.name]: event.target.checked,
                })
              }
            />
          ) : preference.type === "dropdown" ? (
            <select
              value={String(values[preference.name] ?? "")}
              onChange={(event) =>
                onChange({ ...values, [preference.name]: event.target.value })
              }
            >
              {(preference.data ?? []).map((option) => (
                <option key={option.value} value={option.value}>
                  {option.title ?? option.value}
                </option>
              ))}
            </select>
          ) : (
            <input
              required={preference.required}
              type={preference.type === "password" ? "password" : "text"}
              value={String(values[preference.name] ?? "")}
              placeholder={preference.placeholder}
              onChange={(event) =>
                onChange({ ...values, [preference.name]: event.target.value })
              }
            />
          )}
        </label>
      ))}
      <button className="primary">Save and Run</button>
    </form>
  );
}
export function ExtensionRuntime({
  bundle,
  onClose,
}: {
  bundle: ExtensionBundle;
  onClose: () => void;
}) {
  const [stack, setStack] = React.useState<React.ReactElement[]>([]);
  const [notice, setNotice] = React.useState("");
  const [preferences, setPreferences] = React.useState<Record<string, unknown>>(
    () => initialPreferences(bundle),
  );
  const [preferenceOpen, setPreferenceOpen] = React.useState(() => {
    const initial = initialPreferences(bundle);
    return bundle.command.preferences.some(
      (preference) =>
        preference.required &&
        (initial[preference.name] === "" ||
          initial[preference.name] === undefined),
    );
  });
  const assets = React.useMemo(
    () => new Map(bundle.assets.map((asset) => [asset.path, asset.data])),
    [bundle],
  );
  const context = React.useMemo<RuntimeContext>(
    () => ({
      bundle,
      assets,
      preferences,
      push: (element) => setStack((old) => [...old, element]),
      pop: () => setStack((old) => (old.length ? old.slice(0, -1) : old)),
      close: onClose,
      notify: (message) => {
        setNotice(message);
        window.setTimeout(() => setNotice(""), 2200);
      },
    }),
    [bundle, assets, preferences, onClose],
  );
  activeContext = context;
  const evaluated = React.useMemo(() => {
    try {
      return { Component: evaluate(bundle), error: "" };
    } catch (reason) {
      return {
        Component: null,
        error: reason instanceof Error ? reason.message : String(reason),
      };
    }
  }, [bundle]);
  const { Component, error } = evaluated;
  React.useEffect(() => {
    if (
      preferenceOpen ||
      bundle.command.mode !== "no-view" ||
      typeof Component !== "function"
    )
      return;
    Promise.resolve(Component())
      .then(() => context.notify("Command completed"))
      .catch((reason) => context.notify(String(reason)));
  }, [bundle, Component, preferenceOpen]);
  const current = stack[stack.length - 1];
  return (
    <Context.Provider value={context}>
      <section className="extension-runtime">
        <header>
          <button
            onClick={() =>
              stack.length ? setStack((old) => old.slice(0, -1)) : onClose()
            }
          >
            <ArrowLeft />
          </button>
          <span className="ray-command-icon">
            {bundle.command.icon ? <img src={bundle.command.icon} /> : "⌁"}
          </span>
          <div>
            <strong>{bundle.command.title}</strong>
            <small>{bundle.command.extensionTitle} · Raycast compatible</small>
          </div>
          <button
            title="Extension preferences"
            onClick={() => setPreferenceOpen((open) => !open)}
          >
            <SlidersHorizontal />
          </button>
          <button onClick={onClose}>
            <X />
          </button>
        </header>
        <RuntimeBoundary key={bundle.command.id}>
          {preferenceOpen ? (
            <PreferenceEditor
              bundle={bundle}
              values={preferences}
              onChange={setPreferences}
              onSave={() => {
                localStorage.setItem(
                  `qimao-ext-prefs:${bundle.command.extensionName}`,
                  JSON.stringify(preferences),
                );
                setPreferenceOpen(false);
              }}
            />
          ) : error ? (
            <div className="ray-error">
              <strong>Extension Error</strong>
              <p>{error}</p>
            </div>
          ) : bundle.command.mode === "no-view" ? (
            <div className="ray-loading">Running command…</div>
          ) : (
            (current ?? <Component />)
          )}
        </RuntimeBoundary>
        {notice && <div className="ray-toast">{notice}</div>}
      </section>
    </Context.Provider>
  );
}
