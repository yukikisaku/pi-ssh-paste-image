import net from "node:net";
import { encodeJsonLine, makePasteRequest, parseJsonLine, validatePayload } from "./protocol.js";

const DEFAULT_READ_LIMIT = 64 * 1024 * 1024;

export async function requestPaste({ socketPath, token, maxBytes, timeoutMs = 10_000 } = {}) {
  if (!socketPath || !socketPath.trim()) {
    throw new Error("PI_PASTE_SOCK is not set. Start Pi through `pi-ssh-paste-image ssh ...`.");
  }
  if (!token || !token.trim()) {
    throw new Error("PI_PASTE_TOKEN is not set. Start Pi through `pi-ssh-paste-image ssh ...`.");
  }

  const response = await callSocket(socketPath, makePasteRequest({ token, maxBytes }), {
    timeoutMs,
    readLimit: responseReadLimit(maxBytes),
  });

  if (!response || typeof response !== "object") {
    throw new Error("invalid daemon response");
  }
  if (!response.ok) {
    throw new Error(response.error || response.code || "paste daemon returned an error");
  }
  validatePayload(response.payload);
  return response.payload;
}

function responseReadLimit(maxBytes) {
  if (!Number.isFinite(maxBytes) || maxBytes <= 0) {
    return DEFAULT_READ_LIMIT;
  }
  return Math.min(Math.ceil(maxBytes * 1.5) + 64 * 1024, DEFAULT_READ_LIMIT);
}

function callSocket(socketPath, request, { timeoutMs, readLimit }) {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath });
    let settled = false;
    let timer;
    let total = 0;
    const chunks = [];

    function finish(error, value) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error);
      else resolve(value);
    }

    timer = setTimeout(() => {
      finish(new Error(`paste daemon timeout after ${timeoutMs}ms`));
    }, timeoutMs);

    socket.once("connect", () => {
      socket.write(encodeJsonLine(request));
    });

    socket.on("data", (chunk) => {
      total += chunk.length;
      if (total > readLimit) {
        finish(new Error("paste daemon response is too large"));
        return;
      }

      const newline = chunk.indexOf(0x0a);
      if (newline === -1) {
        chunks.push(chunk);
        return;
      }

      chunks.push(chunk.subarray(0, newline));
      try {
        finish(undefined, parseJsonLine(Buffer.concat(chunks)));
      } catch (error) {
        finish(error);
      }
    });

    socket.once("error", (error) => {
      finish(new Error(`connect ${socketPath}: ${error.message}`));
    });

    socket.once("end", () => {
      if (!settled) finish(new Error("paste daemon closed before sending a response"));
    });
  });
}
