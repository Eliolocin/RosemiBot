/**
 * A provider's safety filter removed the generated video. This is an expected content refusal, so
 * callers show the safety message without writing an `error_logs` row.
 */
export class ProviderVideoFilteredError extends Error {
  constructor(readonly provider: string) {
    super(`${provider} blocked the generated video with its content safety filter`);
    this.name = "ProviderVideoFilteredError";
  }
}
