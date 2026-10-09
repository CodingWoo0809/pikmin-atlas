// ZIP 백업 만들기·검증하기 (서버와 무관한 순수 로직 — 테스트 가능)
//   manifest.json  형식·버전·생성 시각·개수·모든 파일의 크기와 SHA-256
//   data.json      places(휴지통 포함), deco_categories(휴지통 포함), photos
//   photos/        표시용·썸네일(.jpg), photos/icons/ 아이콘(.png)
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { z } from 'zod';
import type { DecoCategory, Photo, Place } from './types';

export const BACKUP_FORMAT = 'nomad-atlas-backup';
export const BACKUP_VERSION = 1;
export const SCHEMA_VERSION = 1;

export type BackupData = { places: Place[]; deco_categories: DecoCategory[]; photos: Photo[] };

export type Manifest = {
  format: string;
  backup_version: number;
  schema_version: number;
  created_at: string;
  counts: { places: number; places_deleted: number; deco_categories: number; photos: number; files: number };
  files: Record<string, { bytes: number; sha256: string }>;
};

export function zipPathsFor(p: Pick<Photo, 'id' | 'kind'>): { main: string; thumb: string | null } {
  return p.kind === 'icon'
    ? { main: `photos/icons/${p.id}.png`, thumb: null }
    : { main: `photos/${p.id}.jpg`, thumb: `photos/${p.id}_t.jpg` };
}

export function backupFileName(d = new Date()) {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `Nomad-atlas-backup-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}.zip`;
}

type Hasher = (data: Uint8Array) => Promise<string>;

/** data와 사진 파일들(zip 안 경로 → 바이트)로 ZIP을 만든다 */
export async function buildBackupZip(
  data: BackupData,
  files: Map<string, Uint8Array>,
  sha256: Hasher,
  now = new Date(),
): Promise<{ zip: Uint8Array; manifest: Manifest }> {
  const strip = <T extends object>(rows: T[]) =>
    rows.map((r) => {
      const { owner_id: _o, ...rest } = r as T & { owner_id?: string };
      return rest;
    });
  const dataJson = strToU8(
    JSON.stringify({ places: strip(data.places), deco_categories: strip(data.deco_categories), photos: strip(data.photos) }, null, 1),
  );
  const manifestFiles: Manifest['files'] = {};
  manifestFiles['data.json'] = { bytes: dataJson.length, sha256: await sha256(dataJson) };
  const entries: Zippable = { 'data.json': dataJson };
  for (const [path, bytes] of [...files.entries()].sort(([a], [b]) => (a < b ? -1 : 1))) {
    manifestFiles[path] = { bytes: bytes.length, sha256: await sha256(bytes) };
    entries[path] = [bytes, { level: 0 }]; // 이미 압축된 사진은 다시 압축하지 않음
  }
  const manifest: Manifest = {
    format: BACKUP_FORMAT,
    backup_version: BACKUP_VERSION,
    schema_version: SCHEMA_VERSION,
    created_at: now.toISOString(),
    counts: {
      places: data.places.length,
      places_deleted: data.places.filter((p) => p.deleted_at).length,
      deco_categories: data.deco_categories.length,
      photos: data.photos.length,
      files: files.size,
    },
    files: manifestFiles,
  };
  entries['manifest.json'] = strToU8(JSON.stringify(manifest, null, 1));
  return { zip: zipSync(entries, { level: 6 }), manifest };
}

// ---------------- 검증 ----------------
const uuid = z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, 'id 형식 오류');
const ts = z.string().min(10);

const PhotoSchema = z.object({
  id: uuid,
  kind: z.enum(['place', 'icon']),
  path: z.string(),
  thumb_path: z.string().nullable(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
  bytes: z.number().int().nonnegative(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  created_at: ts,
});

const CategorySchema = z.object({
  id: uuid,
  name: z.string().min(1).max(50),
  icon: z.string().max(16).default(''),
  icon_photo_id: uuid.nullable(),
  sort_order: z.number().int(),
  version: z.number().int().positive(),
  created_at: ts,
  updated_at: ts,
  deleted_at: ts.nullable(),
});

const PlaceSchema = z.object({
  id: uuid,
  category: z.enum(['mushroom', 'bigflower', 'deco']),
  deco_category_id: uuid.nullable(),
  name: z.string().min(1).max(100),
  description: z.string().max(2000),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  photo_id: uuid.nullable(),
  is_favorite: z.boolean(),
  seq: z.union([z.number(), z.string()]).transform((v) => Number(v)),
  version: z.number().int().positive(),
  created_at: ts,
  updated_at: ts,
  deleted_at: ts.nullable(),
});

const DataSchema = z.object({
  places: z.array(PlaceSchema),
  deco_categories: z.array(CategorySchema),
  photos: z.array(PhotoSchema),
});

const ManifestSchema = z.object({
  format: z.string(),
  backup_version: z.number(),
  schema_version: z.number(),
  created_at: z.string(),
  counts: z.object({ places: z.number(), deco_categories: z.number(), photos: z.number() }).passthrough(),
  files: z.record(z.string(), z.object({ bytes: z.number(), sha256: z.string() })),
});

export type ValidatedBackup = {
  manifest: Manifest;
  data: BackupData;
  files: Map<string, Uint8Array>; // zip 안 경로 → 바이트 (사진만)
  summary: {
    createdAt: string;
    mushroom: number;
    bigflower: number;
    deco: number;
    deleted: number;
    categories: number;
    photos: number;
    photoBytes: number;
  };
};

export type ValidationResult = { ok: true; backup: ValidatedBackup } | { ok: false; errors: string[] };

export async function validateBackupZip(bytes: Uint8Array, sha256: Hasher): Promise<ValidationResult> {
  const errors: string[] = [];
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    return { ok: false, errors: ['ZIP 파일을 열 수 없습니다. 파일이 손상되었거나 ZIP이 아닙니다.'] };
  }
  if (!entries['manifest.json']) errors.push('manifest.json이 없습니다. 이 앱에서 만든 백업이 아닙니다.');
  if (!entries['data.json']) errors.push('data.json이 없습니다.');
  if (errors.length) return { ok: false, errors };

  let manifest: Manifest;
  try {
    const m = ManifestSchema.safeParse(JSON.parse(strFromU8(entries['manifest.json'])));
    if (!m.success) return { ok: false, errors: ['manifest.json 내용이 올바르지 않습니다.'] };
    manifest = m.data as unknown as Manifest;
  } catch {
    return { ok: false, errors: ['manifest.json을 읽을 수 없습니다.'] };
  }
  if (manifest.format !== BACKUP_FORMAT) return { ok: false, errors: [`다른 형식의 파일입니다 (${manifest.format}).`] };
  if (manifest.backup_version > BACKUP_VERSION || manifest.schema_version > SCHEMA_VERSION) {
    return { ok: false, errors: ['더 새로운 버전의 앱에서 만든 백업입니다. 앱을 새로고침한 뒤 다시 시도하세요.'] };
  }

  // 모든 파일의 존재·크기·지문 확인
  for (const [path, info] of Object.entries(manifest.files)) {
    const f = entries[path];
    if (!f) {
      errors.push(`파일이 빠져 있습니다: ${path}`);
      continue;
    }
    if (f.length !== info.bytes || (await sha256(f)) !== info.sha256) errors.push(`파일이 손상되었습니다: ${path}`);
  }
  if (errors.length) return { ok: false, errors: errors.slice(0, 20) };

  let data: BackupData;
  try {
    const parsed = DataSchema.safeParse(JSON.parse(strFromU8(entries['data.json'])));
    if (!parsed.success) {
      const issues = parsed.error.issues.slice(0, 10).map((i) => `data.json ${i.path.join('.')}: ${i.message}`);
      return { ok: false, errors: issues };
    }
    data = parsed.data as unknown as BackupData;
  } catch {
    return { ok: false, errors: ['data.json을 읽을 수 없습니다.'] };
  }

  // 연결 관계 확인
  const photoIds = new Set(data.photos.map((p) => p.id));
  const catIds = new Set(data.deco_categories.map((c) => c.id));
  const files = new Map<string, Uint8Array>();
  let photoBytes = 0;
  for (const ph of data.photos) {
    const zp = zipPathsFor(ph);
    for (const p of [zp.main, zp.thumb]) {
      if (!p) continue;
      if (!entries[p] || !manifest.files[p]) errors.push(`사진 파일이 없습니다: ${p}`);
      else {
        files.set(p, entries[p]);
        photoBytes += entries[p].length;
      }
    }
  }
  for (const p of data.places) {
    if (p.photo_id && !photoIds.has(p.photo_id)) errors.push(`장소 "${p.name}"의 사진 정보가 없습니다.`);
    if (p.deco_category_id && !catIds.has(p.deco_category_id)) errors.push(`장소 "${p.name}"의 데코 분류가 없습니다.`);
    if (p.category !== 'deco' && p.deco_category_id) errors.push(`장소 "${p.name}": 데코가 아닌데 분류가 있습니다.`);
  }
  for (const c of data.deco_categories) {
    if (c.icon_photo_id && !photoIds.has(c.icon_photo_id)) errors.push(`분류 "${c.name}"의 아이콘 정보가 없습니다.`);
  }
  const dupIds = (arr: { id: string }[]) => arr.length !== new Set(arr.map((a) => a.id)).size;
  if (dupIds(data.places) || dupIds(data.photos) || dupIds(data.deco_categories)) errors.push('같은 id가 두 번 들어 있습니다.');
  const activeNames = data.deco_categories.filter((c) => !c.deleted_at).map((c) => c.name.toLowerCase());
  if (activeNames.length !== new Set(activeNames).size) errors.push('같은 이름의 데코 분류가 두 개 있습니다.');
  if (errors.length) return { ok: false, errors: errors.slice(0, 20) };

  const live = data.places.filter((p) => !p.deleted_at);
  return {
    ok: true,
    backup: {
      manifest,
      data,
      files,
      summary: {
        createdAt: manifest.created_at,
        mushroom: live.filter((p) => p.category === 'mushroom').length,
        bigflower: live.filter((p) => p.category === 'bigflower').length,
        deco: live.filter((p) => p.category === 'deco').length,
        deleted: data.places.length - live.length,
        categories: data.deco_categories.filter((c) => !c.deleted_at).length,
        photos: data.photos.length,
        photoBytes,
      },
    },
  };
}

/** 복원용: 사진 경로를 지금 로그인한 주인 폴더로 바꾼다 (계정을 새로 만든 경우 대비) */
export function rewriteForOwner(data: BackupData, ownerId: string): BackupData {
  return {
    ...data,
    photos: data.photos.map((p) =>
      p.kind === 'icon'
        ? { ...p, path: `${ownerId}/icons/${p.id}.png`, thumb_path: null }
        : { ...p, path: `${ownerId}/photos/${p.id}.jpg`, thumb_path: `${ownerId}/photos/${p.id}_t.jpg` },
    ),
  };
}
