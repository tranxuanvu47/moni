// Client ID công khai của Google Cloud. Không điền client secret.
// Android: package com.aitiman.moni và SHA-1 của bản build.
// iOS: bundle com.aitiman.moni.
// Redirect: com.googleusercontent.apps.<phần trước .apps.googleusercontent.com>:/oauth2redirect
// Sau khi điền, build lại để app nhận scheme redirect.
export const googleOAuth = {
  androidClientId: '',
  iosClientId: '',
};
