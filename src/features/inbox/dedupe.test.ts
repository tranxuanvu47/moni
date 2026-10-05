import { describe, expect, it } from 'vitest';

import {
  canonicalSourceFingerprint,
  dedupeByFingerprint,
  detectPotentialInternalTransferPair,
} from '@/src/features/inbox/dedupe';

describe('canonical source fingerprints', () => {
  it('scopes a stable event ID by source and namespace', () => {
    const base = {
      source: 'bank_notification' as const,
      sourceNamespace: 'com.bank.app',
      sourceEventId: 'notification-42',
      type: 'expense' as const,
      amount: 125_000,
    };
    expect(canonicalSourceFingerprint({ ...base, rawText: 'Original' })).toBe(
      canonicalSourceFingerprint({ ...base, rawText: 'Updated balance' }),
    );
    expect(canonicalSourceFingerprint(base)).not.toBe(
      canonicalSourceFingerprint({ ...base, sourceNamespace: 'com.other.bank' }),
    );
  });

  it('canonicalizes content fallback without storing raw text in the fingerprint', () => {
    const first = canonicalSourceFingerprint({
      source: 'statement_import',
      sourceNamespace: 'vcb-csv',
      type: 'expense',
      amount: 80_000,
      occurredLocalDate: '2026-10-04',
      merchant: '  Highlands  Coffee ',
      description: 'Thanh  toán tại quầy',
    });
    const second = canonicalSourceFingerprint({
      source: 'statement_import',
      sourceNamespace: 'VCB-CSV',
      type: 'expense',
      amount: 80_000,
      occurredLocalDate: '2026-10-04',
      merchant: 'highlands coffee',
      description: 'THANH TOÁN TẠI QUẦY',
    });
    expect(first).toBe(second);
    expect(first).not.toContain('highlands');
  });

  it('keeps the first item and reports exact duplicates', () => {
    const result = dedupeByFingerprint(
      [
        { id: 'a', fingerprint: 'same' },
        { id: 'b', fingerprint: 'same' },
        { id: 'c', fingerprint: 'different' },
      ],
      (item) => item.fingerprint,
    );
    expect(result.unique.map((item) => item.id)).toEqual(['a', 'c']);
    expect(result.duplicates).toEqual([{ duplicate: { id: 'b', fingerprint: 'same' }, original: { id: 'a', fingerprint: 'same' } }]);
  });
});

describe('potential internal transfer pairing', () => {
  const outgoing = {
    id: 'out',
    type: 'expense' as const,
    amount: 1_000_000,
    currency: 'VND',
    accountId: 'account-a',
    occurredAt: '2026-10-04T10:00:00',
    transferReference: 'FT-123456',
  };
  const incoming = {
    id: 'in',
    type: 'income' as const,
    amount: 1_000_000,
    currency: 'VND',
    accountId: 'account-b',
    occurredAt: '2026-10-04T10:04:00',
    transferReference: 'ft 123456',
  };

  it('suggests review when amount, accounts, time, and a strong reference agree', () => {
    const pair = detectPotentialInternalTransferPair(outgoing, incoming);
    expect(pair).toMatchObject({ outgoingId: 'out', incomingId: 'in', confidence: 'potential' });
    expect(pair?.evidence).toContain('reference_match');
  });

  it('does not infer a transfer from equal amounts and time alone', () => {
    expect(
      detectPotentialInternalTransferPair(
        { ...outgoing, transferReference: null },
        { ...incoming, transferReference: null },
      ),
    ).toBeNull();
  });

  it('rejects same-account and distant pairs', () => {
    expect(detectPotentialInternalTransferPair(outgoing, { ...incoming, accountId: 'account-a' })).toBeNull();
    expect(detectPotentialInternalTransferPair(outgoing, { ...incoming, occurredAt: '2026-10-04T11:00:00' })).toBeNull();
  });
});
