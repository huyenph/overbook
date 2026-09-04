import { Injectable, Logger, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Kafka, Partitioners, logLevel, type Producer } from 'kafkajs';

export interface OutgoingMessage {
  topic: string;
  key: string;
  value: Record<string, unknown>;
  headers?: Record<string, string>;
}

@Injectable()
export class KafkaService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(KafkaService.name);
  readonly kafka: Kafka;
  private producer!: Producer;
  private connected = false;

  constructor(private readonly config: ConfigService) {
    this.kafka = new Kafka({
      clientId: `${config.get<string>('kafka.clientId')}-${config.get<string>('app.instanceId')}`,
      brokers: config.get<string[]>('kafka.brokers') ?? ['localhost:9092'],
      logLevel: logLevel.WARN,
      retry: { initialRetryTime: 300, retries: 8 },
    });
  }

  async onModuleInit(): Promise<void> {
    await this.ensureTopics();
    this.producer = this.kafka.producer({
      createPartitioner: Partitioners.DefaultPartitioner,
      // Broker-side dedup of producer retries. It does not make the whole
      // pipeline exactly-once — that is what the outbox id + the consumer's
      // processed_messages table are for — but it removes one duplicate source.
      idempotent: true,
      maxInFlightRequests: 5,
    });
    await this.producer.connect();
    this.connected = true;
    this.logger.log('kafka producer connected');
  }

  async onApplicationShutdown(): Promise<void> {
    if (!this.connected) return;
    this.connected = false;
    await this.producer.disconnect().catch(() => undefined);
  }

  get isConnected(): boolean {
    return this.connected;
  }

  /** Topics are created up front so a fresh stack is not racing auto-creation. */
  private async ensureTopics(): Promise<void> {
    const topics = this.config.get<Record<string, string>>('kafka.topics') ?? {};
    const admin = this.kafka.admin();
    try {
      await admin.connect();
      const existing = new Set(await admin.listTopics());
      const missing = Object.values(topics).filter((topic) => !existing.has(topic));
      if (missing.length > 0) {
        await admin.createTopics({
          waitForLeaders: true,
          topics: missing.map((topic) => ({
            topic,
            numPartitions: 3,
            replicationFactor: 1,
          })),
        });
        this.logger.log(`created kafka topics: ${missing.join(', ')}`);
      }
    } catch (error) {
      this.logger.warn(`topic bootstrap skipped: ${(error as Error).message}`);
    } finally {
      await admin.disconnect().catch(() => undefined);
    }
  }

  async publish(message: OutgoingMessage): Promise<void> {
    await this.publishBatch([message]);
  }

  /**
   * The relay publishes a whole poll batch in one request. Kafka groups by
   * topic, and the message key decides the partition, so all events for one
   * booking stay ordered relative to each other.
   */
  async publishBatch(messages: OutgoingMessage[]): Promise<void> {
    if (messages.length === 0) return;

    const byTopic = new Map<string, OutgoingMessage[]>();
    for (const message of messages) {
      const bucket = byTopic.get(message.topic);
      if (bucket) bucket.push(message);
      else byTopic.set(message.topic, [message]);
    }

    await this.producer.sendBatch({
      topicMessages: [...byTopic.entries()].map(([topic, items]) => ({
        topic,
        messages: items.map((item) => ({
          key: item.key,
          value: JSON.stringify(item.value),
          headers: item.headers,
        })),
      })),
      acks: -1,
      timeout: 10000,
    });
  }
}
