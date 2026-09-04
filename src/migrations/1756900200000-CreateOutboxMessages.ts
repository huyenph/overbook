import { MigrationInterface, QueryRunner } from 'typeorm';

/** M5 / Q60 — transactional outbox. */
export class CreateOutboxMessages1756900200000 implements MigrationInterface {
  name = 'CreateOutboxMessages1756900200000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "outbox_messages" (
        "id"             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "aggregate_type" varchar(100) NOT NULL,
        "aggregate_id"   varchar(100) NOT NULL,
        "event_type"     varchar(100) NOT NULL,
        "topic"          varchar(200) NOT NULL,
        "message_key"    varchar(200) NOT NULL,
        "payload"        jsonb        NOT NULL,
        "status"         varchar(20)  NOT NULL DEFAULT 'pending',
        "attempts"       integer      NOT NULL DEFAULT 0,
        "available_at"   timestamptz  NOT NULL DEFAULT now(),
        "published_at"   timestamptz,
        "last_error"     text,
        "created_at"     timestamptz  NOT NULL DEFAULT now()
      )
    `);
    // Partial index: the relay only ever scans rows still waiting to go out,
    // so the table can grow without the poll query degrading.
    await queryRunner.query(`
      CREATE INDEX "idx_outbox_pending" ON "outbox_messages" ("available_at", "created_at")
      WHERE "status" = 'pending'
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_outbox_status_available_at" ON "outbox_messages" ("status", "available_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_outbox_status_available_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_outbox_pending"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "outbox_messages"`);
  }
}
