import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Icon, PhotoImg, Spinner } from '../components/bits';
import { ConflictError, gcPhotos, insertPlace, updatePlace, type PlaceInput } from '../lib/api';
import { formatCoord, latProblem, lngProblem, parseNumber, splitPair } from '../lib/coords';
import { dataErrorMessage } from '../lib/errors';
import { compressPhoto, photoErrorMessage, removeFiles, uploadPhoto, type CompressedPhoto } from '../lib/photos';
import { clearDraft, loadDraft, saveDraft } from '../lib/prefs';
import { CATEGORY_LABEL, type Category, type Place } from '../lib/types';
import { usePlaceActions } from '../state/actions';
import { useAtlas } from '../state/atlas';
import { useAuth } from '../state/auth';
import { useBack } from '../lib/useBack';
import { useUi } from '../state/ui';

type Form = { name: string; description: string; lat: string; lng: string; decoCategoryId: string; isFavorite: boolean };

function formFrom(p: Place): Form {
  return {
    name: p.name,
    description: p.description,
    lat: formatCoord(p.lat),
    lng: formatCoord(p.lng),
    decoCategoryId: p.deco_category_id ?? '',
    isFavorite: p.is_favorite,
  };
}

export function PlaceEditorPage() {
  const { id } = useParams();
  const [search] = useSearchParams();
  const { places, loaded } = useAtlas();
  if (!loaded) return <Spinner />;
  if (id) {
    const p = places.find((x) => x.id === id);
    if (!p || p.deleted_at) {
      return (
        <section className="page">
          <div className="empty">
            <p>이 장소는 삭제되었거나 없습니다.</p>
            <Link to="/trash" className="btn btn-plain">
              휴지통 보기
            </Link>
          </div>
        </section>
      );
    }
    return <Editor key={p.id} existing={p} category={p.category} />;
  }
  const c = search.get('category');
  const category: Category = c === 'bigflower' || c === 'deco' ? c : 'mushroom';
  return <Editor key={`new-${category}`} existing={null} category={category} initialDeco={search.get('deco') ?? ''} />;
}

function Editor({ existing, category, initialDeco = '' }: { existing: Place | null; category: Category; initialDeco?: string }) {
  const back = useBack(category === 'deco' ? (initialDeco || existing?.deco_category_id ? `/deco/${existing?.deco_category_id ?? initialDeco}` : '/deco') : `/${category}`);
  const { ownerId } = useAuth();
  const { categories, photos, online, putPlace, putPhoto, refresh } = useAtlas();
  const { toast, ask, confirm } = useUi();
  const { trash } = usePlaceActions();
  const draftKey = existing ? `place.${existing.id}` : `place.new.${category}`;
  const blank: Form = { name: '', description: '', lat: '', lng: '', decoCategoryId: initialDeco, isFavorite: false };
  const base = existing ? formFrom(existing) : blank;

  const [form, setForm] = useState<Form>(() => {
    const d = loadDraft<{ form: Form; version: number | null }>(draftKey);
    return d && (!existing || d.version === existing.version) ? d.form : base;
  });
  const [draftRestored] = useState(() => {
    const d = loadDraft<{ form: Form; version: number | null }>(draftKey);
    return !!d && (!existing || d.version === existing.version) && JSON.stringify(d.form) !== JSON.stringify(base);
  });
  const [version, setVersion] = useState<number | null>(existing?.version ?? null);
  const [newPhoto, setNewPhoto] = useState<{ c: CompressedPhoto; url: string } | null>(null);
  const [removePhoto, setRemovePhoto] = useState(false);
  const [compressing, setCompressing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const hasPhotoField = category !== 'deco';
  const liveCats = useMemo(() => categories.filter((c) => !c.deleted_at).sort((a, b) => a.sort_order - b.sort_order), [categories]);

  useEffect(() => {
    if (JSON.stringify(form) === JSON.stringify(base)) clearDraft(draftKey);
    else saveDraft(draftKey, { form, version });
  }, [form]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => () => {
    if (newPhoto) URL.revokeObjectURL(newPhoto.url);
  }, [newPhoto]);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  const lat = parseNumber(form.lat);
  const lng = parseNumber(form.lng);
  const errors = {
    name: !form.name.trim() ? '이름을 입력하세요.' : form.name.trim().length > 100 ? '이름은 100자 이하여야 합니다.' : null,
    lat: latProblem(lat),
    lng: lngProblem(lng),
    description: form.description.length > 2000 ? '설명은 2000자 이하여야 합니다.' : null,
  };
  const invalid = Object.values(errors).some(Boolean);

  const onLatChange = (v: string) => {
    const pair = splitPair(v);
    if (pair) setForm((f) => ({ ...f, lat: pair.lat, lng: pair.lng }));
    else set('lat', v);
  };

  const pickPhoto = async (file: File | undefined) => {
    if (!file) return;
    setCompressing(true);
    try {
      const c = await compressPhoto(file, 'place');
      setNewPhoto({ c, url: URL.createObjectURL(c.display) });
      setRemovePhoto(false);
    } catch (e) {
      toast(photoErrorMessage(e), { kind: 'error', ms: 6000 });
    } finally {
      setCompressing(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const currentPhoto = existing?.photo_id && !removePhoto ? photos.get(existing.photo_id) : undefined;

  const save = async () => {
    setTouched(true);
    if (invalid || saving) return;
    if (!online) return toast('오프라인 — 저장되지 않습니다. 작성한 글자는 이 기기에 임시 보관됩니다.', { kind: 'error' });
    if (!ownerId) return;
    setSaving(true);
    let uploadedPhotoId: string | null = null;
    try {
      let photoId = existing?.photo_id ?? null;
      if (removePhoto) photoId = null;
      if (newPhoto) {
        const row = await uploadPhoto(ownerId, newPhoto.c);
        putPhoto(row);
        uploadedPhotoId = row.id;
        photoId = row.id;
      }
      const input: PlaceInput = {
        category,
        deco_category_id: category === 'deco' ? form.decoCategoryId || null : null,
        name: form.name.trim(),
        description: form.description.trim(),
        lat: lat!,
        lng: lng!,
        photo_id: hasPhotoField ? photoId : null,
        is_favorite: form.isFavorite,
      };
      let saved: Place;
      if (!existing) {
        saved = await insertPlace(input);
      } else {
        try {
          saved = await updatePlace(existing.id, version, input);
        } catch (e) {
          if (!(e instanceof ConflictError)) throw e;
          const server = e.server as Place | null;
          if (!server || server.deleted_at) {
            throw new Error('다른 기기에서 이 장소를 삭제했습니다. 휴지통에서 복구한 뒤 다시 수정하세요.');
          }
          const choice = await ask(
            '다른 기기에서 먼저 수정됨',
            <p>이 장소는 다른 기기에서 먼저 수정되었습니다. 어떻게 할까요?</p>,
            [
              { value: 'overwrite', label: '내 내용으로 덮어쓰기', tone: 'danger' },
              { value: 'server', label: '서버 내용 보기', tone: 'primary' },
              { value: 'cancel', label: '취소', tone: 'plain' },
            ],
          );
          if (choice === 'overwrite') {
            saved = await updatePlace(existing.id, server.version, input);
          } else {
            if (choice === 'server') {
              putPlace(server);
              setForm(formFrom(server));
              setVersion(server.version);
              setRemovePhoto(false);
              toast('서버의 최신 내용을 불러왔습니다. 필요하면 다시 수정하세요.');
            }
            if (uploadedPhotoId) {
              await removeFiles(await gcPhotos([uploadedPhotoId]));
              setNewPhoto(null);
            }
            setSaving(false);
            return;
          }
        }
      }
      putPlace(saved);
      // 바뀐 옛 사진이 더 이상 쓰이지 않으면 정리 (DB 먼저, 파일은 나중)
      if (existing?.photo_id && existing.photo_id !== saved.photo_id) {
        gcPhotos([existing.photo_id])
          .then((paths) => removeFiles(paths))
          .then(() => refresh(true))
          .catch(() => undefined);
      }
      clearDraft(draftKey);
      toast(existing ? '저장했습니다.' : '등록했습니다.', { kind: 'success' });
      back();
    } catch (e) {
      if (uploadedPhotoId) {
        // 장소 저장에 실패하면 방금 올린 사진도 정리
        gcPhotos([uploadedPhotoId]).then(removeFiles).catch(() => undefined);
      }
      toast(`저장 실패: ${dataErrorMessage(e as Error)}`, { kind: 'error', ms: 6000 });
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!existing) return;
    const ok = await confirm('휴지통으로 옮길까요?', <p>"{existing.name}"을(를) 휴지통으로 옮깁니다. 휴지통에서 언제든 복구할 수 있습니다.</p>, '휴지통으로', 'danger');
    if (!ok) return;
    if (await trash(existing)) {
      clearDraft(draftKey);
      back();
    }
  };

  const title = existing ? '장소 편집' : category === 'deco' ? '후보 장소 추가' : `${CATEGORY_LABEL[category]} 추가`;

  return (
    <section className="page page-narrow">
      <div className="page-head">
        <button type="button" className="icon-btn" onClick={() => back()} aria-label="뒤로">
          <Icon name="back" />
        </button>
        <h1 className="grow">{title}</h1>
        <span className={`cat-label cat-label-${category}`}>{CATEGORY_LABEL[category]}</span>
      </div>

      {draftRestored && (
        <div className="banner banner-quiet inline-banner">
          저장하지 않았던 작성 내용을 불러왔습니다.
          <button type="button" className="link-btn" onClick={() => setForm(base)}>
            처음 내용으로
          </button>
        </div>
      )}

      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
        noValidate
      >
        {hasPhotoField && (
          <div className="field">
            <span className="field-label">사진</span>
            <div className="photo-edit">
              <div className="photo-edit-preview">
                {newPhoto ? <img src={newPhoto.url} alt="새 사진 미리보기" /> : <PhotoImg photo={currentPhoto} thumb={false} alt="현재 사진" />}
                {compressing && <div className="photo-edit-busy">압축 중…</div>}
              </div>
              <div className="photo-edit-actions">
                <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pickPhoto(e.target.files?.[0])} />
                <button type="button" className="btn btn-plain" onClick={() => fileRef.current?.click()} disabled={compressing || saving}>
                  <Icon name="photo" size={17} /> {currentPhoto || newPhoto ? '사진 바꾸기' : '사진 고르기'}
                </button>
                {(currentPhoto || newPhoto) && (
                  <button
                    type="button"
                    className="btn btn-quiet"
                    onClick={() => {
                      setNewPhoto(null);
                      setRemovePhoto(true);
                    }}
                    disabled={saving}
                  >
                    사진 빼기
                  </button>
                )}
                {newPhoto && (
                  <p className="hint">
                    압축됨: {newPhoto.c.width}×{newPhoto.c.height}, {Math.round((newPhoto.c.display.size + (newPhoto.c.thumb?.size ?? 0)) / 1024)}KB
                  </p>
                )}
              </div>
            </div>
          </div>
        )}

        <label className="field">
          <span className="field-label">이름</span>
          <input value={form.name} onChange={(e) => set('name', e.target.value)} maxLength={100} placeholder="예: 광화문광장 북쪽" aria-invalid={touched && !!errors.name} />
          {touched && errors.name && <span className="field-error">{errors.name}</span>}
        </label>

        <div className="field">
          <span className="field-label">좌표</span>
          <div className="coord-inputs">
            <label>
              <span className="sub-label">위도</span>
              <input inputMode="decimal" value={form.lat} onChange={(e) => onLatChange(e.target.value)} placeholder="37.566535" aria-invalid={touched && !!errors.lat} />
            </label>
            <label>
              <span className="sub-label">경도</span>
              <input inputMode="decimal" value={form.lng} onChange={(e) => set('lng', e.target.value)} placeholder="126.977969" aria-invalid={touched && !!errors.lng} />
            </label>
          </div>
          <span className="hint">"37.566535, 126.977969" 형태를 위도 칸에 붙여 넣으면 자동으로 나눠집니다.</span>
          {touched && (errors.lat || errors.lng) && <span className="field-error">{errors.lat ?? errors.lng}</span>}
        </div>

        {category === 'deco' && (
          <label className="field">
            <span className="field-label">데코 분류</span>
            <select value={form.decoCategoryId} onChange={(e) => set('decoCategoryId', e.target.value)}>
              <option value="">미분류</option>
              {liveCats.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.icon ? `${c.icon} ` : ''}
                  {c.name}
                </option>
              ))}
            </select>
          </label>
        )}

        <label className="field">
          <span className="field-label">설명</span>
          <textarea value={form.description} onChange={(e) => set('description', e.target.value)} rows={4} maxLength={2000} placeholder="메모 (선택)" />
          <span className="hint right">{form.description.length} / 2000</span>
        </label>

        <label className="check">
          <input type="checkbox" checked={form.isFavorite} onChange={(e) => set('isFavorite', e.target.checked)} />
          즐겨찾기
        </label>

        <div className="form-actions">
          <button type="button" className="btn btn-plain" onClick={() => back()} disabled={saving}>
            취소
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving || compressing || !online}>
            {saving ? '저장 중…' : !online ? '오프라인' : existing ? '저장' : '등록'}
          </button>
        </div>
      </form>

      {existing && (
        <div className="danger-zone">
          <button type="button" className="btn btn-danger-outline" onClick={onDelete} disabled={saving}>
            <Icon name="trash" size={16} /> 이 장소 삭제
          </button>
          <p className="hint">휴지통으로 옮겨지며, 영구 삭제하기 전까지 복구할 수 있습니다.</p>
        </div>
      )}
    </section>
  );
}
