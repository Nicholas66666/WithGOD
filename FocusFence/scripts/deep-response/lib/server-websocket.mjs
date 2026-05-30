import crypto from "node:crypto";

import { buildServerWebSocketFrame, tryReadWebSocketFrame } from "./ws-frame.mjs";

export class ServerWebSocketConnection {
  constructor(socket) {
    this.socket = socket;
    this.buffer = Buffer.alloc(0);
    this.onText = () => {};
    this.onBinary = () => {};
    this.onClose = () => {};
    this.onError = () => {};

    socket.on("data", (chunk) => this.handleFrameBytes(chunk));
    socket.on("close", () => this.onClose());
    socket.on("error", (error) => this.onError(error));
  }

  handleFrameBytes(chunk) {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    while (this.buffer.byteLength >= 2) {
      const frame = tryReadWebSocketFrame(this.buffer);
      if (!frame) {
        return;
      }
      this.buffer = this.buffer.subarray(frame.bytesRead);
      if (frame.opcode === 0x1) {
        this.onText(frame.payload.toString("utf8"));
      } else if (frame.opcode === 0x2) {
        this.onBinary(frame.payload);
      } else if (frame.opcode === 0x8) {
        this.close();
      } else if (frame.opcode === 0x9) {
        this.sendFrame(0xA, frame.payload);
      }
    }
  }

  sendText(text) {
    this.sendFrame(0x1, Buffer.from(text, "utf8"));
  }

  sendBinary(data) {
    this.sendFrame(0x2, Buffer.from(data));
  }

  sendFrame(opcode, payload) {
    if (!this.socket.destroyed) {
      this.socket.write(buildServerWebSocketFrame(opcode, payload));
    }
  }

  close() {
    if (!this.socket.destroyed) {
      this.sendFrame(0x8, Buffer.alloc(0));
      this.socket.end();
    }
  }
}

export function acceptWebSocketUpgrade(request, socket) {
  const key = request.headers["sec-websocket-key"];
  if (!key) {
    socket.destroy();
    return null;
  }

  const accept = crypto.createHash("sha1")
    .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
    .digest("base64");
  socket.write([
    "HTTP/1.1 101 Switching Protocols",
    "Upgrade: websocket",
    "Connection: Upgrade",
    `Sec-WebSocket-Accept: ${accept}`,
    "",
    ""
  ].join("\r\n"));
  return new ServerWebSocketConnection(socket);
}
