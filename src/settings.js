import { readFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";

const DEFAULT_SETTINGS = {
  shortcut: "alt+shift+v",
  outputDir: "/tmp/pi-ssh-paste-image",
  socketPath: "",
  token: "",
  maxBytes: 20 * 1024 * 1024,
  timeoutMs: 10_000,
};

export function loadStartupSettings() {
  return mergeSettings(DEFAULT_SETTINGS, envSettings(), readJsonSettings(globalSettingsPath()));
}

export function isPasteBridgeConfigured(settings) {
  return Boolean(settings?.socketPath?.trim() && settings?.token?.trim());
}

export function loadRuntimeSettings(ctx) {
  const projectSettings = ctx?.isProjectTrusted?.() ? readJsonSettings(path.join(ctx.cwd, ".pi", "settings.json")) : {};
  return mergeSettings(DEFAULT_SETTINGS, readJsonSettings(globalSettingsPath()), projectSettings, envSettings());
}

function envSettings() {
  return normalizeSettings({
    socketPath: process.env.PI_PASTE_SOCK,
    token: process.env.PI_PASTE_TOKEN,
    outputDir: process.env.PI_PASTE_OUTPUT_DIR,
    maxBytes: parseNumber(process.env.PI_PASTE_MAX_BYTES),
    timeoutMs: parseNumber(process.env.PI_PASTE_TIMEOUT_MS),
  });
}

function readJsonSettings(filePath) {
  try {
    const json = JSON.parse(readFileSync(filePath, "utf8"));
    return normalizeSettings(json.sshPasteImage || json.piSshPasteImage || json.sshPaste || {});
  } catch {
    return {};
  }
}

function normalizeSettings(input) {
  const result = {};
  if (typeof input.shortcut === "string" && input.shortcut.trim()) result.shortcut = input.shortcut.trim();
  if (typeof input.outputDir === "string" && input.outputDir.trim()) result.outputDir = input.outputDir.trim();
  if (typeof input.socketPath === "string" && input.socketPath.trim()) result.socketPath = input.socketPath.trim();
  if (typeof input.token === "string" && input.token.trim()) result.token = input.token.trim();
  if (Number.isFinite(input.maxBytes) && input.maxBytes > 0) result.maxBytes = input.maxBytes;
  if (Number.isFinite(input.timeoutMs) && input.timeoutMs > 0) result.timeoutMs = input.timeoutMs;
  return result;
}

function mergeSettings(...items) {
  return Object.assign({}, ...items.map(normalizeSettings));
}

function parseNumber(value) {
  if (value === undefined || value === "") return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function globalSettingsPath() {
  return path.join(os.homedir(), ".pi", "agent", "settings.json");
}
