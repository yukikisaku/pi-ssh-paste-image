export const PROTOCOL_VERSION = 1;
export const REQUEST_METHOD = "paste.get";

export function encodeJsonLine(value) {
  return `${JSON.stringify(value)}\n`;
}

export function parseJsonLine(line) {
  const text = Buffer.isBuffer(line) ? line.toString("utf8") : String(line);
  return JSON.parse(text.trimEnd());
}

export function makePasteRequest({ token, maxBytes } = {}) {
  return {
    version: PROTOCOL_VERSION,
    method: REQUEST_METHOD,
    token,
    maxBytes,
  };
}

export function okResponse(payload) {
  return {
    version: PROTOCOL_VERSION,
    ok: true,
    payload,
  };
}

export function errorResponse(code, message) {
  return {
    version: PROTOCOL_VERSION,
    ok: false,
    code,
    error: message,
  };
}

export function validateRequest(request, expectedToken) {
  if (!request || typeof request !== "object") {
    throw protocolError("invalid_request", "request must be an object");
  }
  if (request.version !== PROTOCOL_VERSION) {
    throw protocolError("protocol_version_mismatch", `unsupported protocol version: ${request.version}`);
  }
  if (request.method !== REQUEST_METHOD) {
    throw protocolError("unknown_method", `unknown method: ${request.method}`);
  }
  if (!expectedToken) {
    throw protocolError("token_not_configured", "local daemon token is not configured");
  }
  if (request.token !== expectedToken) {
    throw protocolError("unauthorized", "invalid paste token");
  }
}

export function validatePayload(payload) {
  if (!payload || typeof payload !== "object") {
    throw protocolError("invalid_payload", "payload must be an object");
  }

  if (payload.kind === "text") {
    if (typeof payload.text !== "string") {
      throw protocolError("invalid_payload", "text payload missing text");
    }
    return;
  }

  if (payload.kind === "image") {
    validateBinaryItem(payload);
    return;
  }

  if (payload.kind === "files") {
    if (!Array.isArray(payload.files) || payload.files.length === 0) {
      throw protocolError("invalid_payload", "files payload missing files");
    }
    for (const file of payload.files) {
      validateBinaryItem(file);
    }
    return;
  }

  throw protocolError("unsupported_payload", `unsupported payload kind: ${payload.kind}`);
}

function validateBinaryItem(item) {
  if (!item || typeof item !== "object") {
    throw protocolError("invalid_payload", "binary item must be an object");
  }
  if (typeof item.dataBase64 !== "string" || item.dataBase64.length === 0) {
    throw protocolError("invalid_payload", "binary item missing dataBase64");
  }
  if (item.filename !== undefined && typeof item.filename !== "string") {
    throw protocolError("invalid_payload", "binary item filename must be a string");
  }
  if (item.mime !== undefined && typeof item.mime !== "string") {
    throw protocolError("invalid_payload", "binary item mime must be a string");
  }
}

function protocolError(code, message) {
  const error = new Error(message);
  error.code = code;
  return error;
}
