export type Category = 'mushroom' | 'bigflower' | 'deco';

export const CATEGORY_LABEL: Record<Category, string> = {
  mushroom: '버섯',
  bigflower: '빅플라워',
  deco: '단일 데코 스팟',
};

export type Place = {
  id: string;
  category: Category;
  deco_category_id: string | null;
  name: string;
  description: string;
  lat: number;
  lng: number;
  photo_id: string | null;
  is_favorite: boolean;
  seq: number;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type DecoCategory = {
  id: string;
  name: string;
  icon: string;
  icon_photo_id: string | null;
  sort_order: number;
  version: number;
  created_at: string;
  updated_at: string;
  deleted_at: string | null;
};

export type Photo = {
  id: string;
  kind: 'place' | 'icon';
  path: string;
  thumb_path: string | null;
  width: number;
  height: number;
  bytes: number;
  sha256: string;
  created_at: string;
};

export type OwnerSettings = {
  owner_id: string;
  password_initialized: boolean;
  last_backup_at: string | null;
  schema_version: number;
};

export type SortKey = 'newest' | 'oldest' | 'name' | 'favorite';

export const SORT_LABEL: Record<SortKey, string> = {
  newest: '최신순',
  oldest: '오래된순',
  name: '이름순',
  favorite: '즐겨찾기순',
};
