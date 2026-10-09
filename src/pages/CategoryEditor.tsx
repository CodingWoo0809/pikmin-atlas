import { useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Icon, PhotoImg, Spinner } from '../components/bits';
import { ConflictError, gcPhotos, insertCategory, trashCategory, untrashCategory, updateCategory, type CategoryInput, type TrashMode } from '../lib/api';
import { dataErrorMessage } from '../lib/errors';
import { compressPhoto, photoErrorMessage, removeFiles, uploadPhoto, type CompressedPhoto } from '../lib/photos';
import { useBack } from '../lib/useBack';
import type { DecoCategory } from '../lib/types';
import { useAtlas } from '../state/atlas';
import { useAuth } from '../state/auth';
import { useUi } from '../state/ui';

const EMOJI = ['☕', '🌳', '🏪', '🍔', '🍜', '🍰', '🏛️', '🎬', '📚', '🚉', '🏖️', '⛰️', '🏥', '💈', '🧺', '🏟️', '🌉', '🐾', '🍣', '🥐', '🎨', '🏫', '✈️', '🌸'];

export function CategoryEditorPage() {
  const { id } = useParams();
  const { categories, loaded } = useAtlas();
  if (!loaded) return <Spinner />;
  if (id) {
    const c = categories.find((x) => x.id === id);
    if (!c || c.deleted_at) {
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
    return <Editor key={c.id} existing={c} />;
  }
  return <Editor existing={null} />;
}

function Editor({ existing }: { existing: DecoCategory | null }) {
  const nav = useNavigate();
  const back = useBack(existing ? `/deco/${existing.id}` : '/deco');
  const { ownerId } = useAuth();
  const { categories, places, photos, online, putCategory, putPhoto, putPlaces, refresh } = useAtlas();
  const { toast, ask } = useUi();
  const [name, setName] = useState(existing?.name ?? '');
  const [icon, setIcon] = useState(existing?.icon ?? '');
  const [newIcon, setNewIcon] = useState<{ c: CompressedPhoto; url: string } | null>(null);
  const [removeIcon, setRemoveIcon] = useState(false);
  const [saving, setSaving] = useState(false);
  const [touched, setTouched] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const trimmed = name.trim();
  const clash = categories.some((c) => !c.deleted_at && c.id !== existing?.id && c.name.toLowerCase() === trimmed.toLowerCase());
  const nameError = !trimmed ? '이름을 입력하세요.' : trimmed.length > 50 ? '50자 이하로 입력하세요.' : clash ? '같은 이름의 분류가 이미 있습니다.' : null;
  const currentIconPhoto = existing?.icon_photo_id && !removeIcon ? photos.get(existing.icon_photo_id) : undefined;
  const memberCount = existing ? places.filter((p) => p.deco_category_id === existing.id && !p.deleted_at).length : 0;

  const pick = async (file?: File) => {
    if (!file) return;
    try {
      const c = await compressPhoto(file, 'icon');
      setNewIcon({ c, url: URL.createObjectURL(c.display) });
      setRemoveIcon(false);
    } catch (e) {
      toast(photoErrorMessage(e), { kind: 'error', ms: 6000 });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const save = async () => {
    setTouched(true);
    if (nameError || saving || !ownerId) return;
    if (!online) return toast('오프라인 — 저장되지 않습니다.', { kind: 'error' });
    setSaving(true);
    let uploaded: string | null = null;
    try {
      let iconPhotoId = removeIcon ? null : existing?.icon_photo_id ?? null;
      if (newIcon) {
        const row = await uploadPhoto(ownerId, newIcon.c);
        putPhoto(row);
        uploaded = row.id;
        iconPhotoId = row.id;
      }
      const input: CategoryInput = { name: trimmed, icon: [...icon.trim()].slice(0, 8).join(''), icon_photo_id: iconPhotoId };
      let saved: DecoCategory;
      if (existing) {
        try {
          saved = await updateCategory(existing.id, existing.version, input);
        } catch (e) {
          if (!(e instanceof ConflictError) || !e.server) throw e;
          saved = await updateCategory(existing.id, null, input); // 분류 이름·아이콘은 마지막 저장을 우선
        }
      } else {
        const maxOrder = Math.max(0, ...categories.map((c) => c.sort_order));
        saved = await insertCategory(input, maxOrder + 1);
      }
      putCategory(saved);
      if (existing?.icon_photo_id && existing.icon_photo_id !== saved.icon_photo_id) {
        gcPhotos([existing.icon_photo_id]).then(removeFiles).catch(() => undefined);
      }
      toast(existing ? '분류를 저장했습니다.' : '분류를 만들었습니다.', { kind: 'success' });
      if (existing) back();
      else nav(`/deco/${saved.id}`, { replace: true });
    } catch (e) {
      if (uploaded) gcPhotos([uploaded]).then(removeFiles).catch(() => undefined);
      toast(`저장 실패: ${dataErrorMessage(e as Error)}`, { kind: 'error', ms: 6000 });
      setSaving(false);
    }
  };

  const onDelete = async () => {
    if (!existing) return;
    const choice = await ask(
      `"${existing.name}" 분류 삭제`,
      <p>
        분류를 휴지통으로 옮깁니다. 이 분류의 후보 장소 {memberCount}곳은 어떻게 할까요?
      </p>,
      [
        { value: 'with_places', label: `후보 장소도 함께 휴지통으로`, tone: 'danger' },
        { value: 'uncategorize', label: '후보 장소는 "미분류"로 옮기기', tone: 'primary' },
        { value: 'cancel', label: '취소', tone: 'plain' },
      ],
    );
    if (choice !== 'with_places' && choice !== 'uncategorize') return;
    if (!online) return toast('오프라인 — 저장되지 않습니다.', { kind: 'error' });
    const mode = choice as TrashMode;
    try {
      const affected = await trashCategory(existing.id, mode);
      putCategory({ ...existing, deleted_at: new Date().toISOString() });
      if (mode === 'with_places') putPlaces(affected, { deleted_at: new Date().toISOString() });
      else putPlaces(affected, { deco_category_id: null });
      nav('/deco', { replace: true });
      toast(`"${existing.name}" 분류를 휴지통으로 옮겼습니다.`, {
        action: {
          label: '되돌리기',
          run: async () => {
            try {
              await untrashCategory(existing.id, mode, affected);
              await refresh(true);
              toast('되돌렸습니다.', { kind: 'success' });
            } catch (e) {
              toast(`되돌리기 실패: ${dataErrorMessage(e as Error)}`, { kind: 'error' });
            }
          },
        },
      });
    } catch (e) {
      toast(`삭제 실패: ${dataErrorMessage(e as Error)}`, { kind: 'error' });
    }
  };

  return (
    <section className="page page-narrow">
      <div className="page-head">
        <button type="button" className="icon-btn" onClick={back} aria-label="뒤로">
          <Icon name="back" />
        </button>
        <h1 className="grow">{existing ? '분류 편집' : '데코 분류 추가'}</h1>
      </div>
      <form
        className="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        <label className="field">
          <span className="field-label">분류 이름</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={50} placeholder="예: 카페" aria-invalid={touched && !!nameError} />
          {touched && nameError && <span className="field-error">{nameError}</span>}
        </label>

        <div className="field">
          <span className="field-label">아이콘</span>
          <div className="icon-pick">
            <span className="cat-icon cat-icon-lg" aria-hidden="true">
              {newIcon ? <img src={newIcon.url} alt="" /> : currentIconPhoto ? <PhotoImg photo={currentIconPhoto} alt="" /> : <span>{icon || trimmed.slice(0, 1) || '?'}</span>}
            </span>
            <input className="emoji-input" value={icon} onChange={(e) => setIcon(e.target.value)} maxLength={16} placeholder="이모지" aria-label="이모지 아이콘" />
          </div>
          <div className="emoji-row">
            {EMOJI.map((e) => (
              <button key={e} type="button" className={`emoji ${icon === e ? 'is-on' : ''}`} onClick={() => setIcon(e)} aria-label={`아이콘 ${e}`}>
                {e}
              </button>
            ))}
          </div>
          <div className="row-gap">
            <input ref={fileRef} type="file" accept="image/*" hidden onChange={(e) => pick(e.target.files?.[0])} />
            <button type="button" className="btn btn-plain btn-sm" onClick={() => fileRef.current?.click()}>
              <Icon name="photo" size={16} /> 그림으로 아이콘 만들기
            </button>
            {(newIcon || currentIconPhoto) && (
              <button
                type="button"
                className="btn btn-quiet btn-sm"
                onClick={() => {
                  setNewIcon(null);
                  setRemoveIcon(true);
                }}
              >
                그림 빼기
              </button>
            )}
          </div>
          <span className="hint">그림을 넣으면 이모지 대신 그림이 보입니다.</span>
        </div>

        <div className="form-actions">
          <button type="button" className="btn btn-plain" onClick={back} disabled={saving}>
            취소
          </button>
          <button type="submit" className="btn btn-primary" disabled={saving || !online}>
            {saving ? '저장 중…' : existing ? '저장' : '만들기'}
          </button>
        </div>
      </form>
      {existing && (
        <div className="danger-zone">
          <button type="button" className="btn btn-danger-outline" onClick={onDelete}>
            <Icon name="trash" size={16} /> 이 분류 삭제
          </button>
          <p className="hint">휴지통에서 복구할 수 있습니다.</p>
        </div>
      )}
    </section>
  );
}
