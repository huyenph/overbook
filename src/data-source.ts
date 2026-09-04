import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { DataSource, DataSourceOptions } from 'typeorm';
import { SnakeNamingStrategy } from 'typeorm-naming-strategies';
import { configuration } from './config/configuration';

loadEnv();

// Force UTC before pg parses anything, so `timestamptz` round-trips as an instant.
process.env.TZ = 'UTC';

const { database } = configuration();

export const dataSourceOptions: DataSourceOptions = {
  type: 'postgres',
  host: database.host,
  port: database.port,
  username: database.username,
  password: database.password,
  database: database.name,
  // Never true. Schema changes go through reviewed migrations (see src/migrations).
  synchronize: false,
  migrationsRun: false,
  namingStrategy: new SnakeNamingStrategy(),
  entities: [__dirname + '/**/*.entity{.ts,.js}'],
  migrations: [__dirname + '/migrations/*{.ts,.js}'],
  extra: {
    max: database.poolMax,
    // A request should fail fast rather than pile up when the pool is exhausted (Q58).
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
    options: '-c timezone=UTC',
  },
};

export default new DataSource(dataSourceOptions);
