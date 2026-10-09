import { useState, type FormEvent } from 'react';
import { appConfig } from '../lib/env';
import { passwordProblem } from '../lib/password';
import { useAuth } from '../state/auth';

function Gate({ children, title, lead }: { children: React.ReactNode; title: string; lead?: string }) {
  return (
    <main className="gate">
      <div className="gate-card">
        <div className="gate-mark" aria-hidden="true">
          <span className="seed seed-a" />
          <span className="seed seed-b" />
          <span className="seed seed-c" />
        </div>
        <h1>{title}</h1>
        {lead && <p className="gate-lead">{lead}</p>}
        {children}
      </div>
    </main>
  );
}

export function LoginPage() {
  const { login, notice, clearNotice } = useAuth();
  const [pw, setPw] = useState('');
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError(null);
    clearNotice();
    const err = await login(pw);
    setBusy(false);
    if (err) {
      setError(err);
      setPw('');
    }
  };

  return (
    <Gate title="Nomad Atlas">
      <form className="gate-form" onSubmit={submit}>
        {notice && !error && <p className="gate-notice">{notice}</p>}
        <label className="field">
          <span className="field-label">비밀번호</span>
          <div className="pw-wrap">
            <input
              type={show ? 'text' : 'password'}
              autoComplete="current-password"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              value={pw}
              onChange={(e) => setPw(e.target.value)}
              maxLength={40}
              autoFocus
              aria-invalid={!!error}
              aria-describedby={error ? 'login-err' : undefined}
            />
            <button type="button" className="pw-toggle" onClick={() => setShow((s) => !s)} aria-label={show ? '비밀번호 숨기기' : '비밀번호 보기'}>
              {show ? '숨기기' : '보기'}
            </button>
          </div>
        </label>
        {error && (
          <p className="field-error" id="login-err" role="alert">
            {error}
          </p>
        )}
        <button type="submit" className="btn btn-primary btn-block" disabled={busy || pw.length === 0}>
          {busy ? '확인 중…' : '들어가기'}
        </button>
        <details className="gate-help">
          <summary>비밀번호를 잊었어요</summary>
          <p>
            이 도감은 주인 한 명만 쓰도록 만들어져 있어 이메일 재설정이 없습니다. Supabase 대시보드 → SQL Editor에서 저장소의{' '}
            <code>docs/OPERATIONS.md</code>에 있는 "비밀번호 복구" SQL을 실행하면 새 비밀번호를 정할 수 있습니다.
          </p>
        </details>
      </form>
    </Gate>
  );
}

export function SetupPasswordPage() {
  const { setInitialPassword, logout } = useAuth();
  return (
    <Gate title="새 비밀번호 정하기" lead="처음 들어오셨습니다. 앞으로 쓸 비밀번호를 정하세요. 6~12자, 영문·숫자·특수문자, 대소문자는 구분하지 않습니다.">
      <NewPasswordForm submitLabel="비밀번호 정하고 시작하기" onSubmit={(next) => setInitialPassword(next)} />
      <button type="button" className="btn btn-quiet btn-block" onClick={() => logout(false)}>
        로그아웃
      </button>
    </Gate>
  );
}

export function NewPasswordForm({
  onSubmit,
  submitLabel,
  withCurrent,
}: {
  onSubmit: (next: string, current: string) => Promise<string | null>;
  submitLabel: string;
  withCurrent?: boolean;
}) {
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [again, setAgain] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const rule = next ? passwordProblem(next) : null;
  const mismatch = again && next.toLowerCase() !== again.toLowerCase() ? '두 번 입력한 비밀번호가 다릅니다.' : null;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setDone(false);
    const p = passwordProblem(next);
    if (p) return setError(p);
    if (next.toLowerCase() !== again.toLowerCase()) return setError('두 번 입력한 비밀번호가 다릅니다.');
    setBusy(true);
    const err = await onSubmit(next, current);
    setBusy(false);
    if (err) setError(err);
    else {
      setDone(true);
      setCurrent('');
      setNext('');
      setAgain('');
    }
  };

  return (
    <form className="gate-form" onSubmit={submit}>
      {withCurrent && (
        <label className="field">
          <span className="field-label">현재 비밀번호</span>
          <input type="password" autoComplete="current-password" autoCapitalize="none" value={current} onChange={(e) => setCurrent(e.target.value)} maxLength={40} />
        </label>
      )}
      <label className="field">
        <span className="field-label">새 비밀번호</span>
        <input type="password" autoComplete="new-password" autoCapitalize="none" value={next} onChange={(e) => setNext(e.target.value)} maxLength={40} aria-invalid={!!rule} />
        {rule ? <span className="field-error">{rule}</span> : <span className="hint">6~12자 · 영문, 숫자, 특수문자 · 대소문자 구분 없음</span>}
      </label>
      <label className="field">
        <span className="field-label">새 비밀번호 확인</span>
        <input type="password" autoComplete="new-password" autoCapitalize="none" value={again} onChange={(e) => setAgain(e.target.value)} maxLength={40} aria-invalid={!!mismatch} />
        {mismatch && <span className="field-error">{mismatch}</span>}
      </label>
      {error && (
        <p className="field-error" role="alert">
          {error}
        </p>
      )}
      {done && <p className="ok-text">비밀번호를 바꿨습니다. 다른 기기에서도 새 비밀번호로 들어가세요.</p>}
      <button type="submit" className="btn btn-primary btn-block" disabled={busy || !next || !again || (withCurrent && !current)}>
        {busy ? '저장 중…' : submitLabel}
      </button>
    </form>
  );
}

export function NotOwnerPage() {
  const { logout } = useAuth();
  return (
    <Gate title="주인 계정이 아닙니다" lead="로그인은 되었지만 이 계정은 도감 주인으로 지정되어 있지 않아 데이터에 접근할 수 없습니다.">
      <p className="hint">
        주인이라면 Supabase SQL Editor에서 <code>supabase/setup_owner.sql</code>을 실행했는지 확인하세요. 인터넷 문제일 수도 있으니 새로고침도 해 보세요.
      </p>
      <button type="button" className="btn btn-plain btn-block" onClick={() => window.location.reload()}>
        새로고침
      </button>
      <button type="button" className="btn btn-quiet btn-block" onClick={() => logout(false)}>
        로그아웃
      </button>
    </Gate>
  );
}

export function ConfigErrorPage() {
  return (
    <Gate title="설정값이 부족합니다" lead="배포할 때 들어가야 하는 공개 설정값이 비어 있거나 잘못되었습니다.">
      <ul className="problems">{!appConfig.ok && appConfig.problems.map((p) => <li key={p}>{p}</li>)}</ul>
      <p className="hint">GitHub 저장소 → Settings → Secrets and variables → Actions → Variables 에서 값을 확인한 뒤 다시 배포하세요.</p>
      <p className="hint">빌드: {__BUILD_TIME__}</p>
    </Gate>
  );
}
