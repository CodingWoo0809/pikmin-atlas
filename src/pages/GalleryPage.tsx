import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { CoordButton, FavButton, Icon, PhotoImg, Spinner } from '../components/bits';
import { Toolbar } from '../components/Toolbar';
import { loadPref, savePref } from '../lib/prefs';
import { matchesSearch, sortPlaces } from '../lib/sort';
import { CATEGORY_LABEL, SORT_LABEL, type Photo, type Place, type SortKey } from '../lib/types';
import { usePlaceActions } from '../state/actions';
import { useAtlas } from '../state/atlas';

const SORT_KEYS = Object.keys(SORT_LABEL) as SortKey[];

export function useListState(key: string) {
  const [sort, setSort] = useState<SortKey>(() => loadPref(`sort.${key}`, SORT_KEYS, 'newest'));
  const [favOnly, setFavOnly] = useState(() => loadPref(`fav.${key}`, ['1', '0'], '0') === '1');
  const [query, setQuery] = useState('');
  useEffect(() => {
    setSort(loadPref(`sort.${key}`, SORT_KEYS, 'newest'));
    setFavOnly(loadPref(`fav.${key}`, ['1', '0'], '0') === '1');
    setQuery('');
  }, [key]);
  return {
    sort,
    setSort: (s: SortKey) => {
      setSort(s);
      savePref(`sort.${key}`, s);
    },
    favOnly,
    setFavOnly: (v: boolean) => {
      setFavOnly(v);
      savePref(`fav.${key}`, v ? '1' : '0');
    },
    query,
    setQuery,
  };
}

export function applyList(list: Place[], s: { sort: SortKey; favOnly: boolean; query: string }) {
  return sortPlaces(
    list.filter((p) => (!s.favOnly || p.is_favorite) && matchesSearch(p, s.query)),
    s.sort,
  );
}

export function GalleryPage({ category }: { category: 'mushroom' | 'bigflower' }) {
  const { places, photos, loaded, loadError, refresh } = useAtlas();
  const st = useListState(category);
  const [detail, setDetail] = useState<Place | null>(null);
  const all = useMemo(() => places.filter((p) => p.category === category && !p.deleted_at), [places, category]);
  const { sort, favOnly, query } = st;
  const list = useMemo(() => applyList(all, { sort, favOnly, query }), [all, sort, favOnly, query]);

  // 상세 보기 중 데이터가 바뀌면 최신 내용으로
  const current = detail ? places.find((p) => p.id === detail.id && !p.deleted_at) ?? null : null;

  return (
    <section className="page">
      <h1 className="sr-only">{CATEGORY_LABEL[category]}</h1>
      <Toolbar sort={st.sort} onSort={st.setSort} favOnly={st.favOnly} onFavOnly={st.setFavOnly} query={st.query} onQuery={st.setQuery} count={list.length} />

      {!loaded && !loadError && <Spinner />}
      {loadError && !loaded && (
        <div className="empty">
          <p>{loadError}</p>
          <button type="button" className="btn btn-primary" onClick={() => refresh(true)}>
            다시 불러오기
          </button>
        </div>
      )}
      {loaded && all.length === 0 && (
        <div className="empty">
          <p>아직 등록한 {CATEGORY_LABEL[category]}이 없습니다.</p>
          <Link className="btn btn-primary" to={`/place/new?category=${category}`}>
            첫 {CATEGORY_LABEL[category]} 등록하기
          </Link>
        </div>
      )}
      {loaded && all.length > 0 && list.length === 0 && <p className="empty">조건에 맞는 장소가 없습니다.</p>}

      <ul className="gallery">
        {list.map((p) => (
          <PlaceCard key={p.id} place={p} photo={p.photo_id ? photos.get(p.photo_id) : undefined} onOpen={() => setDetail(p)} />
        ))}
      </ul>

      <Link to={`/place/new?category=${category}`} className="fab" aria-label={`${CATEGORY_LABEL[category]} 추가`}>
        <Icon name="plus" size={22} />
        <span>추가</span>
      </Link>

      {current && <DetailSheet place={current} onClose={() => setDetail(null)} />}
    </section>
  );
}

function PlaceCard({ place, photo, onOpen }: { place: Place; photo: Photo | undefined; onOpen: () => void }) {
  const { toggleFavorite } = usePlaceActions();
  const [busy, setBusy] = useState(false);
  return (
    <li className="card">
      <button type="button" className="card-photo" onClick={onOpen} aria-label={`${place.name} 자세히 보기`}>
        <PhotoImg photo={photo} alt={place.name} />
      </button>
      <FavButton
        on={place.is_favorite}
        busy={busy}
        onToggle={async () => {
          setBusy(true);
          await toggleFavorite(place);
          setBusy(false);
        }}
      />
      <Link to={`/place/${place.id}`} className="card-edit" aria-label={`${place.name} 편집`}>
        <Icon name="edit" size={14} />
      </Link>
      <div className="card-body">
        <p className="card-name" title={place.name}>
          {place.name}
        </p>
        <CoordButton lat={place.lat} lng={place.lng} />
        {place.description && (
          <p className="card-desc" title={place.description}>
            {place.description}
          </p>
        )}
      </div>
    </li>
  );
}

function DetailSheet({ place, onClose }: { place: Place; onClose: () => void }) {
  const { photos } = useAtlas();
  const { toggleFavorite } = usePlaceActions();
  const nav = useNavigate();
  const photo = place.photo_id ? photos.get(place.photo_id) : undefined;
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="scrim" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={place.name} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-photo">
          <PhotoImg photo={photo} thumb={false} alt={place.name} />
          <button type="button" className="sheet-close" onClick={onClose} aria-label="닫기">
            <Icon name="close" />
          </button>
        </div>
        <div className="sheet-body">
          <div className="sheet-title">
            <h2>{place.name}</h2>
            <FavButton on={place.is_favorite} onToggle={() => toggleFavorite(place)} />
          </div>
          <CoordButton lat={place.lat} lng={place.lng} stacked={false} />
          {place.description && <p className="sheet-desc">{place.description}</p>}
          <button type="button" className="btn btn-plain btn-block" onClick={() => nav(`/place/${place.id}`)}>
            <Icon name="edit" size={16} /> 편집
          </button>
        </div>
      </div>
    </div>
  );
}
