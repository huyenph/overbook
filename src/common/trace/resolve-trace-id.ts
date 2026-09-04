import { randomUUID } from 'node:crypto';
import { TRACE_HEADER, TRACE_HEADER_ALT } from './trace.constants';

type Headers = Record<string, string | string[] | undefined>;

const MAX_LENGTH = 128;
const SAFE = /^[A-Za-z0-9._:-]+$/;

/**
 * Q65 — one id, followable from nginx through the API into the Kafka message.
 * An inbound id is honoured so a trace spans hops, but it is validated first:
 * a header is attacker-controlled, and it ends up in log lines and metrics.
 */
export const resolveTraceId = (headers: Headers | undefined): string => {
  const candidate = pick(headers?.[TRACE_HEADER]) ?? pick(headers?.[TRACE_HEADER_ALT]);
  if (candidate && candidate.length <= MAX_LENGTH && SAFE.test(candidate)) {
    return candidate;
  }
  return randomUUID();
};

const pick = (value: string | string[] | undefined): string | undefined => {
  if (Array.isArray(value)) return value[0]?.trim() || undefined;
  return value?.trim() || undefined;
};
