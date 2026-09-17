import net from "node:net";
import { mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { encodeJsonLine, errorResponse, okResponse, parseJsonLine, validateRequest } from "./protocol.js";
import { readClipboard } from "./clipboard.js";

export async function startPasteDaemon({ socketPath, host, port, token, maxBytes = 20 * 1024 * 1024 } = {}) {
  const useTcp = host !== undefined || port !== undefined;
  if (!useTcp && !socketPath) throw new Error("socketPath is required");
  if (!token) throw new Error("token is required");

  if (!useTcp) {
    await mkdir(path.dirname(socketPath), { recursive: true, mode: 0o700 });
    await rm(socketPath, { force: true });
  }

  const server = net.createServer((socket) => {
    handleConnection(socket, { token, maxBytes }).catch((error) => {
      socket.end(encodeJsonLine(errorResponse(error.code || "internal_error", error.message)));
    });
  });

  const listenHost = host || "127.0.0.1";
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    const onListening = () => {
      server.off("error", reject);
      resolve();
    };
    if (useTcp) {
      server.listen({ host: listenHost, port: port ?? 0 }, onListening);
    } else {
      server.listen(socketPath, onListening);
    }
  });

  const address = server.address();
  return {
    socketPath: useTcp ? undefined : socketPath,
    host: useTcp ? listenHost : undefined,
    port: useTcp && typeof address === "object" && address ? address.port : undefined,
    close: async () => {
      await new Promise((resolve) => server.close(resolve));
      if (!useTcp) await rm(socketPath, { force: true });
    },
  };
}

async function handleConnection(socket, { token, maxBytes }) {
  const request = await readRequestLine(socket);
  validateRequest(request, token);
  const requestedMax = Number.isFinite(request.maxBytes) && request.maxBytes > 0 ? request.maxBytes : maxBytes;
  const payload = await readClipboard({ maxBytes: Math.min(requestedMax, maxBytes) });
  socket.end(encodeJsonLine(okResponse(payload)));
}

function readRequestLine(socket, limit = 64 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;
    let settled = false;

    function finish(error, value) {
      if (settled) return;
      settled = true;
      socket.off("data", onData);
      socket.off("error", onError);
      socket.off("end", onEnd);
      if (error) reject(error);
      else resolve(value);
    }

    function onData(chunk) {
      total += chunk.length;
      if (total > limit) {
        finish(new Error("request is too large"));
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
    }

    function onError(error) {
      finish(error);
    }

    function onEnd() {
      finish(new Error("connection closed before request"));
    }

    socket.on("data", onData);
    socket.once("error", onError);
    socket.once("end", onEnd);
  });
}
