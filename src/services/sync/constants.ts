export const WORKBOOK_TITLE = 'Mono Finance Data';

export const SCHEMA_VERSION = '1';

export const CLOUD_SCHEMA_VERSION = 1;

export const CLOUD_PAGE_SIZE = 40;

export const CLOUD_MAX_PAGES = 8;

export const TRANSACTION_SOURCES = ['manual', 'ai', 'voice', 'image', 'bank_notification', 'sheets'] as const;

export type TransactionSource = (typeof TRANSACTION_SOURCES)[number];

export const SHEET_NAMES = {
  transactions: 'Transactions',
  categories: 'Categories',
  accounts: 'Accounts',
  budgets: 'Budgets',
  settings: 'Settings',
  metadata: 'SyncMetadata',
} as const;

export type SyncEntityName = 'transactions' | 'categories' | 'accounts' | 'budgets' | 'settings';

export type DataSheetName = (typeof SHEET_NAMES)[keyof typeof SHEET_NAMES];

export const ENTITY_SHEETS: Record<SyncEntityName, DataSheetName> = {
  transactions: SHEET_NAMES.transactions,
  categories: SHEET_NAMES.categories,
  accounts: SHEET_NAMES.accounts,
  budgets: SHEET_NAMES.budgets,
  settings: SHEET_NAMES.settings,
};

export const HEADERS = {
  [SHEET_NAMES.transactions]: [
    'id',
    'type',
    'amount',
    'currency',
    'category_id',
    'description',
    'occurred_at',
    'created_at',
    'updated_at',
    'deleted_at',
    'revision',
    'device_id',
    'source',
    'fingerprint',
    'account_id',
    'transfer_account_id',
    'transfer_fee',
    'recurring_rule_id',
    'occurrence_key',
  ],
  [SHEET_NAMES.categories]: [
    'id',
    'name',
    'icon',
    'color',
    'type',
    'is_default',
    'sort_order',
    'created_at',
    'updated_at',
    'deleted_at',
    'revision',
    'device_id',
  ],
  [SHEET_NAMES.accounts]: [
    'id',
    'name',
    'type',
    'bank_code',
    'masked_identifier',
    'currency',
    'opening_balance',
    'opening_balance_date',
    'archived_at',
    'display_order',
    'created_at',
    'updated_at',
    'deleted_at',
    'revision',
    'device_id',
  ],
  [SHEET_NAMES.budgets]: [
    'id',
    'category_id',
    'amount',
    'period',
    'effective_date',
    'created_at',
    'updated_at',
    'deleted_at',
    'revision',
    'device_id',
    'warning_threshold_bps',
    'limit_threshold_bps',
  ],
  [SHEET_NAMES.settings]: ['id', 'value', 'updated_at', 'deleted_at', 'revision', 'device_id'],
  [SHEET_NAMES.metadata]: ['key', 'value'],
} as const;

export const BUSINESS_FIELDS: Record<SyncEntityName, readonly string[]> = {
  transactions: [
    'type',
    'amount',
    'currency',
    'category_id',
    'description',
    'occurred_at',
    'created_at',
    'deleted_at',
    'source',
    'fingerprint',
    'account_id',
    'transfer_account_id',
    'transfer_fee',
    'recurring_rule_id',
    'occurrence_key',
  ],
  categories: ['name', 'icon', 'color', 'type', 'is_default', 'sort_order', 'created_at', 'deleted_at'],
  accounts: [
    'name',
    'type',
    'bank_code',
    'masked_identifier',
    'currency',
    'opening_balance',
    'opening_balance_date',
    'archived_at',
    'display_order',
    'created_at',
    'deleted_at',
  ],
  budgets: [
    'category_id',
    'amount',
    'period',
    'effective_date',
    'created_at',
    'deleted_at',
    'warning_threshold_bps',
    'limit_threshold_bps',
  ],
  settings: ['value', 'deleted_at'],
};

export const SYNCED_PREFERENCE_KEYS = [
  'reminder_enabled',
  'reminder_hour',
  'reminder_minute',
  'weekly_recap_enabled',
  'budget_alert_enabled',
] as const;

export type SyncedPreferenceKey = (typeof SYNCED_PREFERENCE_KEYS)[number];

export const metaKeys = {
  deviceId: 'sync_device_id',
  spreadsheetId: 'sync_spreadsheet_id',
  email: 'sync_account_email',
  lastSuccess: 'sync_last_success_at',
  lastError: 'sync_last_error',
  lastWarning: 'sync_last_warning',
  enabled: 'sync_enabled',
  nextAttempt: 'sync_next_attempt_at',
  failCount: 'sync_fail_count',
  linkedUid: 'sync_linked_uid',
  cursorTransactions: 'sync_fs_cursor_transactions',
  cursorCategories: 'sync_fs_cursor_categories',
  cursorAccounts: 'sync_fs_cursor_accounts',
  cursorBudgets: 'sync_fs_cursor_budgets',
  cursorSettings: 'sync_fs_cursor_settings',
} as const;

export const CURSOR_KEYS: Record<SyncEntityName, (typeof metaKeys)[keyof typeof metaKeys]> = {
  transactions: metaKeys.cursorTransactions,
  categories: metaKeys.cursorCategories,
  accounts: metaKeys.cursorAccounts,
  budgets: metaKeys.cursorBudgets,
  settings: metaKeys.cursorSettings,
};

export const GOOGLE_SCOPES = ['openid', 'email', 'https://www.googleapis.com/auth/drive.file'] as const;

export const MAX_OUTBOX_ATTEMPTS = 8;
