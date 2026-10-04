import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type PropsWithChildren } from 'react';

import { readRememberedEmail } from '@/src/services/auth/credentials';
import { peekBiometricUnlock, restoreAuthSession } from '@/src/services/auth/restore';
import { currentFirebaseAccount } from '@/src/services/sync/firebase/auth';
import { disconnectSyncAccount } from '@/src/services/sync/runtime';

export type AuthGateStatus = 'loading' | 'signed_out' | 'needs_biometric' | 'ready';

interface AuthSessionValue {
  status: AuthGateStatus;
  email: string | null;
  refresh: () => Promise<void>;
  markUnlocked: () => void;
  notifySignedIn: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthSessionContext = createContext<AuthSessionValue | null>(null);

export function AuthSessionProvider({ children }: PropsWithChildren) {
  const [status, setStatus] = useState<AuthGateStatus>('loading');
  const [email, setEmail] = useState<string | null>(null);
  const unlockedThisLaunch = useRef(false);

  const refresh = useCallback(async () => {
    try {
      let account = await currentFirebaseAccount().catch(() => null);

      if (!account) {
        const restored = await restoreAuthSession();
        if (restored.status === 'needs_biometric') {
          setEmail(restored.email);
          setStatus('needs_biometric');
          return;
        }
        if (restored.status === 'restored' || restored.status === 'signed_in') {
          account = await currentFirebaseAccount().catch(() => null);
        }
      }

      if (!account) {
        setEmail(await readRememberedEmail());
        setStatus('signed_out');
        return;
      }

      const unlockEmail = unlockedThisLaunch.current ? null : await peekBiometricUnlock().catch(() => null);
      if (unlockEmail) {
        setEmail(unlockEmail);
        setStatus('needs_biometric');
        return;
      }

      setEmail(account.email);
      setStatus('ready');
    } catch {
      setEmail(null);
      setStatus('signed_out');
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const markUnlocked = useCallback(() => {
    unlockedThisLaunch.current = true;
    setStatus('ready');
  }, []);

  const notifySignedIn = useCallback(async () => {
    unlockedThisLaunch.current = true;
    const account = await currentFirebaseAccount().catch(() => null);
    setEmail(account?.email ?? (await readRememberedEmail()));
    setStatus(account ? 'ready' : 'signed_out');
  }, []);

  const signOut = useCallback(async () => {
    unlockedThisLaunch.current = false;
    await disconnectSyncAccount();
    setEmail(await readRememberedEmail());
    setStatus('signed_out');
  }, []);

  const value = useMemo(
    () => ({ status, email, refresh, markUnlocked, notifySignedIn, signOut }),
    [status, email, refresh, markUnlocked, notifySignedIn, signOut],
  );

  return <AuthSessionContext.Provider value={value}>{children}</AuthSessionContext.Provider>;
}

export function useAuthSession(): AuthSessionValue {
  const value = useContext(AuthSessionContext);
  if (!value) {
    throw new Error('useAuthSession cần AuthSessionProvider.');
  }
  return value;
}
