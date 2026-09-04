import { createHash } from 'node:crypto';

/**
 * Stable fingerprint of "the same request". Object keys are sorted so that
 * `{a:1,b:2}` and `{b:2,a:1}` are one request, not two — a retry from a
 * different client library must not look like a new intent.
 */
export const requestFingerprint = (method: string, path: string, body: unknown): string => {
  const canonical = `${method.toUpperCase()} ${path} ${stableStringify(body)}`;
  return createHash('sha256').update(canonical).digest('hex');
};

const stableStringify = (value: unknown): string => {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`);
  return `{${entries.join(',')}}`;
};
