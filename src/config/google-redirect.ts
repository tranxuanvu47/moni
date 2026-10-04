const GOOGLE_SUFFIX = '.apps.googleusercontent.com';

export function googleRedirectScheme(clientId: string): string | null {
  const trimmed = clientId.trim();
  if (!trimmed.endsWith(GOOGLE_SUFFIX)) {
    return null;
  }
  return `com.googleusercontent.apps.${trimmed.slice(0, -GOOGLE_SUFFIX.length)}`;
}

export function googleNativeRedirectUri(clientId: string): string {
  const scheme = googleRedirectScheme(clientId);
  if (!scheme) {
    throw new Error('Google client ID không đúng định dạng.');
  }
  return `${scheme}:/oauth2redirect`;
}
