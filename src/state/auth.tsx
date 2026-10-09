import type { Session } from '@supabase/supabase-js';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getSettings, upsertSettings } from '../lib/api';
import { appConfig } from '../lib/env';
import { authErrorMessage, dataErrorMessage } from '../lib/errors';
import { normalizePassword, passwordProblem } from '../lib/password';
import { clearSignedUrlCache } from '../lib/photos';
import { sb } from '../lib/supabase';

export type AuthStatus = 'loading' | 'signedOut' | 'needsSetup' | 'notOwner' | 'ready';

type AuthCtx = {
  status: AuthStatus;
  session: Session | null;
  ownerId: string | null;
  notice: string | null;
  login: (password: string) => Promise<string | null>;
  setInitialPassword: (next: string) => Promise<string | null>;
  changePassword: (current: string, next: string) => Promise<string | null>;
  logout: (everywhere: boolean) => Promise<void>;
  clearNotice: () => void;
};

const Ctx = createContext<AuthCtx | null>(null);

export function useAuth() {
  const v = useContext(Ctx);
  if (!v) throw new Error('AuthProvider missing');
  return v;
}

function email() {
  if (!appConfig.ok) throw new Error('config');
  return appConfig.config.ownerEmail;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [session, setSession] = useState<Session | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const intentionalSignOut = useRef(false);

  const decide = useCallback(async (s: Session | null) => {
    setSession(s);
    if (!s) {
      setStatus('signedOut');
      return;
    }
    try {
      const settings = await getSettings();
      if (!settings) {
        // 행이 없으면: 아직 최초 설정 전이거나, 주인으로 지정되지 않은 계정(RLS가 막음)
        try {
          await upsertSettings({ password_initialized: false });
          setStatus('needsSetup');
        } catch {
          setStatus('notOwner');
        }
        return;
      }
      setStatus(settings.password_initialized ? 'ready' : 'needsSetup');
    } catch (e) {
      setNotice(dataErrorMessage(e as Error));
      setStatus('ready'); // 네트워크 문제일 수 있음 → 도감 화면에서 다시 시도
    }
  }, []);

  useEffect(() => {
    const client = sb();
    let first = true;
    client.auth.getSession().then(({ data }) => {
      first = false;
      void decide(data.session);
    });
    const { data: sub } = client.auth.onAuthStateChange((event, s) => {
      if (event === 'INITIAL_SESSION') return;
      if (event === 'SIGNED_OUT') {
        clearSignedUrlCache();
        if (!intentionalSignOut.current && !first) setNotice('로그인이 만료되었습니다. 다시 로그인하세요.');
        intentionalSignOut.current = false;
        setSession(null);
        setStatus('signedOut');
        return;
      }
      if (event === 'TOKEN_REFRESHED' || event === 'USER_UPDATED') {
        setSession(s);
      }
    });
    return () => sub.subscription.unsubscribe();
  }, [decide]);

  const login = useCallback(
    async (password: string) => {
      const problem = passwordProblem(password);
      if (problem) return problem;
      const { data, error } = await sb().auth.signInWithPassword({ email: email(), password: normalizePassword(password) });
      if (error) return authErrorMessage(error);
      setNotice(null);
      setStatus('loading');
      await decide(data.session);
      return null;
    },
    [decide],
  );

  const setInitialPassword = useCallback(async (next: string) => {
    const problem = passwordProblem(next);
    if (problem) return problem;
    const { error } = await sb().auth.updateUser({ password: normalizePassword(next) });
    if (error && error.code !== 'same_password') return authErrorMessage(error);
    try {
      await upsertSettings({ password_initialized: true });
    } catch (e) {
      return dataErrorMessage(e as Error);
    }
    setStatus('ready');
    return null;
  }, []);

  const changePassword = useCallback(async (current: string, next: string) => {
    const p1 = passwordProblem(current);
    if (p1) return `현재 비밀번호: ${p1}`;
    const p2 = passwordProblem(next);
    if (p2) return `새 비밀번호: ${p2}`;
    // 본인 확인: 현재 비밀번호로 다시 로그인해 본다
    const re = await sb().auth.signInWithPassword({ email: email(), password: normalizePassword(current) });
    if (re.error) {
      return re.error.code === 'invalid_credentials' ? '현재 비밀번호가 맞지 않습니다.' : authErrorMessage(re.error);
    }
    const { error } = await sb().auth.updateUser({ password: normalizePassword(next) });
    if (error) return authErrorMessage(error);
    return null;
  }, []);

  const logout = useCallback(async (everywhere: boolean) => {
    intentionalSignOut.current = true;
    await sb().auth.signOut({ scope: everywhere ? 'global' : 'local' });
    setNotice(everywhere ? '모든 기기에서 로그아웃했습니다.' : '로그아웃했습니다.');
    setStatus('signedOut');
    setSession(null);
  }, []);

  const value = useMemo<AuthCtx>(
    () => ({
      status,
      session,
      ownerId: session?.user.id ?? null,
      notice,
      login,
      setInitialPassword,
      changePassword,
      logout,
      clearNotice: () => setNotice(null),
    }),
    [status, session, notice, login, setInitialPassword, changePassword, logout],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
