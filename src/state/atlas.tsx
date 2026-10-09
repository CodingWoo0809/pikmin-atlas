import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { fetchAtlas, getOpenRestore, getSettings, type AtlasData, type OpenRestore } from '../lib/api';
import { dataErrorMessage } from '../lib/errors';
import type { DecoCategory, OwnerSettings, Photo, Place } from '../lib/types';

type AtlasCtx = {
  loaded: boolean;
  loadError: string | null;
  syncing: boolean;
  online: boolean;
  places: Place[];
  categories: DecoCategory[];
  photos: Map<string, Photo>;
  settings: OwnerSettings | null;
  openRestore: OpenRestore | null;
  refresh: (force?: boolean) => Promise<void>;
  /** 서버 저장이 끝난 행을 화면 데이터에 바로 반영 */
  putPlace: (p: Place) => void;
  putPlaces: (ids: string[], patch: Partial<Place>) => void;
  dropPlaces: (ids: string[]) => void;
  putCategory: (c: DecoCategory) => void;
  dropCategory: (id: string) => void;
  putPhoto: (p: Photo) => void;
};

const Ctx = createContext<AtlasCtx | null>(null);

export function useAtlas() {
  const v = useContext(Ctx);
  if (!v) throw new Error('AtlasProvider missing');
  return v;
}

export function AtlasProvider({ children }: { children: ReactNode }) {
  const [data, setData] = useState<AtlasData>({ places: [], categories: [], photos: [] });
  const [loaded, setLoaded] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [online, setOnline] = useState(typeof navigator === 'undefined' ? true : navigator.onLine);
  const [settings, setSettings] = useState<OwnerSettings | null>(null);
  const [openRestore, setOpenRestore] = useState<OpenRestore | null>(null);
  const lastFetch = useRef(0);
  const inflight = useRef<Promise<void> | null>(null);

  const refresh = useCallback(async (force = false) => {
    if (inflight.current) return inflight.current;
    if (!force && Date.now() - lastFetch.current < 4000) return;
    const run = (async () => {
      setSyncing(true);
      try {
        const [atlas, s, r] = await Promise.all([fetchAtlas(), getSettings(), getOpenRestore()]);
        setData(atlas);
        setSettings(s);
        setOpenRestore(r);
        setLoadError(null);
        setLoaded(true);
        lastFetch.current = Date.now();
      } catch (e) {
        setLoadError(dataErrorMessage(e as Error));
      } finally {
        setSyncing(false);
        inflight.current = null;
      }
    })();
    inflight.current = run;
    return run;
  }, []);

  // 동기화: 처음, 앱으로 돌아올 때, 네트워크가 돌아올 때
  useEffect(() => {
    void refresh(true);
    const onVisible = () => document.visibilityState === 'visible' && void refresh();
    const onFocus = () => void refresh();
    const onOnline = () => {
      setOnline(true);
      void refresh(true);
    };
    const onOffline = () => setOnline(false);
    document.addEventListener('visibilitychange', onVisible);
    window.addEventListener('focus', onFocus);
    window.addEventListener('online', onOnline);
    window.addEventListener('offline', onOffline);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener('online', onOnline);
      window.removeEventListener('offline', onOffline);
    };
  }, [refresh]);

  const putPlace = useCallback((p: Place) => {
    setData((d) => {
      const i = d.places.findIndex((x) => x.id === p.id);
      const places = [...d.places];
      if (i >= 0) places[i] = { ...p, seq: Number(p.seq) };
      else places.push({ ...p, seq: Number(p.seq) });
      return { ...d, places };
    });
  }, []);
  const putPlaces = useCallback((ids: string[], patch: Partial<Place>) => {
    const set = new Set(ids);
    setData((d) => ({ ...d, places: d.places.map((p) => (set.has(p.id) ? { ...p, ...patch } : p)) }));
  }, []);
  const dropPlaces = useCallback((ids: string[]) => {
    const set = new Set(ids);
    setData((d) => ({ ...d, places: d.places.filter((p) => !set.has(p.id)) }));
  }, []);
  const putCategory = useCallback((c: DecoCategory) => {
    setData((d) => {
      const i = d.categories.findIndex((x) => x.id === c.id);
      const categories = [...d.categories];
      if (i >= 0) categories[i] = c;
      else categories.push(c);
      return { ...d, categories };
    });
  }, []);
  const dropCategory = useCallback((id: string) => {
    setData((d) => ({ ...d, categories: d.categories.filter((c) => c.id !== id) }));
  }, []);
  const putPhoto = useCallback((p: Photo) => {
    setData((d) => ({ ...d, photos: [...d.photos.filter((x) => x.id !== p.id), p] }));
  }, []);

  const photos = useMemo(() => new Map(data.photos.map((p) => [p.id, p])), [data.photos]);

  const value = useMemo<AtlasCtx>(
    () => ({
      loaded,
      loadError,
      syncing,
      online,
      places: data.places,
      categories: data.categories,
      photos,
      settings,
      openRestore,
      refresh,
      putPlace,
      putPlaces,
      dropPlaces,
      putCategory,
      dropCategory,
      putPhoto,
    }),
    [loaded, loadError, syncing, online, data, photos, settings, openRestore, refresh, putPlace, putPlaces, dropPlaces, putCategory, dropCategory, putPhoto],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
