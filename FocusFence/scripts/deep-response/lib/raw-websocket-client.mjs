import crypto from "node:crypto";
import net from "node:net";
import tls from "node:tls";

import { buildClientWebSocketFrame, tryReadWebSocketFrame } from "./ws-frame.mjs";

export class RawWebSocketClient {
  static async connect(url, headers = {}, { timeoutMs = 15_000 } = {}) {
    const client = new RawWebSocketClient(url, headers, { timeoutMs });
    await client.connect();
    return client;
  }

  constructor(url, headers = {}, { timeoutMs = 15_000 } = {}) {
    this.url = typeof url === "string" ? new URL(url) : url;
    this.headers = headers;
    this.timeoutMs = timeoutMs;
    this.socket = null;
    this.buffer = Buffer.alloc(0);
    this.isOpen = false;
    this.onText = () => {};
    this.onBinary = () => {};
    this.onClose = () => {};
    this.onError = () => {};
  }

  async connect() {
    const secure = this.url.protocol === "wss:";
    const port = Number(this.url.port || (secure ? 443 : 80));
    const host = this.url.hostname;
    const key = crypto.randomBytes(16).toString("base64");
    this.socket = secure ? tls.connect({ host, port, servername: host }) : net.connect({ host, port });

    await new Promise((resolve, reject) => {
      const onReady = () => {
        this.socket.off("error", onError);
        resolve();
      };
      const onError = (error) => {
        this.socket.off(secure ? "secureConnect" : "connect", onReady);
        reject(error);
      };
      this.socket.once(secure ? "secureConnect" : "connect", onReady);
      this.socket.once("error", onError);
    });

    const requestHeaders = {
      Host: this.url.host,
      Upgrade: "websocket",
      Connection: "Upgrade",
      "Sec-WebSocket-Key": key,
      "Sec-WebSocket-Version": "13",
      ...this.headers
    };
    const request = [
      `GET ${this.url.pathname || "/"}${this.url.search || ""} HTTP/1.1`,
      ...Object.entries(requestHeaders).map(([header, value]) => `${header}: ${value}`),
      "",
      ""
    ].join("\r\n");

    this.socket.write(request);
    const rest = await this.readHandshake(key);
    this.isOpen = true;
    this.socket.on("data", (chunk) => this.handleFrameBytes(chunk));
    this.socket.on("error", (error) => this.onError(error));
    this.socket.on("close", () => this.onClose({ code: 1006, reason: "socket_closed" }));
    if (rest.byteLength > 0) {
      this.handleFrameBytes(rest);
    }
  }

  readHandshake(key) {
    return new Promise((resolve, reject) => {
      let buffer = Buffer.alloc(0);
      const timeout = setTimeout(() => reject(new Error("WebSocket handshake timed out")), this.timeoutMs);
      const onData = (chunk) => {
        buffer = Buffer.concat([buffer, chunk]);
        const separator = buffer.indexOf("\r\n\r\n");
        if (separator === -1) {
          return;
        }
        clearTimeout(timeout);
        this.socket.off("data", onData);
        const headerText = buffer.subarray(0, separator).toString("utf8");
        const statusLine = headerText.split("\r\n", 1)[0] || "";
        if (!statusLine.includes(" 101 ")) {
          reject(new Error(`WebSocket upgrade failed: ${statusLine}`));
          return;
        }
        const accept = headerText.match(/^Sec-WebSocket-Accept:\s*(.+)$/im)?.[1]?.trim();
        const expected = crypto.createHash("sha1")
          .update(`${key}258EAFA5-E914-47DA-95CA-C5AB0DC85B11`)
          .digest("base64");
        if (accept !== expected) {
          reject(new Error("WebSocket upgrade failed: invalid accept key"));
          return;
        }
        resolve(buffer.subarray(separator + 4));
      };
      this.socket.on("data", onData);
    });
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
        const code = frame.payload.byteLength >= 2 ? frame.payload.readUInt16BE(0) : 1005;
        const reason = frame.payload.byteLength > 2 ? frame.payload.subarray(2).toString("utf8") : "";
        this.onClose({ code, reason });
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
    if (!this.socket || this.socket.destroyed) {
      throw new Error("WebSocket is not open");
    }
    this.socket.write(buildClientWebSocketFrame(opcode, payload));
  }

  close() {
    if (this.socket && !this.socket.destroyed) {
      this.sendFrame(0x8, Buffer.alloc(0));
      this.socket.end();
    }
  }
}
