import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { validatePayload } from "./protocol.js";

const DEFAULT_OUTPUT_DIR = "/tmp/pi-ssh-paste-image";

export async function payloadToEditorText(payload, { outputDir = DEFAULT_OUTPUT_DIR, cwd = process.cwd() } = {}) {
  validatePayload(payload);

  if (payload.kind === "text") {
    return {
      editorText: payload.text,
      notification: undefined,
      savedFiles: [],
    };
  }

  const targetDir = resolveOutputDir(outputDir, cwd);
  await mkdir(targetDir, { recursive: true, mode: 0o700 });

  const items = payload.kind === "image" ? [payload] : payload.files;
  const savedFiles = [];
  for (const item of items) {
    savedFiles.push(await saveBinaryItem(item, targetDir));
  }

  return {
    editorText: savedFiles.map((file) => `@${file.path}`).join(" "),
    notification: fileNotification(savedFiles),
    savedFiles,
  };
}

function resolveOutputDir(outputDir, cwd) {
  const value = outputDir && outputDir.trim() ? outputDir : DEFAULT_OUTPUT_DIR;
  return path.isAbsolute(value) ? value : path.resolve(cwd, value);
}

export function sanitizeFileName(fileName, fallback = "clipboard.bin") {
  const base = path.basename(String(fileName || fallback)).replaceAll("\0", "");
  const cleaned = base
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}._-]+/gu, "_")
    .replace(/^\.+/, "")
    .replace(/_+/g, "_")
    .slice(0, 160);
  return cleaned || fallback;
}

function fileNameForMime(mime) {
  switch (mime) {
    case "image/png":
      return "clipboard.png";
    case "image/jpeg":
      return "clipboard.jpg";
    case "image/gif":
      return "clipboard.gif";
    case "image/webp":
      return "clipboard.webp";
    case "application/pdf":
      return "clipboard.pdf";
    default:
      return "clipboard.bin";
  }
}

async function saveBinaryItem(item, targetDir) {
  const buffer = Buffer.from(item.dataBase64, "base64");
  const fallback = fileNameForMime(item.mime);
  const safeName = sanitizeFileName(item.filename, fallback);
  const uniqueName = `${timestamp()}-${randomUUID().slice(0, 8)}-${safeName}`;
  const filePath = path.join(targetDir, uniqueName);
  await writeFile(filePath, buffer, { mode: 0o600, flag: "wx" });
  return {
    path: filePath,
    byteLength: buffer.byteLength,
    mime: item.mime,
    source: item.source,
  };
}

function fileNotification(files) {
  const count = files.length;
  const totalBytes = files.reduce((sum, file) => sum + file.byteLength, 0);
  const mimeTypes = new Set(files.map((file) => file.mime).filter(Boolean));
  const parts = [`SSH paste: saved ${count} ${count === 1 ? "file" : "files"}`];

  if (mimeTypes.size === 1) {
    parts.push([...mimeTypes][0]);
  }
  if (totalBytes > 0) {
    parts.push(formatBytes(totalBytes));
  }
  return parts.filter(Boolean).join(" · ");
}

function formatBytes(bytes) {
  const units = ["B", "KiB", "MiB", "GiB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return index === 0 ? `${bytes} B` : `${value.toFixed(value >= 10 ? 0 : 1)} ${units[index]}`;
}

function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, "-");
}
