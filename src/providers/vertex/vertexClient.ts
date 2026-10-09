/**
 * Vertex AI client construction and composite-key parsing
 *
 * The stored "API key" for the Vertex provider is actually a composite config:
 *   {project_id}::{location}
 * Example: "my-gcp-project::us-central1"
 *
 * Real authentication comes from Application Default Credentials (ADC) on the host:
 *   - Service account on the machine/container
 *   - GOOGLE_APPLICATION_CREDENTIALS env var
 *   - `gcloud auth application-default login`
 *
 * This module centralises parsing, validation, and GoogleGenAI client construction
 * so streaming, validation, and any future v2 helpers share the same logic.
 */

import { GoogleGenAI } from "@google/genai";
import { log } from "../../utils/misc/logger";

export interface VertexConfig {
  /** GCP project ID */
  projectId: string;
  /** GCP region / location (e.g. "us-central1") */
  location: string;
}

const COMPOSITE_KEY_SEPARATOR = "::";

/**
 * Parse the composite key string stored as the "API key" for Vertex.
 *
 * Expected format: `{project_id}::{location}`
 *
 * @param compositeKey - The raw composite key from the database
 * @throws Error if the format is invalid
 */
export function parseVertexCompositeKey(compositeKey: string): VertexConfig {
  if (!compositeKey || typeof compositeKey !== "string") {
    throw new Error("Vertex composite key is empty. Expected format: {project_id}::{location}");
  }

  const parts = compositeKey.split(COMPOSITE_KEY_SEPARATOR);

  if (parts.length !== 2) {
    throw new Error(
      `Invalid Vertex composite key format. Expected exactly one "${COMPOSITE_KEY_SEPARATOR}" separator. Got: "${compositeKey}"`,
    );
  }

  const [projectId, location] = parts.map((p) => p.trim());

  if (!projectId) {
    throw new Error(`Vertex composite key has an empty project ID. Expected format: {project_id}::{location}`);
  }

  if (!location) {
    throw new Error(`Vertex composite key has an empty location. Expected format: {project_id}::{location}`);
  }

  return { projectId, location };
}

/**
 * Construct a GoogleGenAI client configured for Vertex AI.
 *
 * Uses ADC (Application Default Credentials) rather than an API key.
 *
 * @returns GoogleGenAI client ready for Vertex AI calls
 */
export function createVertexClient(config: VertexConfig): GoogleGenAI {
  log.info(`Creating Vertex AI client for project "${config.projectId}" in "${config.location}"`);

  return new GoogleGenAI({
    vertexai: true,
    project: config.projectId,
    location: config.location,
  });
}
