import { useCallback } from 'react';
import { ConflictError, setPlacesDeleted, updatePlace } from '../lib/api';
import { dataErrorMessage } from '../lib/errors';
import type { Place } from '../lib/types';
import { useAtlas } from './atlas';
import { useUi } from './ui';

export function usePlaceActions() {
  const { putPlace, putPlaces, refresh, online } = useAtlas();
  const { toast } = useUi();

  const toggleFavorite = useCallback(
    async (p: Place) => {
      if (!online) return toast('오프라인 — 저장되지 않습니다.', { kind: 'error' });
      try {
        // 즐겨찾기는 다른 기기 수정과 충돌해도 덮어써도 무방하므로 version 검사 없이 저장
        const saved = await updatePlace(p.id, null, { is_favorite: !p.is_favorite });
        putPlace(saved);
      } catch (e) {
        if (e instanceof ConflictError) {
          toast('이미 삭제된 장소입니다.', { kind: 'error' });
          void refresh(true);
        } else toast(`저장 실패: ${dataErrorMessage(e as Error)}`, { kind: 'error' });
      }
    },
    [online, putPlace, refresh, toast],
  );

  /** 휴지통으로 이동 + 되돌리기 버튼 */
  const trash = useCallback(
    async (p: Place, after?: () => void) => {
      if (!online) {
        toast('오프라인 — 저장되지 않습니다.', { kind: 'error' });
        return false;
      }
      try {
        await setPlacesDeleted([p.id], true);
        putPlaces([p.id], { deleted_at: new Date().toISOString() });
        after?.();
        toast(`"${p.name}"을(를) 휴지통으로 옮겼습니다.`, {
          action: {
            label: '되돌리기',
            run: async () => {
              try {
                await setPlacesDeleted([p.id], false);
                putPlaces([p.id], { deleted_at: null });
                toast('되돌렸습니다.', { kind: 'success' });
              } catch (e) {
                toast(`되돌리기 실패: ${dataErrorMessage(e as Error)} (휴지통에서 복구할 수 있습니다)`, { kind: 'error' });
              }
            },
          },
        });
        return true;
      } catch (e) {
        toast(`삭제 실패: ${dataErrorMessage(e as Error)}`, { kind: 'error' });
        return false;
      }
    },
    [online, putPlaces, toast],
  );

  return { toggleFavorite, trash };
}
