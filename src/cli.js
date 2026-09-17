import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { startPasteDaemon } from "./daemon.js";
import { runSshWrapper } from "./ssh-wrapper.js";

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

export async function runCli(argv) {
  const [command, ...rest] = argv;

  switch (command) {
    case "daemon":
      await runDaemonCommand(parseOptions(rest));
      return;
    case "ssh":
      await runSshCommand(rest);
      return;
    case "doctor":
      await runDoctorCommand();
      return;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      return;
    default:
      throw new Error(`unknown command: ${command}`);
  }
}

async function runDaemonCommand({ options }) {
  const tmpDir = options.socket ? undefined : await mkdtemp(path.join(os.tmpdir(), "pi-ssh-paste-image-"));
  if (tmpDir) await chmod(tmpDir, 0o700);

  const socketPath = options.socket || path.join(tmpDir, "local.sock");
  const token = options.token || randomToken();
  const maxBytes = parseBytes(options["max-bytes"], DEFAULT_MAX_BYTES);
  const daemon = await startPasteDaemon({ socketPath, token, maxBytes });

  console.error("pi-ssh-paste-image daemon is running");
  console.error(`PI_PASTE_SOCK=${daemon.socketPath}`);
  console.error(`PI_PASTE_TOKEN=${token}`);
  console.error(`PI_PASTE_MAX_BYTES=${maxBytes}`);
  console.error("Stop with Ctrl+C.");

  const stop = async () => {
    await daemon.close().catch(() => {});
    if (tmpDir) await rm(tmpDir, { recursive: true, force: true });
  };

  process.once("SIGINT", async () => {
    await stop();
    process.exit(130);
  });
  process.once("SIGTERM", async () => {
    await stop();
    process.exit(143);
  });

  await new Promise(() => {});
}

async function runSshCommand(args) {
  const split = args.indexOf("--");
  const beforeCommand = split === -1 ? args : args.slice(0, split);
  const remoteCommand = split === -1 ? [] : args.slice(split + 1);
  const { options, positional } = parseOptions(beforeCommand);
  const target = positional[0];

  if (!target) {
    throw new Error("ssh target is required. Example: pi-ssh-paste-image ssh user@host -- pi");
  }

  await runSshWrapper({
    target,
    remoteCommand,
    outputDir: options["output-dir"] || "/tmp/pi-ssh-paste-image",
    maxBytes: parseBytes(options["max-bytes"], DEFAULT_MAX_BYTES),
    remoteSocket: options["remote-socket"],
    sshOptions: normalizeRepeatable(options["ssh-option"]),
  });
}

async function runDoctorCommand() {
  const checks = [];
  checks.push(["platform", process.platform]);
  checks.push(["node", process.version]);

  if (process.platform === "linux") {
    checks.push(["wl-paste", (await hasCommand("wl-paste")) ? "ok" : "missing"]);
    checks.push(["xclip", (await hasCommand("xclip")) ? "ok" : "missing"]);
    checks.push(["xsel", (await hasCommand("xsel")) ? "ok" : "missing"]);
    checks.push(["ssh", (await hasCommand("ssh")) ? "ok" : "missing"]);
  } else if (process.platform === "darwin") {
    checks.push(["pbpaste", (await hasCommand("pbpaste")) ? "ok" : "missing"]);
    checks.push(["pngpaste", (await hasCommand("pngpaste")) ? "ok" : "missing (画像には推奨)"]);
    checks.push(["ssh", (await hasCommand("ssh")) ? "ok" : "missing"]);
  } else if (process.platform === "win32") {
    checks.push(["powershell.exe", (await hasCommand("powershell.exe")) ? "ok" : "missing"]);
    checks.push(["ssh", (await hasCommand("ssh")) ? "ok" : "missing"]);
  }

  for (const [name, value] of checks) {
    console.log(`${name}: ${value}`);
  }
}

function parseOptions(args) {
  const options = {};
  const positional = [];

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg.startsWith("--")) {
      positional.push(arg);
      continue;
    }

    const [rawKey, inlineValue] = arg.slice(2).split("=", 2);
    const key = rawKey;
    const value = inlineValue ?? args[i + 1];
    if (inlineValue === undefined) i += 1;

    if (value === undefined) {
      throw new Error(`missing value for --${key}`);
    }

    if (key === "ssh-option") {
      options[key] = [...normalizeRepeatable(options[key]), value];
    } else {
      options[key] = value;
    }
  }

  return { options, positional };
}

function normalizeRepeatable(value) {
  if (value === undefined) return [];
  return Array.isArray(value) ? value : [value];
}

function parseBytes(value, fallback) {
  if (!value) return fallback;
  const match = String(value).trim().match(/^(\d+(?:\.\d+)?)(b|kb|kib|mb|mib|gb|gib)?$/i);
  if (!match) throw new Error(`invalid byte size: ${value}`);
  const amount = Number(match[1]);
  const unit = (match[2] || "b").toLowerCase();
  const multiplier = {
    b: 1,
    kb: 1000,
    kib: 1024,
    mb: 1000 * 1000,
    mib: 1024 * 1024,
    gb: 1000 * 1000 * 1000,
    gib: 1024 * 1024 * 1024,
  }[unit];
  return Math.floor(amount * multiplier);
}

function hasCommand(command) {
  return new Promise((resolve) => {
    const lookupCommand = process.platform === "win32" ? "where.exe" : "sh";
    const args = process.platform === "win32"
      ? [command]
      : ["-lc", `command -v ${shellQuote(command)} >/dev/null 2>&1`];
    const child = spawn(lookupCommand, args, { stdio: "ignore" });
    child.once("exit", (code) => resolve(code === 0));
    child.once("error", () => resolve(false));
  });
}

function randomToken(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}

function printHelp() {
  console.log(`pi-ssh-paste-image

Usage:
  pi-ssh-paste-image ssh [options] user@host -- pi
  pi-ssh-paste-image daemon [--socket PATH] [--token TOKEN]
  pi-ssh-paste-image doctor

SSH options:
  --output-dir DIR       SSH先で画像を保存する場所 (default: /tmp/pi-ssh-paste-image)
  --max-bytes SIZE       転送上限 (default: 20MiB)
  --remote-socket PATH   SSH先に作るreverse socket path
  --ssh-option VALUE     sshへ渡す追加オプション。複数指定可

Example:
  pi-ssh-paste-image ssh ubuntu@example.com -- pi
  # SSH先のPiで /paste または alt+shift+v
`);
}
