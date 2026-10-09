import { useMemo } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CoordButton, FavButton, Icon, PhotoImg, Spinner } from '../components/bits';
import { Toolbar } from '../components/Toolbar';
import type { DecoCategory, Place } from '../lib/types';
import { usePlaceActions } from '../state/actions';
import { useAtlas } from '../state/atlas';
import { applyList, useListState } from './GalleryPage';

export function CategoryIcon({ cat, size = 'md' }: { cat: DecoCategory | null; size?: 'md' | 'lg' }) {
  const { photos } = useAtlas();
  const photo = cat?.icon_photo_id ? photos.get(cat.icon_photo_id) : undefined;
  return (
    <span className={`cat-icon cat-icon-${size}`} aria-hidden="true">
      {photo ? <PhotoImg photo={photo} alt="" /> : <span>{cat ? cat.icon || cat.name.slice(0, 1) : '?'}</span>}
    </span>
  );
}

export function DecoHomePage() {
  const { categories, places, loaded } = useAtlas();
  const live = useMemo(() => categories.filter((c) => !c.deleted_at).sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ko')), [categories]);
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of places) {
      if (p.category !== 'deco' || p.deleted_at) continue;
      const k = p.deco_category_id ?? 'none';
      m.set(k, (m.get(k) ?? 0) + 1);
    }
    return m;
  }, [places]);
  const uncategorized = counts.get('none') ?? 0;

  if (!loaded) return <Spinner />;
  return (
    <section className="page">
      <div className="page-head">
        <h1>데코 분류</h1>
        <Link to="/deco-category/new" className="btn btn-primary btn-sm">
          <Icon name="plus" size={16} /> 분류 추가
        </Link>
      </div>
      {live.length === 0 && uncategorized === 0 && (
        <div className="empty">
          <p>데코 분류를 만들고 분류마다 후보 장소를 등록하세요. 예: 카페, 공원, 편의점</p>
          <Link className="btn btn-primary" to="/deco-category/new">
            첫 분류 만들기
          </Link>
        </div>
      )}
      <ul className="cat-grid">
        {live.map((c) => (
          <li key={c.id}>
            <Link to={`/deco/${c.id}`} className="cat-tile">
              <CategoryIcon cat={c} size="lg" />
              <span className="cat-name">{c.name}</span>
              <span className="cat-count">후보 {counts.get(c.id) ?? 0}곳</span>
            </Link>
          </li>
        ))}
        {uncategorized > 0 && (
          <li>
            <Link to="/deco/none" className="cat-tile cat-tile-muted">
              <CategoryIcon cat={null} size="lg" />
              <span className="cat-name">미분류</span>
              <span className="cat-count">후보 {uncategorized}곳</span>
            </Link>
          </li>
        )}
      </ul>
    </section>
  );
}

export function DecoCandidatesPage() {
  const { catId = 'none' } = useParams();
  const { categories, places, loaded } = useAtlas();
  const cat = catId === 'none' ? null : categories.find((c) => c.id === catId) ?? null;
  const st = useListState(`deco.${catId}`);
  const all = useMemo(
    () => places.filter((p) => p.category === 'deco' && !p.deleted_at && (p.deco_category_id ?? 'none') === catId),
    [places, catId],
  );
  const { sort, favOnly, query } = st;
  const list = useMemo(() => applyList(all, { sort, favOnly, query }), [all, sort, favOnly, query]);

  if (!loaded) return <Spinner />;
  if (catId !== 'none' && (!cat || cat.deleted_at)) {
    return (
      <section className="page">
        <div className="empty">
          <p>이 분류는 삭제되었거나 없습니다.</p>
          <Link to="/deco" className="btn btn-plain">
            분류 목록으로
          </Link>
        </div>
      </section>
    );
  }
  const addHref = `/place/new?category=deco${cat ? `&deco=${cat.id}` : ''}`;
  return (
    <section className="page">
      <div className="page-head">
        <Link to="/deco" className="icon-btn" aria-label="분류 목록으로">
          <Icon name="back" />
        </Link>
        <CategoryIcon cat={cat} />
        <h1 className="grow">{cat?.name ?? '미분류'}</h1>
        {cat && (
          <Link to={`/deco-category/${cat.id}`} className="btn btn-plain btn-sm">
            <Icon name="edit" size={15} /> 분류 편집
          </Link>
        )}
      </div>
      <Toolbar sort={st.sort} onSort={st.setSort} favOnly={st.favOnly} onFavOnly={st.setFavOnly} query={st.query} onQuery={st.setQuery} count={list.length} />
      {all.length === 0 && (
        <div className="empty">
          <p>아직 후보 장소가 없습니다.</p>
          <Link className="btn btn-primary" to={addHref}>
            후보 장소 추가
          </Link>
        </div>
      )}
      {all.length > 0 && list.length === 0 && <p className="empty">조건에 맞는 장소가 없습니다.</p>}
      <ul className="deco-grid">
        {list.map((p) => (
          <DecoCard key={p.id} place={p} />
        ))}
      </ul>
      <Link to={addHref} className="fab" aria-label="후보 장소 추가">
        <Icon name="plus" size={22} />
        <span>추가</span>
      </Link>
    </section>
  );
}

function DecoCard({ place }: { place: Place }) {
  const { toggleFavorite } = usePlaceActions();
  return (
    <li className="deco-card">
      <div className="deco-card-top">
        <p className="deco-name">{place.name}</p>
        <FavButton on={place.is_favorite} onToggle={() => toggleFavorite(place)} />
      </div>
      <CoordButton lat={place.lat} lng={place.lng} />
      {place.description && <p className="deco-desc">{place.description}</p>}
      <Link to={`/place/${place.id}`} className="deco-edit">
        <Icon name="edit" size={14} /> 편집
      </Link>
    </li>
  );
}
