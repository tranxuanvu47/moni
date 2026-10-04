import {
  isBiometricLoginEnabled,
  isRememberEnabled,
  readRememberedCredentials,
  readRememberedEmail,
} from '@/src/services/auth/credentials';
import { currentFirebaseAccount, signInWithEmail } from '@/src/services/sync/firebase/auth';
import { finishEmailRestore } from '@/src/services/sync/runtime';

export type AuthRestoreState =
  | { status: 'signed_in' }
  | { status: 'signed_out' }
  | { status: 'needs_biometric'; email: string }
  | { status: 'restored' };

/** Chỉ đọc SecureStore — không đụng Firebase, dùng lúc mở app. */
export async function peekBiometricUnlock(): Promise<string | null> {
  if (!(await isBiometricLoginEnabled())) {
    return null;
  }
  const email = (await readRememberedEmail())?.trim();
  return email || null;
}

/**
 * Khôi phục phiên Firebase sau khi UI đã hiện.
 * Không gọi sync/activateLink để tránh treo splash.
 */
export async function restoreAuthSession(): Promise<AuthRestoreState> {
  try {
    const account = await currentFirebaseAccount();
    if (account) {
      return { status: 'signed_in' };
    }
  } catch {
    // Tiếp tục thử nhớ mật khẩu.
  }

  if (!(await isRememberEnabled())) {
    return { status: 'signed_out' };
  }

  const credentials = await readRememberedCredentials();
  if (!credentials) {
    return { status: 'signed_out' };
  }

  if (await isBiometricLoginEnabled()) {
    return { status: 'needs_biometric', email: credentials.email };
  }

  try {
    // Chỉ đăng nhập Auth — đồng bộ để startSyncRuntime xử lý sau.
    await signInWithEmail(credentials.email, credentials.password);
    return { status: 'restored' };
  } catch {
    return { status: 'signed_out' };
  }
}

export async function signInWithRememberedCredentials(): Promise<void> {
  const credentials = await readRememberedCredentials();
  if (!credentials) {
    throw new Error('Chưa có mật khẩu đã lưu. Hãy đăng nhập bằng email một lần và bật nhớ mật khẩu.');
  }
  await finishEmailRestore(credentials.email, credentials.password);
}

/** Mở khóa bằng vân tay: dùng mật khẩu đã lưu, hoặc phiên đăng nhập còn trên máy. */
export async function unlockWithBiometric(): Promise<void> {
  const credentials = await readRememberedCredentials();
  if (credentials) {
    await finishEmailRestore(credentials.email, credentials.password);
    return;
  }
  const account = await currentFirebaseAccount();
  if (!account) {
    throw new Error('Phiên đăng nhập đã hết. Hãy đăng nhập lại.');
  }
}
