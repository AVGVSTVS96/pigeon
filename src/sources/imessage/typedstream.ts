const utf8 = new TextDecoder("utf-8", { fatal: true });

function ascii(bytes: Uint8Array, start: number, end: number): string {
  return String.fromCharCode(...bytes.subarray(start, end));
}

function readString(bytes: Uint8Array, at: number, littleEndian: boolean): string {
  const head = bytes[at];
  if (head === undefined) return "";
  let start = at + 1;
  let length = head;
  if (head === 0x81 || head === 0x82) {
    const width = head === 0x81 ? 2 : 4;
    if (start + width > bytes.length) return "";
    length = 0;
    for (let i = 0; i < width; i++) {
      const shift = (littleEndian ? i : width - 1 - i) * 8;
      length += bytes[start + i]! * 2 ** shift;
    }
    start += width;
  } else if (head >= 0x80 && head <= 0x91) {
    return "";
  }
  if (start + length > bytes.length) return "";
  try {
    return utf8.decode(bytes.subarray(start, start + length));
  } catch {
    return "";
  }
}

/**
 * Message text from `message.attributedBody`, which newer macOS writes instead
 * of `message.text`. It's an NSAttributedString in NeXT's typedstream format;
 * the body is the first NSString, framed as 0x01 0x2b ("+") then a length.
 */
export function decodeAttributedBody(bytes: Uint8Array): string {
  if (bytes.length === 0) return "";
  if (bytes[0] === 0xff && bytes[1] === 0xfe) {
    try {
      return new TextDecoder("utf-16le", { fatal: true }).decode(bytes.subarray(2));
    } catch {
      return "";
    }
  }
  if (bytes[0] !== 0x04 || bytes[1] !== 0x0b || bytes.length < 13) return "";
  const signature = ascii(bytes, 2, 13);
  if (signature !== "streamtyped" && signature !== "typedstream") return "";

  for (let i = 13; i + 1 < bytes.length; i++) {
    if (bytes[i] === 0x01 && bytes[i + 1] === 0x2b) return readString(bytes, i + 2, signature === "streamtyped");
  }
  return "";
}
