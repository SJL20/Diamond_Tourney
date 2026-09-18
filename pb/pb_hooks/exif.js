// Strip GPS / EXIF so a public field photo cannot publish a child's weekend location.
// Keep in lockstep with lib/exif.py.

function toBytes(raw) {
  if (!raw) return [];
  if (typeof raw === "string") {
    const out = [];
    for (let i = 0; i < raw.length; i++) out.push(raw.charCodeAt(i) & 255);
    return out;
  }
  if (raw.length !== undefined) {
    const out = [];
    for (let i = 0; i < raw.length; i++) out.push(Number(raw[i]) & 255);
    return out;
  }
  return [];
}

function fromBytes(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return s;
}

function stripJpeg(bytes) {
  if (bytes.length < 4 || bytes[0] !== 0xff || bytes[1] !== 0xd8) return bytes;
  const out = [0xff, 0xd8];
  let i = 2;
  while (i < bytes.length - 1) {
    if (bytes[i] !== 0xff) {
      for (; i < bytes.length; i++) out.push(bytes[i]);
      break;
    }
    const marker = bytes[i + 1];
    if (marker === 0xda) {
      for (; i < bytes.length; i++) out.push(bytes[i]);
      break;
    }
    if (marker === 0xd9) {
      out.push(0xff, 0xd9);
      break;
    }
    if (i + 3 >= bytes.length) break;
    const len = (bytes[i + 2] << 8) | bytes[i + 3];
    const skip = marker === 0xe1 || marker === 0xe2;
    if (!skip) {
      for (let j = 0; j < len + 2 && i + j < bytes.length; j++) out.push(bytes[i + j]);
    }
    i += len + 2;
  }
  return out;
}

function pngChunkType(bytes, i) {
  return String.fromCharCode(bytes[i], bytes[i + 1], bytes[i + 2], bytes[i + 3]);
}

function stripPng(bytes) {
  const sig = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 16) return bytes;
  for (let i = 0; i < 8; i++) if (bytes[i] !== sig[i]) return bytes;
  const out = sig.slice();
  let i = 8;
  while (i + 12 <= bytes.length) {
    const len = (bytes[i] << 24) | (bytes[i + 1] << 16) | (bytes[i + 2] << 8) | bytes[i + 3];
    const type = pngChunkType(bytes, i + 4);
    const total = 12 + len;
    if (i + total > bytes.length) break;
    const drop = type === "eXIf" || type === "iTXt" || type === "tEXt" || type === "zTXt";
    if (!drop) {
      for (let j = 0; j < total; j++) out.push(bytes[i + j]);
    }
    i += total;
    if (type === "IEND") break;
  }
  return out;
}

function stripExif(raw) {
  const bytes = toBytes(raw);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) return stripJpeg(bytes);
  if (bytes.length >= 8 && bytes[0] === 137 && bytes[1] === 80) return stripPng(bytes);
  return bytes;
}

function hasGpsExif(raw) {
  const bytes = toBytes(raw);
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8) {
    const text = fromBytes(bytes);
    return text.indexOf("GPS") !== -1 || text.indexOf("Exif") !== -1;
  }
  if (bytes.length >= 8 && bytes[0] === 137) {
    const text = fromBytes(bytes);
    return text.indexOf("eXIf") !== -1;
  }
  return false;
}

module.exports = {
  stripExif: stripExif,
  hasGpsExif: hasGpsExif,
  toBytes: toBytes,
};
