// SPDX-License-Identifier: AGPL-3.0-or-later
export type CommandResult = {
  id: string;
  title: string;
  subtitle: string;
  kind: "command" | "calculator" | "emoji" | "file" | "shortcut" | "clipboard" | "quicklink" | "snippet" | "note" | "custom";
  value?: string;
  path?: string;
  action?: string;
  searchTerms?: string;
};

const tokenize = (source: string) => {
  const tokens = source.replace(/\s+/g, "").match(/(?:\d*\.\d+|\d+\.?\d*|[()+\-*/%^])/g);
  if (!tokens || tokens.join("") !== source.replace(/\s+/g, "")) return null;
  return tokens;
};

export function calculateExpression(source: string): number | null {
  const tokens = tokenize(source);
  if (!tokens || !tokens.some((token) => /\d/.test(token))) return null;
  let index = 0;
  const primary = (): number => {
    const token = tokens[index++];
    if (token === "(") {
      const value = add();
      if (tokens[index++] !== ")") throw new Error("parenthesis");
      return value;
    }
    if (token === "+") return primary();
    if (token === "-") return -primary();
    const value = Number(token);
    if (!Number.isFinite(value)) throw new Error("number");
    return value;
  };
  const power = (): number => {
    let value = primary();
    if (tokens[index] === "^") {
      index += 1;
      value **= power();
    }
    return value;
  };
  const multiply = (): number => {
    let value = power();
    while (["*", "/", "%"].includes(tokens[index])) {
      const operation = tokens[index++];
      const right = power();
      value = operation === "*" ? value * right : operation === "/" ? value / right : value % right;
    }
    return value;
  };
  const add = (): number => {
    let value = multiply();
    while (["+", "-"].includes(tokens[index])) {
      const operation = tokens[index++];
      const right = multiply();
      value = operation === "+" ? value + right : value - right;
    }
    return value;
  };
  try {
    const result = add();
    return index === tokens.length && Number.isFinite(result) ? result : null;
  } catch {
    return null;
  }
}

const unitScale: Record<string, [string, number]> = {
  mm: ["length", .001], cm: ["length", .01], m: ["length", 1], km: ["length", 1000],
  in: ["length", .0254], inch: ["length", .0254], ft: ["length", .3048], yd: ["length", .9144], mi: ["length", 1609.344],
  g: ["mass", .001], kg: ["mass", 1], oz: ["mass", .028349523125], lb: ["mass", .45359237],
  b: ["data", 1], kb: ["data", 1024], mb: ["data", 1024 ** 2], gb: ["data", 1024 ** 3], tb: ["data", 1024 ** 4],
  s: ["time", 1], sec: ["time", 1], min: ["time", 60], h: ["time", 3600], hr: ["time", 3600], d: ["time", 86400],
};
const unitAliases: Record<string, string> = {
  毫米: "mm", 厘米: "cm", 米: "m", 千米: "km", 公里: "km", 英寸: "in", 英尺: "ft",
  克: "g", 千克: "kg", 公斤: "kg", 磅: "lb", 秒: "s", 分钟: "min", 小时: "h", 天: "d",
  "°c": "c", "℃": "c", 摄氏度: "c", "°f": "f", "℉": "f", 华氏度: "f", 开尔文: "k",
};

export function convertUnits(source: string): { value: number; from: string; to: string } | null {
  const match = source.trim().toLowerCase().match(/^([+-]?(?:\d+(?:\.\d+)?|\.\d+))\s*([a-z°℃℉\u4e00-\u9fff]+?)\s*(?:to|in|=|转|换算(?:成)?)\s*([a-z°℃℉\u4e00-\u9fff]+)$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const from = unitAliases[match[2]] ?? match[2];
  const to = unitAliases[match[3]] ?? match[3];
  if (["c", "f", "k"].includes(from) && ["c", "f", "k"].includes(to)) {
    const kelvin = from === "k" ? amount : from === "c" ? amount + 273.15 : (amount - 32) * 5 / 9 + 273.15;
    if (kelvin < 0) return null;
    return { value: to === "k" ? kelvin : to === "c" ? kelvin - 273.15 : (kelvin - 273.15) * 9 / 5 + 32, from, to };
  }
  const left = unitScale[from], right = unitScale[to];
  if (!left || !right || left[0] !== right[0]) return null;
  return { value: amount * left[1] / right[1], from, to };
}

// Keep quoted arguments intact; never execute a shell while parsing input.
export function splitCommandArguments(source: string): string[] | null {
  const result: string[] = [];
  let token = "", quote = "", started = false;
  for (let i = 0; i < source.length; i++) {
    const char = source[i];
    if (char === "\\" && quote !== "'" && i + 1 < source.length &&
      (source[i + 1] === '"' || source[i + 1] === "'" || source[i + 1] === "\\" || (!quote && /\s/.test(source[i + 1])))) {
      token += source[++i]; started = true;
    } else if (quote) {
      if (char === quote) quote = ""; else token += char;
    } else if (char === '"' || char === "'") {
      quote = char; started = true;
    } else if (/\s/.test(char)) {
      if (started) result.push(token);
      token = ""; started = false;
    } else { token += char; started = true; }
  }
  if (quote) return null;
  if (started) result.push(token);
  return result;
}

export function dictionaryTerm(source: string): string | null {
  return source.trim().match(/^(?:dict|define|词典|释义)(?:[:：]\s*|\s+)(.+)$/i)?.[1].trim() || null;
}

export function textUtility(source: string, en = false, now = Date.now()): CommandResult | null {
  const match = source.trim().match(/^(json|base64|decode64|time)[:：]\s*([\s\S]*)$/i);
  if (!match || !match[2]) return null;
  const operation = match[1].toLowerCase(), input = match[2];
  const titles: Record<string, string> = en
    ? { json: "Format JSON", base64: "Encode Base64", decode64: "Decode Base64", time: "Convert timestamp" }
    : { json: "格式化 JSON", base64: "Base64 编码", decode64: "Base64 解码", time: "时间戳转换" };
  try {
    let value: string;
    if (operation === "json") value = JSON.stringify(JSON.parse(input), null, 2);
    else if (operation === "base64") {
      const bytes = new TextEncoder().encode(input);
      value = btoa(Array.from(bytes, (byte) => String.fromCharCode(byte)).join(""));
    } else if (operation === "decode64") {
      value = new TextDecoder("utf-8", { fatal: true }).decode(Uint8Array.from(atob(input.replace(/\s/g, "")), (char) => char.charCodeAt(0)));
    } else {
      const raw = input.trim();
      const time = /^(now|现在)$/i.test(raw) ? now : /^-?\d+$/.test(raw)
        ? Number(raw) * (raw.replace("-", "").length <= 10 ? 1000 : 1)
        : Date.parse(raw);
      const date = new Date(time);
      value = `UTC: ${date.toISOString()}\nUnix (s): ${Math.floor(time / 1000)}\nUnix (ms): ${time}`;
    }
    return { id: "text-utility", title: titles[operation], subtitle: value.slice(0, 180), kind: "snippet", action: "preview-output", value };
  } catch {
    return { id: "text-utility-error", title: en ? "Invalid input" : "输入格式不正确", subtitle: operation === "time" ? (en ? "Use Unix seconds / milliseconds or an ISO date" : "请输入秒/毫秒时间戳，或 ISO 日期，如 2026-10-20T12:00:00Z") : (en ? `Check the ${operation} content` : `请检查 ${operation} 内容是否完整、编码是否正确`), kind: "command", action: "input-error" };
  }
}

export const emojiCatalog = [
  ["😀", "grin smile 开心 笑脸"], ["😂", "joy tears 笑哭"], ["🥰", "love 喜欢 爱"],
  ["😍", "heart eyes 爱心"], ["🤔", "think 思考"], ["😎", "cool 墨镜"],
  ["😭", "cry 哭"], ["😡", "angry 生气"], ["👍", "thumb up 赞"],
  ["👎", "thumb down 踩"], ["👏", "clap 鼓掌"], ["🙏", "please thanks 谢谢"],
  ["🎉", "party celebrate 庆祝"], ["❤️", "heart love 红心"], ["🔥", "fire hot 火"],
  ["✨", "sparkles 闪亮"], ["✅", "check done 完成"], ["❌", "cross error 错误"],
  ["🚀", "rocket launch 启动"], ["💡", "idea light 想法"], ["📌", "pin 图钉"],
  ["📎", "paperclip 附件"], ["🔍", "search 搜索"], ["⚡", "lightning 快速"],
] as const;

export function matchText(text: string, query: string) {
  const haystack = text.toLocaleLowerCase();
  const words = query.toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  return words.every((word) => haystack.includes(word));
}
