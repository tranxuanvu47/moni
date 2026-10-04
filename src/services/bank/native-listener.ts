import { Platform } from 'react-native';

import type { BankNotificationLike } from '@/src/features/bank/parse-notification';

export interface NativeBankListener {
  isNotificationPermissionGranted(): boolean;
  openNotificationListenerSettings(): void;
  setAllowedPackages(packages: string[]): void;
  addListener(event: 'onNotificationReceived', listener: (event: BankNotificationLike) => void): { remove: () => void };
}

export function getNativeBankListener(): NativeBankListener | null {
  if (Platform.OS !== 'android') {
    return null;
  }
  try {
    const mod = require('expo-android-notification-listener-service') as { default?: NativeBankListener };
    return mod.default ?? null;
  } catch {
    return null;
  }
}

export function bankListenerAvailability(): { ready: boolean; reason: string | null } {
  if (Platform.OS !== 'android') {
    return { ready: false, reason: 'Đọc thông báo ngân hàng chỉ hỗ trợ Android.' };
  }
  if (!getNativeBankListener()) {
    return {
      ready: false,
      reason: 'Cần bản cài development/production build. Expo Go không có module đọc thông báo hệ thống.',
    };
  }
  return { ready: true, reason: null };
}
