type SyncTrigger = () => void;

let trigger: SyncTrigger | null = null;
let timer: ReturnType<typeof setTimeout> | null = null;

const DEBOUNCE_MS = 900;

export function setSyncTrigger(next: SyncTrigger | null): void {
  trigger = next;
}

/** Gọi sau khi có thay đổi local — đồng bộ nền khi đã gắn Firebase và có mạng. */
export function requestSyncSoon(): void {
  if (!trigger) {
    return;
  }
  if (timer) {
    clearTimeout(timer);
  }
  timer = setTimeout(() => {
    timer = null;
    trigger?.();
  }, DEBOUNCE_MS);
}
