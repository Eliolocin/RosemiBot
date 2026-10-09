const JPEG_XMP_HEADER = Buffer.from("http://ns.adobe.com/xap/1.0/\0", "ascii");
const JPEG_EXTENDED_XMP_HEADER = Buffer.from("http://ns.adobe.com/xmp/extension/\0", "ascii");
const MAX_JPEG_SEGMENT_DATA = 0xffff - 2;
const WEBP_XMP_FLAG = 0x04;

/** Insert XMP without decoding the provider's compressed image data. */
export function embedXmpInJpeg(image: Buffer, xmp: string): Buffer | null {
  if (image.length < 4 || image.readUInt16BE(0) !== 0xffd8) return null;
  const payload = Buffer.concat([JPEG_XMP_HEADER, Buffer.from(xmp, "utf8")]);
  if (payload.length > MAX_JPEG_SEGMENT_DATA) return null;

  let offset = 2;
  let insertionOffset = 2;
  let sawImageData = false;
  while (offset + 4 <= image.length) {
    if (image[offset] !== 0xff) return null;
    let markerOffset = offset + 1;
    while (image[markerOffset] === 0xff) markerOffset++;
    if (markerOffset >= image.length) return null;
    const marker = image[markerOffset];
    if (marker === 0xda) {
      sawImageData = true;
      break;
    }
    if (marker === 0xd9 || marker === 0x00 || marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd7)) return null;
    if (markerOffset + 2 >= image.length) return null;
    const segmentLength = image.readUInt16BE(markerOffset + 1);
    const nextOffset = markerOffset + 1 + segmentLength;
    if (segmentLength < 2 || nextOffset > image.length) return null;
    if (marker === 0xe1) {
      const segmentData = image.subarray(markerOffset + 3, nextOffset);
      // Existing standard or extended XMP may carry provider data that must survive unchanged.
      if (
        segmentData.subarray(0, JPEG_XMP_HEADER.length).equals(JPEG_XMP_HEADER) ||
        segmentData.subarray(0, JPEG_EXTENDED_XMP_HEADER.length).equals(JPEG_EXTENDED_XMP_HEADER)
      )
        return null;
    }
    if (marker >= 0xe0 && marker <= 0xef) insertionOffset = nextOffset;
    offset = nextOffset;
  }
  if (!sawImageData) return null;

  const segment = Buffer.allocUnsafe(payload.length + 4);
  segment.writeUInt16BE(0xffe1, 0);
  segment.writeUInt16BE(payload.length + 2, 2);
  payload.copy(segment, 4);
  return Buffer.concat([image.subarray(0, insertionOffset), segment, image.subarray(insertionOffset)]);
}

/** Add the WebP XMP chunk and its VP8X feature flag without changing VP8/VP8L bytes. */
export function embedXmpInWebp(
  image: Buffer,
  xmp: string,
  width: number,
  height: number,
  hasAlpha: boolean,
): Buffer | null {
  if (
    image.length < 20 ||
    image.toString("ascii", 0, 4) !== "RIFF" ||
    image.toString("ascii", 8, 12) !== "WEBP" ||
    image.readUInt32LE(4) + 8 !== image.length
  )
    return null;

  let offset = 12;
  let vp8xOffset: number | null = null;
  let hasImageData = false;
  let hasExif = false;
  let hasIcc = false;
  while (offset + 8 <= image.length) {
    const chunkType = image.toString("ascii", offset, offset + 4);
    const size = image.readUInt32LE(offset + 4);
    const nextOffset = offset + 8 + size + (size % 2);
    if (nextOffset > image.length) return null;
    if (chunkType === "XMP ") return null;
    if (chunkType === "VP8X") {
      if (vp8xOffset !== null || size !== 10 || offset !== 12) return null;
      vp8xOffset = offset;
    }
    if (chunkType === "VP8 " || chunkType === "VP8L" || chunkType === "ANMF") hasImageData = true;
    if (chunkType === "EXIF") hasExif = true;
    if (chunkType === "ICCP") hasIcc = true;
    offset = nextOffset;
  }
  if (offset !== image.length || !hasImageData) return null;

  const xmpBytes = Buffer.from(xmp, "utf8");
  const xmpChunk = Buffer.alloc(8 + xmpBytes.length + (xmpBytes.length % 2));
  xmpChunk.write("XMP ", 0, "ascii");
  xmpChunk.writeUInt32LE(xmpBytes.length, 4);
  xmpBytes.copy(xmpChunk, 8);

  let result: Buffer;
  if (vp8xOffset !== null) {
    result = Buffer.concat([image, xmpChunk]);
    result[vp8xOffset + 8] |= WEBP_XMP_FLAG;
  } else {
    if (
      !Number.isInteger(width) ||
      !Number.isInteger(height) ||
      width < 1 ||
      height < 1 ||
      width > 0x1000000 ||
      height > 0x1000000
    )
      return null;
    const vp8x = Buffer.alloc(18);
    vp8x.write("VP8X", 0, "ascii");
    vp8x.writeUInt32LE(10, 4);
    vp8x[8] = WEBP_XMP_FLAG | (hasAlpha ? 0x10 : 0) | (hasExif ? 0x08 : 0) | (hasIcc ? 0x20 : 0);
    vp8x.writeUIntLE(width - 1, 12, 3);
    vp8x.writeUIntLE(height - 1, 15, 3);
    result = Buffer.concat([image.subarray(0, 12), vp8x, image.subarray(12), xmpChunk]);
  }
  if (result.length - 8 > 0xffffffff) return null;
  result.writeUInt32LE(result.length - 8, 4);
  return result;
}
