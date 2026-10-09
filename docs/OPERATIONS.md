# 운영 안내 (설정·복구)

이 문서에는 비밀 정보가 없습니다. 비밀번호·비밀 키는 여기에 적지 마세요.

## 1. 처음 한 번만 하는 Supabase 설정

### 1-1. 데이터베이스·사진 저장소 만들기
1. https://supabase.com/dashboard 접속 → 이 도감용 프로젝트 선택
2. 왼쪽 메뉴 **SQL Editor** → **New query**
3. 저장소의 `supabase/migrations/001_init.sql` 내용을 **전부** 붙여 넣고 **Run**
4. 아래쪽에 `Success. No rows returned`가 보이면 성공
   - 여러 번 실행해도 안전합니다(이미 있는 것은 건너뛰거나 다시 맞춥니다).
   - 결과 확인: 왼쪽 **Table Editor**에 `places`, `photos`, `deco_categories`, `owner_settings`, `restore_snapshots`가 보이고, **Storage**에 `nomad-private` 버킷이 **Private**로 보이면 정상입니다.

### 1-2. 로그인 설정 (Authentication)
- **Authentication → Sign In / Providers**
  - `Allow new users to sign up` **끄기** (방문자가 계정을 만들 수 없게)
  - `Allow anonymous sign-ins` **끄기**
  - Email provider: `Confirm email`은 상관없음(주인 계정은 Auto Confirm으로 만듦), `Secure password change` **끄기**
- **Authentication → Policies(또는 Password Security)**: 최소 길이 6, 필수 문자 조건 **없음**
- Turnstile(CAPTCHA)은 쓰지 않으므로 **Attack Protection의 CAPTCHA는 꺼진 상태**여야 합니다. 켜져 있으면 로그인이 실패합니다.

### 1-3. 주인 계정 만들기
1. **Authentication → Users → Add user → Create new user**
2. Email: GitHub 변수 `VITE_OWNER_EMAIL`과 **똑같은 주소** (예: `owner@nomad-atlas.invalid`처럼 실제로 메일을 받지 않는 주소도 가능)
3. Password: 임시 비밀번호를 **소문자로** 6~12자 (예: `temp1234`)
4. **Auto Confirm User** 체크 → Create user
5. SQL Editor에서 `supabase/setup_owner.sql`을 열어 이메일을 같은 주소로 바꾼 뒤 Run → 결과 1행이 보이면 성공
6. 배포된 사이트에서 임시 비밀번호로 들어가면 "새 비밀번호 정하기" 화면이 나옵니다.

> 이 단계(5)를 빼먹으면 로그인 후 "주인 계정이 아닙니다" 화면이 나오고 데이터에 접근할 수 없습니다. 가입이 실수로 열려 있어도 주인으로 지정된 계정 1개 외에는 아무것도 볼 수 없습니다.

## 2. GitHub 설정
- 저장소 → **Settings → Secrets and variables → Actions → Variables** 탭에 아래 3개 (모두 공개해도 되는 값)
  - `VITE_SUPABASE_URL` = `https://xxxx.supabase.co`
  - `VITE_SUPABASE_PUBLISHABLE_KEY` = `sb_publishable_...`
  - `VITE_OWNER_EMAIL` = 주인 계정 이메일
  - (이전에 만든 `VITE_TURNSTILE_SITE_KEY`는 더 이상 쓰지 않으므로 지워도 됩니다)
- **Settings → Pages → Source = GitHub Actions**
- `main`에 올리면 자동으로 타입 검사 → 테스트(SQL 검증 포함) → 비밀 키 검사 → 빌드 → 배포됩니다. **Actions** 탭에서 초록색 체크가 보이면 성공.

## 3. 비밀번호를 잊었을 때 (복구)
1. Supabase 대시보드 → 프로젝트 → **SQL Editor → New query**
2. 아래 SQL에서 `새비밀번호`와 이메일을 바꾼 뒤 Run
   - 새 비밀번호는 **소문자**로, 6~12자, 영문·숫자·특수문자 (공백·한글 불가)

```sql
update auth.users
   set encrypted_password = extensions.crypt(lower('새비밀번호'), extensions.gen_salt('bf', 10)),
       updated_at = now()
 where email = lower('owner@nomad-atlas.invalid');
```
3. `Success. 1 rows affected`가 보이면 앱에서 새 비밀번호로 로그인
   - 0 rows면 이메일이 다른 것입니다. **Authentication → Users**에서 주소를 확인하세요.
   - 이 SQL은 작업 환경의 Postgres에서 문법과 해시 생성을 검증했습니다. 실제 Supabase에서 처음 쓸 때 한 번 시험해 두는 것을 권장합니다(예: 지금 비밀번호와 같은 값으로 실행 후 로그인 확인).
- 대시보드 계정이 곧 도감 열쇠입니다. GitHub·Supabase 계정에 2단계 인증을 켜 두세요.

## 4. 프로젝트가 일시정지되었을 때
무료 플랜은 1주일 넘게 쓰지 않으면 프로젝트가 멈출 수 있습니다. 앱에 "서버에 연결할 수 없습니다"가 계속 보이면 대시보드에서 프로젝트를 열고 **Resume project**를 누르세요. 몇 분 뒤 앱이 다시 동작합니다.

## 5. 보안 점검 방법 (비로그인 상태에서 데이터가 안 보이는지)
브라우저 주소창이 아닌, 터미널이 있다면:
```bash
# 표: 401 또는 권한 오류(42501)가 나와야 정상
curl "https://xxxx.supabase.co/rest/v1/places?select=*" -H "apikey: sb_publishable_..."
# 사진: 400/404 (Object not found)가 나와야 정상
curl "https://xxxx.supabase.co/storage/v1/object/public/nomad-private/아무경로.jpg"
```

## 6. 백업 습관
- 설정 → 백업·복원 → **백업 ZIP 내려받기**. 14일 넘게 백업하지 않으면 화면 위에 알림이 나옵니다.
- ZIP 파일은 iCloud Drive·PC 등 Supabase 밖에 보관하세요. 무료 플랜에는 자동 백업이 없습니다.
- 복원은 "검사 → 안전 백업 내려받기 → 사진 업로드 → 도감 교체 → 확인 후 확정" 순서입니다. 확정 전까지는 **복원 되돌리기**로 이전 상태로 돌아갈 수 있습니다.

## 7. 가져오기 파일 형식
- CSV 열: `이름, 카테고리, 위도, 경도, 설명, 즐겨찾기, 데코분류` (영문 `name, category, lat, lng, description, favorite, deco_category`)
  - 카테고리: `버섯`/`빅플라워`/`데코` (또는 `mushroom`/`bigflower`/`deco`)
  - 즐겨찾기: `예`/`아니오`, `true`/`false`, `1`/`0`, 빈칸=아니오
  - 데코분류: 데코에만. 없는 이름이면 새로 만듭니다. 빈칸=미분류
- 인코딩: UTF-8(엑셀 "CSV UTF-8") 또는 한글 CP949(엑셀 "CSV") 자동 인식
- JSON: `{ "format": "nomad-atlas-import", "version": 1, "deco_categories": [{"name":"카페","icon":"☕"}], "places": [ {...} ] }`
- 앱의 가져오기 화면에서 CSV·JSON 예시 파일을 내려받을 수 있습니다.
