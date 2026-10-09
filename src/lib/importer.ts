// CSV·JSON 가져오기: 글자 인코딩 판별 → 해석 → 행별 검사 → 중복 판정 → 서버로 보낼 내용 만들기
import Papa from 'papaparse';
import { dupKey, parseNumber } from './coords';
import type { Category, DecoCategory, Place } from './types';

export type RowStatus = 'ok' | 'error' | 'duplicate';
export type DupAction = 'skip' | 'add';

export type ImportRow = {
  line: number; // 원본 파일의 줄 번호(머리글 다음 줄 = 2) 또는 JSON 순번(1부터)
  name: string;
  category: Category | null;
  lat: number | null;
  lng: number | null;
  description: string;
  favorite: boolean;
  decoCategoryName: string; // 데코만. 빈 값 = 미분류
  errors: string[];
  duplicateOf: 'existing' | 'file' | null;
  action: DupAction; // 중복 행 처리 방법 (기본 건너뛰기)
};

export type ImportPreview = {
  rows: ImportRow[];
  newCategoryNames: string[];
  encoding: 'utf-8' | 'cp949' | 'json';
  fileErrors: string[];
};

// ---------- 인코딩 ----------
export function decodeText(buf: ArrayBuffer): { text: string; encoding: 'utf-8' | 'cp949' } {
  const bytes = new Uint8Array(buf);
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    return { text: text.replace(/^\uFEFF/, ''), encoding: 'utf-8' };
  } catch {
    // 엑셀에서 "CSV"로 저장한 한글 파일 (CP949 = euc-kr 확장)
    const text = new TextDecoder('euc-kr').decode(bytes);
    return { text, encoding: 'cp949' };
  }
}

// ---------- 머리글·값 해석 ----------
const HEADER_ALIASES: Record<string, keyof RawRecord> = {
  name: 'name', 이름: 'name', 장소: 'name', 장소명: 'name',
  category: 'category', 카테고리: 'category', 종류: 'category', 분류: 'category',
  lat: 'lat', latitude: 'lat', 위도: 'lat',
  lng: 'lng', lon: 'lng', long: 'lng', longitude: 'lng', 경도: 'lng',
  description: 'description', desc: 'description', 설명: 'description', 메모: 'description',
  favorite: 'favorite', is_favorite: 'favorite', 즐겨찾기: 'favorite',
  deco_category: 'deco_category', decocategory: 'deco_category', 데코분류: 'deco_category', 데코: 'deco_category', 데코카테고리: 'deco_category',
};

type RawRecord = {
  name?: unknown;
  category?: unknown;
  lat?: unknown;
  lng?: unknown;
  description?: unknown;
  favorite?: unknown;
  deco_category?: unknown;
};

function normHeader(h: string) {
  return h.replace(/^\uFEFF/, '').trim().toLowerCase().replace(/[\s-]+/g, '');
}

export function parseCategory(v: unknown): Category | null {
  const s = String(v ?? '').trim().toLowerCase().replace(/\s+/g, '');
  if (['mushroom', '버섯'].includes(s)) return 'mushroom';
  if (['bigflower', 'big_flower', 'flower', '빅플라워', '빅플', '큰꽃'].includes(s)) return 'bigflower';
  if (['deco', 'decor', '데코', '단일데코', '단일데코스팟', '데코스팟'].includes(s)) return 'deco';
  return null;
}

export function parseBool(v: unknown): boolean | null {
  if (typeof v === 'boolean') return v;
  const s = String(v ?? '').trim().toLowerCase();
  if (s === '') return false;
  if (['true', '1', 'y', 'yes', 'o', '예', '네', '★', '⭐', 'v'].includes(s)) return true;
  if (['false', '0', 'n', 'no', 'x', '아니오', '아니요', '-'].includes(s)) return false;
  return null;
}

function str(v: unknown): string {
  if (v == null) return '';
  return String(v).trim();
}

function buildRow(rec: RawRecord, line: number): ImportRow {
  const errors: string[] = [];
  const name = str(rec.name);
  if (!name) errors.push('이름이 비어 있습니다.');
  else if (name.length > 100) errors.push('이름이 100자를 넘습니다.');

  const rawCat = str(rec.category);
  const category = parseCategory(rawCat);
  if (!rawCat) errors.push('카테고리가 비어 있습니다.');
  else if (!category) errors.push(`카테고리 "${rawCat}"를 알 수 없습니다. (버섯/빅플라워/데코)`);

  const lat = parseNumber(rec.lat as string);
  const lng = parseNumber(rec.lng as string);
  if (lat == null) errors.push('위도가 숫자가 아닙니다.');
  else if (lat < -90 || lat > 90) errors.push('위도는 -90 ~ 90 사이여야 합니다.');
  if (lng == null) errors.push('경도가 숫자가 아닙니다.');
  else if (lng < -180 || lng > 180) errors.push('경도는 -180 ~ 180 사이여야 합니다.');

  const description = str(rec.description);
  if (description.length > 2000) errors.push('설명이 2000자를 넘습니다.');

  const fav = parseBool(rec.favorite);
  if (fav == null) errors.push(`즐겨찾기 값 "${str(rec.favorite)}"을 알 수 없습니다. (예/아니오, true/false)`);

  const decoCategoryName = str(rec.deco_category);
  if (decoCategoryName && category && category !== 'deco') errors.push('데코 분류는 데코 장소에만 쓸 수 있습니다.');
  if (decoCategoryName.length > 50) errors.push('데코 분류 이름이 50자를 넘습니다.');

  return {
    line,
    name,
    category,
    lat,
    lng,
    description,
    favorite: fav ?? false,
    decoCategoryName: category === 'deco' ? decoCategoryName : '',
    errors,
    duplicateOf: null,
    action: 'skip',
  };
}

export function parseCsv(text: string): { records: { rec: RawRecord; line: number }[]; fileErrors: string[] } {
  const fileErrors: string[] = [];
  const res = Papa.parse<string[]>(text, { skipEmptyLines: 'greedy' });
  const data = res.data as string[][];
  if (data.length === 0) return { records: [], fileErrors: ['파일이 비어 있습니다.'] };
  const header = data[0].map((h) => HEADER_ALIASES[normHeader(h)] ?? null);
  for (const need of ['name', 'category', 'lat', 'lng'] as const) {
    if (!header.includes(need)) {
      const ko = { name: '이름', category: '카테고리', lat: '위도', lng: '경도' }[need];
      fileErrors.push(`필수 열 "${need}"(${ko})이 없습니다.`);
    }
  }
  for (const e of res.errors.slice(0, 5)) {
    if (e.code === 'TooFewFields' || e.code === 'TooManyFields') continue;
    fileErrors.push(`${(e.row ?? 0) + 1}번째 행: ${e.message}`);
  }
  if (fileErrors.length) return { records: [], fileErrors };
  const records = data.slice(1).map((cols, i) => {
    const rec: RawRecord = {};
    header.forEach((key, idx) => {
      if (key) rec[key] = cols[idx];
    });
    return { rec, line: i + 2 };
  });
  return { records, fileErrors };
}

export function parseJson(text: string): {
  records: { rec: RawRecord; line: number }[];
  categories: { name: string; icon: string }[];
  fileErrors: string[];
} {
  let obj: unknown;
  try {
    obj = JSON.parse(text.replace(/^\uFEFF/, ''));
  } catch {
    return { records: [], categories: [], fileErrors: ['JSON 형식이 올바르지 않습니다.'] };
  }
  const o = obj as Record<string, unknown>;
  let places: unknown = o;
  let cats: unknown = [];
  if (!Array.isArray(obj)) {
    if (o.format !== undefined && o.format !== 'nomad-atlas-import') {
      return { records: [], categories: [], fileErrors: [`지원하지 않는 형식입니다: ${String(o.format)}`] };
    }
    places = o.places;
    cats = o.deco_categories ?? [];
  }
  if (!Array.isArray(places)) return { records: [], categories: [], fileErrors: ['"places" 목록이 없습니다.'] };
  const categories = Array.isArray(cats)
    ? cats
        .map((c) => (typeof c === 'string' ? { name: c, icon: '' } : { name: str((c as RawRecord & { icon?: unknown }).name), icon: str((c as { icon?: unknown }).icon).slice(0, 16) }))
        .filter((c) => c.name)
    : [];
  const records = places.map((p, i) => {
    const r = (p ?? {}) as Record<string, unknown>;
    const rec: RawRecord = {};
    for (const [k, v] of Object.entries(r)) {
      const key = HEADER_ALIASES[normHeader(k)];
      if (key) rec[key] = v;
    }
    return { rec, line: i + 1 };
  });
  return { records, categories, fileErrors: [] };
}

/** 미리보기 만들기: 행 검사 + 중복 판정 + 새로 만들 분류 */
export function buildPreview(
  records: { rec: RawRecord; line: number }[],
  existing: Place[],
  existingCategories: DecoCategory[],
  extraCategories: { name: string; icon: string }[] = [],
): { rows: ImportRow[]; newCategoryNames: string[] } {
  const rows = records.map(({ rec, line }) => buildRow(rec, line));

  // 휴지통 항목도 "이미 있는 기록"으로 본다 (복구하면 겹치므로)
  const seen = new Set(existing.map((p) => dupKey(p.category, p.lat, p.lng)));
  const fileSeen = new Set<string>();
  for (const r of rows) {
    if (r.errors.length || !r.category || r.lat == null || r.lng == null) continue;
    const key = dupKey(r.category, r.lat, r.lng);
    if (seen.has(key)) r.duplicateOf = 'existing';
    else if (fileSeen.has(key)) r.duplicateOf = 'file';
    fileSeen.add(key);
  }

  const known = new Set(existingCategories.filter((c) => !c.deleted_at).map((c) => c.name.toLowerCase()));
  const newNames = new Map<string, string>();
  for (const c of extraCategories) {
    if (!known.has(c.name.toLowerCase())) newNames.set(c.name.toLowerCase(), c.name);
  }
  for (const r of rows) {
    if (r.errors.length || !r.decoCategoryName) continue;
    const k = r.decoCategoryName.toLowerCase();
    if (!known.has(k) && !newNames.has(k)) newNames.set(k, r.decoCategoryName);
  }
  return { rows, newCategoryNames: [...newNames.values()] };
}

export function rowStatus(r: ImportRow): RowStatus {
  if (r.errors.length) return 'error';
  if (r.duplicateOf) return 'duplicate';
  return 'ok';
}

export function summarize(rows: ImportRow[]) {
  let add = 0, skip = 0, error = 0;
  for (const r of rows) {
    const s = rowStatus(r);
    if (s === 'error') error++;
    else if (s === 'duplicate' && r.action === 'skip') skip++;
    else add++;
  }
  return { add, skip, error };
}

export type ImportPayload = {
  new_categories: { id: string; name: string; icon: string }[];
  places: {
    category: Category;
    deco_category_id: string | null;
    name: string;
    description: string;
    lat: number;
    lng: number;
    is_favorite: boolean;
  }[];
};

/** 서버(import_records)로 보낼 내용. 오류 행과 '건너뛰기'로 둔 중복 행은 빠진다. */
export function buildPayload(
  rows: ImportRow[],
  existingCategories: DecoCategory[],
  extraCategories: { name: string; icon: string }[] = [],
  makeId: () => string = () => crypto.randomUUID(),
): ImportPayload {
  const byName = new Map(existingCategories.filter((c) => !c.deleted_at).map((c) => [c.name.toLowerCase(), c.id]));
  const icons = new Map(extraCategories.map((c) => [c.name.toLowerCase(), c.icon]));
  const new_categories: ImportPayload['new_categories'] = [];
  const places: ImportPayload['places'] = [];
  const ensure = (name: string) => {
    const k = name.toLowerCase();
    let id = byName.get(k);
    if (!id) {
      id = makeId();
      byName.set(k, id);
      new_categories.push({ id, name, icon: icons.get(k) ?? '' });
    }
    return id;
  };
  for (const r of rows) {
    const s = rowStatus(r);
    if (s === 'error' || (s === 'duplicate' && r.action === 'skip')) continue;
    places.push({
      category: r.category!,
      deco_category_id: r.category === 'deco' && r.decoCategoryName ? ensure(r.decoCategoryName) : null,
      name: r.name,
      description: r.description,
      lat: r.lat!,
      lng: r.lng!,
      is_favorite: r.favorite,
    });
  }
  // JSON에 분류만 적혀 있고 장소가 없는 경우도 분류는 만든다
  for (const c of extraCategories) ensure(c.name);
  return { new_categories, places };
}

export async function readImportFile(
  file: File,
  existing: Place[],
  existingCategories: DecoCategory[],
): Promise<ImportPreview & { extraCategories: { name: string; icon: string }[] }> {
  if (file.size > 10 * 1024 * 1024) {
    return { rows: [], newCategoryNames: [], encoding: 'utf-8', fileErrors: ['파일이 10MB를 넘습니다.'], extraCategories: [] };
  }
  const buf = await file.arrayBuffer();
  const isJson = /\.json$/i.test(file.name) || file.type === 'application/json';
  if (isJson) {
    const { text } = decodeText(buf);
    const r = parseJson(text);
    const p = buildPreview(r.records, existing, existingCategories, r.categories);
    return { ...p, encoding: 'json', fileErrors: r.fileErrors, extraCategories: r.categories };
  }
  const { text, encoding } = decodeText(buf);
  const r = parseCsv(text);
  const p = buildPreview(r.records, existing, existingCategories);
  return { ...p, encoding, fileErrors: r.fileErrors, extraCategories: [] };
}

export const SAMPLE_CSV =
  '이름,카테고리,위도,경도,설명,즐겨찾기,데코분류\n' +
  '광화문광장 버섯,버섯,37.572389,126.976863,주말 오전에 자주 열림,예,\n' +
  '서울숲 빅플라워,빅플라워,37.544388,127.037442,,아니오,\n' +
  '스타벅스 시청점,데코,37.565418,126.977537,,아니오,카페\n';

export const SAMPLE_JSON = JSON.stringify(
  {
    format: 'nomad-atlas-import',
    version: 1,
    deco_categories: [{ name: '카페', icon: '☕' }],
    places: [
      { name: '광화문광장 버섯', category: 'mushroom', lat: 37.572389, lng: 126.976863, description: '주말 오전에 자주 열림', favorite: true },
      { name: '스타벅스 시청점', category: 'deco', lat: 37.565418, lng: 126.977537, deco_category: '카페' },
    ],
  },
  null,
  2,
);
