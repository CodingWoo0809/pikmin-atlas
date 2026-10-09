# Nomad Atlas

나 혼자 쓰는 비공개 피크민 블룸 장소 도감 웹앱 (iPhone · PC).

- 화면: Vite + React + TypeScript, Hash Routing → GitHub Pages
- 로그인·데이터·사진: Supabase (Auth, Postgres + RLS, 비공개 Storage)
- 로봇 차단: Cloudflare Turnstile

이 저장소는 공개되어 있지만 **비밀 정보와 도감 데이터는 들어 있지 않습니다.** 데이터와 사진은 Supabase에만 있고, 로그인한 주인만 접근할 수 있습니다.

## 문서
- 설계: [docs/DESIGN.md](docs/DESIGN.md)

## 설정값 (Repository variables)

GitHub 저장소 → Settings → Secrets and variables → Actions → **Variables** 탭에 등록합니다. 모두 공개해도 되는 값입니다.

| 이름 | 예시 |
|---|---|
| `VITE_SUPABASE_URL` | `https://xxxx.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` |
| `VITE_OWNER_EMAIL` | 주인 계정용 내부 주소 |
| `VITE_TURNSTILE_SITE_KEY` | Turnstile Site key |

**절대 등록하지 않는 값**: `sb_secret_...` 키, Turnstile Secret key, DB 비밀번호.

## 자동 배포

`main` 브랜치에 올리면 GitHub Actions가 테스트 → 소스 비밀 키 검사 → 빌드 → 빌드 결과 비밀 키 검사 → 배포를 순서대로 실행합니다. 검사에서 비밀 키로 보이는 문자열이 나오면 배포가 중단됩니다.

## 로컬 개발 (선택)

```bash
npm ci
cp .env.example .env.local   # 값 채우기
npm run dev
npm test
```
