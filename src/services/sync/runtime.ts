import { AppState } from 'react-native';
import * as Network from 'expo-network';

import { getDatabase } from '@/src/database/expo-client';
import { connectGoogleAccount, disconnectGoogleAccount, googleAccessToken, googleAccount, googleAuthAvailability } from '@/src/services/sync/google/oauth';
import { createGoogleSheetsProvider } from '@/src/services/sync/google/sheets';
import { metaKeys, WORKBOOK_TITLE } from '@/src/services/sync/constants';
import { runSyncCycle, readSyncStatus } from '@/src/services/sync/engine';
import {
  clearRememberedPassword,
  rememberEmailOnly,
  saveRememberedCredentials,
  setRememberEnabled,
} from '@/src/services/auth/credentials';
import {
  currentFirebaseAccount,
  describeAuthError,
  firebaseWebClientId,
  registerWithEmail,
  signInWithEmail,
  signInWithGoogle,
  signOutFirebase,
} from '@/src/services/sync/firebase/auth';
import { countLocalFinance, decideAccountLink, type LinkAction } from '@/src/services/sync/link';
import { listConflicts } from '@/src/services/sync/local-store';
import { setMetaPreference } from '@/src/services/sync/meta';
import { setSyncTrigger } from '@/src/services/sync/schedule';
import { importSheetSnapshots, type SheetImportReport } from '@/src/services/sync/sheets-import';
import type { CloudAccount, CloudStore, StoredConflict, SyncCycleResult } from '@/src/services/sync/types';
import { toLocalDateTime } from '@/src/utils/dates';

let syncing = false;
let syncGeneration = 0;
const SYNC_TIMEOUT_MS = 45_000;
const PROFILE_TIMEOUT_MS = 15_000;

export interface SyncSession {
  nativeReady: boolean;
  nativeReason: string | null;
  googleSignInReady: boolean;
  googleSignInReason: string | null;
  sheetsReady: boolean;
  sheetsReason: string | null;
  account: CloudAccount | null;
  email: string | null;
  enabled: boolean;
  linkedUid: string | null;
  link: LinkAction | 'signed_out';
  localTransactions: number;
  lastSuccessAt: string | null;
  lastError: string | null;
  lastWarning: string | null;
  pendingTransactions: number;
  conflicts: StoredConflict[];
}

export function startSyncRuntime(): () => void {
  setSyncTrigger(() => {
    void syncNow(false);
  });
  const appState = AppState.addEventListener('change', (state) => {
    if (state === 'active') {
      void syncNow(false);
    }
  });
  const network = Network.addNetworkStateListener((state) => {
    if (state.isConnected && state.isInternetReachable !== false) {
      void syncNow(false);
    }
  });
  void syncNow(false);
  return () => {
    setSyncTrigger(null);
    appState.remove();
    network.remove();
  };
}

export async function readSyncSession(): Promise<SyncSession> {
  const db = getDatabase();
  const [status, conflicts, counts] = await Promise.all([readSyncStatus(db), listConflicts(db), countLocalFinance(db)]);
  const sheets = googleAuthAvailability();
  const webClientId = firebaseWebClientId();
  let account: CloudAccount | null = null;
  let nativeReady = true;
  let nativeReason: string | null = null;
  try {
    account = await currentFirebaseAccount();
  } catch (error) {
    nativeReady = false;
    nativeReason = describeAuthError(error);
  }
  const link = account ? decideAccountLink(status.linkedUid, account.uid, counts) : 'signed_out';
  return {
    nativeReady,
    nativeReason,
    googleSignInReady: Boolean(webClientId),
    googleSignInReason: webClientId
      ? null
      : 'Đăng nhập Google chưa sẵn sàng trên bản này. Bạn vẫn có thể dùng email.',
    sheetsReady: sheets.ok,
    sheetsReason: sheets.ok ? null : sheets.reason,
    account,
    email: account?.email ?? status.email,
    enabled: status.enabled,
    linkedUid: status.linkedUid,
    link,
    localTransactions: counts.transactions,
    lastSuccessAt: status.lastSuccessAt,
    lastError: status.lastError,
    lastWarning: status.lastWarning,
    pendingTransactions: status.pendingTransactions,
    conflicts,
  };
}

export async function syncNow(force = false): Promise<SyncCycleResult> {
  if (syncing) {
    return { outcome: 'waiting', pending: 0, nextAttemptAt: '' };
  }
  syncing = true;
  const generation = ++syncGeneration;
  try {
    const store = await openStore();
    return await withTimeout(
      runSyncCycle({
        db: getDatabase(),
        store,
        online: await isOnline(),
        now: toLocalDateTime(new Date()),
        force,
      }),
      SYNC_TIMEOUT_MS,
      'Đồng bộ quá lâu. Kiểm tra mạng rồi bấm Đồng bộ ngay lại.',
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : describeAuthError(error);
    if (message.includes('quá lâu')) {
      await setMetaPreference(getDatabase(), metaKeys.lastError, message).catch(() => undefined);
    }
    return { outcome: 'error', message: describeAuthError(error), pending: 0 };
  } finally {
    if (generation === syncGeneration) {
      syncing = false;
    }
  }
}

export interface AuthSignInOptions {
  remember?: boolean;
}

export async function signInFirebaseGoogle(): Promise<LinkAction> {
  return finishSignIn(() => signInWithGoogle());
}

export async function signInFirebaseEmail(
  email: string,
  password: string,
  options: AuthSignInOptions = {},
): Promise<LinkAction> {
  const result = await finishSignIn(() => signInWithEmail(email, password));
  await persistCredentials(email, password, options.remember === true);
  return result;
}

export async function registerFirebaseEmail(
  email: string,
  password: string,
  options: AuthSignInOptions = {},
): Promise<LinkAction> {
  const result = await finishSignIn(() => registerWithEmail(email, password));
  await persistCredentials(email, password, options.remember === true);
  return result;
}

export async function finishEmailRestore(email: string, password: string): Promise<LinkAction> {
  return finishSignIn(() => signInWithEmail(email, password));
}

export async function confirmFirebaseLink(): Promise<void> {
  const account = await currentFirebaseAccount();
  if (!account) {
    throw new Error('Chưa đăng nhập.');
  }
  const db = getDatabase();
  const counts = await countLocalFinance(db);
  const linkedUid = (await readSyncStatus(db)).linkedUid;
  const decision = decideAccountLink(linkedUid, account.uid, counts);
  if (decision === 'blocked') {
    throw new Error('Máy này đã gắn với tài khoản khác. Dữ liệu trên máy không được gộp sang tài khoản vừa đăng nhập.');
  }
  await activateLink(account);
}

export async function disconnectSyncAccount(): Promise<void> {
  await signOutFirebase();
  const db = getDatabase();
  await setMetaPreference(db, metaKeys.enabled, '0');
  await setMetaPreference(db, metaKeys.email, '');
}

export async function importLegacySheets(): Promise<SheetImportReport> {
  const provider = createGoogleSheetsProvider({
    fetch: globalThis.fetch.bind(globalThis),
    getAccessToken: googleAccessToken,
    account: {
      getAccount: googleAccount,
      connect: connectGoogleAccount,
      disconnect: disconnectGoogleAccount,
    },
  });
  const account = (await provider.getAccount()) ?? (await provider.connect());
  if (!account) {
    throw new Error('Chưa đăng nhập Google để đọc Sheets.');
  }
  const workbook = await provider.ensureWorkbook(WORKBOOK_TITLE);
  const sheets = await provider.readSheets(workbook.spreadsheetId);
  return importSheetSnapshots(getDatabase(), sheets);
}

async function finishSignIn(signIn: () => Promise<CloudAccount>): Promise<LinkAction> {
  let account: CloudAccount;
  try {
    account = await signIn();
  } catch (error) {
    throw new Error(describeAuthError(error));
  }
  const db = getDatabase();
  const counts = await countLocalFinance(db);
  const linkedUid = (await readSyncStatus(db)).linkedUid;
  const decision = decideAccountLink(linkedUid, account.uid, counts);
  if (decision === 'blocked') {
    await signOutFirebase();
    throw new Error('Máy này đã gắn với tài khoản khác. Dữ liệu trên máy không được gộp sang tài khoản vừa đăng nhập.');
  }
  if (decision === 'confirm') {
    return decision;
  }
  await activateLink(account);
  return 'resume';
}

async function activateLink(account: CloudAccount): Promise<void> {
  const db = getDatabase();
  // Gắn máy trước để UI thoát trạng thái chờ; đồng bộ cloud có thể chậm/fail riêng.
  await setMetaPreference(db, metaKeys.linkedUid, account.uid);
  await setMetaPreference(db, metaKeys.enabled, '1');
  await setMetaPreference(db, metaKeys.email, account.email);
  await setMetaPreference(db, metaKeys.lastError, '');
  await setMetaPreference(db, metaKeys.lastWarning, '');

  try {
    const store = await openStore();
    await withTimeout(
      store.writeProfile(account.uid, {
        email: account.email,
        displayName: account.email.split('@')[0] ?? '',
        updatedAt: toLocalDateTime(new Date()),
      }),
      PROFILE_TIMEOUT_MS,
      'Không lưu được hồ sơ tài khoản. Kiểm tra mạng rồi thử lại.',
    );
  } catch (error) {
    const message = describeAuthError(error);
    await setMetaPreference(db, metaKeys.lastError, message);
    throw new Error(message);
  }

  const result = await syncNow(true);
  if (result.outcome === 'error') {
    await setMetaPreference(db, metaKeys.lastError, result.message);
    await setMetaPreference(db, metaKeys.lastWarning, 'Tài khoản đã gắn. Đồng bộ chưa xong — bấm Đồng bộ ngay để thử lại.');
    return;
  }
  if (result.outcome === 'offline' || result.outcome === 'waiting') {
    await setMetaPreference(
      db,
      metaKeys.lastWarning,
      'Tài khoản đã gắn. Sẽ đồng bộ khi có mạng hoặc khi bạn bấm Đồng bộ ngay.',
    );
  }
}

async function persistCredentials(email: string, password: string, remember: boolean): Promise<void> {
  if (remember) {
    await saveRememberedCredentials(email, password);
    return;
  }
  await setRememberEnabled(false);
  await rememberEmailOnly(email);
  await clearRememberedPassword();
}

async function openStore(): Promise<CloudStore> {
  const { createNativeFirestoreStore } = await import('@/src/services/sync/firebase/native-store');
  return createNativeFirestoreStore();
}

async function isOnline(): Promise<boolean> {
  try {
    const state = await Network.getNetworkStateAsync();
    return Boolean(state.isConnected) && state.isInternetReachable !== false;
  } catch {
    return false;
  }
}

function withTimeout<T>(promise: Promise<T>, ms: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (value) => {
        clearTimeout(timer);
        resolve(value);
      },
      (error: unknown) => {
        clearTimeout(timer);
        reject(error);
      },
    );
  });
}
