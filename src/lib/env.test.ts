import { describe, expect, it } from 'vitest';
import { looksLikeSecret, readConfig } from './env';

const good = {
  VITE_SUPABASE_URL: 'https://abcdefgh.supabase.co',
  VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_test123',
  VITE_OWNER_EMAIL: 'owner@nomad-atlas.invalid',
};

function fakeJwt(payload: object) {
  const b64 = (o: object) => btoa(JSON.stringify(o)).replace(/=+$/, '');
  return `${b64({ alg: 'HS256' })}.${b64(payload)}.sig`;
}

describe('readConfig', () => {
  it('정상 값은 통과한다', () => {
    const r = readConfig(good);
    expect(r.ok).toBe(true);
  });

  it('값이 비어 있으면 문제 목록을 돌려준다', () => {
    const r = readConfig({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems.length).toBe(3);
  });

  it('Turnstile 값이 없어도 통과한다', () => {
    expect(readConfig({ ...good }).ok).toBe(true);
  });

  it('sb_secret_ 키가 들어오면 거부한다', () => {
    const r = readConfig({ ...good, VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_abc' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.problems[0]).toContain('비밀 키');
  });

  it('service_role JWT가 들어오면 거부한다', () => {
    const r = readConfig({ ...good, VITE_SUPABASE_PUBLISHABLE_KEY: fakeJwt({ role: 'service_role' }) });
    expect(r.ok).toBe(false);
  });
});

describe('looksLikeSecret', () => {
  it('anon JWT는 비밀 키로 보지 않는다', () => {
    expect(looksLikeSecret(fakeJwt({ role: 'anon' }))).toBe(false);
  });
  it('publishable 키는 비밀 키가 아니다', () => {
    expect(looksLikeSecret('sb_publishable_x')).toBe(false);
  });
});
