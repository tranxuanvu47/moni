import { afterEach, describe, expect, it } from 'vitest';

import { createUuid } from '@/src/utils/id';

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

describe('createUuid', () => {
  const original = globalThis.crypto;

  afterEach(() => {
    Object.defineProperty(globalThis, 'crypto', { value: original, configurable: true });
  });

  it('tạo uuid khi máy không có Web Crypto', () => {
    Object.defineProperty(globalThis, 'crypto', { value: undefined, configurable: true });
    expect(createUuid()).toMatch(uuidPattern);
  });
});
