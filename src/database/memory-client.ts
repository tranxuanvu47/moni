import type { DatabaseSync } from 'node:sqlite';

import type { DatabaseClient, SqlParams } from '@/src/database/client';

export function createMemoryClient(database: DatabaseSync): DatabaseClient {
  return {
    async exec(sql: string): Promise<void> {
      database.exec(sql);
    },
    async run(sql: string, params: SqlParams = []): Promise<void> {
      database.prepare(sql).run(...params);
    },
    async get<T>(sql: string, params: SqlParams = []): Promise<T | null> {
      const row = database.prepare(sql).get(...params) as T | undefined;
      return row ?? null;
    },
    async all<T>(sql: string, params: SqlParams = []): Promise<T[]> {
      return database.prepare(sql).all(...params) as T[];
    },
    async transaction<T>(work: () => Promise<T>): Promise<T> {
      database.exec('BEGIN');
      try {
        const result = await work();
        database.exec('COMMIT');
        return result;
      } catch (error) {
        database.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
