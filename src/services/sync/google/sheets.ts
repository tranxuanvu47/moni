import type { DataSheetName } from '@/src/services/sync/constants';
import { HEADERS, SHEET_NAMES } from '@/src/services/sync/constants';
import { backoffDelayMs, withBackoff } from '@/src/services/sync/sanitize';
import { isRetryableSyncError, SyncHttpError, type SheetRowUpdate, type SheetSnapshot, type SyncAccount, type SyncProvider } from '@/src/services/sync/types';

const SHEET_ORDER: DataSheetName[] = [
  SHEET_NAMES.transactions,
  SHEET_NAMES.categories,
  SHEET_NAMES.budgets,
  SHEET_NAMES.settings,
  SHEET_NAMES.metadata,
];

const WRITE_CHUNK = 100;

interface SheetCache {
  nextRow: number;
  ids: Map<string, number[]>;
}

export interface GoogleSheetsClient {
  fetch: typeof fetch;
  getAccessToken: () => Promise<string>;
  sleep?: (ms: number) => Promise<void>;
  random?: () => number;
  account: {
    getAccount: () => Promise<SyncAccount | null>;
    connect: () => Promise<SyncAccount>;
    disconnect: () => Promise<void>;
  };
}

export function createGoogleSheetsProvider(client: GoogleSheetsClient): SyncProvider {
  const cache = new Map<string, SheetCache>();
  const sleep = client.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms)));
  const random = client.random ?? Math.random;

  return {
    id: 'google-sheets',
    getAccount: () => client.account.getAccount(),
    connect: () => client.account.connect(),
    disconnect: () => client.account.disconnect(),
    async ensureWorkbook(title: string): Promise<{ spreadsheetId: string }> {
      const existing = await findSpreadsheet(client, title, sleep, random);
      const spreadsheetId = existing ?? (await createSpreadsheet(client, title, sleep, random));
      await ensureTabs(client, spreadsheetId, sleep, random);
      await ensureHeaders(client, spreadsheetId, sleep, random);
      return { spreadsheetId };
    },
    async readSheets(spreadsheetId: string): Promise<Partial<Record<DataSheetName, SheetSnapshot>>> {
      const ranges = SHEET_ORDER.map((sheet) => fullRange(sheet));
      const grids = await batchGet(client, spreadsheetId, ranges, sleep, random);
      const snapshots: Partial<Record<DataSheetName, SheetSnapshot>> = {};
      SHEET_ORDER.forEach((sheet, index) => {
        const grid = grids[index] ?? [];
        const expected = [...HEADERS[sheet]];
        const header = grid[0] ?? [];
        const rows = header.length > 0 ? grid.slice(1) : [];
        snapshots[sheet] = { header: header.length > 0 ? header : expected, rows };
        cache.set(cacheKey(spreadsheetId, sheet), indexGrid(header.length > 0 ? grid : [expected]));
      });
      return snapshots;
    },
    async upsertRows(spreadsheetId: string, sheet: DataSheetName, header: readonly string[], rows: SheetRowUpdate[]): Promise<void> {
      if (rows.length === 0) {
        return;
      }
      let sheetCache = cache.get(cacheKey(spreadsheetId, sheet));
      if (!sheetCache) {
        const grids = await batchGet(client, spreadsheetId, [fullRange(sheet)], sleep, random);
        sheetCache = indexGrid(grids[0] ?? [Array.from(header)]);
        cache.set(cacheKey(spreadsheetId, sheet), sheetCache);
      }
      const data: Array<{ range: string; values: string[][] }> = [];
      for (const row of rows) {
        const targets = sheetCache.ids.get(row.id) ?? [];
        if (targets.length === 0) {
          const rowNumber = sheetCache.nextRow;
          sheetCache.nextRow += 1;
          sheetCache.ids.set(row.id, [rowNumber]);
          data.push({ range: rowRange(sheet, rowNumber, header.length), values: [row.values] });
          continue;
        }
        for (const rowNumber of targets) {
          data.push({ range: rowRange(sheet, rowNumber, header.length), values: [row.values] });
        }
      }
      for (let offset = 0; offset < data.length; offset += WRITE_CHUNK) {
        if (offset > 0) {
          await sleep(1100);
        }
        await sheetsPost(client, `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, sleep, random, {
          valueInputOption: 'RAW',
          data: data.slice(offset, offset + WRITE_CHUNK),
        });
      }
    },
  };
}

async function findSpreadsheet(client: GoogleSheetsClient, title: string, sleep: (ms: number) => Promise<void>, random: () => number): Promise<string | null> {
  const query = `name = '${title.replaceAll("'", "\\'")}' and mimeType = 'application/vnd.google-apps.spreadsheet' and trashed = false`;
  const params = new URLSearchParams({
    q: query,
    fields: 'files(id,name)',
    orderBy: 'modifiedTime desc',
    pageSize: '1',
    spaces: 'drive',
  });
  const body = await sheetsGet<{ files?: Array<{ id: string }> }>(
    client,
    `https://www.googleapis.com/drive/v3/files?${params.toString()}`,
    sleep,
    random,
  );
  return body.files?.[0]?.id ?? null;
}

async function createSpreadsheet(client: GoogleSheetsClient, title: string, sleep: (ms: number) => Promise<void>, random: () => number): Promise<string> {
  const created = await sheetsPost<{ id: string }>(client, 'https://www.googleapis.com/drive/v3/files', sleep, random, {
    name: title,
    mimeType: 'application/vnd.google-apps.spreadsheet',
  });
  if (!created.id) {
    throw new Error('Google Drive không trả về spreadsheet.');
  }
  return created.id;
}

async function ensureTabs(client: GoogleSheetsClient, spreadsheetId: string, sleep: (ms: number) => Promise<void>, random: () => number): Promise<void> {
  const meta = await sheetsGet<{ sheets?: Array<{ properties?: { sheetId?: number; title?: string } }> }>(
    client,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}?fields=sheets.properties`,
    sleep,
    random,
  );
  const titles = new Set((meta.sheets ?? []).map((sheet) => sheet.properties?.title).filter((title): title is string => Boolean(title)));
  const requests: object[] = [];
  if (!titles.has(SHEET_NAMES.transactions)) {
    const first = meta.sheets?.[0]?.properties;
    if (first?.sheetId !== undefined && first.title === 'Sheet1') {
      requests.push({
        updateSheetProperties: {
          properties: { sheetId: first.sheetId, title: SHEET_NAMES.transactions },
          fields: 'title',
        },
      });
      titles.add(SHEET_NAMES.transactions);
    }
  }
  for (const title of SHEET_ORDER) {
    if (!titles.has(title)) {
      requests.push({ addSheet: { properties: { title } } });
    }
  }
  if (requests.length === 0) {
    return;
  }
  await sheetsPost(client, `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, sleep, random, { requests });
}

async function ensureHeaders(client: GoogleSheetsClient, spreadsheetId: string, sleep: (ms: number) => Promise<void>, random: () => number): Promise<void> {
  const ranges = SHEET_ORDER.map((sheet) => headerRange(sheet));
  const grids = await batchGet(client, spreadsheetId, ranges, sleep, random);
  const writes: Array<{ range: string; values: string[][] }> = [];
  SHEET_ORDER.forEach((sheet, index) => {
    const header = grids[index]?.[0] ?? [];
    const expected = [...HEADERS[sheet]];
    if (header.length === 0) {
      writes.push({ range: headerRange(sheet), values: [expected] });
      return;
    }
    const matches = expected.every((column, columnIndex) => header[columnIndex] === column);
    if (!matches) {
      throw new Error('Cột trên Google Sheets không khớp. Giữ nguyên hàng tiêu đề của Mono Finance Data.');
    }
  });
  if (writes.length === 0) {
    return;
  }
  await sheetsPost(client, `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchUpdate`, sleep, random, {
    valueInputOption: 'RAW',
    data: writes,
  });
}

async function batchGet(client: GoogleSheetsClient, spreadsheetId: string, ranges: string[], sleep: (ms: number) => Promise<void>, random: () => number): Promise<string[][][]> {
  const params = new URLSearchParams();
  params.set('valueRenderOption', 'FORMULA');
  params.set('majorDimension', 'ROWS');
  ranges.forEach((range) => params.append('ranges', range));
  const body = await sheetsGet<{ valueRanges?: Array<{ values?: string[][] }> }>(
    client,
    `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values:batchGet?${params.toString()}`,
    sleep,
    random,
  );
  return (body.valueRanges ?? []).map((range) => (range.values ?? []).map((row) => row.map((cell) => String(cell ?? ''))));
}

async function sheetsGet<T>(client: GoogleSheetsClient, url: string, sleep: (ms: number) => Promise<void>, random: () => number): Promise<T> {
  const response = await request(client, url, { method: 'GET' }, sleep, random);
  return (await response.json()) as T;
}

async function sheetsPost<T>(client: GoogleSheetsClient, url: string, sleep: (ms: number) => Promise<void>, random: () => number, body: unknown): Promise<T> {
  const response = await request(client, url, { method: 'POST', body: JSON.stringify(body) }, sleep, random);
  return (await response.json()) as T;
}

async function request(
  client: GoogleSheetsClient,
  url: string,
  init: RequestInit,
  sleep: (ms: number) => Promise<void>,
  random: () => number,
): Promise<Response> {
  const token = await client.getAccessToken();
  return withBackoff({
    maxAttempts: 5,
    sleep,
    random,
    shouldRetry: isRetryableSyncError,
    delayFor: (error, attempt) => {
      if (error instanceof SyncHttpError && error.retryAfterMs && error.retryAfterMs > 0) {
        return Math.min(error.retryAfterMs, 60_000);
      }
      return backoffDelayMs(attempt, random);
    },
    run: async () => {
      const response = await client.fetch(url, {
        ...init,
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        throw new SyncHttpError(await safeError(response), response.status, retryAfterMs(response));
      }
      return response;
    },
  });
}

function indexGrid(grid: string[][]): SheetCache {
  const ids = new Map<string, number[]>();
  for (let index = 1; index < grid.length; index += 1) {
    const id = grid[index]?.[0] ?? '';
    if (!id) {
      continue;
    }
    const rowNumber = index + 1;
    const current = ids.get(id) ?? [];
    current.push(rowNumber);
    ids.set(id, current);
  }
  return { nextRow: Math.max(grid.length, 1) + 1, ids };
}

function cacheKey(spreadsheetId: string, sheet: string): string {
  return `${spreadsheetId}:${sheet}`;
}

function fullRange(sheet: DataSheetName): string {
  return `${quoteSheet(sheet)}!A:${columnName(HEADERS[sheet].length)}`;
}

function headerRange(sheet: DataSheetName): string {
  return rowRange(sheet, 1, HEADERS[sheet].length);
}

function rowRange(sheet: string, row: number, columns: number): string {
  return `${quoteSheet(sheet)}!A${row}:${columnName(columns)}${row}`;
}

function quoteSheet(sheet: string): string {
  return `'${sheet.replaceAll("'", "''")}'`;
}

function columnName(count: number): string {
  let value = count;
  let name = '';
  while (value > 0) {
    const remainder = (value - 1) % 26;
    name = String.fromCharCode(65 + remainder) + name;
    value = Math.floor((value - 1) / 26);
  }
  return name;
}

function retryAfterMs(response: Response): number | null {
  const header = response.headers.get('retry-after');
  if (!header) {
    return null;
  }
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : null;
}

async function safeError(response: Response): Promise<string> {
  if (response.status === 429) {
    return 'Google Sheets đang giới hạn lượt gọi. Thử lại sau ít phút.';
  }
  if (response.status === 401) {
    return 'Phiên Google đã hết hạn. Hãy kết nối lại.';
  }
  try {
    const body = (await response.json()) as { error?: { message?: string } };
    const message = body.error?.message ?? '';
    if (message && message.length < 180 && !/token|bearer|authorization/i.test(message)) {
      return message;
    }
  } catch {
    return `Google Sheets trả lỗi ${response.status}.`;
  }
  return `Google Sheets trả lỗi ${response.status}.`;
}
