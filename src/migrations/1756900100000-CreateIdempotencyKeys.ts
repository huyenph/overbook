import { MigrationInterface, QueryRunner } from 'typeorm';

/** M2 / Q64 — idempotency keys with a stored response and a TTL column. */
export class CreateIdempotencyKeys1756900100000 implements MigrationInterface {
  name = 'CreateIdempotencyKeys1756900100000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE "idempotency_keys" (
        "key"             varchar(200) PRIMARY KEY,
        "endpoint"        varchar(200) NOT NULL,
        "request_hash"    char(64)     NOT NULL,
        "status"          varchar(20)  NOT NULL DEFAULT 'in_progress',
        "response_status" integer,
        "response_body"   jsonb,
        "created_at"      timestamptz  NOT NULL DEFAULT now(),
        "expires_at"      timestamptz  NOT NULL
      )
    `);
    await queryRunner.query(
      `CREATE INDEX "idx_idempotency_keys_expires_at" ON "idempotency_keys" ("expires_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_idempotency_keys_expires_at"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "idempotency_keys"`);
  }
}
