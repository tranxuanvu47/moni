import * as AuthSession from 'expo-auth-session';
import * as WebBrowser from 'expo-web-browser';
import Constants, { ExecutionEnvironment } from 'expo-constants';
import { Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';

import { googleOAuth } from '@/src/config/google.local';
import { googleNativeRedirectUri } from '@/src/config/google-redirect';
import { GOOGLE_SCOPES } from '@/src/services/sync/constants';
import type { SyncAccount } from '@/src/services/sync/types';

WebBrowser.maybeCompleteAuthSession();

const TOKEN_KEY = 'mono.google.tokens';

const discovery = {
  authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
  tokenEndpoint: 'https://oauth2.googleapis.com/token',
  revocationEndpoint: 'https://oauth2.googleapis.com/revoke',
  userInfoEndpoint: 'https://openidconnect.googleapis.com/v1/userinfo',
};

interface StoredTokens {
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number;
  email: string;
}

export function googleAuthAvailability(): { ok: true; clientId: string } | { ok: false; reason: string } {
  if (Constants.executionEnvironment === ExecutionEnvironment.StoreClient) {
    return { ok: false, reason: 'Đăng nhập Google cần bản cài trên máy, không dùng được trong Expo Go.' };
  }
  const clientId = Platform.OS === 'ios' ? googleOAuth.iosClientId.trim() : googleOAuth.androidClientId.trim();
  if (!clientId) {
    return {
      ok: false,
      reason: 'Chưa có Google client ID. Điền vào src/config/google.local.ts rồi build lại để gắn redirect.',
    };
  }
  return { ok: true, clientId };
}

export async function googleAccount(): Promise<SyncAccount | null> {
  const stored = await readTokens();
  if (!stored) {
    return null;
  }
  return { email: stored.email };
}

export async function connectGoogleAccount(): Promise<SyncAccount> {
  const availability = googleAuthAvailability();
  if (!availability.ok) {
    throw new Error(availability.reason);
  }
  const redirectUri = googleNativeRedirectUri(availability.clientId);
  const request = new AuthSession.AuthRequest({
    clientId: availability.clientId,
    scopes: [...GOOGLE_SCOPES],
    redirectUri,
    responseType: AuthSession.ResponseType.Code,
    usePKCE: true,
    extraParams: {
      access_type: 'offline',
      prompt: 'consent',
    },
  });
  await request.makeAuthUrlAsync(discovery);
  const result = await request.promptAsync(discovery);
  if (result.type === 'cancel' || result.type === 'dismiss') {
    throw new Error('Bạn đã đóng cửa sổ đăng nhập Google.');
  }
  if (result.type !== 'success' || !result.params.code) {
    throw new Error('Google không trả mã đăng nhập.');
  }
  const token = await AuthSession.exchangeCodeAsync(
    {
      clientId: availability.clientId,
      code: result.params.code,
      redirectUri,
      extraParams: {
        code_verifier: request.codeVerifier ?? '',
      },
    },
    discovery,
  );
  const profile = await AuthSession.fetchUserInfoAsync({ accessToken: token.accessToken }, discovery);
  const email = typeof profile.email === 'string' ? profile.email : '';
  if (!email) {
    throw new Error('Google không trả email của tài khoản.');
  }
  const previous = await readTokens();
  await writeTokens({
    accessToken: token.accessToken,
    refreshToken: token.refreshToken ?? previous?.refreshToken ?? null,
    expiresAt: Date.now() + (token.expiresIn ?? 3600) * 1000,
    email,
  });
  return { email };
}

export async function disconnectGoogleAccount(): Promise<void> {
  const stored = await readTokens();
  const availability = googleAuthAvailability();
  if (stored && availability.ok) {
    const token = stored.refreshToken ?? stored.accessToken;
    await AuthSession.revokeAsync({ clientId: availability.clientId, token }, discovery).catch(() => undefined);
  }
  await SecureStore.deleteItemAsync(TOKEN_KEY).catch(() => undefined);
}

export async function googleAccessToken(): Promise<string> {
  const stored = await readTokens();
  if (!stored) {
    throw new Error('Chưa kết nối Google.');
  }
  if (stored.expiresAt - 60_000 > Date.now()) {
    return stored.accessToken;
  }
  const availability = googleAuthAvailability();
  if (!availability.ok || !stored.refreshToken) {
    throw new Error('Phiên Google đã hết hạn. Hãy kết nối lại.');
  }
  const refreshed = await AuthSession.refreshAsync(
    {
      clientId: availability.clientId,
      refreshToken: stored.refreshToken,
    },
    discovery,
  );
  const next: StoredTokens = {
    accessToken: refreshed.accessToken,
    refreshToken: refreshed.refreshToken ?? stored.refreshToken,
    expiresAt: Date.now() + (refreshed.expiresIn ?? 3600) * 1000,
    email: stored.email,
  };
  await writeTokens(next);
  return next.accessToken;
}

async function readTokens(): Promise<StoredTokens | null> {
  const raw = await SecureStore.getItemAsync(TOKEN_KEY);
  if (!raw) {
    return null;
  }
  try {
    const parsed = JSON.parse(raw) as StoredTokens;
    if (!parsed.accessToken || !parsed.email) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeTokens(tokens: StoredTokens): Promise<void> {
  await SecureStore.setItemAsync(TOKEN_KEY, JSON.stringify(tokens));
}
