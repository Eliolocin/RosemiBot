import { describe, expect, it } from "bun:test";
import { parseVertexCompositeKey } from "@/providers/vertex/vertexClient";

describe("parseVertexCompositeKey", () => {
  it("accepts Google Cloud location names", () => {
    for (const location of ["global", "us", "us-central1", "europe-west4"]) {
      expect(parseVertexCompositeKey(`my-project::${location}`)).toEqual({ projectId: "my-project", location });
    }
  });

  it("rejects locations that would move the SDK request host and its ADC token", () => {
    const hostAlteringLocations = ["evil.example/x?", "evil.example#", "a@evil.example/", "evil.example:443/"];
    const accepted = hostAlteringLocations.filter((location) => {
      try {
        parseVertexCompositeKey(`my-project::${location}`);
        return true;
      } catch {
        return false;
      }
    });
    expect(accepted).toEqual([]);
  });
});
