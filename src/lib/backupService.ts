// 백업·복원의 서버 작업 부분
import { fetchAtlas, upsertSettings } from './api';
export { saveBlob } from './download';
import { backupFileName, buildBackupZip, rewriteForOwner, zipPathsFor, type BackupData, type ValidatedBackup } from './backup';
import { downloadFile, removeFiles, sha256Hex } from './photos';
import { BUCKET, sb } from './supabase';
import type { Photo } from './types';

export type Progress = (done: number, total: number, label: string) => void;

const hasher = (d: Uint8Array) => sha256Hex(d);

/** 현재 도감(휴지통 포함)과 압축 사진을 ZIP 하나로 */
export async function createBackup(onProgress: Progress, label = '사진 내려받는 중'): Promise<{ blob: Blob; filename: string; photos: number }> {
  onProgress(0, 1, '데이터 불러오는 중');
  const atlas = await fetchAtlas();
  const data: BackupData = { places: atlas.places, deco_categories: atlas.categories, photos: atlas.photos };
  const jobs: { zipPath: string; storagePath: string }[] = [];
  for (const ph of atlas.photos) {
    const zp = zipPathsFor(ph);
    jobs.push({ zipPath: zp.main, storagePath: ph.path });
    if (zp.thumb && ph.thumb_path) jobs.push({ zipPath: zp.thumb, storagePath: ph.thumb_path });
  }
  const files = new Map<string, Uint8Array>();
  const missing: string[] = [];
  const total = jobs.length;
  let done = 0;
  const worker = async () => {
    for (;;) {
      const job = jobs.shift();
      if (!job) return;
      try {
        files.set(job.zipPath, await downloadFile(job.storagePath));
      } catch {
        missing.push(job.storagePath);
      }
      onProgress(++done, total, label);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  if (missing.length) {
    throw new Error(`사진 ${missing.length}개를 내려받지 못해 백업을 만들지 않았습니다. 인터넷 연결을 확인하고 다시 시도하세요.`);
  }
  onProgress(1, 1, 'ZIP 만드는 중');
  const { zip } = await buildBackupZip(data, files, hasher);
  return { blob: new Blob([zip as BlobPart], { type: 'application/zip' }), filename: backupFileName(), photos: atlas.photos.length };
}

export async function markBackupDone() {
  await upsertSettings({ last_backup_at: new Date().toISOString() });
}

// ---------------- 복원 ----------------
export async function beginRestore(): Promise<string> {
  const { data, error } = await sb().rpc('begin_restore');
  if (error) throw error;
  return data as string;
}

/** 백업의 사진을 올린다. 같은 사진(같은 id·지문)이 이미 있으면 건너뛴다. 새로 올린 경로를 돌려준다. */
export async function uploadRestorePhotos(
  backup: ValidatedBackup,
  ownerId: string,
  current: Photo[],
  onProgress: Progress,
): Promise<{ uploaded: string[]; failed: string[] }> {
  const existing = new Map(current.map((p) => [p.id, p.sha256]));
  const data = rewriteForOwner(backup.data, ownerId);
  const jobs: { zipPath: string; path: string; type: string }[] = [];
  for (const ph of data.photos) {
    if (existing.get(ph.id) === ph.sha256) continue;
    const zp = zipPathsFor(ph);
    const type = ph.kind === 'icon' ? 'image/png' : 'image/jpeg';
    jobs.push({ zipPath: zp.main, path: ph.path, type });
    if (zp.thumb && ph.thumb_path) jobs.push({ zipPath: zp.thumb, path: ph.thumb_path, type });
  }
  const total = jobs.length;
  const uploaded: string[] = [];
  const failed: string[] = [];
  let done = 0;
  onProgress(0, total, '사진 올리는 중');
  const worker = async () => {
    for (;;) {
      const job = jobs.shift();
      if (!job) return;
      const bytes = backup.files.get(job.zipPath)!;
      const { error } = await sb()
        .storage.from(BUCKET)
        .upload(job.path, new Blob([bytes as BlobPart], { type: job.type }), { contentType: job.type, upsert: true, cacheControl: '31536000' });
      if (error) failed.push(job.path);
      else uploaded.push(job.path);
      onProgress(++done, total, '사진 올리는 중');
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  return { uploaded, failed };
}

export async function commitRestore(snapshotId: string, backup: ValidatedBackup, ownerId: string) {
  const data = rewriteForOwner(backup.data, ownerId);
  const { data: res, error } = await sb().rpc('commit_restore', { snapshot_id: snapshotId, data });
  if (error) throw error;
  return res as { places: number; deco_categories: number; photos: number };
}

export async function cancelRestore(snapshotId: string, uploadedPaths: string[], current: Photo[]) {
  const { error } = await sb().rpc('cancel_restore', { snapshot_id: snapshotId });
  if (error) throw error;
  // 이번에 새로 올렸지만 지금 도감에서 쓰지 않는 파일만 정리
  const inUse = new Set(current.flatMap((p) => [p.path, p.thumb_path]).filter(Boolean) as string[]);
  await removeFiles(uploadedPaths.filter((p) => !inUse.has(p)));
}

export async function rollbackRestore(snapshotId: string) {
  const { data, error } = await sb().rpc('rollback_restore', { snapshot_id: snapshotId });
  if (error) throw error;
  await removeFiles((data as string[]) ?? []);
}

export async function finalizeRestore(snapshotId: string) {
  const { data, error } = await sb().rpc('finalize_restore', { snapshot_id: snapshotId });
  if (error) throw error;
  await removeFiles((data as string[]) ?? []);
}
