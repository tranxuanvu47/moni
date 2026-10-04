import { aiApiKey } from '@/src/config/ai.local';

export async function hasApiKey(): Promise<boolean> {
  return Boolean(aiApiKey.trim());
}

export async function readApiKey(): Promise<string | null> {
  const value = aiApiKey.trim();
  return value || null;
}
