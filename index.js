import { requestPaste } from "./src/client.js";
import { payloadToEditorText } from "./src/save-payload.js";
import { isPasteBridgeConfigured, loadRuntimeSettings, loadStartupSettings } from "./src/settings.js";

export default function piSshPasteImage(pi) {
  const startupSettings = loadStartupSettings();

  async function paste(ctx) {
    const settings = loadRuntimeSettings(ctx);
    try {
      const payload = await requestPaste({
        socketPath: settings.socketPath,
        token: settings.token,
        maxBytes: settings.maxBytes,
        timeoutMs: settings.timeoutMs,
      });

      const result = await payloadToEditorText(payload, {
        outputDir: settings.outputDir,
        cwd: ctx.cwd,
      });

      ctx.ui.pasteToEditor(result.editorText);
      if (result.notification) {
        ctx.ui.notify(result.notification, "info");
      }
    } catch (error) {
      ctx.ui.notify(`SSH paste failed: ${errorMessage(error)}`, "error");
    }
  }

  if (isPasteBridgeConfigured(startupSettings)) {
    pi.registerShortcut(startupSettings.shortcut, {
      description: "SSH先PiへローカルPCのクリップボード画像/テキストを貼り付け",
      handler: paste,
    });
  }

  pi.registerCommand("paste", {
    description: "SSH先PiへローカルPCのクリップボード画像/テキストを貼り付け",
    handler: async (_args, ctx) => {
      await paste(ctx);
    },
  });

  pi.registerCommand("ssh-paste", {
    description: "SSH paste image の明示的な貼り付けコマンド",
    handler: async (_args, ctx) => {
      await paste(ctx);
    },
  });
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}
