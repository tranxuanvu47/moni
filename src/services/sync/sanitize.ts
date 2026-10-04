const FORMULA_START = /^[=+\-@\t\r]/;

export function neutralizeSpreadsheetText(value: string): string {
  if (FORMULA_START.test(value)) {
    return `'${value}`;
  }
  return value;
}

export function readSpreadsheetText(value: string): { ok: true; text: string } | { ok: false } {
  const trimmedStart = value.trimStart();
  if (FORMULA_START.test(trimmedStart)) {
    return { ok: false };
  }
  if (value.startsWith("'") && FORMULA_START.test(value.slice(1))) {
    return { ok: true, text: value.slice(1) };
  }
  return { ok: true, text: value };
}

export function backoffDelayMs(attempt: number, random: () => number = Math.random): number {
  const exponential = Math.min(60_000, 1_000 * 2 ** Math.min(Math.max(attempt, 0), 16));
  const jitter = Math.floor(random() * 250);
  return Math.min(60_000, exponential + jitter);
}

export async function withBackoff<T>(input: {
  maxAttempts: number;
  sleep: (ms: number) => Promise<void>;
  random?: () => number;
  run: () => Promise<T>;
  shouldRetry: (error: unknown) => boolean;
  delayFor?: (error: unknown, attempt: number) => number;
}): Promise<T> {
  const random = input.random ?? Math.random;
  let lastError: unknown;
  for (let attempt = 0; attempt < input.maxAttempts; attempt += 1) {
    try {
      return await input.run();
    } catch (error) {
      lastError = error;
      const canRetry = attempt < input.maxAttempts - 1 && input.shouldRetry(error);
      if (!canRetry) {
        throw error;
      }
      const delay = input.delayFor?.(error, attempt) ?? backoffDelayMs(attempt, random);
      await input.sleep(delay);
    }
  }
  throw lastError;
}
