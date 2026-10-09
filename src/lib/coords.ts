// 좌표 표시·입력·중복 판정

/** 표시용: 최대 소수 7자리, 끝의 0 제거 */
export function formatCoord(n: number): string {
  if (!Number.isFinite(n)) return '';
  const s = n.toFixed(7);
  return s.replace(/\.?0+$/, '');
}

/** 복사 형식: "37.566535, 126.977969" */
export function coordText(lat: number, lng: number): string {
  return `${formatCoord(lat)}, ${formatCoord(lng)}`;
}

export function parseNumber(raw: string | number | null | undefined): number | null {
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null;
  if (raw == null) return null;
  const s = String(raw).trim().replace(/[°\s]/g, '');
  if (!/^[+-]?(\d+(\.\d*)?|\.\d+)$/.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

export function latProblem(lat: number | null): string | null {
  if (lat == null) return '위도를 숫자로 입력하세요.';
  if (lat < -90 || lat > 90) return '위도는 -90 ~ 90 사이여야 합니다.';
  return null;
}

export function lngProblem(lng: number | null): string | null {
  if (lng == null) return '경도를 숫자로 입력하세요.';
  if (lng < -180 || lng > 180) return '경도는 -180 ~ 180 사이여야 합니다.';
  return null;
}

/** "37.5, 126.9" 처럼 한 줄에 붙여 넣은 좌표를 나눈다. 아니면 null */
export function splitPair(raw: string): { lat: string; lng: string } | null {
  const m = raw.trim().match(/^\(?\s*([+-]?[\d.]+)\s*[,\s/]\s*([+-]?[\d.]+)\s*\)?$/);
  if (!m) return null;
  if (parseNumber(m[1]) == null || parseNumber(m[2]) == null) return null;
  return { lat: m[1], lng: m[2] };
}

/** 중복 판정 키: 같은 카테고리 + 위도·경도를 소수점 다섯째 자리까지 반올림 */
export function dupKey(category: string, lat: number, lng: number): string {
  const r = (n: number) => {
    const v = Math.round(n * 1e5);
    return Object.is(v, -0) ? 0 : v;
  };
  return `${category}|${r(lat)}|${r(lng)}`;
}
