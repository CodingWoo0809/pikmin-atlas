import type { Place, SortKey } from './types';

const collator = new Intl.Collator('ko', { sensitivity: 'base', numeric: true });

function newestFirst(a: Place, b: Place) {
  if (a.created_at !== b.created_at) return a.created_at < b.created_at ? 1 : -1;
  return b.seq - a.seq;
}

export function sortPlaces(list: Place[], key: SortKey): Place[] {
  const arr = [...list];
  switch (key) {
    case 'newest':
      return arr.sort(newestFirst);
    case 'oldest':
      return arr.sort((a, b) => -newestFirst(a, b));
    case 'name':
      return arr.sort((a, b) => collator.compare(a.name, b.name) || newestFirst(a, b));
    case 'favorite':
      return arr.sort((a, b) => Number(b.is_favorite) - Number(a.is_favorite) || newestFirst(a, b));
  }
}

export function matchesSearch(p: Place, q: string): boolean {
  const s = q.trim().toLowerCase();
  if (!s) return true;
  return p.name.toLowerCase().includes(s) || p.description.toLowerCase().includes(s);
}
