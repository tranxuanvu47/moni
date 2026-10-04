import { firebaseLocal } from '@/src/config/firebase.local';
import type { CloudAccount } from '@/src/services/sync/types';

export function firebaseWebClientId(): string {
  return firebaseLocal.webClientId.trim();
}

export function describeAuthError(error: unknown): string {
  const code = readCode(error);
  const message = error instanceof Error ? error.message : '';
  if (code.includes('invalid-email')) {
    return 'Email không hợp lệ.';
  }
  if (code.includes('wrong-password') || code.includes('invalid-credential') || code.includes('user-not-found')) {
    return 'Email hoặc mật khẩu không đúng.';
  }
  if (code.includes('email-already-in-use')) {
    return 'Email này đã có tài khoản. Hãy đăng nhập.';
  }
  if (code.includes('weak-password')) {
    return 'Mật khẩu cần ít nhất 6 ký tự.';
  }
  if (code.includes('too-many-requests')) {
    return 'Đăng nhập bị giới hạn tạm thời. Thử lại sau ít phút.';
  }
  if (code.includes('network-request-failed')) {
    return 'Không có mạng để đăng nhập. Kiểm tra kết nối rồi thử lại.';
  }
  if (
    code.includes('configuration-not-found') ||
    message.includes('CONFIGURATION_NOT_FOUND') ||
    message.includes('configuration-not')
  ) {
    return 'Đăng nhập chưa sẵn sàng trên bản này. Hãy cập nhật app hoặc thử đăng nhập email.';
  }
  if (message.includes('RNFB') || message.includes('Native module') || message.includes('not installed')) {
    return 'Đăng nhập cần bản cài đầy đủ của app (không dùng Expo Go).';
  }
  if (code === '10' || code.includes('DEVELOPER_ERROR')) {
    return 'Đăng nhập Google chưa được cấu hình đúng trên bản này. Thử đăng nhập bằng email.';
  }
  if (message) {
    return message;
  }
  return 'Không đăng nhập được. Thử lại sau ít phút.';
}

export async function currentFirebaseAccount(): Promise<CloudAccount | null> {
  const { getAuth, onAuthStateChanged } = await import('@react-native-firebase/auth');
  const auth = getAuth();
  const existing = accountFromUser(auth.currentUser);
  if (existing) {
    return existing;
  }

  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      unsubscribe();
      resolve();
    };
    const timer = setTimeout(finish, 2500);
    const unsubscribe = onAuthStateChanged(auth, () => finish());
  });

  return accountFromUser(auth.currentUser);
}

export async function signInWithGoogle(): Promise<CloudAccount> {
  const webClientId = firebaseWebClientId();
  if (!webClientId) {
    throw new Error('Đăng nhập Google chưa sẵn sàng trên bản này. Hãy dùng email hoặc cập nhật app.');
  }
  const [{ GoogleSignin, statusCodes }, authModule] = await Promise.all([
    import('@react-native-google-signin/google-signin'),
    import('@react-native-firebase/auth'),
  ]);
  GoogleSignin.configure({ webClientId });
  await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
  const response = await GoogleSignin.signIn();
  if (response.type === 'cancelled') {
    throw new Error('Bạn đã đóng cửa sổ đăng nhập Google.');
  }
  const idToken = response.data.idToken;
  if (!idToken) {
    throw new Error('Google không trả được mã đăng nhập. Thử lại hoặc dùng email.');
  }
  const auth = authModule.getAuth();
  const credential = authModule.GoogleAuthProvider.credential(idToken);
  try {
    const result = await authModule.signInWithCredential(auth, credential);
    const account = accountFromUser(result.user) ?? accountFromUser(auth.currentUser);
    if (!account) {
      throw new Error('Chưa nhận được phiên đăng nhập. Thử lại nhé.');
    }
    return account;
  } catch (error) {
    if (readCode(error) === statusCodes.SIGN_IN_CANCELLED) {
      throw new Error('Bạn đã đóng cửa sổ đăng nhập Google.');
    }
    throw error;
  }
}

export async function signInWithEmail(email: string, password: string): Promise<CloudAccount> {
  return emailAuth(email, password, 'sign-in');
}

export async function registerWithEmail(email: string, password: string): Promise<CloudAccount> {
  return emailAuth(email, password, 'register');
}

export async function signOutFirebase(): Promise<void> {
  const authModule = await import('@react-native-firebase/auth');
  await authModule.signOut(authModule.getAuth());
  try {
    const { GoogleSignin } = await import('@react-native-google-signin/google-signin');
    await GoogleSignin.signOut();
  } catch {
    // Phiên email không có phiên Google.
  }
}

async function emailAuth(email: string, password: string, mode: 'sign-in' | 'register'): Promise<CloudAccount> {
  const trimmed = email.trim();
  if (!trimmed || !password) {
    throw new Error('Nhập email và mật khẩu.');
  }
  const authModule = await import('@react-native-firebase/auth');
  const auth = authModule.getAuth();
  const result =
    mode === 'register'
      ? await authModule.createUserWithEmailAndPassword(auth, trimmed, password)
      : await authModule.signInWithEmailAndPassword(auth, trimmed, password);
  const account = accountFromUser(result.user) ?? accountFromUser(auth.currentUser);
  if (!account) {
    throw new Error('Chưa nhận được phiên đăng nhập. Thử lại nhé.');
  }
  return account;
}

function accountFromUser(user: { uid: string; email: string | null } | null | undefined): CloudAccount | null {
  if (!user) {
    return null;
  }
  return { uid: user.uid, email: user.email ?? user.uid };
}

function readCode(error: unknown): string {
  if (typeof error === 'object' && error && 'code' in error) {
    return String((error as { code: unknown }).code);
  }
  return '';
}
