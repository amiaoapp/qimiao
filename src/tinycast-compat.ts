// SPDX-License-Identifier: AGPL-3.0-or-later
// Compatibility behavior is adapted from TinyCast, Copyright (C) 2026 Abue Ammar.

import type { AppItem, CommandArgument, CommandTool, Settings } from "./types";

type JsonRecord = Record<string, unknown>;

export type CompatibleBackup = {
  sourceLabel: "qimiao" | "TinyCast" | "Raycast";
  settings?: Partial<Settings>;
  apps?: AppItem[];
  commandTools?: CommandTool[];
  clipboardEntries?: string[];
};

const record = (value: unknown): JsonRecord | null =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const textValue = (value: unknown) =>
  typeof value === "string" && value.trim() ? value.trim() : undefined;

const boolValue = (value: unknown, fallback = true) =>
  typeof value === "boolean" ? value : fallback;

const freshId = (prefix: string) =>
  `${prefix}-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;

export function rewriteRaycastPlaceholders(value: string) {
  return value.replace(/\{\s*query(?=[\s=|}])/gi, "{argument")
    .replace(/\{\s*selectedText(?=[\s=|}])/gi, "{selection");
}

function mapQuicklink(value: unknown, source: "tinycast" | "raycast"): CommandTool | null {
  const item = record(value);
  if (!item) return null;
  const title = textValue(item.name ?? item.title);
  const content = textValue(item.link ?? item.url);
  if (!title || !content) return null;
  return {
    id: textValue(item.id) ?? freshId("quicklink"),
    type: "quicklink",
    title,
    content: rewriteRaycastPlaceholders(content),
    enabled: boolValue(item.isEnabled),
    showsInRootSearch: boolValue(item.showsInRootSearch),
    pinnedAt: textValue(item.pinnedAt),
    createdAt: textValue(item.createdAt),
    openWithBundleID: textValue(item.openWithBundleID),
    iconSymbol: textValue(item.iconSymbol),
    source,
  };
}

function mapSnippet(value: unknown, source: "tinycast" | "raycast"): CommandTool | null {
  const item = record(value);
  if (!item) return null;
  const title = textValue(item.name ?? item.title);
  const content = typeof (item.text ?? item.content) === "string"
    ? String(item.text ?? item.content)
    : undefined;
  if (!title || content === undefined) return null;
  return {
    id: textValue(item.id) ?? freshId("snippet"), type: "snippet", title, content,
    keyword: textValue(item.keyword), enabled: boolValue(item.isEnabled),
    showsConfirmation: boolValue(item.showsConfirmation, false), source,
  };
}

function mapArguments(value: unknown): CommandArgument[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const item = record(entry);
    const name = textValue(item?.name ?? item?.placeholder);
    return name ? [{ name, optional: boolValue(item?.isOptional ?? item?.optional, false) }] : [];
  });
}

function mapCustomCommand(value: unknown, source: "tinycast" | "raycast"): CommandTool | null {
  const item = record(value);
  if (!item) return null;
  const title = textValue(item.name ?? item.title);
  const content = textValue(item.command ?? item.program);
  if (!title || !content) return null;
  return {
    id: textValue(item.id) ?? freshId("command"), type: "custom", title, content,
    enabled: boolValue(item.isEnabled), arguments: mapArguments(item.arguments),
    requiresConfirmation: boolValue(item.requiresConfirmation, false),
    showsConfirmation: boolValue(item.showsConfirmation, false),
    showsOutput: boolValue(item.showsOutput, false),
    workingDirectory: textValue(item.workingDirectory),
    iconSymbol: textValue(item.iconSymbol), source,
  };
}

function mapNote(value: unknown, source: "tinycast" | "raycast"): CommandTool | null {
  const item = record(value);
  if (!item) return null;
  const title = textValue(item.name ?? item.title);
  const content = typeof (item.text ?? item.content ?? item.source) === "string"
    ? String(item.text ?? item.content ?? item.source)
    : undefined;
  if (!title || content === undefined) return null;
  return { id: textValue(item.id) ?? freshId("note"), type: "note", title, content, source };
}

function arrayAt(value: unknown) {
  return Array.isArray(value) ? value : [];
}

function tinycastSettings(value: unknown): Partial<Settings> | undefined {
  const settings = record(value);
  if (!settings) return undefined;
  const result: Partial<Settings> = {};
  if (settings.appearance === "light" || settings.appearance === "dark" || settings.appearance === "system")
    result.theme = settings.appearance;
  // Capability-granting settings, global hotkeys, login items and permissions are deliberately
  // not imported. A data file must never arm a listener or grant a capability by itself.
  return Object.keys(result).length ? result : undefined;
}

function raycastQuicklinks(root: JsonRecord) {
  const container = record(root.quicklinks);
  return arrayAt(container?.quicklinks ?? root.quicklinks);
}

function raycastSnippets(root: JsonRecord) {
  const container = record(root.snippets);
  return arrayAt(container?.snippets ?? root.snippets);
}

export function parseCompatibleBackup(raw: string): CompatibleBackup {
  const parsed: unknown = JSON.parse(raw);
  const root = record(parsed);
  if (!root) throw new Error("Unsupported backup data");

  if (root.format === "qimiao-backup") {
    if (!Array.isArray(root.apps)) throw new Error("Invalid qimiao backup");
    return {
      sourceLabel: "qimiao",
      settings: (record(root.settings) ?? undefined) as Partial<Settings> | undefined,
      apps: root.apps as AppItem[],
      commandTools: Array.isArray(root.commandTools) ? root.commandTools as CommandTool[] : [],
      clipboardEntries: Array.isArray(root.clipboardEntries)
        ? root.clipboardEntries.filter((value): value is string => typeof value === "string")
        : undefined,
    };
  }

  const looksRaycast = Boolean(record(root.settings)?.general)
    || Boolean(record(root.clipboardHistory))
    || Boolean(record(root.snippets)?.snippets)
    || Boolean(record(root.quicklinks)?.openWithPlatforms);
  const source = looksRaycast ? "raycast" : "tinycast";
  const settingsBackup = record(root.settings);
  const quicklinkValues = looksRaycast
    ? raycastQuicklinks(root)
    : arrayAt(root.quicklinks ?? settingsBackup?.quicklinks);
  const snippetValues = looksRaycast ? raycastSnippets(root) : arrayAt(root.snippets);
  const commandValues = arrayAt(root.customCommands ?? settingsBackup?.customCommands);
  const noteValues = arrayAt(root.notes);
  const commandTools = [
    ...quicklinkValues.map((value) => mapQuicklink(value, source)),
    ...snippetValues.map((value) => mapSnippet(value, source)),
    ...commandValues.map((value) => mapCustomCommand(value, source)),
    ...noteValues.map((value) => mapNote(value, source)),
  ].filter((value): value is CommandTool => value !== null);

  if (!commandTools.length && !settingsBackup)
    throw new Error("Unsupported TinyCast/Raycast backup data");
  return {
    sourceLabel: looksRaycast ? "Raycast" : "TinyCast",
    settings: looksRaycast ? undefined : tinycastSettings(settingsBackup?.settings ?? root.settings),
    commandTools,
    clipboardEntries: arrayAt(root.clipboardEntries)
      .filter((value): value is string => typeof value === "string"),
  };
}

export function toolMatchesQuery(tool: CommandTool, query: string) {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return true;
  const names = [tool.title, tool.alias, tool.keyword].filter(Boolean) as string[];
  return names.some((name) => {
    const candidate = name.toLocaleLowerCase();
    return candidate.includes(normalized) || normalized.startsWith(`${candidate} `);
  }) || `${tool.title} ${tool.alias ?? ""} ${tool.keyword ?? ""} ${tool.content}`
    .toLocaleLowerCase().includes(normalized);
}

export function toolArgumentInput(query: string, tool?: CommandTool) {
  if (!tool) return "";
  const trimmed = query.trim();
  const names = [tool.keyword, tool.alias, tool.title].filter(Boolean) as string[];
  for (const name of names) {
    if (trimmed.toLocaleLowerCase().startsWith(`${name.toLocaleLowerCase()} `))
      return trimmed.slice(name.length).trim();
  }
  return "";
}

export function normalizeCompatibleDestination(value: string) {
  const trimmed = value.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed) || /^(~\/|\/|[a-z]:[\\/])/i.test(trimmed))
    return trimmed;
  if (/^[a-z0-9](?:[a-z0-9.-]*\.)[a-z]{2,}(?:[/:?#]|$)/i.test(trimmed))
    return `https://${trimmed}`;
  return trimmed;
}

type ExpansionContext = {
  argument?: string;
  clipboard?: string;
  selection?: string;
  snippets?: CommandTool[];
  urlEncode?: boolean;
};

const parameter = (source: string, name: string) => {
  const quoted = source.match(new RegExp(`\\b${name}\\s*=\\s*(["'])(.*?)\\1`, "i"));
  if (quoted) return quoted[2];
  return source.match(new RegExp(`\\b${name}\\s*=\\s*([^|]+?)(?=\\s+\\w+\\s*=|$)`, "i"))?.[1]?.trim();
};

const dateValue = (kind: string) => {
  const now = new Date();
  if (kind === "date") return now.toLocaleDateString();
  if (kind === "time") return now.toLocaleTimeString();
  if (kind === "day") return now.toLocaleDateString(undefined, { weekday: "long" });
  return now.toLocaleString();
};

function applyModifiers(value: string, modifiers: string[]) {
  let output = value;
  let raw = false;
  let encoded = false;
  for (const modifier of modifiers.map((item) => item.trim().toLocaleLowerCase())) {
    if (modifier === "trim") output = output.trim();
    else if (modifier === "uppercase") output = output.toLocaleUpperCase();
    else if (modifier === "lowercase") output = output.toLocaleLowerCase();
    else if (modifier === "percent-encode") { output = encodeURIComponent(output); encoded = true; }
    else if (modifier === "json-stringify") output = JSON.stringify(output).slice(1, -1);
    else if (modifier === "raw") raw = true;
  }
  return { output, raw, encoded };
}

export async function expandCompatibleTemplate(
  template: string, context: ExpansionContext, depth = 0,
): Promise<{ value: string; missingArguments: string[] }> {
  if (depth > 5) return { value: template, missingArguments: [] };
  const missingArguments: string[] = [];
  const tokens = [...template.matchAll(/\{([^{}]+)\}/g)];
  let value = template;
  for (const token of tokens) {
    const body = token[1].trim();
    const parts = body.split("|");
    const head = parts.shift()?.trim() ?? "";
    const name = head.match(/^[^\s:=]+/)?.[0]?.toLocaleLowerCase() ?? "";
    let replacement: string | undefined;
    if (name === "argument" || name === "query") {
      replacement = context.argument || parameter(head, "default");
      if (replacement === undefined) missingArguments.push(parameter(head, "name") ?? "Argument");
    } else if (name === "clipboard") replacement = context.clipboard ?? "";
    else if (name === "selection" || name === "selectedtext") replacement = context.selection ?? context.clipboard ?? "";
    else if (["date", "time", "datetime", "day"].includes(name)) replacement = dateValue(name);
    else if (name === "uuid") replacement = crypto.randomUUID();
    else if (name === "cursor") replacement = "";
    else if (name === "snippet" || head.toLocaleLowerCase().startsWith("snippet:")) {
      const targetName = head.includes(":") ? head.slice(head.indexOf(":") + 1).trim() : parameter(head, "name");
      const snippet = context.snippets?.find((item) => item.type === "snippet" &&
        [item.title, item.keyword].some((candidate) => candidate?.toLocaleLowerCase() === targetName?.toLocaleLowerCase()));
      if (snippet) replacement = (await expandCompatibleTemplate(snippet.content, context, depth + 1)).value;
    }
    if (replacement === undefined) continue;
    const modified = applyModifiers(replacement, parts);
    const finalValue = context.urlEncode && !modified.raw && !modified.encoded
      ? encodeURIComponent(modified.output)
      : modified.output;
    value = value.replace(token[0], finalValue);
  }
  return { value, missingArguments };
}
