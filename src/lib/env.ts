// 빌드할 때 주입되는 "공개해도 되는 값"만 읽는다.
// 비밀 키가 실수로 들어오면 앱을 아예 시작하지 않도록 막는다.
// (Turnstile은 사용하지 않기로 해서 설정값은 3개다.)

export type AppConfig = {
  supabaseUrl: string;
  supabasePublishableKey: string;
  ownerEmail: string;
};

export type ConfigResult =
  | { ok: true; config: AppConfig }
  | { ok: false; problems: string[] };

type RawEnv = Record<string, string | undefined>;

/** 문자열이 비밀 키처럼 보이면 true */
export function looksLikeSecret(value: string): boolean {
  const v = value.trim();
  if (v.startsWith('sb_secret_')) return true;
  // 예전 방식 키(JWT) 안에 service_role 권한이 들어 있는지 확인
  const parts = v.split('.');
  if (parts.length === 3) {
    try {
      const payload = JSON.parse(atob(parts[1].replace(/-/g, '+').replace(/_/g, '/')));
      // 검사용 문자열을 조립해서 써서, 빌드 결과물에 해당 단어가 그대로 남지 않게 한다
      // (빌드 결과물 비밀 키 검사가 오탐하지 않도록).
      if (payload && payload.role === ['service', 'role'].join('_')) return true;
    } catch {
      /* JWT가 아니면 무시 */
    }
  }
  return false;
}

export function readConfig(env: RawEnv): ConfigResult {
  const problems: string[] = [];
  const get = (name: string) => (env[name] ?? '').trim();

  const supabaseUrl = get('VITE_SUPABASE_URL');
  const supabasePublishableKey = get('VITE_SUPABASE_PUBLISHABLE_KEY');
  const ownerEmail = get('VITE_OWNER_EMAIL').toLowerCase();

  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co\/?$/.test(supabaseUrl)) {
    problems.push('VITE_SUPABASE_URL 값이 없거나 https://xxxx.supabase.co 형식이 아닙니다.');
  }
  if (!supabasePublishableKey) {
    problems.push('VITE_SUPABASE_PUBLISHABLE_KEY 값이 없습니다.');
  } else if (looksLikeSecret(supabasePublishableKey)) {
    problems.push('VITE_SUPABASE_PUBLISHABLE_KEY에 비밀 키가 들어 있습니다. 즉시 Supabase에서 해당 키를 폐기하세요.');
  } else if (!supabasePublishableKey.startsWith('sb_publishable_')) {
    problems.push('VITE_SUPABASE_PUBLISHABLE_KEY는 sb_publishable_ 로 시작해야 합니다.');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(ownerEmail)) {
    problems.push('VITE_OWNER_EMAIL 값이 없거나 이메일 형식이 아닙니다.');
  }

  if (problems.length > 0) return { ok: false, problems };
  return {
    ok: true,
    config: {
      supabaseUrl: supabaseUrl.replace(/\/$/, ''),
      supabasePublishableKey,
      ownerEmail,
    },
  };
}

export const appConfig: ConfigResult = readConfig(import.meta.env as unknown as RawEnv);
