export type SqlValue = string | number | null;
export type SqlParams = SqlValue[];

export interface DatabaseClient {
  exec(sql: string): Promise<void>;
  run(sql: string, params?: SqlParams): Promise<void>;
  get<T>(sql: string, params?: SqlParams): Promise<T | null>;
  all<T>(sql: string, params?: SqlParams): Promise<T[]>;
  transaction<T>(work: () => Promise<T>): Promise<T>;
}
