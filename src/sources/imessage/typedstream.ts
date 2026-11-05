const utf8 = new TextDecoder("utf-8", { fatal: true });

const TWO_BYTE_LENGTH = 0x81;
const FOUR_BYTE_LENGTH = 0x82;
const LAST_TAG = 0x91;
const FIRST_TAG = 0x80;
const STRING_START = [0x01, 0x2b];
const UTF16_BOM = [0xff, 0xfe];
const HEADER = [0x04, 0x0b];
const HEADER_LENGTH = 13;

const ascii = (bytes: Uint8Array, start: number, end: number): string =>
  String.fromCodePoint(...bytes.subarray(start, end));

const startsWith = (bytes: Uint8Array, at: number, prefix: number[]) =>
  prefix.every((byte, i) => bytes[at + i] === byte);

const readLength = (bytes: Uint8Array, start: number, width: number, littleEndian: boolean) => {
  let length = 0;

  for (const [i, byte] of bytes.subarray(start, start + width).entries()) {
    const shift = (littleEndian ? i : width - 1 - i) * 8;

    length += byte * 2 ** shift;
  }

  return length;
};

const decodeUtf8 = (bytes: Uint8Array): string => {
  try {
    return utf8.decode(bytes);
  } catch {
    return "";
  }
};

const readString = (bytes: Uint8Array, at: number, littleEndian: boolean): string => {
  const head = bytes[at];

  if (head === undefined) {
    return "";
  }

  let start = at + 1;
  let length = head;

  if (head === TWO_BYTE_LENGTH || head === FOUR_BYTE_LENGTH) {
    const width = head === TWO_BYTE_LENGTH ? 2 : 4;

    if (start + width > bytes.length) {
      return "";
    }

    length = readLength(bytes, start, width, littleEndian);
    start += width;
  } else if (head >= FIRST_TAG && head <= LAST_TAG) {
    return "";
  }

  if (start + length > bytes.length) {
    return "";
  }

  return decodeUtf8(bytes.subarray(start, start + length));
};

const decodeUtf16 = (bytes: Uint8Array): string => {
  try {
    return new TextDecoder("utf-16le", { fatal: true }).decode(bytes);
  } catch {
    return "";
  }
};

export const decodeAttributedBody = (bytes: Uint8Array): string => {
  if (startsWith(bytes, 0, UTF16_BOM)) {
    return decodeUtf16(bytes.subarray(UTF16_BOM.length));
  }

  if (!startsWith(bytes, 0, HEADER) || bytes.length < HEADER_LENGTH) {
    return "";
  }

  const signature = ascii(bytes, HEADER.length, HEADER_LENGTH);

  if (signature !== "streamtyped" && signature !== "typedstream") {
    return "";
  }

  for (let i = HEADER_LENGTH; i + 1 < bytes.length; i += 1) {
    if (startsWith(bytes, i, STRING_START)) {
      return readString(bytes, i + STRING_START.length, signature === "streamtyped");
    }
  }

  return "";
};
