import crypto from "node:crypto";
import http from "node:http";
import { fileURLToPath } from "node:url";

const WS_GUID = "258EAFA5-E914-47DA-95CA-C5AB0DC85B11";
const VALID_PATHS = new Set(["/", "/ws/echo", "/ws/audio-echo"]);
const stats = {
  started_at: now(),
  health_count: 0,
  ws_open_count: 0,
  ws_close_count: 0,
  binary_frame_count: 0,
  abort_ack_count: 0,
  last_ws_open_at: null,
  last_ws_close_at: null,
  last_binary_at: null,
  last_path: null,
  last_session_id: null,
};

function now() {
  return new Date().toISOString();
}

function log(event) {
  process.stdout.write(`${JSON.stringify({ ts: now(), ...event })}\n`);
}

function acceptKey(key) {
  return crypto.createHash("sha1").update(`${key}${WS_GUID}`).digest("base64");
}

function encodeFrame(opcode, payload = Buffer.alloc(0)) {
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let headerLength = 2;
  if (data.length >= 126 && data.length <= 0xffff) {
    headerLength += 2;
  } else if (data.length > 0xffff) {
    headerLength += 8;
  }

  const frame = Buffer.alloc(headerLength + data.length);
  frame[0] = 0x80 | opcode;
  if (data.length < 126) {
    frame[1] = data.length;
  } else if (data.length <= 0xffff) {
    frame[1] = 126;
    frame.writeUInt16BE(data.length, 2);
  } else {
    frame[1] = 127;
    frame.writeBigUInt64BE(BigInt(data.length), 2);
  }
  data.copy(frame, headerLength);
  return frame;
}

function decodeFrames(buffer) {
  const frames = [];
  let offset = 0;

  while (buffer.length - offset >= 2) {
    const first = buffer[offset];
    const second = buffer[offset + 1];
    const opcode = first & 0x0f;
    const masked = (second & 0x80) === 0x80;
    let length = second & 0x7f;
    let cursor = offset + 2;

    if (length === 126) {
      if (buffer.length - cursor < 2) break;
      length = buffer.readUInt16BE(cursor);
      cursor += 2;
    } else if (length === 127) {
      if (buffer.length - cursor < 8) break;
      const bigLength = buffer.readBigUInt64BE(cursor);
      if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
        throw new Error("Frame too large");
      }
      length = Number(bigLength);
      cursor += 8;
    }

    const maskLength = masked ? 4 : 0;
    if (buffer.length - cursor < maskLength + length) break;

    let payload = Buffer.from(buffer.subarray(cursor + maskLength, cursor + maskLength + length));
    if (masked) {
      const mask = buffer.subarray(cursor, cursor + 4);
      for (let index = 0; index < payload.length; index += 1) {
        payload[index] ^= mask[index % 4];
      }
    }

    frames.push({ opcode, payload });
    offset = cursor + maskLength + length;
  }

  return { frames, rest: buffer.subarray(offset) };
}

function handleControlText(socket, sessionID, payload) {
  let message;
  try {
    message = JSON.parse(payload.toString("utf8"));
  } catch {
    socket.write(encodeFrame(0x1, JSON.stringify({ type: "error", error: "bad_json" })));
    return;
  }

  if (message.type === "abort") {
    const ack = {
      type: "abort_ack",
      generation: Number.isFinite(message.generation) ? message.generation : null,
    };
    log({ event: "abort_ack", session_id: sessionID, generation: ack.generation });
    stats.abort_ack_count += 1;
    socket.write(encodeFrame(0x1, JSON.stringify(ack)));
    return;
  }

  socket.write(encodeFrame(0x1, JSON.stringify({ type: "ack", received_type: message.type ?? null })));
}

function attachWebSocket(socket, request, options) {
  const sessionID = crypto.randomUUID();
  const path = new URL(request.url, "http://localhost").pathname;
  let pending = Buffer.alloc(0);
  let framesIn = 0;
  let pingTimer;

  log({ event: "ws_open", session_id: sessionID, path });
  stats.ws_open_count += 1;
  stats.last_ws_open_at = now();
  stats.last_path = path;
  stats.last_session_id = sessionID;

  if (options.pingIntervalMs > 0) {
    pingTimer = setInterval(() => {
      socket.write(encodeFrame(0x9, Buffer.from("watch-socket-lab")));
      log({ event: "server_ping", session_id: sessionID });
    }, options.pingIntervalMs);
    pingTimer.unref?.();
  }

  socket.on("data", (chunk) => {
    try {
      pending = Buffer.concat([pending, chunk]);
      const decoded = decodeFrames(pending);
      pending = decoded.rest;

      for (const frame of decoded.frames) {
        if (frame.opcode === 0x8) {
          socket.end(encodeFrame(0x8, frame.payload));
          return;
        }
        if (frame.opcode === 0x9) {
          socket.write(encodeFrame(0xA, frame.payload));
          continue;
        }
        if (frame.opcode === 0x1) {
          handleControlText(socket, sessionID, frame.payload);
          continue;
        }
        if (frame.opcode === 0x2) {
          framesIn += 1;
          stats.binary_frame_count += 1;
          stats.last_binary_at = now();
          log({
            event: "binary_echo",
            session_id: sessionID,
            seq: framesIn,
            bytes: frame.payload.length,
          });
          socket.write(encodeFrame(0x2, frame.payload));
        }
      }
    } catch (error) {
      log({ event: "ws_error", session_id: sessionID, error: error.message });
      socket.destroy(error);
    }
  });

  socket.on("close", () => {
    if (pingTimer) clearInterval(pingTimer);
    stats.ws_close_count += 1;
    stats.last_ws_close_at = now();
    log({ event: "ws_close", session_id: sessionID, frames_in: framesIn });
  });
}

export function createWatchWssEchoServer(options = {}) {
  const resolved = {
    pingIntervalMs: options.pingIntervalMs ?? 15_000,
  };

  const server = http.createServer((request, response) => {
    const path = new URL(request.url, "http://localhost").pathname;
    if (path === "/health") {
      stats.health_count += 1;
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, service: "watch-wss-echo" }));
      return;
    }
    if (path === "/stats") {
      response.writeHead(200, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: true, stats }));
      return;
    }

    response.writeHead(404, { "content-type": "application/json" });
    response.end(JSON.stringify({ ok: false, error: "not_found" }));
  });

  server.on("upgrade", (request, socket) => {
    const path = new URL(request.url, "http://localhost").pathname;
    const key = request.headers["sec-websocket-key"];
    if (!VALID_PATHS.has(path) || typeof key !== "string") {
      socket.write("HTTP/1.1 404 Not Found\r\n\r\n");
      socket.destroy();
      return;
    }

    socket.write([
      "HTTP/1.1 101 Switching Protocols",
      "Upgrade: websocket",
      "Connection: Upgrade",
      `Sec-WebSocket-Accept: ${acceptKey(key)}`,
      "\r\n",
    ].join("\r\n"));
    attachWebSocket(socket, request, resolved);
  });

  return {
    server,
    get port() {
      return server.address().port;
    },
    listen(port, host = "0.0.0.0") {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, host, () => {
          server.off("error", reject);
          log({ event: "server_listen", host, port: server.address().port });
          resolve();
        });
      });
    },
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number.parseInt(process.env.WATCH_WSS_PORT ?? process.env.PORT ?? "8799", 10);
  const host = process.env.WATCH_WSS_HOST ?? "0.0.0.0";
  const app = createWatchWssEchoServer();
  await app.listen(port, host);
}
