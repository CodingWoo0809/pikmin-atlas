// 비밀번호 규칙 (설계 3.2)
// - 6~12자, 영문·숫자·키보드 특수문자 (공백·한글 불가)
// - 대소문자 구분 없음 → 규칙 검사 후 항상 소문자로 바꿔서 서버에 보낸다

const ALLOWED = /^[\x21-\x7E]+$/; // ! 부터 ~ 까지 (공백 제외 출력 가능한 ASCII)

export function passwordProblem(raw: string): string | null {
  if (raw.length === 0) return '비밀번호를 입력하세요.';
  if (!ALLOWED.test(raw)) return '영문, 숫자, 특수문자만 쓸 수 있습니다. (공백·한글 불가)';
  if (raw.length < 6) return '6자 이상이어야 합니다.';
  if (raw.length > 12) return '12자 이하여야 합니다.';
  return null;
}

export function normalizePassword(raw: string): string {
  return raw.toLowerCase();
}
