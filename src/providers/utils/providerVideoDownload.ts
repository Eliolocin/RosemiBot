/** Byte ceiling, in MB, for a generated video a provider returns by URL or response body. */
export const PROVIDER_VIDEO_DOWNLOAD_MAX_MB = Math.max(
  1,
  Number.parseInt(process.env.PROVIDER_VIDEO_DOWNLOAD_MAX_MB ?? "25", 10) || 25,
);
