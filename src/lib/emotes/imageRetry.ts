// A picture that fails to download is asked for again a few times before the emote stays as its name.
// One lost request on a slow or lossy connection would otherwise leave a word in chat for good.

/** Wait before each new try; after the last one the picture counts as missing. */
export const IMAGE_RETRY_DELAYS_MS = [2_000, 8_000, 30_000];

/** How long to wait after failure number `failures` (1 = the first), or null when no tries are left. */
export function imageRetryDelay(failures: number): number | null {
  return IMAGE_RETRY_DELAYS_MS[failures - 1] ?? null;
}
