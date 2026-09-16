import { spawn } from "node:child_process";
import { access, readFile, stat } from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const IMAGE_TYPES = [
  { mime: "image/png", filename: "clipboard.png" },
  { mime: "image/jpeg", filename: "clipboard.jpg" },
  { mime: "image/webp", filename: "clipboard.webp" },
  { mime: "image/gif", filename: "clipboard.gif" },
];

export async function readClipboard({ maxBytes = 20 * 1024 * 1024 } = {}) {
  if (process.platform === "linux") {
    return readLinuxClipboard({ maxBytes });
  }
  if (process.platform === "darwin") {
    return readMacClipboard({ maxBytes });
  }
  if (process.platform === "win32") {
    return readWindowsClipboard({ maxBytes });
  }
  throw new Error(`unsupported local platform: ${process.platform}`);
}

async function readLinuxClipboard({ maxBytes }) {
  const attempts = [tryLinuxUriList, tryLinuxImage, tryLinuxText];
  const errors = [];
  for (const attempt of attempts) {
    try {
      const payload = await attempt({ maxBytes });
      if (payload) return payload;
    } catch (error) {
      errors.push(error.message);
    }
  }
  const suffix = errors.length > 0 ? ` (${errors.join("; ")})` : "";
  throw new Error(`clipboard has no supported image/file/text content${suffix}`);
}

async function tryLinuxUriList({ maxBytes }) {
  const sources = [
    { cmd: "wl-paste", args: ["--no-newline", "--type", "text/uri-list"] },
    { cmd: "xclip", args: ["-selection", "clipboard", "-t", "text/uri-list", "-o"] },
  ];

  for (const source of sources) {
    if (!(await commandExists(source.cmd))) continue;
    const result = await captureOptional(source.cmd, source.args, { maxBytes: 1024 * 1024 });
    if (!result) continue;

    const paths = parseUriList(result.toString("utf8"));
    if (paths.length === 0) continue;

    const files = await readLocalFiles(paths, { maxBytes });
    if (files.length > 0) {
      return { kind: "files", files };
    }
  }
  return undefined;
}

async function tryLinuxImage({ maxBytes }) {
  const commands = [];
  for (const type of IMAGE_TYPES) {
    commands.push({ cmd: "wl-paste", args: ["--type", type.mime], ...type });
    commands.push({ cmd: "xclip", args: ["-selection", "clipboard", "-t", type.mime, "-o"], ...type });
  }

  for (const item of commands) {
    if (!(await commandExists(item.cmd))) continue;
    const data = await captureOptional(item.cmd, item.args, { maxBytes });
    if (!data || data.byteLength === 0) continue;
    return {
      kind: "image",
      mime: item.mime,
      filename: item.filename,
      byteLength: data.byteLength,
      dataBase64: data.toString("base64"),
      source: item.cmd,
    };
  }
  return undefined;
}

async function tryLinuxText({ maxBytes }) {
  const sources = [
    { cmd: "wl-paste", args: ["--no-newline", "--type", "text/plain"] },
    { cmd: "xclip", args: ["-selection", "clipboard", "-out"] },
    { cmd: "xsel", args: ["--clipboard", "--output"] },
  ];

  for (const source of sources) {
    if (!(await commandExists(source.cmd))) continue;
    const data = await captureOptional(source.cmd, source.args, { maxBytes });
    if (!data || data.byteLength === 0) continue;
    return { kind: "text", text: data.toString("utf8") };
  }
  return undefined;
}

async function readMacClipboard({ maxBytes }) {
  if (await commandExists("pngpaste")) {
    const image = await captureOptional("pngpaste", ["-"], { maxBytes });
    if (image?.byteLength > 0) {
      return {
        kind: "image",
        mime: "image/png",
        filename: "clipboard.png",
        byteLength: image.byteLength,
        dataBase64: image.toString("base64"),
        source: "pngpaste",
      };
    }
  }

  if (await commandExists("pbpaste")) {
    const text = await captureOptional("pbpaste", [], { maxBytes });
    if (text?.byteLength > 0) {
      return { kind: "text", text: text.toString("utf8") };
    }
  }
  throw new Error("macOS clipboard needs pbpaste for text or pngpaste for images");
}

async function readWindowsClipboard({ maxBytes }) {
  const script = "Get-Clipboard -Raw";
  const data = await captureOptional("powershell.exe", ["-NoProfile", "-Command", script], { maxBytes });
  if (data?.byteLength > 0) {
    return { kind: "text", text: data.toString("utf8") };
  }
  throw new Error("Windows MVP currently supports text clipboard only");
}

export function parseUriList(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"))
    .filter((line) => line.startsWith("file://"))
    .map((line) => {
      try {
        return fileURLToPath(line);
      } catch {
        return undefined;
      }
    })
    .filter(Boolean);
}

async function readLocalFiles(paths, { maxBytes }) {
  const files = [];
  let total = 0;

  for (const filePath of paths) {
    await access(filePath, constants.R_OK);
    const info = await stat(filePath);
    if (!info.isFile()) continue;
    total += info.size;
    if (total > maxBytes) {
      throw new Error(`clipboard files exceed maxBytes (${maxBytes})`);
    }
    const data = await readFile(filePath);
    files.push({
      filename: path.basename(filePath),
      mime: mimeFromPath(filePath),
      byteLength: data.byteLength,
      dataBase64: data.toString("base64"),
      source: "text/uri-list",
    });
  }

  return files;
}

function mimeFromPath(filePath) {
  switch (path.extname(filePath).toLowerCase()) {
    case ".png":
      return "image/png";
    case ".jpg":
    case ".jpeg":
      return "image/jpeg";
    case ".gif":
      return "image/gif";
    case ".webp":
      return "image/webp";
    case ".pdf":
      return "application/pdf";
    case ".txt":
    case ".md":
      return "text/plain";
    default:
      return "application/octet-stream";
  }
}

async function commandExists(command) {
  try {
    await capture("sh", ["-lc", `command -v ${shellQuote(command)}`], {
      maxBytes: 4096,
      timeoutMs: 1500,
    });
    return true;
  } catch {
    return false;
  }
}

async function captureOptional(command, args, options) {
  try {
    return await capture(command, args, { timeoutMs: 3000, ...options });
  } catch {
    return undefined;
  }
}

function capture(command, args, { maxBytes, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"] });
    const chunks = [];
    const stderr = [];
    let total = 0;
    let settled = false;

    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (error) reject(error);
      else resolve(value);
    }

    const timer = setTimeout(() => {
      child.kill("SIGTERM");
      finish(new Error(`${command} timed out`));
    }, timeoutMs);

    child.stdout.on("data", (chunk) => {
      total += chunk.length;
      if (total > maxBytes) {
        child.kill("SIGTERM");
        finish(new Error(`${command} output exceeds maxBytes (${maxBytes})`));
        return;
      }
      chunks.push(chunk);
    });

    child.stderr.on("data", (chunk) => stderr.push(chunk));
    child.once("error", finish);
    child.once("close", (code) => {
      if (settled) return;
      if (code === 0) {
        finish(undefined, Buffer.concat(chunks, total));
      } else {
        const message = Buffer.concat(stderr).toString("utf8").trim() || `${command} exited ${code}`;
        finish(new Error(message));
      }
    });
  });
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
