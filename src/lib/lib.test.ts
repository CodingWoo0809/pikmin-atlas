import { createHash } from 'node:crypto';
import { strToU8, unzipSync, zipSync } from 'fflate';
import { describe, expect, it } from 'vitest';
import { buildBackupZip, rewriteForOwner, validateBackupZip, type BackupData } from './backup';
import { coordText, dupKey, formatCoord, parseNumber, splitPair } from './coords';
import { buildPayload, decodeText, parseCsv, parseJson, buildPreview, summarize, SAMPLE_CSV, SAMPLE_JSON } from './importer';
import { normalizePassword, passwordProblem } from './password';
import { sortPlaces } from './sort';
import type { DecoCategory, Place } from './types';

const sha = async (d: Uint8Array) => createHash('sha256').update(d).digest('hex');

function place(p: Partial<Place>): Place {
  return {
    id: crypto.randomUUID(), category: 'mushroom', deco_category_id: null, name: '장소', description: '',
    lat: 37.5, lng: 127, photo_id: null, is_favorite: false, seq: 1, version: 1,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null, ...p,
  };
}
function cat(c: Partial<DecoCategory>): DecoCategory {
  return {
    id: crypto.randomUUID(), name: '카페', icon: '☕', icon_photo_id: null, sort_order: 1, version: 1,
    created_at: '2026-01-01T00:00:00.000Z', updated_at: '2026-01-01T00:00:00.000Z', deleted_at: null, ...c,
  };
}

describe('비밀번호 규칙', () => {
  it('6~12자, 영문·숫자·특수문자만', () => {
    expect(passwordProblem('abc12')).toMatch(/6자/);
    expect(passwordProblem('abcdefghijklm')).toMatch(/12자/);
    expect(passwordProblem('abc 123')).toMatch(/공백/);
    expect(passwordProblem('비밀번호123')).toMatch(/한글/);
    expect(passwordProblem('Nomad#2026')).toBeNull();
    expect(passwordProblem('~!@#$%^&*()')).toBeNull();
  });
  it('대소문자 구분 없음 → 소문자로 정규화', () => {
    expect(normalizePassword('Nomad#2026')).toBe('nomad#2026');
    expect(normalizePassword('NOMAD#2026')).toBe(normalizePassword('nomad#2026'));
  });
});

describe('좌표', () => {
  it('표시: 최대 7자리, 끝 0 제거', () => {
    expect(formatCoord(37.5665350)).toBe('37.566535');
    expect(formatCoord(126.123456789)).toBe('126.1234568');
    expect(formatCoord(127)).toBe('127');
    expect(coordText(37.566535, 126.977969)).toBe('37.566535, 126.977969');
  });
  it('입력 해석', () => {
    expect(parseNumber(' 37.5 ')).toBe(37.5);
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('37.5.1')).toBeNull();
    expect(splitPair('37.566535, 126.977969')).toEqual({ lat: '37.566535', lng: '126.977969' });
    expect(splitPair('(37.5 127.1)')).toEqual({ lat: '37.5', lng: '127.1' });
    expect(splitPair('37.5')).toBeNull();
  });
  it('중복 키: 소수점 다섯째 자리 반올림, 카테고리별', () => {
    expect(dupKey('mushroom', 37.123454, 127.000001)).toBe(dupKey('mushroom', 37.123449, 126.999996));
    expect(dupKey('mushroom', 37.12345, 127)).not.toBe(dupKey('mushroom', 37.12346, 127));
    expect(dupKey('mushroom', 37.1, 127)).not.toBe(dupKey('bigflower', 37.1, 127));
  });
});

describe('정렬', () => {
  const a = place({ name: '나무', created_at: '2026-01-01T00:00:00Z', seq: 1 });
  const b = place({ name: '가로수', created_at: '2026-01-02T00:00:00Z', seq: 2, is_favorite: true });
  const c = place({ name: '다리', created_at: '2026-01-02T00:00:00Z', seq: 3 });
  it('최신순은 같은 시각이면 등록 순번이 큰 것이 먼저', () => {
    expect(sortPlaces([a, b, c], 'newest').map((p) => p.name)).toEqual(['다리', '가로수', '나무']);
    expect(sortPlaces([a, b, c], 'oldest').map((p) => p.name)).toEqual(['나무', '가로수', '다리']);
  });
  it('이름순(가나다), 즐겨찾기순', () => {
    expect(sortPlaces([a, b, c], 'name').map((p) => p.name)).toEqual(['가로수', '나무', '다리']);
    expect(sortPlaces([a, b, c], 'favorite')[0].name).toBe('가로수');
  });
});

describe('가져오기', () => {
  it('UTF-8(BOM)과 CP949를 자동 인식', () => {
    const utf8 = new TextEncoder().encode('\uFEFF이름,카테고리\n버섯1,버섯');
    expect(decodeText(utf8.buffer as ArrayBuffer)).toEqual({ text: '이름,카테고리\n버섯1,버섯', encoding: 'utf-8' });
    // "이름,버섯" 을 CP949로 저장한 바이트
    const cp949 = new Uint8Array([0xc0, 0xcc, 0xb8, 0xa7, 0x2c, 0xb9, 0xf6, 0xbc, 0xb8]);
    expect(decodeText(cp949.buffer)).toEqual({ text: '이름,버섯', encoding: 'cp949' });
  });

  it('샘플 CSV: 한글 머리글, 데코 분류는 새로 생성 예정', () => {
    const { records, fileErrors } = parseCsv(SAMPLE_CSV);
    expect(fileErrors).toEqual([]);
    const { rows, newCategoryNames } = buildPreview(records, [], []);
    expect(rows).toHaveLength(3);
    expect(rows.every((r) => r.errors.length === 0)).toBe(true);
    expect(rows[0].favorite).toBe(true);
    expect(newCategoryNames).toEqual(['카페']);
  });

  it('필수 열이 없으면 파일 오류', () => {
    expect(parseCsv('name,lat\nx,1').fileErrors.length).toBeGreaterThan(0);
  });

  it('행 오류: 좌표 범위, 카테고리, 빈 이름', () => {
    const { records } = parseCsv('name,category,lat,lng\n,버섯,1,1\nA,나무,1,1\nB,버섯,91,1\nC,mushroom,1,abc\n');
    const { rows } = buildPreview(records, [], []);
    expect(rows.map((r) => r.errors.length > 0)).toEqual([true, true, true, true]);
    expect(rows[0].line).toBe(2);
  });

  it('중복: 기존 기록·파일 안 모두, 기본 건너뛰기, 행별로 추가 가능, 기존 기록은 건드리지 않음', () => {
    const existing = [place({ category: 'mushroom', lat: 37.572389, lng: 126.976863 })];
    const { records } = parseCsv(
      'name,category,lat,lng\n기존과같음,버섯,37.572391,126.976861\n새것,버섯,37.1,127.1\n파일안중복,버섯,37.100001,127.1\n다른카테고리,빅플라워,37.1,127.1\n',
    );
    const { rows } = buildPreview(records, existing, []);
    expect(rows.map((r) => r.duplicateOf)).toEqual(['existing', null, 'file', null]);
    expect(summarize(rows)).toEqual({ add: 2, skip: 2, error: 0 });
    rows[2].action = 'add';
    const payload = buildPayload(rows, []);
    expect(payload.places.map((p) => p.name)).toEqual(['새것', '파일안중복', '다른카테고리']);
  });

  it('기존 분류는 이름(대소문자 무시)으로 연결, 없으면 새로 만든다', () => {
    const existingCat = cat({ name: 'Cafe' });
    const { records } = parseCsv('name,category,lat,lng,deco_category\nA,데코,1,1,cafe\nB,데코,2,2,공원\nC,데코,3,3,공원\nD,데코,4,4,\n');
    const { rows, newCategoryNames } = buildPreview(records, [], [existingCat]);
    expect(newCategoryNames).toEqual(['공원']);
    let n = 0;
    const payload = buildPayload(rows, [existingCat], [], () => `new-${++n}`);
    expect(payload.new_categories).toEqual([{ id: 'new-1', name: '공원', icon: '' }]);
    expect(payload.places.map((p) => p.deco_category_id)).toEqual([existingCat.id, 'new-1', 'new-1', null]);
  });

  it('JSON 형식', () => {
    const r = parseJson(SAMPLE_JSON);
    expect(r.fileErrors).toEqual([]);
    const { rows, newCategoryNames } = buildPreview(r.records, [], [], r.categories);
    expect(rows.every((x) => x.errors.length === 0)).toBe(true);
    expect(rows[1].decoCategoryName).toBe('카페');
    expect(newCategoryNames).toEqual(['카페']);
    expect(buildPayload(rows, [], r.categories).new_categories[0].icon).toBe('☕');
    expect(parseJson('{').fileErrors.length).toBe(1);
    expect(parseJson('{"format":"other","places":[]}').fileErrors.length).toBe(1);
  });
});

describe('ZIP 백업', () => {
  const photoId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const catId = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
  const main = new Uint8Array([1, 2, 3, 4]);
  const thumb = new Uint8Array([5, 6]);

  async function makeData(): Promise<BackupData> {
    return {
      photos: [{ id: photoId, kind: 'place', path: `owner/photos/${photoId}.jpg`, thumb_path: `owner/photos/${photoId}_t.jpg`,
        width: 10, height: 10, bytes: 6, sha256: await sha(main), created_at: '2026-01-01T00:00:00Z' }],
      deco_categories: [cat({ id: catId, deleted_at: '2026-02-01T00:00:00Z' })],
      places: [
        place({ id: crypto.randomUUID(), photo_id: photoId }),
        place({ id: crypto.randomUUID(), category: 'deco', deco_category_id: catId, deleted_at: '2026-02-01T00:00:00Z' }),
      ],
    };
  }
  const files = () => new Map([[`photos/${photoId}.jpg`, main], [`photos/${photoId}_t.jpg`, thumb]]);

  it('만들기 → 검증 통과 (휴지통 항목 포함)', async () => {
    const data = await makeData();
    const { zip, manifest } = await buildBackupZip(data, files(), sha);
    expect(Object.keys(unzipSync(zip)).sort()).toEqual(['data.json', 'manifest.json', `photos/${photoId}.jpg`, `photos/${photoId}_t.jpg`]);
    expect(manifest.counts.places_deleted).toBe(1);
    const v = await validateBackupZip(zip, sha);
    expect(v.ok).toBe(true);
    if (v.ok) {
      expect(v.backup.summary).toMatchObject({ mushroom: 1, deco: 0, deleted: 1, photos: 1 });
      const rw = rewriteForOwner(v.backup.data, 'me');
      expect(rw.photos[0].path).toBe(`me/photos/${photoId}.jpg`);
    }
  });

  it('손상·누락·다른 파일은 거부', async () => {
    const data = await makeData();
    const { zip } = await buildBackupZip(data, files(), sha);
    const entries = unzipSync(zip);

    expect((await validateBackupZip(new Uint8Array([1, 2, 3]), sha)).ok).toBe(false);

    const tampered = { ...entries, [`photos/${photoId}.jpg`]: new Uint8Array([9, 9, 9, 9]) };
    const r1 = await validateBackupZip(zipSync(tampered), sha);
    expect(r1.ok).toBe(false);
    if (!r1.ok) expect(r1.errors[0]).toMatch(/손상/);

    const { [`photos/${photoId}_t.jpg`]: _drop, ...missing } = entries;
    const r2 = await validateBackupZip(zipSync(missing), sha);
    expect(r2.ok).toBe(false);

    const r3 = await validateBackupZip(zipSync({ 'hello.txt': strToU8('x') }), sha);
    expect(r3.ok).toBe(false);
  });

  it('장소가 없는 사진을 가리키면 거부', async () => {
    const data = await makeData();
    data.places[0].photo_id = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
    const { zip } = await buildBackupZip(data, files(), sha);
    const r = await validateBackupZip(zip, sha);
    expect(r.ok).toBe(false);
  });
});
