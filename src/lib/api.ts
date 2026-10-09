// 데이터베이스 읽기·쓰기. 모든 요청은 로그인한 주인의 출입증으로 나가며, 서버의 RLS가 다시 검사한다.
import { sb } from './supabase';
import type { DecoCategory, OwnerSettings, Photo, Place } from './types';

const PAGE = 1000;

async function fetchAllRows<T>(table: string, order: string): Promise<T[]> {
  const out: T[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data, error } = await sb().from(table).select('*').order(order).range(from, from + PAGE - 1);
    if (error) throw error;
    out.push(...((data ?? []) as T[]));
    if (!data || data.length < PAGE) break;
  }
  return out;
}

export type AtlasData = { places: Place[]; categories: DecoCategory[]; photos: Photo[] };

export async function fetchAtlas(): Promise<AtlasData> {
  const [places, categories, photos] = await Promise.all([
    fetchAllRows<Place>('places', 'seq'),
    fetchAllRows<DecoCategory>('deco_categories', 'sort_order'),
    fetchAllRows<Photo>('photos', 'created_at'),
  ]);
  return {
    places: places.map((p) => ({ ...p, seq: Number(p.seq) })),
    categories,
    photos,
  };
}

// ---------- 설정 ----------
export async function getSettings(): Promise<OwnerSettings | null> {
  const { data, error } = await sb().from('owner_settings').select('*').maybeSingle();
  if (error) throw error;
  return data as OwnerSettings | null;
}

export async function upsertSettings(patch: Partial<Omit<OwnerSettings, 'owner_id'>>) {
  const { data: u } = await sb().auth.getUser();
  if (!u.user) throw new Error('로그인이 만료되었습니다.');
  const { error } = await sb()
    .from('owner_settings')
    .upsert({ owner_id: u.user.id, ...patch, updated_at: new Date().toISOString() }, { onConflict: 'owner_id' });
  if (error) throw error;
}

// ---------- 장소 ----------
export type PlaceInput = {
  category: Place['category'];
  deco_category_id: string | null;
  name: string;
  description: string;
  lat: number;
  lng: number;
  photo_id: string | null;
  is_favorite: boolean;
};

export async function insertPlace(input: PlaceInput): Promise<Place> {
  const { data, error } = await sb().from('places').insert(input).select().single();
  if (error) throw error;
  return data as Place;
}

export class ConflictError extends Error {
  constructor(public server: Place | DecoCategory | null) {
    super('CONFLICT');
  }
}

/** version이 같을 때만 수정. 다른 기기에서 먼저 수정했으면 ConflictError */
export async function updatePlace(id: string, version: number | null, patch: Partial<PlaceInput> & { deleted_at?: string | null }): Promise<Place> {
  let req = sb().from('places').update(patch).eq('id', id);
  if (version != null) req = req.eq('version', version);
  const { data, error } = await req.select();
  if (error) throw error;
  if (!data || data.length === 0) {
    const { data: cur } = await sb().from('places').select('*').eq('id', id).maybeSingle();
    throw new ConflictError((cur as Place) ?? null);
  }
  return data[0] as Place;
}

export async function setPlacesDeleted(ids: string[], deleted: boolean) {
  const { error } = await sb()
    .from('places')
    .update({ deleted_at: deleted ? new Date().toISOString() : null })
    .in('id', ids);
  if (error) throw error;
}

export async function purgePlaces(ids: string[]): Promise<string[]> {
  const { data, error } = await sb().rpc('purge_places', { ids });
  if (error) throw error;
  return (data as string[]) ?? [];
}

// ---------- 데코 분류 ----------
export type CategoryInput = { name: string; icon: string; icon_photo_id: string | null };

export async function insertCategory(input: CategoryInput, sortOrder: number): Promise<DecoCategory> {
  const { data, error } = await sb()
    .from('deco_categories')
    .insert({ ...input, sort_order: sortOrder })
    .select()
    .single();
  if (error) throw error;
  return data as DecoCategory;
}

export async function updateCategory(id: string, version: number | null, patch: Partial<CategoryInput> & { sort_order?: number; deleted_at?: string | null }) {
  let req = sb().from('deco_categories').update(patch).eq('id', id);
  if (version != null) req = req.eq('version', version);
  const { data, error } = await req.select();
  if (error) throw error;
  if (!data || data.length === 0) {
    const { data: cur } = await sb().from('deco_categories').select('*').eq('id', id).maybeSingle();
    throw new ConflictError((cur as DecoCategory) ?? null);
  }
  return data[0] as DecoCategory;
}

export type TrashMode = 'with_places' | 'uncategorize';

export async function trashCategory(id: string, mode: TrashMode): Promise<string[]> {
  const { data, error } = await sb().rpc('trash_deco_category', { cat_id: id, mode });
  if (error) throw error;
  return (data as string[]) ?? [];
}

export async function untrashCategory(id: string, mode: TrashMode | 'none', placeIds: string[]) {
  const { error } = await sb().rpc('untrash_deco_category', { cat_id: id, mode, place_ids: placeIds });
  if (error) throw error;
}

export async function purgeCategory(id: string): Promise<string[]> {
  const { data, error } = await sb().rpc('purge_deco_category', { cat_id: id });
  if (error) throw error;
  return (data as string[]) ?? [];
}

/** 사진 교체 후 옛 사진이 더 이상 쓰이지 않으면 정리 */
export async function gcPhotos(ids: string[]): Promise<string[]> {
  if (!ids.length) return [];
  const { data, error } = await sb().rpc('gc_photos', { candidate_ids: ids });
  if (error) throw error;
  return (data as string[]) ?? [];
}

// ---------- 끝나지 않은 복원 ----------
export type OpenRestore = { id: string; status: 'pending' | 'committed'; created_at: string };

export async function getOpenRestore(): Promise<OpenRestore | null> {
  const { data, error } = await sb()
    .from('restore_snapshots')
    .select('id,status,created_at')
    .in('status', ['pending', 'committed'])
    .order('created_at', { ascending: false })
    .limit(1);
  if (error) throw error;
  return (data?.[0] as OpenRestore) ?? null;
}
