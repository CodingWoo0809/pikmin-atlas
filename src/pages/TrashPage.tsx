import { useMemo, useState } from 'react';
import { CoordButton, formatDate, Icon, PhotoImg, Spinner } from '../components/bits';
import { purgeCategory, purgePlaces, setPlacesDeleted, untrashCategory, updatePlace } from '../lib/api';
import { dataErrorMessage } from '../lib/errors';
import { removeFiles } from '../lib/photos';
import { useBack } from '../lib/useBack';
import { CATEGORY_LABEL, type DecoCategory, type Place } from '../lib/types';
import { useAtlas } from '../state/atlas';
import { useUi } from '../state/ui';

export function TrashPage() {
  const back = useBack('/mushroom');
  const { places, categories, photos, loaded, online, putPlaces, dropPlaces, refresh } = useAtlas();
  const { toast, confirm, ask } = useUi();
  const [busy, setBusy] = useState(false);

  const deletedPlaces = useMemo(
    () => places.filter((p) => p.deleted_at).sort((a, b) => (a.deleted_at! < b.deleted_at! ? 1 : -1)),
    [places],
  );
  const deletedCats = useMemo(() => categories.filter((c) => c.deleted_at), [categories]);
  const catById = useMemo(() => new Map(categories.map((c) => [c.id, c])), [categories]);

  const guard = () => {
    if (!online) {
      toast('오프라인 — 저장되지 않습니다.', { kind: 'error' });
      return false;
    }
    return true;
  };

  const restorePlace = async (p: Place) => {
    if (!guard()) return;
    const cat = p.deco_category_id ? catById.get(p.deco_category_id) : null;
    let withCat = false;
    if (cat?.deleted_at) {
      const c = await ask(
        '분류도 휴지통에 있습니다',
        <p>
          이 장소의 분류 "{cat.name}"도 휴지통에 있습니다. 분류도 함께 복구할까요? 복구하지 않으면 장소는 보이지 않는 분류에 남습니다.
        </p>,
        [
          { value: 'with', label: '분류도 함께 복구', tone: 'primary' },
          { value: 'alone', label: '장소만 복구 (미분류로)', tone: 'plain' },
          { value: 'cancel', label: '취소', tone: 'plain' },
        ],
      );
      if (!c || c === 'cancel') return;
      withCat = c === 'with';
    }
    setBusy(true);
    try {
      if (withCat && cat) await untrashCategory(cat.id, 'none', []);
      await setPlacesDeleted([p.id], false);
      if (cat?.deleted_at && !withCat) {
        await updatePlace(p.id, null, { deco_category_id: null });
      }
      putPlaces([p.id], { deleted_at: null });
      await refresh(true);
      toast(`"${p.name}"을(를) 복구했습니다.`, { kind: 'success' });
    } catch (e) {
      toast(`복구 실패: ${dataErrorMessage(e as Error)}`, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const purge = async (list: Place[]) => {
    if (!guard() || list.length === 0) return;
    const ok = await confirm(
      list.length === 1 ? '영구 삭제할까요?' : `${list.length}곳을 영구 삭제할까요?`,
      <p>영구 삭제하면 되돌릴 수 없습니다. 다른 장소가 쓰지 않는 사진도 함께 지워집니다.</p>,
      '영구 삭제',
      'danger',
    );
    if (!ok) return;
    setBusy(true);
    try {
      const ids = list.map((p) => p.id);
      const paths: string[] = [];
      for (let i = 0; i < ids.length; i += 200) paths.push(...(await purgePlaces(ids.slice(i, i + 200))));
      dropPlaces(ids);
      const filesOk = await removeFiles(paths);
      await refresh(true);
      toast(filesOk ? '영구 삭제했습니다.' : '영구 삭제했습니다. 일부 사진 파일은 설정 → 저장공간 정리에서 지울 수 있습니다.', { kind: 'success' });
    } catch (e) {
      toast(`영구 삭제 실패: ${dataErrorMessage(e as Error)}`, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const restoreCat = async (c: DecoCategory) => {
    if (!guard()) return;
    setBusy(true);
    try {
      await untrashCategory(c.id, 'none', []);
      await refresh(true);
      toast(`"${c.name}" 분류를 복구했습니다. 함께 삭제된 장소는 아래 목록에서 따로 복구하세요.`, { kind: 'success', ms: 5000 });
    } catch (e) {
      toast(`복구 실패: ${dataErrorMessage(e as Error)}`, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const purgeCat = async (c: DecoCategory) => {
    if (!guard()) return;
    const n = places.filter((p) => p.deco_category_id === c.id).length;
    const ok = await confirm(
      `"${c.name}" 분류를 영구 삭제할까요?`,
      <p>되돌릴 수 없습니다.{n > 0 ? ` 이 분류에 속한 장소 ${n}곳은 지워지지 않고 "미분류"가 됩니다.` : ''}</p>,
      '영구 삭제',
      'danger',
    );
    if (!ok) return;
    setBusy(true);
    try {
      const paths = await purgeCategory(c.id);
      await removeFiles(paths);
      await refresh(true);
      toast('분류를 영구 삭제했습니다.', { kind: 'success' });
    } catch (e) {
      toast(`영구 삭제 실패: ${dataErrorMessage(e as Error)}`, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  if (!loaded) return <Spinner />;
  return (
    <section className="page page-narrow">
      <div className="page-head">
        <button type="button" className="icon-btn" onClick={back} aria-label="뒤로">
          <Icon name="back" />
        </button>
        <h1 className="grow">휴지통</h1>
        {deletedPlaces.length > 0 && (
          <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => purge(deletedPlaces)} disabled={busy}>
            장소 모두 영구 삭제
          </button>
        )}
      </div>
      <p className="hint">휴지통은 자동으로 비워지지 않습니다. 영구 삭제하기 전까지 언제든 복구할 수 있습니다.</p>

      {deletedCats.length > 0 && (
        <>
          <h2 className="section-title">삭제한 데코 분류</h2>
          <ul className="trash-list">
            {deletedCats.map((c) => (
              <li key={c.id} className="trash-item">
                <span className="cat-icon" aria-hidden="true">
                  <span>{c.icon || c.name.slice(0, 1)}</span>
                </span>
                <div className="trash-main">
                  <p className="trash-name">{c.name}</p>
                  <p className="hint">{formatDate(c.deleted_at!)} 삭제</p>
                </div>
                <div className="trash-actions">
                  <button type="button" className="btn btn-plain btn-sm" onClick={() => restoreCat(c)} disabled={busy}>
                    <Icon name="restore" size={15} /> 복구
                  </button>
                  <button type="button" className="btn btn-quiet-danger btn-sm" onClick={() => purgeCat(c)} disabled={busy}>
                    영구 삭제
                  </button>
                </div>
              </li>
            ))}
          </ul>
        </>
      )}

      <h2 className="section-title">삭제한 장소</h2>
      {deletedPlaces.length === 0 ? (
        <p className="empty">휴지통이 비어 있습니다.</p>
      ) : (
        <ul className="trash-list">
          {deletedPlaces.map((p) => (
            <li key={p.id} className="trash-item">
              <div className="trash-thumb">
                {p.category === 'deco' ? (
                  <span className="cat-icon" aria-hidden="true">
                    <span>{(p.deco_category_id && catById.get(p.deco_category_id)?.icon) || '·'}</span>
                  </span>
                ) : (
                  <PhotoImg photo={p.photo_id ? photos.get(p.photo_id) : undefined} alt="" />
                )}
              </div>
              <div className="trash-main">
                <p className="trash-name">{p.name}</p>
                <p className="hint">
                  <span className={`cat-label cat-label-${p.category}`}>{CATEGORY_LABEL[p.category]}</span> {formatDate(p.deleted_at!)} 삭제
                </p>
                <CoordButton lat={p.lat} lng={p.lng} stacked={false} />
              </div>
              <div className="trash-actions">
                <button type="button" className="btn btn-plain btn-sm" onClick={() => restorePlace(p)} disabled={busy}>
                  <Icon name="restore" size={15} /> 복구
                </button>
                <button type="button" className="btn btn-quiet-danger btn-sm" onClick={() => purge([p])} disabled={busy}>
                  영구 삭제
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
