// SPDX-License-Identifier: AGPL-3.0-or-later
export type CommandResult = {
  id: string;
  title: string;
  subtitle: string;
  kind: "command" | "calculator" | "emoji" | "file" | "shortcut" | "clipboard" | "quicklink" | "snippet" | "note" | "custom";
  value?: string;
  path?: string;
  action?: string;
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
};

export function convertUnits(source: string): { value: number; from: string; to: string } | null {
  const match = source.trim().toLowerCase().match(/^(-?\d+(?:\.\d+)?)\s*([a-z]+)\s*(?:to|in|=|转|换算(?:成)?)\s*([a-z]+)$/i);
  if (!match) return null;
  const amount = Number(match[1]);
  const from = match[2];
  const to = match[3];
  const left = unitScale[from], right = unitScale[to];
  if (!left || !right || left[0] !== right[0]) return null;
  return { value: amount * left[1] / right[1], from, to };
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
