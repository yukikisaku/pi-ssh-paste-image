import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseUriList } from "../src/clipboard.js";
import { payloadToEditorText, sanitizeFileName } from "../src/save-payload.js";
import { startPasteDaemon } from "../src/daemon.js";
import { buildRemoteCommand, buildSshArgs } from "../src/ssh-wrapper.js";
import { isPasteBridgeConfigured } from "../src/settings.js";

test("sanitizeFileName removes path traversal and unsafe characters", () => {
  assert.equal(sanitizeFileName("../../hello world.png"), "hello_world.png");
  assert.equal(sanitizeFileName("..."), "clipboard.bin");
  assert.equal(sanitizeFileName("a/b/c?.png"), "c_.png");
});

test("parseUriList extracts file URLs and ignores comments", () => {
  const expected = process.platform === "win32"
    ? ["C:\\tmp\\a.png", "C:\\Users\\yuki\\My File.png"]
    : ["/tmp/a.png", "/home/yuki/My File.png"];
  const input = `# comment\n${pathToFileURL(expected[0]).href}\nhttps://example.com/nope\n${pathToFileURL(expected[1]).href}\n`;
  assert.deepEqual(parseUriList(input), expected);
});

test("payloadToEditorText saves image payload and returns @file reference", async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), "pi-ssh-paste-image-test-"));
  try {
    const payload = {
      kind: "image",
      mime: "image/png",
      filename: "screen shot.png",
      dataBase64: Buffer.from("fake image").toString("base64"),
    };

    const result = await payloadToEditorText(payload, { outputDir: dir });
    assert.match(result.editorText, /^@/);
    assert.match(result.savedFiles[0].path, /screen_shot\.png$/);
    assert.equal(await readFile(result.savedFiles[0].path, "utf8"), "fake image");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("isPasteBridgeConfigured requires socket path and token", () => {
  assert.equal(isPasteBridgeConfigured({ socketPath: "/tmp/paste.sock", token: "secret" }), true);
  assert.equal(isPasteBridgeConfigured({ socketPath: "/tmp/paste.sock", token: "" }), false);
  assert.equal(isPasteBridgeConfigured({ socketPath: "", token: "secret" }), false);
});

test("buildSshArgs includes reverse socket and remote env", () => {
  const args = buildSshArgs({
    target: "user@example.com",
    localSocket: "/tmp/local.sock",
    remoteSocket: "/tmp/remote.sock",
    token: "secret",
    outputDir: "/tmp/out",
    maxBytes: 123,
    remoteCommand: ["pi"],
  });

  assert.ok(args.includes("-R"));
  assert.ok(args.includes("/tmp/remote.sock:/tmp/local.sock"));
  assert.ok(args.includes("user@example.com"));
  assert.match(args.at(-1), /PI_PASTE_SOCK/);
  assert.match(args.at(-1), /PI_PASTE_TOKEN/);
});

test("buildSshArgs supports a loopback TCP forward target", () => {
  const args = buildSshArgs({
    target: "user@example.com",
    localForwardTarget: "127.0.0.1:45678",
    remoteSocket: "/tmp/remote.sock",
    token: "secret",
    outputDir: "/tmp/out",
    maxBytes: 123,
    remoteCommand: ["pi"],
  });

  assert.ok(args.includes("/tmp/remote.sock:127.0.0.1:45678"));
});

test("startPasteDaemon can listen on loopback TCP", async () => {
  const daemon = await startPasteDaemon({ host: "127.0.0.1", port: 0, token: "secret" });
  try {
    assert.equal(daemon.host, "127.0.0.1");
    assert.ok(Number.isInteger(daemon.port));
    assert.ok(daemon.port > 0);
  } finally {
    await daemon.close();
  }
});

test("buildRemoteCommand shell-quotes remote command arguments", () => {
  const command = buildRemoteCommand({
    remoteSocket: "/tmp/remote.sock",
    token: "tok'en",
    outputDir: "/tmp/out dir",
    maxBytes: 5,
    remoteCommand: ["echo", "hello world"],
  });

  assert.match(command, /'hello world'/);
  assert.match(command, /tok'\\''en/);
  assert.match(command, /rm -f '\/tmp\/remote\.sock'/);
});
