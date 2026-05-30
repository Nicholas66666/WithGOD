import crypto from "node:crypto";

export function buildClientWebSocketFrame(opcode, payload, mask = crypto.randomBytes(4)) {
  return buildWebSocketFrame({ opcode, payload, mask });
}

export function buildServerWebSocketFrame(opcode, payload) {
  return buildWebSocketFrame({ opcode, payload, mask: null });
}

function buildWebSocketFrame({ opcode, payload, mask }) {
  const body = Buffer.from(payload);
  const length = body.byteLength;
  const masked = Boolean(mask);
  const parts = [Buffer.from([0x80 | opcode])];

  if (length < 126) {
    parts.push(Buffer.from([(masked ? 0x80 : 0) | length]));
  } else if (length <= 0xffff) {
    const header = Buffer.alloc(3);
    header[0] = (masked ? 0x80 : 0) | 126;
    header.writeUInt16BE(length, 1);
    parts.push(header);
  } else {
    const header = Buffer.alloc(9);
    header[0] = (masked ? 0x80 : 0) | 127;
    header.writeBigUInt64BE(BigInt(length), 1);
    parts.push(header);
  }

  if (!masked) {
    parts.push(body);
    return Buffer.concat(parts);
  }

  const maskedBody = Buffer.alloc(length);
  for (let index = 0; index < length; index += 1) {
    maskedBody[index] = body[index] ^ mask[index % 4];
  }
  parts.push(mask, maskedBody);
  return Buffer.concat(parts);
}

export function tryReadWebSocketFrame(buffer) {
  if (buffer.byteLength < 2) {
    return null;
  }

  const first = buffer[0];
  const second = buffer[1];
  let offset = 2;
  let payloadLength = second & 0x7f;

  if (payloadLength === 126) {
    if (buffer.byteLength < offset + 2) {
      return null;
    }
    payloadLength = buffer.readUInt16BE(offset);
    offset += 2;
  } else if (payloadLength === 127) {
    if (buffer.byteLength < offset + 8) {
      return null;
    }
    const bigLength = buffer.readBigUInt64BE(offset);
    if (bigLength > BigInt(Number.MAX_SAFE_INTEGER)) {
      throw new Error("websocket frame too large");
    }
    payloadLength = Number(bigLength);
    offset += 8;
  }

  const masked = Boolean(second & 0x80);
  let mask = null;
  if (masked) {
    if (buffer.byteLength < offset + 4) {
      return null;
    }
    mask = buffer.subarray(offset, offset + 4);
    offset += 4;
  }

  if (buffer.byteLength < offset + payloadLength) {
    return null;
  }

  const payload = Buffer.from(buffer.subarray(offset, offset + payloadLength));
  if (masked) {
    for (let index = 0; index < payload.byteLength; index += 1) {
      payload[index] ^= mask[index % 4];
    }
  }

  return {
    fin: Boolean(first & 0x80),
    opcode: first & 0x0f,
    payload,
    bytesRead: offset + payloadLength
  };
}
