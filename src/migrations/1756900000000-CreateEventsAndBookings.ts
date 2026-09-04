import { MigrationInterface, QueryRunner } from 'typeorm';

/** M0/M1 — the two core tables. All timestamps are timestamptz (UTC). */
export class CreateEventsAndBookings1756900000000 implements MigrationInterface {
  name = 'CreateEventsAndBookings1756900000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE "events" (
        "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "name"            varchar(200)  NOT NULL,
        "venue"           varchar(200)  NOT NULL,
        "total_seats"     integer       NOT NULL,
        "available_seats" integer       NOT NULL,
        "price_cents"     integer       NOT NULL,
        "starts_at"       timestamptz   NOT NULL,
        "version"         integer       NOT NULL DEFAULT 0,
        "created_at"      timestamptz   NOT NULL DEFAULT now(),
        "updated_at"      timestamptz   NOT NULL DEFAULT now()
        -- Deliberately NO check constraint on available_seats.
        -- In production you would add CHECK (available_seats >= 0) as a last-resort
        -- safety net; here it is left off so Milestone 1 can actually show the
        -- counter going negative instead of the database hiding the race.
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_events_name" ON "events" ("name")`);

    await queryRunner.query(`
      CREATE TABLE "bookings" (
        "id"              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "event_id"        uuid          NOT NULL REFERENCES "events"("id") ON DELETE CASCADE,
        "user_id"         varchar(100)  NOT NULL,
        "quantity"        integer       NOT NULL,
        "status"          varchar(20)   NOT NULL DEFAULT 'confirmed',
        "idempotency_key" varchar(200),
        "created_at"      timestamptz   NOT NULL DEFAULT now(),
        "updated_at"      timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT "chk_bookings_quantity_positive" CHECK ("quantity" > 0)
      )
    `);
    await queryRunner.query(`CREATE INDEX "idx_bookings_user_id" ON "bookings" ("user_id")`);
    await queryRunner.query(
      `CREATE INDEX "idx_bookings_event_id_created_at" ON "bookings" ("event_id", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_bookings_event_id_created_at"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_bookings_user_id"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "bookings"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_events_name"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "events"`);
  }
}
