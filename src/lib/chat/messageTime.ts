/** The furthest a date can be from 1970, either way. Formatting anything past it throws, which would blank the app. */
const MAX_DATE_MS = 8_640_000_000_000_000;

/**
 * How far ahead of this computer's clock a message time may be. Our own choice, tighter than what can be formatted:
 * clocks drift by seconds or minutes, and a line stamped further ahead would sit at the bottom of chat and never expire.
 */
const MAX_AHEAD_MS = 24 * 60 * 60_000;

export function canFormatTime(ts: number): boolean {
  return Math.abs(ts) <= MAX_DATE_MS;
}

/** True for a real message time: a number above zero, not implausibly far ahead of `now`. */
export function isUsableTime(ts: unknown, now = Date.now()): ts is number {
  return typeof ts === "number" && Number.isFinite(ts) && ts > 0 && ts <= now + MAX_AHEAD_MS;
}

/** The time in a `tmi-sent-ts` tag, or `now` when it's missing or not usable. */
export function sentTime(tag: string | undefined, now = Date.now()): number {
  const ts = Number(tag);
  return isUsableTime(ts, now) ? ts : now;
}
