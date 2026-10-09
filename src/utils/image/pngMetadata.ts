/**
 * PNG Metadata Utilities
 * Handles embedding and extracting JSON metadata in PNG tEXt chunks
 * Based on PNG specification: http://www.libpng.org/pub/png/spec/1.2/PNG-Chunks.html
 */

import type { PresetExport } from "../../types/preset/presetExport";
import { inflateSync } from "node:zlib";
import { log } from "../misc/logger";

/**
 * PNG file signature (magic bytes)
 * Every PNG file must start with these 8 bytes
 */
const PNG_SIGNATURE = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10]);

/**
 * PNG chunk types used in this implementation
 */
const TEXT_CHUNK_TYPE = "tEXt"; // Uncompressed text chunk
const COMPRESSED_TEXT_CHUNK_TYPE = "zTXt"; // Compressed text chunk
const INTERNATIONAL_TEXT_CHUNK_TYPE = "iTXt"; // International text chunk
const IEND_CHUNK_TYPE = "IEND"; // End of PNG datastream marker

/**
 * Metadata key identifier for TomoriBot preset data
 * This key is used in the tEXt chunk to identify our JSON data
 */
const METADATA_KEY = "TomoriPreset";
const SILLY_TAVERN_METADATA_KEYS = new Set(["chara", "char"]);

type PngTextChunk = {
  key: string;
  value: string;
  type: typeof TEXT_CHUNK_TYPE | typeof COMPRESSED_TEXT_CHUNK_TYPE | typeof INTERNATIONAL_TEXT_CHUNK_TYPE;
};

/**
 * Reads a 4-byte big-endian unsigned integer from a byte array
 */
function readUint32(data: Uint8Array, offset: number): number {
  return (data[offset] << 24) | (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3];
}

/**
 * Writes a 4-byte big-endian unsigned integer to a byte array
 */
function writeUint32(data: Uint8Array, offset: number, value: number): void {
  data[offset] = (value >>> 24) & 0xff;
  data[offset + 1] = (value >>> 16) & 0xff;
  data[offset + 2] = (value >>> 8) & 0xff;
  data[offset + 3] = value & 0xff;
}

/**
 * Converts a string to a UTF-8 byte array
 * @returns Uint8Array containing UTF-8 encoded bytes
 */
function stringToBytes(str: string): Uint8Array {
  const encoder = new TextEncoder();
  return encoder.encode(str);
}

/**
 * Calculates CRC32 checksum for PNG chunk data
 * CRC32 is used to detect data corruption in PNG chunks
 * @param data - Byte array containing chunk type and chunk data
 * @param length - Number of bytes to include in CRC calculation
 */
function calculateCRC(data: Uint8Array, offset: number, length: number): number {
  const crcTable: number[] = [];
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let j = 0; j < 8; j++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[i] = c;
  }

  let crc = 0xffffffff;
  for (let i = 0; i < length; i++) {
    crc = crcTable[(crc ^ data[offset + i]) & 0xff] ^ (crc >>> 8);
  }

  return crc ^ 0xffffffff;
}

/**
 * Verifies that a buffer starts with a valid PNG signature
 */
function verifyPNGSignature(data: Uint8Array): boolean {
  if (data.length < PNG_SIGNATURE.length) {
    return false;
  }

  for (let i = 0; i < PNG_SIGNATURE.length; i++) {
    if (data[i] !== PNG_SIGNATURE[i]) {
      return false;
    }
  }

  return true;
}

function findNullByte(data: Uint8Array, start: number, endExclusive: number): number {
  for (let i = start; i < endExclusive; i++) {
    if (data[i] === 0) {
      return i;
    }
  }

  return -1;
}

function tryParseJSON(value: string): unknown | null {
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

function decodeBase64ToUTF8(value: string): string | null {
  const normalized = value.trim().replace(/\s+/g, "").replace(/-/g, "+").replace(/_/g, "/");

  if (!normalized) {
    return null;
  }

  const padded = normalized + "=".repeat((4 - (normalized.length % 4)) % 4);
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(padded)) {
    return null;
  }

  const decodedBuffer = Buffer.from(padded, "base64");
  if (decodedBuffer.length === 0) {
    return null;
  }

  return decodedBuffer.toString("utf8");
}

function parseTextChunk(data: Uint8Array, offset: number, length: number): PngTextChunk | null {
  const chunkEnd = offset + length;
  const keyEnd = findNullByte(data, offset, chunkEnd);
  if (keyEnd <= offset) {
    return null;
  }

  const key = String.fromCharCode(...data.slice(offset, keyEnd));
  if (keyEnd + 1 >= chunkEnd) {
    return null;
  }

  const value = new TextDecoder().decode(data.slice(keyEnd + 1, chunkEnd));
  return { key, value, type: TEXT_CHUNK_TYPE };
}

function parseCompressedTextChunk(data: Uint8Array, offset: number, length: number): PngTextChunk | null {
  const chunkEnd = offset + length;
  const keyEnd = findNullByte(data, offset, chunkEnd);
  if (keyEnd <= offset || keyEnd + 2 > chunkEnd) {
    return null;
  }

  const compressionMethod = data[keyEnd + 1];
  if (compressionMethod !== 0) {
    return null;
  }

  const key = String.fromCharCode(...data.slice(offset, keyEnd));
  const compressedText = data.slice(keyEnd + 2, chunkEnd);
  if (compressedText.length === 0) {
    return null;
  }

  try {
    const value = new TextDecoder().decode(inflateSync(compressedText));
    return { key, value, type: COMPRESSED_TEXT_CHUNK_TYPE };
  } catch {
    return null;
  }
}

function parseInternationalTextChunk(data: Uint8Array, offset: number, length: number): PngTextChunk | null {
  const chunkEnd = offset + length;
  const keyEnd = findNullByte(data, offset, chunkEnd);
  if (keyEnd <= offset || keyEnd + 5 > chunkEnd) {
    return null;
  }

  const key = String.fromCharCode(...data.slice(offset, keyEnd));
  let cursor = keyEnd + 1;

  const compressionFlag = data[cursor];
  cursor += 1;
  const compressionMethod = data[cursor];
  cursor += 1;

  const languageTagEnd = findNullByte(data, cursor, chunkEnd);
  if (languageTagEnd === -1) {
    return null;
  }
  cursor = languageTagEnd + 1;

  const translatedKeywordEnd = findNullByte(data, cursor, chunkEnd);
  if (translatedKeywordEnd === -1) {
    return null;
  }
  cursor = translatedKeywordEnd + 1;

  let textBytes = data.slice(cursor, chunkEnd);
  if (compressionFlag === 1) {
    if (compressionMethod !== 0 || textBytes.length === 0) {
      return null;
    }

    try {
      textBytes = inflateSync(textBytes);
    } catch {
      return null;
    }
  }

  const value = new TextDecoder().decode(textBytes);
  return { key, value, type: INTERNATIONAL_TEXT_CHUNK_TYPE };
}

function extractAllTextChunksFromPNGData(data: Uint8Array): PngTextChunk[] {
  const chunks: PngTextChunk[] = [];
  let offset = PNG_SIGNATURE.length;

  while (offset + 8 <= data.length) {
    const length = readUint32(data, offset);
    offset += 4;

    if (offset + 4 > data.length) {
      break;
    }

    const chunkType = String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);
    offset += 4;

    if (offset + length + 4 > data.length) {
      break;
    }

    let parsedChunk: PngTextChunk | null = null;
    if (chunkType === TEXT_CHUNK_TYPE) {
      parsedChunk = parseTextChunk(data, offset, length);
    } else if (chunkType === COMPRESSED_TEXT_CHUNK_TYPE) {
      parsedChunk = parseCompressedTextChunk(data, offset, length);
    } else if (chunkType === INTERNATIONAL_TEXT_CHUNK_TYPE) {
      parsedChunk = parseInternationalTextChunk(data, offset, length);
    }

    if (parsedChunk) {
      chunks.push(parsedChunk);
    }

    offset += length; // Skip chunk data
    offset += 4; // Skip CRC

    if (chunkType === IEND_CHUNK_TYPE) {
      break;
    }
  }

  return chunks;
}

export interface SillyTavernCardMetadata {
  metadataKey: string;
  rawValue: string;
  decodedValue: string;
  decodedFromBase64: boolean;
  parsedJson: unknown;
}

/**
 * Extracts SillyTavern character card metadata from PNG metadata chunks.
 * Supports `tEXt`, `zTXt`, and `iTXt` chunks.
 */
export function extractSillyTavernMetadataFromPNG(pngBuffer: Buffer): SillyTavernCardMetadata | null {
  try {
    const data = new Uint8Array(pngBuffer);
    if (!verifyPNGSignature(data)) {
      return null;
    }

    const textChunks = extractAllTextChunksFromPNGData(data);
    const candidates = textChunks.filter((chunk) => SILLY_TAVERN_METADATA_KEYS.has(chunk.key.toLowerCase()));

    for (const candidate of [...candidates].reverse()) {
      const rawValue = candidate.value.trim();
      if (!rawValue) {
        continue;
      }

      const directJson = tryParseJSON(rawValue);
      if (directJson !== null) {
        return {
          metadataKey: candidate.key,
          rawValue,
          decodedValue: rawValue,
          decodedFromBase64: false,
          parsedJson: directJson,
        };
      }

      const decoded = decodeBase64ToUTF8(rawValue);
      if (!decoded) {
        continue;
      }

      const decodedJson = tryParseJSON(decoded.replace(/^\uFEFF/, ""));
      if (decodedJson !== null) {
        return {
          metadataKey: candidate.key,
          rawValue,
          decodedValue: decoded,
          decodedFromBase64: true,
          parsedJson: decodedJson,
        };
      }
    }

    return null;
  } catch (error) {
    log.warn("Failed to extract SillyTavern metadata from PNG (continuing fallback path)", error);
    return null;
  }
}

/**
 * Extracts TomoriBot preset metadata from a PNG file
 * @returns PresetExport object if found, null otherwise
 */
export function extractMetadataFromPNG(pngBuffer: Buffer): PresetExport | null {
  try {
    const data = new Uint8Array(pngBuffer);

    if (!verifyPNGSignature(data)) {
      log.warn("Invalid PNG signature detected during metadata extraction");
      return null;
    }

    const textChunks = extractAllTextChunksFromPNGData(data);
    const presetChunks = textChunks.filter((chunk) => chunk.key === METADATA_KEY);

    let lastPreset: PresetExport | null = null;
    let presetCount = 0;
    for (const chunk of presetChunks) {
      try {
        const parsed = JSON.parse(chunk.value) as PresetExport;
        lastPreset = parsed;
        presetCount += 1;
      } catch (error) {
        log.error("Failed to parse TomoriPreset JSON metadata:", error as Error);
      }
    }

    if (lastPreset) {
      if (presetCount > 1) {
        log.warn(`Multiple TomoriPreset metadata chunks found (${presetCount}); using the last one.`);
      } else {
        log.success("Successfully extracted TomoriPreset metadata from PNG");
      }
      return lastPreset;
    }

    log.info("No TomoriPreset metadata found in PNG");
    return null;
  } catch (error) {
    log.error("Error extracting metadata from PNG:", error as Error);
    return null;
  }
}

function appendTextChunkToPNG(pngBuffer: Buffer, key: string, value: string, type: "tEXt" | "iTXt"): Buffer {
  try {
    const data = new Uint8Array(pngBuffer);

    if (!verifyPNGSignature(data)) {
      throw new Error("Invalid PNG signature");
    }

    // Find the IEND chunk position
    // We need to insert our metadata chunk BEFORE IEND
    let offset = PNG_SIGNATURE.length;
    let iendOffset = -1;

    while (offset < data.length) {
      const length = readUint32(data, offset);
      offset += 4;

      const chunkType = String.fromCharCode(data[offset], data[offset + 1], data[offset + 2], data[offset + 3]);

      if (chunkType === IEND_CHUNK_TYPE) {
        iendOffset = offset - 4; // Store position before IEND chunk
        break;
      }

      offset += 4; // Skip chunk type
      offset += length; // Skip chunk data
      offset += 4; // Skip CRC
    }

    if (iendOffset === -1) {
      throw new Error("Could not find IEND chunk in PNG");
    }

    const keyBytes = stringToBytes(`${key}\0`);
    const valueBytes = stringToBytes(value);

    // iTXt stores UTF-8 after the compression flag, method, language tag, and translated key.
    const internationalHeader = type === INTERNATIONAL_TEXT_CHUNK_TYPE ? new Uint8Array(4) : new Uint8Array(0);
    const chunkData = new Uint8Array(keyBytes.length + internationalHeader.length + valueBytes.length);
    chunkData.set(keyBytes, 0);
    chunkData.set(internationalHeader, keyBytes.length);
    chunkData.set(valueBytes, keyBytes.length + internationalHeader.length);

    const chunkLength = chunkData.length;

    // Calculate the new PNG size
    // Original size + chunk header (4 bytes length + 4 bytes type) + chunk data + CRC (4 bytes)
    const newPngSize = data.length + 12 + chunkLength;
    const newPngData = new Uint8Array(newPngSize);

    newPngData.set(data.slice(0, iendOffset));

    let writeOffset = iendOffset;

    writeUint32(newPngData, writeOffset, chunkLength);
    writeOffset += 4;

    const typeBytes = stringToBytes(type);
    newPngData.set(typeBytes, writeOffset);
    writeOffset += 4;

    newPngData.set(chunkData, writeOffset);
    writeOffset += chunkLength;

    // Calculate and write CRC for the chunk
    // CRC is calculated over chunk type + chunk data
    const crcData = new Uint8Array(4 + chunkLength);
    crcData.set(typeBytes);
    crcData.set(chunkData, 4);
    const crc = calculateCRC(crcData, 0, crcData.length);
    writeUint32(newPngData, writeOffset, crc);
    writeOffset += 4;

    newPngData.set(data.slice(iendOffset), writeOffset);

    return Buffer.from(newPngData);
  } catch (error) {
    log.error("Error embedding text chunk in PNG:", error as Error);
    throw error;
  }
}

/** Keep the persona card format in a tEXt chunk for existing imports. */
export function embedMetadataInPNG(pngBuffer: Buffer, metadata: PresetExport): Buffer {
  return appendTextChunkToPNG(pngBuffer, METADATA_KEY, JSON.stringify(metadata), TEXT_CHUNK_TYPE);
}

/** Store the full generation prompt as UTF-8 without altering existing PNG chunks. */
export function embedImagePromptInPNG(pngBuffer: Buffer, prompt: string, negativePrompt?: string): Buffer {
  const withPrompt = appendTextChunkToPNG(pngBuffer, "TomoriPrompt", prompt, INTERNATIONAL_TEXT_CHUNK_TYPE);
  return negativePrompt
    ? appendTextChunkToPNG(withPrompt, "TomoriNegativePrompt", negativePrompt, INTERNATIONAL_TEXT_CHUNK_TYPE)
    : withPrompt;
}
