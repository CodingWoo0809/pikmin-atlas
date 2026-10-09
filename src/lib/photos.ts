// 사진: 브라우저에서 압축 → 비공개 저장소에 업로드 → 만료되는 Signed URL로 표시
import { BUCKET, sb } from './supabase';
import type { Photo } from './types';

export const DISPLAY_MAX = 1600;
export const THUMB_MAX = 480;
export const ICON_MAX = 256;

export type CompressedPhoto = {
  id: string;
  kind: 'place' | 'icon';
  display: Blob;
  thumb: Blob | null;
  width: number;
  height: number;
  sha256: string;
};

export async function sha256Hex(data: Blob | ArrayBuffer | Uint8Array): Promise<string> {
  let buf: ArrayBuffer;
  if (data instanceof Blob) buf = await data.arrayBuffer();
  else if (data instanceof Uint8Array) buf = data.slice().buffer as ArrayBuffer;
  else buf = data;
  const digest = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function loadImage(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.decoding = 'async';
    img.onload = () => {
      URL.revokeObjectURL(url);
      resolve(img);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('IMAGE_DECODE'));
    };
    img.src = url;
  });
}

function fit(w: number, h: number, max: number) {
  const scale = Math.min(1, max / Math.max(w, h));
  return { w: Math.max(1, Math.round(w * scale)), h: Math.max(1, Math.round(h * scale)) };
}

function draw(img: HTMLImageElement, max: number, type: 'image/jpeg' | 'image/png', quality: number) {
  // 최신 브라우저는 <img>를 그릴 때 사진의 회전 정보(EXIF)를 반영한다.
  const { w, h } = fit(img.naturalWidth, img.naturalHeight, max);
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('CANVAS');
  if (type === 'image/jpeg') {
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, w, h);
  }
  ctx.imageSmoothingQuality = 'high';
  ctx.drawImage(img, 0, 0, w, h);
  return new Promise<{ blob: Blob; w: number; h: number }>((resolve, reject) => {
    canvas.toBlob(
      (b) => {
        canvas.width = 0;
        canvas.height = 0;
        if (b) resolve({ blob: b, w, h });
        else reject(new Error('CANVAS'));
      },
      type,
      quality,
    );
  });
}

export function photoErrorMessage(e: unknown): string {
  const m = e instanceof Error ? e.message : String(e);
  if (m === 'IMAGE_DECODE') {
    return '이 사진 형식을 열 수 없습니다. PC에서 HEIC 사진은 열리지 않을 수 있으니 JPG로 바꾸거나 iPhone에서 올려 주세요.';
  }
  if (m === 'CANVAS') return '사진을 압축하지 못했습니다. 메모리가 부족할 수 있으니 다른 앱을 닫고 다시 시도하세요.';
  return m;
}

/** 원본은 보관하지 않고, 압축본(표시용·썸네일)만 만든다 */
export async function compressPhoto(file: Blob, kind: 'place' | 'icon'): Promise<CompressedPhoto> {
  const img = await loadImage(file);
  const id = crypto.randomUUID();
  if (kind === 'icon') {
    const icon = await draw(img, ICON_MAX, 'image/png', 1);
    return { id, kind, display: icon.blob, thumb: null, width: icon.w, height: icon.h, sha256: await sha256Hex(icon.blob) };
  }
  const display = await draw(img, DISPLAY_MAX, 'image/jpeg', 0.82);
  const thumb = await draw(img, THUMB_MAX, 'image/jpeg', 0.74);
  return {
    id,
    kind,
    display: display.blob,
    thumb: thumb.blob,
    width: display.w,
    height: display.h,
    sha256: await sha256Hex(display.blob),
  };
}

export function photoPaths(ownerId: string, id: string, kind: 'place' | 'icon') {
  return kind === 'icon'
    ? { path: `${ownerId}/icons/${id}.png`, thumb_path: null }
    : { path: `${ownerId}/photos/${id}.jpg`, thumb_path: `${ownerId}/photos/${id}_t.jpg` };
}

/** 압축본 업로드 + photos 행 생성. 실패하면 올린 파일을 정리한다. */
export async function uploadPhoto(ownerId: string, c: CompressedPhoto): Promise<Photo> {
  const { path, thumb_path } = photoPaths(ownerId, c.id, c.kind);
  const store = sb().storage.from(BUCKET);
  const uploaded: string[] = [];
  try {
    const type = c.kind === 'icon' ? 'image/png' : 'image/jpeg';
    const r1 = await store.upload(path, c.display, { contentType: type, upsert: false, cacheControl: '31536000' });
    if (r1.error) throw r1.error;
    uploaded.push(path);
    if (c.thumb && thumb_path) {
      const r2 = await store.upload(thumb_path, c.thumb, { contentType: type, upsert: false, cacheControl: '31536000' });
      if (r2.error) throw r2.error;
      uploaded.push(thumb_path);
    }
    const row = {
      id: c.id,
      kind: c.kind,
      path,
      thumb_path,
      width: c.width,
      height: c.height,
      bytes: c.display.size + (c.thumb?.size ?? 0),
      sha256: c.sha256,
    };
    const { data, error } = await sb().from('photos').insert(row).select().single();
    if (error) throw error;
    return data as Photo;
  } catch (e) {
    if (uploaded.length) await store.remove(uploaded).catch(() => undefined);
    throw e;
  }
}

/** 파일 삭제 (실패해도 앱 동작에는 영향 없음 → 저장공간 정리에서 다시 지울 수 있음) */
export async function removeFiles(paths: string[]): Promise<boolean> {
  const list = paths.filter(Boolean);
  if (!list.length) return true;
  let ok = true;
  for (let i = 0; i < list.length; i += 100) {
    const { error } = await sb().storage.from(BUCKET).remove(list.slice(i, i + 100));
    if (error) ok = false;
  }
  return ok;
}

// ---------------- Signed URL 캐시 ----------------
const TTL = 60 * 60; // 1시간
const cache = new Map<string, { url: string; exp: number }>();
const pending = new Map<string, Promise<string | null>>();
let queue: { path: string; resolve: (u: string | null) => void }[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;

async function flush() {
  timer = null;
  const batch = queue;
  queue = [];
  const paths = [...new Set(batch.map((b) => b.path))];
  try {
    const { data, error } = await sb().storage.from(BUCKET).createSignedUrls(paths, TTL);
    if (error) throw error;
    const exp = Date.now() + (TTL - 300) * 1000;
    const map = new Map<string, string | null>();
    for (const d of data ?? []) {
      if (d.path && d.signedUrl && !d.error) {
        cache.set(d.path, { url: d.signedUrl, exp });
        map.set(d.path, d.signedUrl);
      }
    }
    for (const b of batch) b.resolve(map.get(b.path) ?? null);
  } catch {
    for (const b of batch) b.resolve(null);
  } finally {
    for (const p of paths) pending.delete(p);
  }
}

/** 같은 화면의 여러 사진 주소를 한 번에 요청하고, 만료 전까지 재사용한다 */
export function signedUrl(path: string): Promise<string | null> {
  const hit = cache.get(path);
  if (hit && hit.exp > Date.now()) return Promise.resolve(hit.url);
  const p = pending.get(path);
  if (p) return p;
  const promise = new Promise<string | null>((resolve) => {
    queue.push({ path, resolve });
    if (!timer) timer = setTimeout(flush, 30);
  });
  pending.set(path, promise);
  return promise;
}

export function clearSignedUrlCache() {
  cache.clear();
}

export async function downloadFile(path: string): Promise<Uint8Array> {
  const { data, error } = await sb().storage.from(BUCKET).download(path);
  if (error || !data) throw error ?? new Error('download failed');
  return new Uint8Array(await data.arrayBuffer());
}

/** 저장소의 모든 파일 경로 (저장공간 정리용) */
export async function listAllFiles(ownerId: string): Promise<{ path: string; size: number }[]> {
  const out: { path: string; size: number }[] = [];
  for (const folder of ['photos', 'icons']) {
    const prefix = `${ownerId}/${folder}`;
    let offset = 0;
    for (;;) {
      const { data, error } = await sb().storage.from(BUCKET).list(prefix, { limit: 1000, offset, sortBy: { column: 'name', order: 'asc' } });
      if (error) throw error;
      for (const f of data ?? []) {
        if (f.id) out.push({ path: `${prefix}/${f.name}`, size: Number((f.metadata as { size?: number } | null)?.size ?? 0) });
      }
      if (!data || data.length < 1000) break;
      offset += 1000;
    }
  }
  return out;
}
