import { AppState } from 'react-native';

import { getDatabase } from '@/src/database/expo-client';
import { getPreference, preferenceKeys } from '@/src/database/repositories/preferences';
import { BANK_NOTIFICATION_PACKAGES } from '@/src/features/bank/packages';
import { ingestBankNotification } from '@/src/services/bank/ingest';
import { bankListenerAvailability, getNativeBankListener } from '@/src/services/bank/native-listener';
import { useDataStore } from '@/src/store/app-store';

let started = false;
let subscription: { remove: () => void } | null = null;

export function startBankNotificationRuntime(): () => void {
  if (started) {
    return () => undefined;
  }
  started = true;

  const availability = bankListenerAvailability();
  if (!availability.ready) {
    return () => {
      started = false;
    };
  }

  const native = getNativeBankListener();
  if (!native) {
    return () => {
      started = false;
    };
  }

  native.setAllowedPackages([...BANK_NOTIFICATION_PACKAGES]);
  subscription = native.addListener('onNotificationReceived', (event) => {
    void handleNotification(event).catch(() => undefined);
  });

  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      native.setAllowedPackages([...BANK_NOTIFICATION_PACKAGES]);
    }
  });

  return () => {
    started = false;
    subscription?.remove();
    subscription = null;
    appState.remove();
  };
}

export async function isBankNotificationCaptureEnabled(): Promise<boolean> {
  const db = getDatabase();
  return (await getPreference(db, preferenceKeys.bankNotificationsEnabled)) === '1';
}

async function handleNotification(event: Parameters<typeof ingestBankNotification>[1]): Promise<void> {
  if (!(await isBankNotificationCaptureEnabled())) {
    return;
  }
  const native = getNativeBankListener();
  if (!native?.isNotificationPermissionGranted()) {
    return;
  }
  const result = await ingestBankNotification(getDatabase(), event);
  if (result.outcome === 'saved') {
    useDataStore.getState().bump();
  }
}
