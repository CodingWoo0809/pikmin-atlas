// 실제 Supabase가 아닌, 작업 환경의 Postgres(PGlite)에서 마이그레이션 SQL을 검증한다.
// auth / storage 스키마는 Supabase와 같은 이름의 최소 대역(stub)으로 흉내 낸다.
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { beforeAll, describe, expect, it } from 'vitest';

const OWNER = '11111111-1111-4111-8111-111111111111';
const STRANGER = '22222222-2222-4222-8222-222222222222';

const STUB = `
create role anon nologin;
create role authenticated nologin;
create schema auth;
create table auth.users (id uuid primary key, email text);
create function auth.uid() returns uuid language sql stable as
  $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;
grant usage on schema auth to anon, authenticated;
create schema storage;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
create function storage.foldername(name text) returns text[] language sql immutable as
  $$ select (string_to_array(name, '/'))[1:array_length(string_to_array(name, '/'), 1) - 1] $$;
grant usage on schema storage to anon, authenticated;
grant select, insert, update, delete on storage.objects to anon, authenticated;
grant usage on schema public to anon, authenticated;
insert into auth.users values ('${OWNER}', 'owner@x.invalid'), ('${STRANGER}', 'other@x.invalid');
`;

let db: PGlite;

async function as(role: 'anon' | 'authenticated' | 'postgres', uid?: string) {
  await db.exec('reset role');
  await db.exec(`select set_config('request.jwt.claim.sub', '${uid ?? ''}', false)`);
  if (role !== 'postgres') await db.exec(`set role ${role}`);
}

async function q<T = Record<string, unknown>>(sql: string, params: unknown[] = []) {
  return (await db.query<T>(sql, params)).rows;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(STUB);
  const sql = readFileSync(new URL('../migrations/001_init.sql', import.meta.url), 'utf8');
  await db.exec(sql);
  // 두 번 실행해도 오류가 없어야 한다
  await db.exec(sql);
  await db.exec(readFileSync(new URL('../setup_owner.sql', import.meta.url), 'utf8').replace('owner@nomad-atlas.invalid', 'owner@x.invalid'));
}, 60_000);

describe('접근 제어 (RLS)', () => {
  it('비로그인(anon)은 표를 아예 읽을 수 없다', async () => {
    await as('anon');
    await expect(q('select * from public.places')).rejects.toThrow(/permission denied/);
    await expect(q('select * from public.photos')).rejects.toThrow(/permission denied/);
    await expect(q('select public.current_atlas_json()')).rejects.toThrow(/permission denied/);
  });

  it('주인은 자기 행을 추가·조회할 수 있다', async () => {
    await as('authenticated', OWNER);
    await q(`insert into public.places (category, name, lat, lng) values ('mushroom', '광화문 버섯', 37.5759, 126.9768)`);
    const rows = await q<{ name: string; owner_id: string; version: number }>('select * from public.places');
    expect(rows).toHaveLength(1);
    expect(rows[0].owner_id).toBe(OWNER);
  });

  it('주인 지정이 안 된 다른 계정은 아무것도 못 본다·못 쓴다', async () => {
    await as('authenticated', STRANGER);
    expect(await q('select * from public.places')).toHaveLength(0);
    await expect(
      q(`insert into public.places (category, name, lat, lng) values ('mushroom', 'x', 1, 1)`),
    ).rejects.toThrow(/row-level security/);
  });

  it('주인 계정은 두 명이 될 수 없다', async () => {
    await as('postgres');
    await expect(q(`insert into private.app_owner (user_id) values ('${STRANGER}')`)).rejects.toThrow();
  });

  it('사진 저장소: 주인 폴더만 허용, 다른 폴더·다른 계정 거부', async () => {
    await as('authenticated', OWNER);
    await q(`insert into storage.objects (bucket_id, name) values ('nomad-private', '${OWNER}/photos/a.jpg')`);
    await expect(
      q(`insert into storage.objects (bucket_id, name) values ('nomad-private', '${STRANGER}/photos/a.jpg')`),
    ).rejects.toThrow(/row-level security/);
    expect(await q('select * from storage.objects')).toHaveLength(1);
    await as('authenticated', STRANGER);
    expect(await q('select * from storage.objects')).toHaveLength(0);
    await as('anon');
    expect(await q('select * from storage.objects')).toHaveLength(0);
    await as('postgres');
    const b = await q<{ public: boolean }>(`select public from storage.buckets where id = 'nomad-private'`);
    expect(b[0].public).toBe(false);
  });
});

describe('데이터 규칙', () => {
  it('수정하면 version이 1 늘고, 좌표 범위·이름 규칙을 지킨다', async () => {
    await as('authenticated', OWNER);
    const [p] = await q<{ id: string; version: number }>('select id, version from public.places limit 1');
    await q('update public.places set is_favorite = true where id = $1', [p.id]);
    const [p2] = await q<{ version: number }>('select version from public.places where id = $1', [p.id]);
    expect(p2.version).toBe(p.version + 1);
    await expect(q(`insert into public.places (category, name, lat, lng) values ('mushroom', 'bad', 91, 0)`)).rejects.toThrow();
    await expect(q(`insert into public.places (category, name, lat, lng) values ('mushroom', ' 공백 ', 1, 0)`)).rejects.toThrow();
  });

  it('버섯에는 데코 분류를 붙일 수 없고, 분류 이름은 대소문자 무시 중복 금지', async () => {
    await as('authenticated', OWNER);
    const [c] = await q<{ id: string }>(`insert into public.deco_categories (name, icon) values ('Cafe', '☕') returning id`);
    await expect(q(`insert into public.deco_categories (name) values ('cafe')`)).rejects.toThrow(/unique/);
    await expect(
      q(`insert into public.places (category, deco_category_id, name, lat, lng) values ('mushroom', $1, 'x', 1, 1)`, [c.id]),
    ).rejects.toThrow(/places_deco_only/);
  });

  it('데코 분류 휴지통(소속 장소 함께) → 되돌리기', async () => {
    await as('authenticated', OWNER);
    const [c] = await q<{ id: string }>(`insert into public.deco_categories (name, icon) values ('공원', '🌳') returning id`);
    await q(`insert into public.places (category, deco_category_id, name, lat, lng) values ('deco', $1, '서울숲', 37.54, 127.04), ('deco', $1, '올림픽공원', 37.52, 127.12)`, [c.id]);
    const [{ trash_deco_category: ids }] = await q<{ trash_deco_category: string[] }>(
      `select public.trash_deco_category($1, 'with_places')`, [c.id]);
    expect(ids).toHaveLength(2);
    expect(await q(`select * from public.places where deco_category_id = $1 and deleted_at is null`, [c.id])).toHaveLength(0);
    await q(`select public.untrash_deco_category($1, 'with_places', $2)`, [c.id, ids]);
    expect(await q(`select * from public.places where deco_category_id = $1 and deleted_at is null`, [c.id])).toHaveLength(2);

    await q(`select public.trash_deco_category($1, 'uncategorize')`, [c.id]);
    expect(await q(`select * from public.places where category = 'deco' and deco_category_id is null and deleted_at is null`)).toHaveLength(2);
  });

  it('영구 삭제: 다른 장소가 쓰는 사진은 남기고, 아무도 안 쓰는 사진만 파일 경로를 돌려준다', async () => {
    await as('authenticated', OWNER);
    const [ph] = await q<{ id: string }>(
      `insert into public.photos (kind, path, thumb_path, width, height, bytes, sha256)
       values ('place', '${OWNER}/photos/p1.jpg', '${OWNER}/photos/p1_t.jpg', 10, 10, 100, repeat('a', 64)) returning id`);
    const [a] = await q<{ id: string }>(`insert into public.places (category, name, lat, lng, photo_id) values ('bigflower', 'A', 1, 1, $1) returning id`, [ph.id]);
    const [b] = await q<{ id: string }>(`insert into public.places (category, name, lat, lng, photo_id) values ('bigflower', 'B', 2, 2, $1) returning id`, [ph.id]);
    // 휴지통이 아닌 항목은 영구 삭제되지 않는다
    expect((await q<{ purge_places: string[] }>('select public.purge_places($1)', [[a.id]]))[0].purge_places).toEqual([]);
    expect(await q('select 1 from public.places where id = $1', [a.id])).toHaveLength(1);

    await q('update public.places set deleted_at = now() where id = any($1)', [[a.id, b.id]]);
    expect((await q<{ purge_places: string[] }>('select public.purge_places($1)', [[a.id]]))[0].purge_places).toEqual([]);
    const [{ purge_places: paths }] = await q<{ purge_places: string[] }>('select public.purge_places($1)', [[b.id]]);
    expect(paths.sort()).toEqual([`${OWNER}/photos/p1.jpg`, `${OWNER}/photos/p1_t.jpg`]);
    expect(await q('select 1 from public.photos where id = $1', [ph.id])).toHaveLength(0);
  });

  it('가져오기: 새 분류 + 장소를 한 번에 추가', async () => {
    await as('authenticated', OWNER);
    const before = (await q<{ n: number }>('select count(*)::int n from public.places'))[0].n;
    const catId = '33333333-3333-4333-8333-333333333333';
    const [{ import_records: r }] = await q<{ import_records: { categories: number; places: number } }>(
      'select public.import_records($1)',
      [JSON.stringify({
        new_categories: [{ id: catId, name: '편의점', icon: '🏪' }],
        places: [
          { category: 'deco', deco_category_id: catId, name: 'GS25', lat: 37.1, lng: 127.1 },
          { category: 'mushroom', name: '버섯 B', lat: 37.2, lng: 127.2, is_favorite: true, description: '메모' },
        ],
      })]);
    expect(r).toEqual({ categories: 1, places: 2 });
    expect((await q<{ n: number }>('select count(*)::int n from public.places'))[0].n).toBe(before + 2);
  });

  it('가져오기 중 하나라도 잘못되면 아무것도 추가되지 않는다', async () => {
    await as('authenticated', OWNER);
    const before = (await q<{ n: number }>('select count(*)::int n from public.places'))[0].n;
    await expect(q('select public.import_records($1)', [JSON.stringify({
      places: [{ category: 'mushroom', name: 'ok', lat: 1, lng: 1 }, { category: 'mushroom', name: 'bad', lat: 999, lng: 1 }],
    })])).rejects.toThrow();
    expect((await q<{ n: number }>('select count(*)::int n from public.places'))[0].n).toBe(before);
  });
});

describe('복원과 되돌리기', () => {
  it('스냅숏 → 교체 → 되돌리기 → 다시 교체 → 확정', async () => {
    await as('authenticated', OWNER);
    const original = (await q<{ current_atlas_json: { places: unknown[]; photos: unknown[] } }>('select public.current_atlas_json()'))[0].current_atlas_json;

    const photoId = '44444444-4444-4444-8444-444444444444';
    const backup = {
      photos: [{ id: photoId, kind: 'place', path: `${OWNER}/photos/${photoId}.jpg`, thumb_path: `${OWNER}/photos/${photoId}_t.jpg`,
        width: 100, height: 80, bytes: 1234, sha256: 'b'.repeat(64), created_at: '2026-01-01T00:00:00Z' }],
      deco_categories: [],
      places: [
        { id: '55555555-5555-4555-8555-555555555555', category: 'mushroom', deco_category_id: null, name: '백업 버섯',
          description: '', lat: 35, lng: 129, photo_id: photoId, is_favorite: true, seq: 500, version: 3,
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-02T00:00:00Z', deleted_at: null },
        { id: '66666666-6666-4666-8666-666666666666', category: 'bigflower', deco_category_id: null, name: '삭제된 꽃',
          description: '', lat: 36, lng: 128, photo_id: null, is_favorite: false, seq: 501, version: 1,
          created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z', deleted_at: '2026-02-01T00:00:00Z' },
      ],
    };

    const [{ begin_restore: sid }] = await q<{ begin_restore: string }>('select public.begin_restore()');
    // 끝나지 않은 복원이 있으면 새로 시작할 수 없다
    await expect(q('select public.begin_restore()')).rejects.toThrow(/unfinished/);

    // 잘못된 데이터면 트랜잭션 전체가 취소되어 원래 도감이 그대로
    const broken = { ...backup, places: [{ ...backup.places[0], photo_id: '77777777-7777-4777-8777-777777777777' }] };
    await expect(q('select public.commit_restore($1, $2)', [sid, JSON.stringify(broken)])).rejects.toThrow();
    expect((await q('select * from public.places')).length).toBe(original.places.length);

    const [{ commit_restore: res }] = await q<{ commit_restore: Record<string, number> }>(
      'select public.commit_restore($1, $2)', [sid, JSON.stringify(backup)]);
    expect(res).toEqual({ places: 2, deco_categories: 0, photos: 1 });
    // 새 장소의 등록 순번은 복원된 순번 뒤에서 이어진다
    const [n] = await q<{ seq: number }>(`insert into public.places (category, name, lat, lng) values ('mushroom', '새것', 1, 2) returning seq`);
    expect(Number(n.seq)).toBeGreaterThan(501);
    await q(`delete from public.places where name = '새것'`);

    const [{ rollback_restore: leftovers }] = await q<{ rollback_restore: string[] }>('select public.rollback_restore($1)', [sid]);
    expect(leftovers.sort()).toEqual([`${OWNER}/photos/${photoId}.jpg`, `${OWNER}/photos/${photoId}_t.jpg`]);
    expect((await q('select * from public.places')).length).toBe(original.places.length);

    const [{ begin_restore: sid2 }] = await q<{ begin_restore: string }>('select public.begin_restore()');
    await q('select public.commit_restore($1, $2)', [sid2, JSON.stringify(backup)]);
    const [{ finalize_restore: old }] = await q<{ finalize_restore: string[] }>('select public.finalize_restore($1)', [sid2]);
    expect(Array.isArray(old)).toBe(true);
    const [s] = await q<{ status: string }>('select status from public.restore_snapshots where id = $1', [sid2]);
    expect(s.status).toBe('finalized');
  });

  it('다른 계정은 복원 함수로도 주인 데이터에 손댈 수 없다', async () => {
    await as('authenticated', STRANGER);
    await expect(q('select public.begin_restore()')).rejects.toThrow(/row-level security/);
    expect((await q<{ current_atlas_json: { places: unknown[] } }>('select public.current_atlas_json()'))[0].current_atlas_json.places).toEqual([]);
  });
});
