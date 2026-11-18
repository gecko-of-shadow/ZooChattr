import { describe, expect, it } from "vitest";
import { IMAGE_RETRY_DELAYS_MS, imageRetryDelay } from "./imageRetry";

describe("imageRetryDelay", () => {
  it("waits longer before each new try, then gives up", () => {
    expect(imageRetryDelay(1)).toBe(2_000);
    expect(imageRetryDelay(2)).toBe(8_000);
    expect(imageRetryDelay(3)).toBe(30_000);
    expect(imageRetryDelay(IMAGE_RETRY_DELAYS_MS.length + 1)).toBeNull();
  });
});
