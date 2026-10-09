// 이 기기에만 기억하는 편의 설정 (실패해도 앱 동작에는 지장 없음)
export function loadPref<T extends string>(key: string, allowed: readonly T[], fallback: T): T {
  try {
    const v = localStorage.getItem(`nomad.${key}`);
    return v && (allowed as readonly string[]).includes(v) ? (v as T) : fallback;
  } catch {
    return fallback;
  }
}

export function savePref(key: string, value: string) {
  try {
    localStorage.setItem(`nomad.${key}`, value);
  } catch {
    /* 무시 */
  }
}

// 편집 중인 글자 임시 보관 (오프라인·실수로 닫음 대비). 사진은 보관하지 않는다.
export function loadDraft<T>(key: string): T | null {
  try {
    const v = localStorage.getItem(`nomad.draft.${key}`);
    return v ? (JSON.parse(v) as T) : null;
  } catch {
    return null;
  }
}

export function saveDraft(key: string, value: unknown) {
  try {
    localStorage.setItem(`nomad.draft.${key}`, JSON.stringify(value));
  } catch {
    /* 무시 */
  }
}

export function clearDraft(key: string) {
  try {
    localStorage.removeItem(`nomad.draft.${key}`);
  } catch {
    /* 무시 */
  }
}
