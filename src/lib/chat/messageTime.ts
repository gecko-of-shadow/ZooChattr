/** The furthest a date can be from 1970, either way. Formatting anything past it throws, which would blank the app. */
const MAX_DATE_MS = 8_640_000_000_000_000;

/**
 * The start of the year 2100: no real message is later than this. A fixed line on purpose, not "a day ahead of this
 * computer's clock". On a PC whose clock runs slow, that rule would throw away the real times Twitch sends.
 */
const LATEST_TIME_MS = 4_102_444_800_000;

export function canFormatTime(ts: number): boolean {
  return Math.abs(ts) <= MAX_DATE_MS;
}

/** True for a time that could be real: a number above zero, before the year 2100. */
export function isUsableTime(ts: unknown): ts is number {
  return typeof ts === "number" && Number.isFinite(ts) && ts > 0 && ts <= LATEST_TIME_MS;
}

/** The time in a `tmi-sent-ts` tag, or `now` when it's missing or not usable. */
export function sentTime(tag: string | undefined, now = Date.now()): number {
  const ts = Number(tag);
  return isUsableTime(ts) ? ts : now;
}
