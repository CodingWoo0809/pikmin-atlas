// 서버 오류를 사용자에게 보여 줄 쉬운 문장으로 바꾼다.

type AnyErr = { message?: string; status?: number; code?: string; name?: string } | null | undefined;

export function isNetworkError(e: AnyErr): boolean {
  if (!e) return false;
  const msg = (e.message ?? '').toLowerCase();
  return (
    e.name === 'AuthRetryableFetchError' ||
    msg.includes('failed to fetch') ||
    msg.includes('load failed') || // iPhone Safari
    msg.includes('networkerror') ||
    e.status === 0
  );
}

export function authErrorMessage(e: AnyErr): string {
  if (!e) return '알 수 없는 오류가 발생했습니다.';
  if (isNetworkError(e)) {
    return '서버에 연결할 수 없습니다. 인터넷 연결을 확인하세요. 계속되면 Supabase 프로젝트가 일시정지되었는지 확인하세요.';
  }
  const code = e.code ?? '';
  const msg = (e.message ?? '').toLowerCase();
  if (code === 'invalid_credentials' || msg.includes('invalid login credentials')) {
    return '비밀번호가 맞지 않습니다.';
  }
  if (code === 'over_request_rate_limit' || e.status === 429 || msg.includes('rate limit')) {
    return '시도가 너무 많습니다. 몇 분 뒤에 다시 시도하세요.';
  }
  if (code === 'same_password') return '지금 쓰는 비밀번호와 같습니다. 다른 비밀번호를 입력하세요.';
  if (code === 'weak_password') return '서버가 이 비밀번호를 거부했습니다. 6자 이상인지 확인하세요.';
  if (code === 'reauthentication_needed') {
    return 'Supabase의 "Secure password change" 설정이 켜져 있어 변경할 수 없습니다. 설정을 끄세요.';
  }
  if (code === 'email_not_confirmed') return '주인 계정이 아직 확인(Confirm)되지 않았습니다. 대시보드에서 계정을 확인 처리하세요.';
  if (code === 'session_expired' || code === 'session_not_found' || e.status === 401) {
    return '로그인이 만료되었습니다. 다시 로그인하세요.';
  }
  if ((e.status ?? 0) >= 500) {
    return '서버가 응답하지 않습니다. Supabase 프로젝트가 일시정지 상태인지 확인하세요.';
  }
  return e.message || '알 수 없는 오류가 발생했습니다.';
}

export function dataErrorMessage(e: AnyErr): string {
  if (!e) return '알 수 없는 오류가 발생했습니다.';
  if (isNetworkError(e)) return '인터넷 연결이 끊겨 저장하지 못했습니다.';
  const msg = e.message ?? '';
  if (e.code === '23505' || msg.includes('deco_categories_name_unique')) return '같은 이름의 분류가 이미 있습니다.';
  if (e.code === '23503') return '다른 기록이 참조하고 있어 처리할 수 없습니다.';
  if (e.code === '42501' || msg.includes('row-level security')) return '권한이 없습니다. 다시 로그인하세요.';
  if (e.code === 'PGRST301' || msg.toLowerCase().includes('jwt')) return '로그인이 만료되었습니다. 다시 로그인하세요.';
  if (msg.includes('unfinished restore')) return '끝나지 않은 복원이 있습니다. 백업·복원 화면에서 먼저 정리하세요.';
  return msg || '알 수 없는 오류가 발생했습니다.';
}
