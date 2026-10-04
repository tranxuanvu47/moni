import type { DatabaseClient } from '@/src/database/client';
import { DEFAULT_CATEGORIES } from '@/src/features/categories/defaults';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    icon TEXT NOT NULL,
    color TEXT NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('expense', 'income', 'both')),
    is_default INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS transactions (
    id TEXT PRIMARY KEY NOT NULL,
    type TEXT NOT NULL CHECK (type IN ('expense', 'income')),
    amount INTEGER NOT NULL CHECK (amount > 0),
    currency TEXT NOT NULL DEFAULT 'VND' CHECK (currency = 'VND'),
    category_id TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    occurred_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (category_id) REFERENCES categories(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_occurred_at ON transactions (occurred_at)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_type_occurred ON transactions (type, occurred_at)`,
  `CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions (category_id)`,
  `CREATE TABLE IF NOT EXISTS attachments (
    id TEXT PRIMARY KEY NOT NULL,
    transaction_id TEXT NOT NULL,
    local_uri TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    created_at TEXT NOT NULL,
    FOREIGN KEY (transaction_id) REFERENCES transactions(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_attachments_transaction ON attachments (transaction_id)`,
  `CREATE TABLE IF NOT EXISTS budgets (
    id TEXT PRIMARY KEY NOT NULL,
    category_id TEXT,
    amount INTEGER NOT NULL CHECK (amount > 0),
    period TEXT NOT NULL CHECK (period = 'month'),
    effective_date TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (category_id) REFERENCES categories(id)
  )`,
  `CREATE TABLE IF NOT EXISTS preferences (
    key TEXT PRIMARY KEY NOT NULL,
    value TEXT NOT NULL
  )`,
];

const SYNC_COLUMNS = [
  'ALTER TABLE transactions ADD COLUMN deleted_at TEXT',
  'ALTER TABLE transactions ADD COLUMN revision INTEGER NOT NULL DEFAULT 1',
  'ALTER TABLE transactions ADD COLUMN synced_revision INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE transactions ADD COLUMN device_id TEXT NOT NULL DEFAULT \'\'',
  "ALTER TABLE transactions ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending'",
  "ALTER TABLE categories ADD COLUMN updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00'",
  'ALTER TABLE categories ADD COLUMN deleted_at TEXT',
  'ALTER TABLE categories ADD COLUMN revision INTEGER NOT NULL DEFAULT 1',
  'ALTER TABLE categories ADD COLUMN synced_revision INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE categories ADD COLUMN device_id TEXT NOT NULL DEFAULT \'\'',
  "ALTER TABLE categories ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending'",
  'ALTER TABLE budgets ADD COLUMN deleted_at TEXT',
  'ALTER TABLE budgets ADD COLUMN revision INTEGER NOT NULL DEFAULT 1',
  'ALTER TABLE budgets ADD COLUMN synced_revision INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE budgets ADD COLUMN device_id TEXT NOT NULL DEFAULT \'\'',
  "ALTER TABLE budgets ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending'",
  "ALTER TABLE preferences ADD COLUMN updated_at TEXT NOT NULL DEFAULT '1970-01-01T00:00:00'",
  'ALTER TABLE preferences ADD COLUMN deleted_at TEXT',
  'ALTER TABLE preferences ADD COLUMN revision INTEGER NOT NULL DEFAULT 1',
  'ALTER TABLE preferences ADD COLUMN synced_revision INTEGER NOT NULL DEFAULT 0',
  'ALTER TABLE preferences ADD COLUMN device_id TEXT NOT NULL DEFAULT \'\'',
  "ALTER TABLE preferences ADD COLUMN sync_status TEXT NOT NULL DEFAULT 'pending'",
  'ALTER TABLE attachments ADD COLUMN drive_file_id TEXT',
  `CREATE TABLE IF NOT EXISTS sync_outbox (
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    revision INTEGER NOT NULL,
    enqueued_at TEXT NOT NULL,
    attempts INTEGER NOT NULL DEFAULT 0,
    next_attempt_at TEXT,
    last_error TEXT,
    PRIMARY KEY (entity, entity_id)
  )`,
  `CREATE TABLE IF NOT EXISTS sync_conflicts (
    entity TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    local_payload TEXT NOT NULL,
    remote_payload TEXT NOT NULL,
    detected_at TEXT NOT NULL,
    PRIMARY KEY (entity, entity_id)
  )`,
];

export async function migrate(db: DatabaseClient): Promise<void> {
  await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY NOT NULL,
    applied_at TEXT NOT NULL
  )`);

  const current = await db.get<{ version: number | null }>('SELECT MAX(version) AS version FROM schema_migrations');
  const version = current?.version ?? 0;
  if (version < 1) {
    await applyBaseSchema(db);
  }
  if (version < 2) {
    await applySyncSchema(db);
  }
  if (version < 3) {
    await applyFirestoreSchema(db);
  }
}

async function applyBaseSchema(db: DatabaseClient): Promise<void> {
  const appliedAt = '1970-01-01T00:00:00';
  await db.transaction(async () => {
    for (const statement of SCHEMA) {
      await db.exec(statement);
    }

    for (const category of DEFAULT_CATEGORIES) {
      await db.run(
        `INSERT INTO categories (id, name, icon, color, type, is_default, sort_order, created_at)
         VALUES (?, ?, ?, ?, ?, 1, ?, ?)`,
        [category.id, category.name, category.icon, category.color, category.type, category.sortOrder, appliedAt],
      );
    }

    await db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [1, appliedAt]);
  });
}

async function applySyncSchema(db: DatabaseClient): Promise<void> {
  await db.transaction(async () => {
    for (const statement of SYNC_COLUMNS) {
      await db.exec(statement);
    }
    await db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [2, '1970-01-01T00:00:00']);
  });
}

async function applyFirestoreSchema(db: DatabaseClient): Promise<void> {
  await db.exec('PRAGMA foreign_keys = OFF');
  try {
    await db.transaction(async () => {
      await db.exec(`CREATE TABLE transactions_v3 (
        id TEXT PRIMARY KEY NOT NULL,
        type TEXT NOT NULL CHECK (type IN ('expense', 'income', 'transfer')),
        amount INTEGER NOT NULL CHECK (amount > 0),
        currency TEXT NOT NULL DEFAULT 'VND' CHECK (currency = 'VND'),
        category_id TEXT NOT NULL,
        description TEXT NOT NULL DEFAULT '',
        occurred_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        deleted_at TEXT,
        revision INTEGER NOT NULL DEFAULT 1,
        synced_revision INTEGER NOT NULL DEFAULT 0,
        device_id TEXT NOT NULL DEFAULT '',
        sync_status TEXT NOT NULL DEFAULT 'pending',
        source TEXT NOT NULL DEFAULT 'manual',
        fingerprint TEXT,
        account_id TEXT,
        transfer_account_id TEXT,
        FOREIGN KEY (category_id) REFERENCES categories(id)
      )`);
      await db.exec(`INSERT INTO transactions_v3 (
        id, type, amount, currency, category_id, description, occurred_at, created_at, updated_at,
        deleted_at, revision, synced_revision, device_id, sync_status
      )
      SELECT
        id, type, amount, currency, category_id, description, occurred_at, created_at, updated_at,
        deleted_at, revision, synced_revision, device_id, sync_status
      FROM transactions`);
      await db.exec('DROP TABLE transactions');
      await db.exec('ALTER TABLE transactions_v3 RENAME TO transactions');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_occurred_at ON transactions (occurred_at)');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_type_occurred ON transactions (type, occurred_at)');
      await db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_category ON transactions (category_id)');
      await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_fingerprint
        ON transactions (fingerprint)
        WHERE fingerprint IS NOT NULL AND fingerprint != '' AND deleted_at IS NULL`);
      await db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [3, '1970-01-01T00:00:00']);
    });
  } finally {
    await db.exec('PRAGMA foreign_keys = ON');
  }
}
