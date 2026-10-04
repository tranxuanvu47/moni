import { describe, expect, it } from 'vitest';

import { parseBankNotification } from '@/src/features/bank/parse-notification';

describe('parseBankNotification', () => {
  it('đọc thông báo chi tiêu Vietcombank', () => {
    const parsed = parseBankNotification({
      packageName: 'com.VCB',
      title: 'Vietcombank',
      text: 'TK *1234 -50.000 VND luc 10:02. So du 1.200.000 VND. GD tai Circo.',
      postTime: 1_700_000_000_000,
      key: '0|com.VCB|1',
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe('expense');
    expect(parsed?.amount).toBe(50000);
    expect(parsed?.fingerprint).toMatch(/^bn_/);
  });

  it('đọc thông báo nhận tiền MoMo', () => {
    const parsed = parseBankNotification({
      packageName: 'com.mservice.momotransfer',
      text: 'Bạn vừa nhận +100.000đ từ Anh A. Số dư ví 500.000đ',
      postTime: 1_700_000_000_100,
      key: 'momo-1',
    });
    expect(parsed?.type).toBe('income');
    expect(parsed?.amount).toBe(100000);
    expect(parsed?.categoryId).toBe('cat_income');
  });

  it('đọc TPBank chuyển đi theo PS âm — lưu là chi tiêu, không phải chuyển', () => {
    const parsed = parseBankNotification({
      packageName: 'com.tpb.mb.gprsandroid',
      title: '(TPBank)',
      text: '(TPBank): 04/10/26;12:15 TK: xxxx2384798 PS: -1.000.000 SD: 5.200.000 SD KHA DUNG: 5.200.000 ND: TRAN XUAN VU chuyen tien SO GD: 664CTMB262780963 (Them chi tiet trong app)',
      bigText:
        '(TPBank): 04/10/26;12:15 TK: xxxx2384798 PS: -1.000.000 SD: 5.200.000 SD KHA DUNG: 5.200.000 ND: TRAN XUAN VU chuyen tien mua do SO GD: 664CTMB262780963 (Them chi tiet trong app)',
      postTime: 1_700_000_000_200,
      key: 'tpb-1',
    });
    expect(parsed?.type).toBe('expense');
    expect(parsed?.amount).toBe(1_000_000);
    expect(parsed?.description).toContain('1.000.000');
    expect(parsed?.description).toContain('TRAN XUAN VU');
    expect(parsed?.description.length).toBeLessThanOrEqual(400);
  });

  it('đọc TPBank nhận tiền theo PS dương — lưu là thu nhập', () => {
    const parsed = parseBankNotification({
      packageName: 'com.tpb.mb.gprsandroid',
      text: '(TPBank): 04/10/26;09:01 TK: xxxx2384798 PS: +2.500.000 SD: 7.700.000 SD KHA DUNG: 7.700.000 ND: LUONG THANG 9 SO GD: 123CTMB999',
      postTime: 1_700_000_000_300,
      key: 'tpb-2',
    });
    expect(parsed?.type).toBe('income');
    expect(parsed?.amount).toBe(2_500_000);
    expect(parsed?.description).toContain('LUONG THANG 9');
  });

  it('không lấy nhầm số dư hoặc mã giao dịch làm số tiền', () => {
    const parsed = parseBankNotification({
      packageName: 'com.tpb.mb.gprsandroid',
      text: '(TPBank): TK: xxxx2384798 PS: -150.000 SD: 9.999.999 ND: cafe SO GD: 664CTMB262780963',
      key: 'tpb-3',
    });
    expect(parsed?.amount).toBe(150_000);
    expect(parsed?.type).toBe('expense');
  });

  it('bỏ qua OTP', () => {
    expect(
      parseBankNotification({
        packageName: 'com.VCB',
        text: 'Ma OTP 123456 de dang nhap. Khong chia se OTP.',
      }),
    ).toBeNull();
  });
});
