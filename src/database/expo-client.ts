import { openDatabaseAsync, type SQLiteDatabase } from 'expo-sqlite';

import type { DatabaseClient, SqlParams } from '@/src/database/client';

class ExpoDatabaseClient implements DatabaseClient {
  constructor(private readonly db: SQLiteDatabase) {}

  async exec(sql: string): Promise<void> {
    await this.db.execAsync(sql);
  }

  async run(sql: string, params: SqlParams = []): Promise<void> {
    await this.db.runAsync(sql, params);
  }

  async get<T>(sql: string, params: SqlParams = []): Promise<T | null> {
    const row = await this.db.getFirstAsync<T>(sql, params);
    return row ?? null;
  }

  async all<T>(sql: string, params: SqlParams = []): Promise<T[]> {
    return this.db.getAllAsync<T>(sql, params);
  }

  async transaction<T>(work: () => Promise<T>): Promise<T> {
    let result: T | undefined;
    await this.db.withTransactionAsync(async () => {
      result = await work();
    });
    return result as T;
  }
}

let client: DatabaseClient | null = null;

export async function initDatabase(): Promise<DatabaseClient> {
  if (client) {
    return client;
  }

  const sqlite = await openDatabaseAsync('mono.db');
  await sqlite.execAsync('PRAGMA foreign_keys = ON');
  client = new ExpoDatabaseClient(sqlite);
  return client;
}

export function getDatabase(): DatabaseClient {
  if (!client) {
    throw new Error('Cơ sở dữ liệu chưa sẵn sàng.');
  }
  return client;
}
