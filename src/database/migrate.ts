import type { DatabaseClient } from '@/src/database/client';
import { DEFAULT_CATEGORIES } from '@/src/features/categories/defaults';
import { DEFAULT_ACCOUNT_ID } from '@/src/types/finance';

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
  if (version < 4) {
    await applyFinanceFoundationSchema(db);
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

async function applyFinanceFoundationSchema(db: DatabaseClient): Promise<void> {
  const appliedAt = '1970-01-01T00:00:00';
  await db.transaction(async () => {
    await db.exec(`CREATE TABLE IF NOT EXISTS accounts (
      id TEXT PRIMARY KEY NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('cash', 'bank', 'ewallet', 'other')),
      bank_code TEXT,
      masked_identifier TEXT,
      currency TEXT NOT NULL DEFAULT 'VND' CHECK (currency = 'VND'),
      opening_balance INTEGER NOT NULL DEFAULT 0,
      opening_balance_date TEXT NOT NULL,
      archived_at TEXT,
      display_order INTEGER NOT NULL DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      synced_revision INTEGER NOT NULL DEFAULT 0,
      device_id TEXT NOT NULL DEFAULT '',
      sync_status TEXT NOT NULL DEFAULT 'pending'
    )`);
    await db.exec('CREATE INDEX IF NOT EXISTS idx_accounts_active_order ON accounts (archived_at, display_order)');

    await db.run(
      `INSERT OR IGNORE INTO accounts (
         id, name, type, currency, opening_balance, opening_balance_date, display_order,
         created_at, updated_at, revision, synced_revision, device_id, sync_status
       ) VALUES (?, 'Tiền mặt', 'cash', 'VND', 0, '1970-01-01', 0, ?, ?, 1, 0, '', 'pending')`,
      [DEFAULT_ACCOUNT_ID, appliedAt, appliedAt],
    );

    await db.exec('ALTER TABLE transactions ADD COLUMN transfer_fee INTEGER NOT NULL DEFAULT 0 CHECK (transfer_fee >= 0)');
    await db.exec('ALTER TABLE transactions ADD COLUMN recurring_rule_id TEXT');
    await db.exec('ALTER TABLE transactions ADD COLUMN occurrence_key TEXT');
    await db.run(
      `UPDATE transactions
       SET account_id = ?
       WHERE account_id IS NULL AND type IN ('expense', 'income')`,
      [DEFAULT_ACCOUNT_ID],
    );
    await db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_account_occurred ON transactions (account_id, occurred_at)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_transfer_account_occurred ON transactions (transfer_account_id, occurred_at)');
    await db.exec('CREATE INDEX IF NOT EXISTS idx_transactions_source ON transactions (source)');
    await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_transactions_occurrence_key
      ON transactions (occurrence_key)
      WHERE occurrence_key IS NOT NULL AND occurrence_key != '' AND deleted_at IS NULL`);

    await db.exec(`CREATE TABLE IF NOT EXISTS account_adjustments (
      id TEXT PRIMARY KEY NOT NULL,
      account_id TEXT NOT NULL,
      amount INTEGER NOT NULL CHECK (amount != 0),
      reason TEXT NOT NULL,
      occurred_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      synced_revision INTEGER NOT NULL DEFAULT 0,
      device_id TEXT NOT NULL DEFAULT '',
      sync_status TEXT NOT NULL DEFAULT 'pending',
      FOREIGN KEY (account_id) REFERENCES accounts(id)
    )`);
    await db.exec('CREATE INDEX IF NOT EXISTS idx_account_adjustments_account_occurred ON account_adjustments (account_id, occurred_at)');

    await db.exec(`CREATE TABLE IF NOT EXISTS transaction_drafts (
      id TEXT PRIMARY KEY NOT NULL,
      source TEXT NOT NULL CHECK (source IN ('manual', 'ai', 'voice', 'image', 'bank_notification', 'sheets', 'imported_statement')),
      source_event_id TEXT,
      fingerprint TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'confirmed', 'rejected', 'duplicate', 'needs_review')),
      proposed_type TEXT CHECK (proposed_type IS NULL OR proposed_type IN ('expense', 'income', 'transfer')),
      amount INTEGER CHECK (amount IS NULL OR amount > 0),
      currency TEXT NOT NULL DEFAULT 'VND' CHECK (currency = 'VND'),
      category_id TEXT,
      account_id TEXT,
      transfer_account_id TEXT,
      description TEXT NOT NULL DEFAULT '',
      occurred_at TEXT,
      confidence REAL CHECK (confidence IS NULL OR (confidence >= 0 AND confidence <= 1)),
      duplicate_of_id TEXT,
      confirmed_transaction_id TEXT,
      raw_payload TEXT,
      detected_at TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      FOREIGN KEY (category_id) REFERENCES categories(id),
      FOREIGN KEY (account_id) REFERENCES accounts(id),
      FOREIGN KEY (transfer_account_id) REFERENCES accounts(id),
      FOREIGN KEY (confirmed_transaction_id) REFERENCES transactions(id)
    )`);
    await db.exec('CREATE INDEX IF NOT EXISTS idx_transaction_drafts_status_detected ON transaction_drafts (status, detected_at DESC)');
    await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_transaction_drafts_source_event
      ON transaction_drafts (source, source_event_id)
      WHERE source_event_id IS NOT NULL AND source_event_id != '' AND deleted_at IS NULL`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_transaction_drafts_fingerprint
      ON transaction_drafts (source, fingerprint, detected_at)
      WHERE fingerprint IS NOT NULL AND fingerprint != '' AND deleted_at IS NULL`);

    await db.exec(`CREATE TABLE IF NOT EXISTS recurring_rules (
      id TEXT PRIMARY KEY NOT NULL,
      type TEXT NOT NULL CHECK (type IN ('expense', 'income', 'transfer')),
      amount INTEGER NOT NULL CHECK (amount > 0),
      category_id TEXT NOT NULL,
      account_id TEXT NOT NULL,
      transfer_account_id TEXT,
      transfer_fee INTEGER NOT NULL DEFAULT 0 CHECK (transfer_fee >= 0),
      description TEXT NOT NULL DEFAULT '',
      start_date TEXT NOT NULL,
      end_date TEXT,
      frequency TEXT NOT NULL CHECK (frequency IN ('daily', 'weekly', 'monthly', 'yearly')),
      recurrence_interval INTEGER NOT NULL DEFAULT 1 CHECK (recurrence_interval > 0),
      mode TEXT NOT NULL CHECK (mode IN ('automatic', 'reminder')),
      timezone TEXT NOT NULL,
      anchor_day INTEGER NOT NULL CHECK (anchor_day >= 1 AND anchor_day <= 31),
      next_occurrence_date TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      synced_revision INTEGER NOT NULL DEFAULT 0,
      device_id TEXT NOT NULL DEFAULT '',
      sync_status TEXT NOT NULL DEFAULT 'pending',
      FOREIGN KEY (category_id) REFERENCES categories(id),
      FOREIGN KEY (account_id) REFERENCES accounts(id),
      FOREIGN KEY (transfer_account_id) REFERENCES accounts(id)
    )`);
    await db.exec('CREATE INDEX IF NOT EXISTS idx_recurring_rules_due ON recurring_rules (enabled, mode, next_occurrence_date)');

    await db.exec(`CREATE TABLE IF NOT EXISTS categorization_rules (
      id TEXT PRIMARY KEY NOT NULL,
      match_kind TEXT NOT NULL CHECK (match_kind IN ('user_defined', 'exact_merchant', 'keyword')),
      pattern TEXT NOT NULL,
      normalized_pattern TEXT NOT NULL,
      category_id TEXT NOT NULL,
      priority INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      deleted_at TEXT,
      revision INTEGER NOT NULL DEFAULT 1,
      synced_revision INTEGER NOT NULL DEFAULT 0,
      device_id TEXT NOT NULL DEFAULT '',
      sync_status TEXT NOT NULL DEFAULT 'pending',
      FOREIGN KEY (category_id) REFERENCES categories(id)
    )`);
    await db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_categorization_rules_pattern
      ON categorization_rules (match_kind, normalized_pattern)
      WHERE deleted_at IS NULL`);
    await db.exec('CREATE INDEX IF NOT EXISTS idx_categorization_rules_priority ON categorization_rules (enabled, priority DESC)');

    await db.exec('ALTER TABLE budgets ADD COLUMN warning_threshold_bps INTEGER NOT NULL DEFAULT 8000');
    await db.exec('ALTER TABLE budgets ADD COLUMN limit_threshold_bps INTEGER NOT NULL DEFAULT 10000');
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_budgets_overall_month
      ON budgets (effective_date)
      WHERE category_id IS NULL AND deleted_at IS NULL`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_budgets_category_month
      ON budgets (category_id, effective_date)
      WHERE category_id IS NOT NULL AND deleted_at IS NULL`);

    await db.run('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)', [4, appliedAt]);
  });
}
