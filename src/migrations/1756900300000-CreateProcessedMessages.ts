import { MigrationInterface, QueryRunner } from 'typeorm';

/** M6 — consumer-side dedup, turning Kafka's at-least-once into exactly-once effects. */
export class CreateProcessedMessages1756900300000 implements MigrationInterface {
  name = 'CreateProcessedMessages1756900300000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "processed_messages" (
        "message_id"     varchar(200) NOT NULL,
        "consumer_group" varchar(200) NOT NULL,
        "event_type"     varchar(100) NOT NULL,
        "processed_at"   timestamptz  NOT NULL DEFAULT now(),
        PRIMARY KEY ("message_id", "consumer_group")
      )
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "processed_messages"`);
  }
}
