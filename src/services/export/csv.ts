export interface CsvTransaction {
  id: string;
  type: 'expense' | 'income' | 'transfer';
  amount: number;
  currency: 'VND';
  categoryName: string;
  description: string;
  occurredAt: string;
}

const HEADER = ['id', 'type', 'amount', 'currency', 'category', 'description', 'occurred_at'];

export function toCsv(rows: CsvTransaction[]): string {
  const lines = [HEADER.join(',')];
  for (const row of rows) {
    lines.push(
      [
        row.id,
        row.type,
        String(row.amount),
        row.currency,
        row.categoryName,
        row.description,
        row.occurredAt,
      ]
        .map(escapeCell)
        .join(','),
    );
  }
  return `\uFEFF${lines.join('\n')}`;
}

export function parseCsv(source: string): CsvTransaction[] {
  const text = source.replace(/^\uFEFF/, '').trim();
  if (!text) {
    return [];
  }
  const table = parseTable(text);
  const [header, ...body] = table;
  if (!header) {
    return [];
  }
  const index = new Map(header.map((name, position) => [name.trim(), position]));
  return body
    .filter((row) => row.some((cell) => cell.trim()))
    .map((row): CsvTransaction => {
      const rawType = cell(row, index, 'type');
      const type = rawType === 'income' ? 'income' : rawType === 'transfer' ? 'transfer' : 'expense';
      const amount = Number(cell(row, index, 'amount'));
      return {
        id: cell(row, index, 'id'),
        type,
        amount: Number.isInteger(amount) ? amount : 0,
        currency: 'VND' as const,
        categoryName: cell(row, index, 'category'),
        description: cell(row, index, 'description'),
        occurredAt: cell(row, index, 'occurred_at'),
      };
    })
    .filter((row) => row.id && row.amount > 0 && row.occurredAt);
}

function escapeCell(value: string): string {
  if (/[",\n]/.test(value)) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function cell(row: string[], index: Map<string, number>, name: string): string {
  const position = index.get(name);
  if (position == null) {
    return '';
  }
  return row[position] ?? '';
}

function parseTable(source: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let value = '';
  let quoted = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];
    if (quoted && char === '"' && next === '"') {
      value += '"';
      index += 1;
      continue;
    }
    if (char === '"') {
      quoted = !quoted;
      continue;
    }
    if (!quoted && char === ',') {
      row.push(value);
      value = '';
      continue;
    }
    if (!quoted && (char === '\n' || char === '\r')) {
      if (char === '\r' && next === '\n') {
        index += 1;
      }
      row.push(value);
      rows.push(row);
      row = [];
      value = '';
      continue;
    }
    value += char ?? '';
  }

  if (value.length > 0 || row.length > 0) {
    row.push(value);
    rows.push(row);
  }
  return rows;
}
