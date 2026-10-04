import { describe, expect, it } from 'vitest';

import { describeAiError, permissionDeniedMessage } from '@/src/services/ai/errors';
import { createSubmitGuard } from '@/src/utils/submit-guard';
import { parseCsv, toCsv } from '@/src/services/export/csv';

describe('lỗi và quyền', () => {
  it('hết giờ chờ có câu tiếng Việt', () => {
    const error = new Error('aborted');
    error.name = 'AbortError';
    expect(describeAiError(error)).toContain('Hết thời gian');
    expect(permissionDeniedMessage('microphone')).toContain('micro');
  });
});

describe('chống lưu trùng', () => {
  it('bỏ lần bấm thứ hai khi lần trước chưa xong', async () => {
    const guard = createSubmitGuard();
    let running = 0;
    const first = guard.run(async () => {
      running += 1;
      await new Promise((resolve) => setTimeout(resolve, 20));
      running -= 1;
      return 'saved';
    });
    const second = await guard.run(async () => 'again');
    expect(second).toBeUndefined();
    expect(await first).toBe('saved');
    expect(running).toBe(0);
  });
});

describe('CSV', () => {
  it('xuất và đọc lại mô tả có dấu phẩy', () => {
    const csv = toCsv([
      {
        id: 'a1',
        type: 'expense',
        amount: 35000,
        currency: 'VND',
        categoryName: 'Ăn uống',
        description: 'Phở, bò',
        occurredAt: '2026-10-03T08:00:00',
      },
    ]);
    const rows = parseCsv(csv);
    expect(rows[0]?.description).toBe('Phở, bò');
    expect(rows[0]?.amount).toBe(35000);
  });
});
