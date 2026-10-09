# Nomad Atlas

나 혼자 쓰는 비공개 피크민 블룸 장소 도감 웹앱 (iPhone · PC).

- 화면: Vite + React + TypeScript, Hash Routing → GitHub Pages
- 로그인·데이터·사진: Supabase (Auth, Postgres + RLS, 비공개 Storage)
- 로봇 차단(Turnstile)은 쓰지 않습니다.

이 저장소는 공개되어 있지만 **비밀 정보와 도감 데이터는 들어 있지 않습니다.** 데이터와 사진은 Supabase에만 있고, 주인으로 지정된 계정 1개만 접근할 수 있습니다(RLS + 비공개 버킷 + 주인 지정 표).

## 기능
- 버섯 · 빅플라워: 사진 갤러리(iPhone 4열), 좌표 눌러 복사, 즐겨찾기, 정렬(최신·오래된·이름·즐겨찾기), 검색
- 단일 데코 스팟: 데코 분류(이모지/그림 아이콘) 직접 관리, 분류별 후보 장소 2열 카드
- 사진: 브라우저에서 자동 압축(표시용 1600px + 썸네일 480px), 비공개 저장소, 만료되는 주소로 표시
- 삭제 → 되돌리기, 휴지통(영구 삭제 전까지 보관)
- iPhone ↔ PC 동기화(앱으로 돌아올 때·저장 직후·네트워크 복구 시 다시 불러오기), 동시 수정 충돌 감지
- CSV(UTF-8/CP949)·JSON 가져오기: 미리보기, 오류 검사, 중복(같은 카테고리 + 좌표 소수 5자리) 기본 건너뛰기·행별 변경, 추가만 수행
- ZIP 백업(데이터 + 압축 사진 + 휴지통) / 복원(검증 → 안전 백업 → 교체 → 확정 또는 되돌리기)
- 로그인: 비밀번호 하나(6~12자, 대소문자 구분 없음), 최초 비밀번호 설정, 변경, 이 기기/모든 기기 로그아웃

## 문서
- 설계: [docs/DESIGN.md](docs/DESIGN.md)
- 설정·복구 안내: [docs/OPERATIONS.md](docs/OPERATIONS.md)
- DB SQL: [supabase/migrations/001_init.sql](supabase/migrations/001_init.sql), 주인 지정: [supabase/setup_owner.sql](supabase/setup_owner.sql)

## 설정값 (Repository variables)

GitHub 저장소 → Settings → Secrets and variables → Actions → **Variables** 탭에 등록합니다. 모두 공개해도 되는 값입니다.

| 이름 | 예시 |
|---|---|
| `VITE_SUPABASE_URL` | `https://xxxx.supabase.co` |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | `sb_publishable_...` |
| `VITE_OWNER_EMAIL` | 주인 계정용 주소 |

**절대 등록하지 않는 값**: `sb_secret_...` 키, DB 비밀번호.

## 자동 배포

`main` 브랜치에 올리면 GitHub Actions가 타입 검사 → 테스트(SQL 검증 포함) → 소스 비밀 키 검사 → 빌드 → 빌드 결과 비밀 키 검사 → 배포를 순서대로 실행합니다. 검사에서 비밀 키로 보이는 문자열이 나오면 배포가 중단됩니다.

## 로컬 개발 (선택)

```bash
npm ci
cp .env.example .env.local   # 값 채우기
npm run dev
npm test        # 단위 테스트 + 로컬 Postgres(PGlite)로 SQL·RLS 검증
npx tsc -b      # 타입 검사
```
