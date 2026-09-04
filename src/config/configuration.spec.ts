import { configuration } from './configuration';

describe('configuration', () => {
  const original = { ...process.env };

  afterEach(() => {
    process.env = { ...original };
  });

  it('parses booleans loosely but predictably', () => {
    process.env.CACHE_ENABLED = 'FALSE';
    expect(configuration().cache.enabled).toBe(false);

    process.env.CACHE_ENABLED = 'yes';
    expect(configuration().cache.enabled).toBe(true);

    delete process.env.CACHE_ENABLED;
    expect(configuration().cache.enabled).toBe(true);
  });

  it('rejects an unknown booking lock strategy instead of silently defaulting', () => {
    process.env.BOOKING_LOCK_STRATEGY = 'mutex';
    expect(() => configuration()).toThrow(/BOOKING_LOCK_STRATEGY/);
  });

  it('splits the kafka broker list', () => {
    process.env.KAFKA_BROKERS = 'a:9092, b:9092';
    expect(configuration().kafka.brokers).toEqual(['a:9092', 'b:9092']);
  });
});
