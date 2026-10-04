import { describe, expect, it } from 'vitest';

import { HEADERS, SHEET_NAMES } from '@/src/services/sync/constants';
import { createGoogleSheetsProvider } from '@/src/services/sync/google/sheets';

describe('Google Sheets client', () => {
  it('ghi RAW, thử lại khi bị giới hạn, và không thêm dòng mới cho cùng id', async () => {
    const delays: number[] = [];
    const ranges: string[] = [];
    let writes = 0;
    const fetchImpl: typeof fetch = async (input, init) => {
      const url = String(input);
      if (url.includes('values:batchGet')) {
        return Response.json({ valueRanges: [{ values: [] }] });
      }
      if (url.includes('values:batchUpdate')) {
        writes += 1;
        const body = JSON.parse(String(init?.body)) as { valueInputOption: string; data: Array<{ range: string; values: string[][] }> };
        expect(body.valueInputOption).toBe('RAW');
        expect(init?.headers).toMatchObject({ Authorization: 'Bearer token' });
        ranges.push(...body.data.map((item) => item.range));
        if (writes === 1) {
          return new Response(JSON.stringify({ error: { message: 'Quota exceeded' } }), {
            status: 429,
            headers: { 'retry-after': '2' },
          });
        }
        expect(body.data[0]?.values[0]?.[5]).toBe('=HYPERLINK("http://evil")');
        return Response.json({});
      }
      return new Response('missing', { status: 404 });
    };

    const provider = createGoogleSheetsProvider({
      fetch: fetchImpl,
      getAccessToken: async () => 'token',
      sleep: async (ms) => {
        delays.push(ms);
      },
      random: () => 0,
      account: {
        getAccount: async () => ({ email: 'me@gmail.com' }),
        connect: async () => ({ email: 'me@gmail.com' }),
        disconnect: async () => undefined,
      },
    });

    const values = [...HEADERS[SHEET_NAMES.transactions]];
    values[0] = 'tx_1';
    values[5] = '=HYPERLINK("http://evil")';
    await provider.upsertRows('sheet-1', SHEET_NAMES.transactions, HEADERS[SHEET_NAMES.transactions], [{ id: 'tx_1', values }]);
    await provider.upsertRows('sheet-1', SHEET_NAMES.transactions, HEADERS[SHEET_NAMES.transactions], [{ id: 'tx_1', values }]);

    expect(delays).toContain(2000);
    expect(ranges.every((range) => range.includes('A2:'))).toBe(true);
    expect(ranges.some((range) => range.includes('A3:'))).toBe(false);
  });
});
