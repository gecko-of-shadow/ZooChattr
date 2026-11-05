import { describe, expect, it } from "vitest";
import { canFormatTime, isUsableTime, sentTime } from "./messageTime";

const now = 1_700_000_000_000;
const YEAR_2100 = Date.UTC(2100, 0, 1);

describe("isUsableTime", () => {
  it("accepts any real time", () => {
    expect(isUsableTime(1)).toBe(true);
    expect(isUsableTime(now)).toBe(true);
    expect(isUsableTime(YEAR_2100)).toBe(true);
  });

  it("refuses anything else", () => {
    for (const ts of [YEAR_2100 + 1, 1e18, 0, -1, Number.NaN, Number.POSITIVE_INFINITY, "1700000000000", null, undefined]) {
      expect(isUsableTime(ts), String(ts)).toBe(false);
    }
  });
});

describe("sentTime", () => {
  it("reads a usable tag", () => {
    expect(sentTime("1699999999000", now)).toBe(1_699_999_999_000);
  });

  it("keeps Twitch's time on a PC whose clock runs days slow", () => {
    const threeDays = 3 * 24 * 60 * 60_000;
    expect(sentTime(String(now + threeDays), now)).toBe(now + threeDays);
  });

  it("falls back to now", () => {
    for (const tag of [undefined, "", "abc", "999999999999999999", "1e400", "-5", "0"]) {
      expect(sentTime(tag, now), String(tag)).toBe(now);
    }
  });
});

describe("canFormatTime", () => {
  const format = new Intl.DateTimeFormat(undefined, { hour: "numeric" });

  it("matches what the date formatter really accepts", () => {
    for (const ts of [0, now, 8_640_000_000_000_000, -8_640_000_000_000_000]) {
      expect(canFormatTime(ts)).toBe(true);
      expect(() => format.format(ts)).not.toThrow();
    }
    for (const ts of [8_640_000_000_000_001, -8_640_000_000_000_001, 1e18, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(canFormatTime(ts)).toBe(false);
      expect(() => format.format(ts)).toThrow(RangeError);
    }
  });
});
