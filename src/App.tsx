import { useState } from 'react';
import { appConfig } from './lib/env';

// 2단계(인프라 설정) 동안 쓰는 임시 화면.
// 배포가 정상인지, 설정값이 모두 들어왔는지, Supabase에 닿는지만 확인한다.
// 비밀번호 화면과 도감은 3단계부터 이 자리를 대체한다.

type Check = 'idle' | 'checking' | 'ok' | 'fail';

export default function App() {
  const [check, setCheck] = useState<Check>('idle');
  const [detail, setDetail] = useState('');

  async function checkSupabase() {
    if (!appConfig.ok) return;
    setCheck('checking');
    setDetail('');
    try {
      const res = await fetch(`${appConfig.config.supabaseUrl}/auth/v1/health`, {
        headers: { apikey: appConfig.config.supabasePublishableKey },
      });
      if (res.ok) {
        setCheck('ok');
      } else {
        setCheck('fail');
        setDetail(`응답 코드 ${res.status}`);
      }
    } catch (e) {
      setCheck('fail');
      setDetail(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <main className="setup">
      <h1>Nomad Atlas</h1>
      <p className="muted">인프라 설정 확인 화면 (임시)</p>

      <section className="card">
        <h2>1. 설정값</h2>
        {appConfig.ok ? (
          <p className="ok">✓ 공개 설정값 4개가 모두 들어왔습니다.</p>
        ) : (
          <>
            <p className="fail">설정값이 부족합니다.</p>
            <ul>
              {appConfig.problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          </>
        )}
      </section>

      <section className="card">
        <h2>2. Supabase 연결</h2>
        <button type="button" onClick={checkSupabase} disabled={!appConfig.ok || check === 'checking'}>
          {check === 'checking' ? '확인 중…' : '연결 확인'}
        </button>
        {check === 'ok' && <p className="ok">✓ Supabase에 연결되었습니다.</p>}
        {check === 'fail' && (
          <p className="fail">
            연결 실패 {detail && `(${detail})`} — 프로젝트가 일시정지 상태인지, 주소와 키가 맞는지 확인하세요.
          </p>
        )}
      </section>

      <p className="muted small">빌드: {__BUILD_TIME__}</p>
    </main>
  );
}
