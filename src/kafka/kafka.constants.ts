/** Message headers carried end to end: outbox row -> Kafka -> consumer -> DLQ. */
export const HEADER_MESSAGE_ID = 'message-id';
export const HEADER_EVENT_TYPE = 'event-type';
export const HEADER_TRACE_ID = 'trace-id';
export const HEADER_ATTEMPTS = 'attempts';
export const HEADER_RETRY_AT = 'retry-at';
export const HEADER_ORIGINAL_TOPIC = 'original-topic';
export const HEADER_ERROR = 'error';

export interface BookingConfirmedPayload {
  bookingId: string;
  eventId: string;
  userId: string;
  quantity: number;
  eventName: string;
  bookedAt: string;
}
