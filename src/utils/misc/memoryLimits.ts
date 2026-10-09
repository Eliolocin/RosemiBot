import { log } from "@/utils/misc/logger";

const MAX_ATTRIBUTE_LENGTH = 2000;
const MAX_ATTRIBUTES = 10;
const MAX_SAMPLE_DIALOGUE_LENGTH = 2000;
const MAX_SAMPLE_DIALOGUES = 15;
const MAX_TRIGGER_WORDS = 10;
const DOCUMENT_CHUNK_SIZE = 1000;
const DOCUMENT_CHUNK_OVERLAP = 200;

/**
 * Memory limit configuration loaded from environment variables with defaults
 */
export interface MemoryLimits {
  maxPersonalMemories: number;
  maxServerMemories: number;
  maxMemoryLength: number;
  maxSampleDialogueLength: number;
  maxAttributeLength: number;
  maxTriggerWords: number;
  maxSampleDialogues: number;
  maxAttributes: number;
  maxPersonasPerServer: number;
  maxDocumentSizeMB: number;
  maxDocumentTextLength: number;
  documentChunkSize: number;
  documentChunkOverlap: number;
  maxDocumentChunks: number;
  maxDocumentsPerServer: number;
  maxDocumentChunksPerServer: number;
}

export interface MemoryValidationResult {
  isValid: boolean;
  error?: MemoryValidationError;
  currentCount?: number;
  maxAllowed?: number;
}

type MemoryValidationError =
  | "CONTENT_TOO_LONG"
  | "PERSONAL_MEMORY_LIMIT_EXCEEDED"
  | "SERVER_MEMORY_LIMIT_EXCEEDED"
  | "TRIGGER_WORD_LIMIT_EXCEEDED"
  | "SAMPLE_DIALOGUE_LIMIT_EXCEEDED"
  | "ATTRIBUTE_LIMIT_EXCEEDED"
  | "PERSONA_LIMIT_EXCEEDED"
  | "CONTENT_EMPTY";

/**
 * Load memory limits from environment variables with sensible defaults
 */
export function getMemoryLimits(): MemoryLimits {
  // Counted per (owner, persona_lineage_id), so a multi-persona server holds this
  // many times the persona count. Memory length, not count, is the context tax.
  const maxPersonalMemories = parsePositiveIntegerEnv("MAX_PERSONAL_MEMORIES", 100);
  const maxServerMemories = parsePositiveIntegerEnv("MAX_SERVER_MEMORIES", 100);
  const maxMemoryLength = parsePositiveIntegerEnv("MAX_MEMORY_LENGTH", 1000);
  const maxPersonasPerServer = parsePositiveIntegerEnv("MAX_PERSONAS_PER_SERVER", 20);
  const maxDocumentSizeMB = parsePositiveIntegerEnv("MAX_DOCUMENT_SIZE_MB", 4);
  const maxDocumentTextLength = parsePositiveIntegerEnv("MAX_DOCUMENT_TEXT_LENGTH", 120000);
  const maxDocumentChunks = parsePositiveIntegerEnv("MAX_DOCUMENT_CHUNKS", 150);
  const maxDocumentsPerServer = parsePositiveIntegerEnv("MAX_DOCUMENTS_PER_SERVER", 20);
  const maxDocumentChunksPerServer = parsePositiveIntegerEnv("MAX_DOCUMENT_CHUNKS_PER_SERVER", 1000);

  return {
    maxPersonalMemories,
    maxServerMemories,
    maxMemoryLength,
    maxSampleDialogueLength: MAX_SAMPLE_DIALOGUE_LENGTH,
    maxAttributeLength: MAX_ATTRIBUTE_LENGTH,
    maxTriggerWords: MAX_TRIGGER_WORDS,
    maxSampleDialogues: MAX_SAMPLE_DIALOGUES,
    maxAttributes: MAX_ATTRIBUTES,
    maxPersonasPerServer,
    maxDocumentSizeMB,
    maxDocumentTextLength,
    documentChunkSize: DOCUMENT_CHUNK_SIZE,
    documentChunkOverlap: DOCUMENT_CHUNK_OVERLAP,
    maxDocumentChunks,
    maxDocumentsPerServer,
    maxDocumentChunksPerServer,
  };
}

function parsePositiveIntegerEnv(name: string, defaultValue: number): number {
  const rawValue = process.env[name];
  const parsedValue = Number.parseInt(rawValue || defaultValue.toString(), 10);

  if (!Number.isInteger(parsedValue) || parsedValue <= 0) {
    log.warn(`Invalid ${name} value: ${rawValue}. Using default: ${defaultValue}`);
    return defaultValue;
  }

  return parsedValue;
}

export function validateMemoryContent(content: string): MemoryValidationResult {
  const limits = getMemoryLimits();

  if (!content?.trim()) {
    return { isValid: false, error: "CONTENT_EMPTY" };
  }

  if (content.length > limits.maxMemoryLength) {
    return { isValid: false, error: "CONTENT_TOO_LONG", maxAllowed: limits.maxMemoryLength };
  }

  return { isValid: true };
}

/**
 * Attributes use a higher limit (default 2000) than regular memories (default 1000).
 */
export function validateAttribute(content: string): MemoryValidationResult {
  const limits = getMemoryLimits();

  if (!content?.trim()) {
    return { isValid: false, error: "CONTENT_EMPTY" };
  }

  if (content.length > limits.maxAttributeLength) {
    return { isValid: false, error: "CONTENT_TOO_LONG", maxAllowed: limits.maxAttributeLength };
  }

  return { isValid: true };
}

/**
 * Sample dialogues use a higher limit (default 2000) than regular memories (default 1000).
 */
export function validateSampleDialogue(content: string): MemoryValidationResult {
  const limits = getMemoryLimits();

  if (!content?.trim()) {
    return { isValid: false, error: "CONTENT_EMPTY" };
  }

  if (content.length > limits.maxSampleDialogueLength) {
    return { isValid: false, error: "CONTENT_TOO_LONG", maxAllowed: limits.maxSampleDialogueLength };
  }

  return { isValid: true };
}
