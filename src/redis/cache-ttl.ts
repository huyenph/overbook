/**
 * Q59 — TTL jitter. Without it, every key written during the same burst expires
 * during the same second, and the whole herd stampedes the database together.
 * With it, expiry is smeared over a window.
 */
export const ttlWithJitter = (
  baseSeconds: number,
  jitterSeconds: number,
  random: () => number = Math.random,
): number => {
  if (jitterSeconds <= 0) return Math.max(1, baseSeconds);
  const offset = Math.floor(random() * (jitterSeconds + 1));
  return Math.max(1, baseSeconds + offset);
};
