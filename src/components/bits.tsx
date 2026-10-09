import { useEffect, useState, type ReactNode } from 'react';
import { copyText } from '../lib/clipboard';
import { formatCoord, coordText } from '../lib/coords';
import { signedUrl } from '../lib/photos';
import type { Photo } from '../lib/types';
import { useUi } from '../state/ui';

// ---------------- 아이콘 (직접 그린 단순 도형) ----------------
type IconName = 'star' | 'star-fill' | 'edit' | 'plus' | 'gear' | 'trash' | 'search' | 'back' | 'close' | 'copy' | 'photo' | 'restore' | 'sync';

const PATHS: Record<IconName, ReactNode> = {
  star: <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />,
  'star-fill': <path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9l-5.2 2.7 1-5.8-4.3-4.1 5.9-.9z" fill="currentColor" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />,
  edit: <path d="M4 20h4L19 9l-4-4L4 16v4zM13.5 6.5l4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" strokeLinecap="round" />,
  plus: <path d="M12 5v14M5 12h14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  gear: (
    <g fill="none" stroke="currentColor" strokeWidth="1.8">
      <circle cx="12" cy="12" r="3.2" />
      <path d="M12 2.8v2.6M12 18.6v2.6M21.2 12h-2.6M5.4 12H2.8M18.5 5.5l-1.8 1.8M7.3 16.7l-1.8 1.8M18.5 18.5l-1.8-1.8M7.3 7.3L5.5 5.5" strokeLinecap="round" />
    </g>
  ),
  trash: <path d="M4.5 7h15M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
  search: <g fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round"><circle cx="10.5" cy="10.5" r="6" /><path d="M15 15l5 5" /></g>,
  back: <path d="M15 5l-7 7 7 7" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />,
  close: <path d="M6 6l12 12M18 6L6 18" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />,
  copy: <g fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round"><rect x="8" y="8" width="11" height="12" rx="2" /><path d="M5 15V5.5A1.5 1.5 0 0 1 6.5 4H15" /></g>,
  photo: <g fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round"><rect x="3.5" y="5.5" width="17" height="13" rx="2" /><path d="M3.5 15.5l5-4.5 4 3.5 3-2.5 5 4" /><circle cx="15.5" cy="9.5" r="1.4" /></g>,
  restore: <path d="M5 12a7 7 0 1 0 2.1-5M5 4v4h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
  sync: <path d="M19 8a7.5 7.5 0 0 0-13.3 0M5 16a7.5 7.5 0 0 0 13.3 0M19 4v4h-4M5 20v-4h4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />,
};

export function Icon({ name, size = 20, label }: { name: IconName; size?: number; label?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden={label ? undefined : true} role={label ? 'img' : undefined} aria-label={label}>
      {PATHS[name]}
    </svg>
  );
}

// ---------------- 사진 (비공개 저장소 → 만료되는 주소) ----------------
export function PhotoImg({ photo, thumb = true, alt, className }: { photo: Photo | undefined | null; thumb?: boolean; alt: string; className?: string }) {
  const path = photo ? (thumb && photo.thumb_path ? photo.thumb_path : photo.path) : null;
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let alive = true;
    setUrl(null);
    setFailed(false);
    if (!path) return;
    signedUrl(path).then((u) => {
      if (!alive) return;
      if (u) setUrl(u);
      else setFailed(true);
    });
    return () => {
      alive = false;
    };
  }, [path]);

  if (!photo) {
    return (
      <div className={`photo-ph ${className ?? ''}`} aria-label="사진 없음">
        <Icon name="photo" size={26} />
      </div>
    );
  }
  if (failed) {
    return (
      <div className={`photo-ph photo-err ${className ?? ''}`} role="img" aria-label="사진을 불러오지 못함">
        <Icon name="photo" size={22} />
        <span>불러오기 실패</span>
      </div>
    );
  }
  return url ? (
    <img className={className} src={url} alt={alt} loading="lazy" decoding="async" onError={() => setFailed(true)} />
  ) : (
    <div className={`photo-ph photo-loading ${className ?? ''}`} aria-label="사진 불러오는 중" />
  );
}

// ---------------- 좌표 복사 버튼 ----------------
export function CoordButton({ lat, lng, stacked = true }: { lat: number; lng: number; stacked?: boolean }) {
  const { toast } = useUi();
  const [done, setDone] = useState(false);
  const text = coordText(lat, lng);
  const onClick = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const ok = await copyText(text);
    if (ok) {
      setDone(true);
      setTimeout(() => setDone(false), 1200);
      toast(`좌표 복사됨  ${text}`, { kind: 'success' });
    } else {
      toast('복사하지 못했습니다. 좌표를 길게 눌러 직접 복사하세요.', { kind: 'error' });
    }
  };
  return (
    <button type="button" className={`coord ${stacked ? 'coord-stacked' : ''} ${done ? 'coord-done' : ''}`} onClick={onClick} aria-label={`좌표 ${text} 복사`}>
      {stacked ? (
        <>
          <span>{formatCoord(lat)}</span>
          <span>{formatCoord(lng)}</span>
        </>
      ) : (
        <span>{text}</span>
      )}
    </button>
  );
}

export function FavButton({ on, onToggle, busy }: { on: boolean; onToggle: () => void; busy?: boolean }) {
  return (
    <button
      type="button"
      className={`fav ${on ? 'fav-on' : ''}`}
      aria-pressed={on}
      aria-label={on ? '즐겨찾기 해제' : '즐겨찾기 추가'}
      disabled={busy}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
    >
      <Icon name={on ? 'star-fill' : 'star'} size={16} />
    </button>
  );
}

export function Spinner({ label = '불러오는 중' }: { label?: string }) {
  return (
    <div className="spinner-wrap" role="status">
      <span className="spinner" aria-hidden="true" />
      <span>{label}</span>
    </div>
  );
}

export function ProgressBar({ done, total, label }: { done: number; total: number; label: string }) {
  const pct = total > 0 ? Math.round((done / total) * 100) : 0;
  return (
    <div className="progress" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <div className="progress-label">
        <span>{label}</span>
        <span>{total > 0 ? `${done} / ${total}` : ''}</span>
      </div>
      <div className="progress-track">
        <div className="progress-fill" style={{ width: `${pct}%` }} />
      </div>
    </div>
  );
}

export function daysAgo(iso: string | null | undefined): string {
  if (!iso) return '없음';
  const d = Math.floor((Date.now() - new Date(iso).getTime()) / 86_400_000);
  if (d <= 0) return '오늘';
  if (d === 1) return '어제';
  return `${d}일 전`;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / 1024 / 1024).toFixed(1)} MB`;
  return `${(n / 1024 / 1024 / 1024).toFixed(2)} GB`;
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString('ko-KR', { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
}
