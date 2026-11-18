import { useEffect, useRef, useState } from "react";
import { imageRetryDelay } from "@/lib/emotes/imageRetry";

interface RetryState {
  src: string;
  /** Tries that have already failed and been started again for this `src`. */
  attempt: number;
  /** True while the fallback shows (waiting for the next try, or no tries left). */
  failed: boolean;
}

/**
 * For an emote `<img>`: after a failed download the fallback shows, and the picture is asked for again after a
 * short wait (see imageRetryDelay). Put `attempt` in the img's `key` so each try is a new element and a new request.
 */
export function useImageRetry(src: string): { failed: boolean; attempt: number; onError: () => void } {
  const [state, setState] = useState<RetryState>({ src, attempt: 0, failed: false });
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // A different picture (for example still frame -> moving) starts with a clean slate.
  let current = state;
  if (state.src !== src) {
    current = { src, attempt: 0, failed: false };
    setState(current);
  }

  // Leaving the screen, or switching to another picture, cancels the waiting try.
  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
      timer.current = null;
    },
    [src],
  );

  const onError = () => {
    const failures = current.attempt + 1;
    setState({ src, attempt: current.attempt, failed: true });
    const delay = imageRetryDelay(failures);
    if (delay === null) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      timer.current = null;
      setState((s) => (s.src === src ? { src, attempt: failures, failed: false } : s));
    }, delay);
  };

  return { failed: current.failed, attempt: current.attempt, onError };
}
