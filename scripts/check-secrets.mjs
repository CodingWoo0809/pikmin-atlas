// 빌드 결과물(dist)과 소스(src)에 비밀 키처럼 보이는 문자열이 있는지 검사한다.
// 하나라도 발견되면 0이 아닌 코드로 끝나서 GitHub Actions 배포가 중단된다.
//   사용: node scripts/check-secrets.mjs [검사할 폴더 ...]   (기본: dist src)
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';

const targets = process.argv.slice(2).length ? process.argv.slice(2) : ['dist', 'src'];
const TEXT_EXT = new Set(['.js', '.mjs', '.ts', '.tsx', '.html', '.css', '.json', '.map', '.txt', '.md', '.env']);

const patterns = [
  { name: 'Supabase secret key', re: /sb_secret_[A-Za-z0-9_-]{8,}/ },
  { name: 'service_role 표시', re: /service_role/ },
  { name: 'Postgres 접속 주소(비밀번호 포함 가능)', re: /postgres(?:ql)?:\/\/[^\s'"]+:[^\s'"]+@/ },
  { name: '개인 키 블록', re: /-----BEGIN [A-Z ]*PRIVATE KEY-----/ },
];

// 예외: 비밀 키를 "막기 위한" 검사 코드 자체는 허용
const allowFiles = [/src[\\/]lib[\\/]env(\.test)?\.ts$/, /scripts[\\/]check-secrets\.mjs$/];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const s = statSync(p);
    if (s.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}

const findings = [];
for (const t of targets) {
  if (!existsSync(t)) continue;
  for (const file of walk(t)) {
    if (!TEXT_EXT.has(extname(file)) && extname(file) !== '') continue;
    if (allowFiles.some((re) => re.test(file))) continue;
    const text = readFileSync(file, 'utf8');
    for (const { name, re } of patterns) {
      const m = text.match(re);
      if (!m) continue;
      findings.push(`${file}: ${name} (${m[0].slice(0, 16)}…)`);
    }
  }
}

if (findings.length) {
  console.error('❌ 비밀 정보로 보이는 문자열이 발견되었습니다. 배포를 중단합니다.');
  for (const f of findings) console.error('  - ' + f);
  process.exit(1);
}
console.log(`✅ 비밀 키 검사 통과 (${targets.join(', ')})`);
