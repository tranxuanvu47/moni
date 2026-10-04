import fs from 'node:fs';
import path from 'node:path';

import type { ConfigContext, ExpoConfig } from 'expo/config';

const GOOGLE_SUFFIX = '.apps.googleusercontent.com';

function readGoogleClientId(key: 'androidClientId' | 'iosClientId'): string {
  const file = path.join(__dirname, 'src', 'config', 'google.local.ts');
  if (!fs.existsSync(file)) {
    return '';
  }
  const source = fs.readFileSync(file, 'utf8');
  const match = source.match(new RegExp(`${key}:\\s*'([^']*)'`));
  return match?.[1]?.trim() ?? '';
}

function googleRedirectScheme(clientId: string): string | null {
  if (!clientId.endsWith(GOOGLE_SUFFIX)) {
    return null;
  }
  return `com.googleusercontent.apps.${clientId.slice(0, -GOOGLE_SUFFIX.length)}`;
}

export default ({ config }: ConfigContext): ExpoConfig => {
  // Giữ scheme chính là string để Linking không cảnh báo multi-scheme.
  // Scheme Google OAuth (Sheets) gắn riêng theo nền tảng.
  const googleSchemes = [readGoogleClientId('androidClientId'), readGoogleClientId('iosClientId')]
    .map(googleRedirectScheme)
    .filter((scheme): scheme is string => Boolean(scheme));

  const iosSchemes = [...googleSchemes];
  const androidSchemes = [...googleSchemes];

  return {
    ...config,
    name: config.name ?? 'AiTiMan Moni',
    slug: config.slug ?? 'mono',
    scheme: 'mono',
    ios: {
      ...config.ios,
      ...(iosSchemes.length > 0 ? { scheme: iosSchemes } : null),
    },
    android: {
      ...config.android,
      ...(androidSchemes.length > 0 ? { scheme: androidSchemes } : null),
    },
  };
};
