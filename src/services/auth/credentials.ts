import * as SecureStore from 'expo-secure-store';

const EMAIL_KEY = 'mono.auth.email';
const PASSWORD_KEY = 'mono.auth.password';
const REMEMBER_KEY = 'mono.auth.remember';
const BIOMETRIC_KEY = 'mono.auth.biometric';

export interface RememberedCredentials {
  email: string;
  password: string;
}

export async function isRememberEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(REMEMBER_KEY)) === '1';
}

export async function setRememberEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(REMEMBER_KEY, enabled ? '1' : '0');
  if (!enabled) {
    await clearRememberedPassword();
  }
}

export async function isBiometricLoginEnabled(): Promise<boolean> {
  return (await SecureStore.getItemAsync(BIOMETRIC_KEY)) === '1';
}

export async function setBiometricLoginEnabled(enabled: boolean): Promise<void> {
  await SecureStore.setItemAsync(BIOMETRIC_KEY, enabled ? '1' : '0');
}

export async function readRememberedEmail(): Promise<string | null> {
  return SecureStore.getItemAsync(EMAIL_KEY);
}

export async function readRememberedCredentials(): Promise<RememberedCredentials | null> {
  const [email, password, remember] = await Promise.all([
    SecureStore.getItemAsync(EMAIL_KEY),
    SecureStore.getItemAsync(PASSWORD_KEY),
    isRememberEnabled(),
  ]);
  if (!remember || !email?.trim() || !password) {
    return null;
  }
  return { email: email.trim(), password };
}

export async function saveRememberedCredentials(email: string, password: string): Promise<void> {
  const trimmed = email.trim();
  await SecureStore.setItemAsync(EMAIL_KEY, trimmed);
  await SecureStore.setItemAsync(PASSWORD_KEY, password);
  await SecureStore.setItemAsync(REMEMBER_KEY, '1');
}

export async function rememberEmailOnly(email: string): Promise<void> {
  await SecureStore.setItemAsync(EMAIL_KEY, email.trim());
}

export async function clearRememberedPassword(): Promise<void> {
  await SecureStore.deleteItemAsync(PASSWORD_KEY).catch(() => undefined);
}

export async function clearRememberedCredentials(): Promise<void> {
  await Promise.all([
    SecureStore.deleteItemAsync(EMAIL_KEY).catch(() => undefined),
    SecureStore.deleteItemAsync(PASSWORD_KEY).catch(() => undefined),
    SecureStore.setItemAsync(REMEMBER_KEY, '0'),
    SecureStore.setItemAsync(BIOMETRIC_KEY, '0'),
  ]);
}
