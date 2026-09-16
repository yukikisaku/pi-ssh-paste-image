import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { randomBytes } from "node:crypto";
import { startPasteDaemon } from "./daemon.js";

const DEFAULT_MAX_BYTES = 20 * 1024 * 1024;

export async function runSshWrapper({ target, remoteCommand = [], outputDir, maxBytes = DEFAULT_MAX_BYTES, remoteSocket, sshOptions = [] }) {
  if (!target) {
    throw new Error("ssh target is required. Example: pi-ssh-paste-image ssh user@host -- pi");
  }

  const tmpDir = await mkdtemp(path.join(os.tmpdir(), "pi-ssh-paste-image-"));
  const localSocket = path.join(tmpDir, "local.sock");
  const token = randomToken();
  const daemon = await startPasteDaemon({ socketPath: localSocket, token, maxBytes });
  const remoteSock = remoteSocket || `/tmp/pi-ssh-paste-image-${randomToken(10)}.sock`;

  try {
    const sshArgs = buildSshArgs({
      target,
      localSocket,
      remoteSocket: remoteSock,
      token,
      remoteCommand,
      outputDir: outputDir || "/tmp/pi-ssh-paste-image",
      maxBytes,
      sshOptions,
    });

    const code = await spawnInteractive("ssh", sshArgs);
    process.exitCode = code;
  } finally {
    await daemon.close().catch(() => {});
    await rm(tmpDir, { recursive: true, force: true });
  }
}

export function buildSshArgs({ target, localSocket, remoteSocket, token, remoteCommand = [], outputDir, maxBytes, sshOptions = [] }) {
  const command = buildRemoteCommand({ remoteSocket, token, remoteCommand, outputDir, maxBytes });
  return [
    "-t",
    "-o",
    "ExitOnForwardFailure=yes",
    "-o",
    "StreamLocalBindUnlink=yes",
    "-o",
    "StreamLocalBindMask=0177",
    "-R",
    `${remoteSocket}:${localSocket}`,
    ...sshOptions,
    target,
    command,
  ];
}

export function buildRemoteCommand({ remoteSocket, token, remoteCommand = [], outputDir, maxBytes }) {
  const command = remoteCommand.length > 0 ? remoteCommand.map(shellQuote).join(" ") : "${SHELL:-/bin/sh} -l";
  return [
    `cleanup() { rm -f ${shellQuote(remoteSocket)}; }`,
    "trap cleanup EXIT HUP INT TERM",
    `export PI_PASTE_SOCK=${shellQuote(remoteSocket)}`,
    `export PI_PASTE_TOKEN=${shellQuote(token)}`,
    `export PI_PASTE_OUTPUT_DIR=${shellQuote(outputDir)}`,
    `export PI_PASTE_MAX_BYTES=${shellQuote(String(maxBytes))}`,
    command,
    "status=$?",
    "exit $status",
  ].join("; ");
}

function spawnInteractive(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: "inherit" });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (signal) resolve(128 + signalNumber(signal));
      else resolve(code ?? 1);
    });
  });
}

function signalNumber(signal) {
  const numbers = { SIGHUP: 1, SIGINT: 2, SIGTERM: 15 };
  return numbers[signal] ?? 1;
}

function randomToken(bytes = 24) {
  return randomBytes(bytes).toString("base64url");
}

function shellQuote(value) {
  return `'${String(value).replaceAll("'", "'\\''")}'`;
}
