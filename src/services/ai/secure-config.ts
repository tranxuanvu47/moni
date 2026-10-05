import * as SecureStore from 'expo-secure-store';

import { aiApiKey } from '@/src/config/ai.local';

const AI_API_KEY = 'mono.ai.api-key';

export async function hasApiKey(): Promise<boolean> {
  return Boolean(await readApiKey());
}

export async function readApiKey(): Promise<string | null> {
  const bundled = aiApiKey.trim();
  if (bundled) {
    return bundled;
  }
  const value = (await SecureStore.getItemAsync(AI_API_KEY))?.trim() ?? '';
  return value || null;
}

export function hasBundledApiKey(): boolean {
  return Boolean(aiApiKey.trim());
}

export async function saveApiKey(value: string): Promise<void> {
  const key = value.trim();
  if (!key) {
    await removeApiKey();
    return;
  }
  await SecureStore.setItemAsync(AI_API_KEY, key);
}

export async function removeApiKey(): Promise<void> {
  await SecureStore.deleteItemAsync(AI_API_KEY);
}
