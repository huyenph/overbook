/**
 * Q35 — exponential backoff with full jitter.
 *
 * Exponential alone is not enough: if a downstream service blinks and a
 * thousand consumers all back off by exactly 2s, they come back as one
 * synchronised wave and knock it over again. Jitter smears the retries out.
 * "Full jitter" (a uniform pick from [0, exponential]) is the variant AWS
 * measured as best for spreading a herd.
 */
export const computeBackoffMs = (
  attempt: number,
  baseMs: number,
  maxMs: number,
  random: () => number = Math.random,
): number => {
  const exponential = Math.min(maxMs, baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.floor(random() * exponential);
};

/** A message is dead-lettered once it has burned all its attempts. */
export const shouldDeadLetter = (attempts: number, maxAttempts: number): boolean =>
  attempts >= maxAttempts;
