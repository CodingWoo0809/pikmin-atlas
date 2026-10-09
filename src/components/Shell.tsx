import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useAtlas } from '../state/atlas';
import { daysAgo, Icon } from './bits';

const TABS = [
  { to: '/mushroom', label: '버섯', cat: 'mushroom' },
  { to: '/bigflower', label: '빅플라워', cat: 'bigflower' },
  { to: '/deco', label: '단일 데코 스팟', cat: 'deco' },
] as const;

export function Shell() {
  const { online, syncing, settings, openRestore, loaded, places } = useAtlas();
  const loc = useLocation();
  const current = TABS.find((t) => loc.pathname.startsWith(t.to))?.cat ?? 'none';
  const trashCount = places.filter((p) => p.deleted_at).length;
  const backupAge = settings?.last_backup_at ? (Date.now() - new Date(settings.last_backup_at).getTime()) / 86_400_000 : Infinity;

  return (
    <div className="shell" data-cat={current}>
      <header className="top">
        <div className="top-row">
          <Link to="/mushroom" className="brand">
            <span className="brand-mark" aria-hidden="true" />
            Nomad Atlas
          </Link>
          <div className="top-actions">
            <span className={`sync-dot ${syncing ? 'is-syncing' : ''} ${online ? '' : 'is-off'}`} title={online ? (syncing ? '동기화 중' : '최신 상태') : '오프라인'} />
            <Link to="/trash" className="icon-btn" aria-label={`휴지통 (${trashCount})`}>
              <Icon name="trash" />
              {trashCount > 0 && <span className="badge">{trashCount > 99 ? '99+' : trashCount}</span>}
            </Link>
            <Link to="/settings" className="icon-btn" aria-label="설정">
              <Icon name="gear" />
            </Link>
          </div>
        </div>
        <nav className="tabs" aria-label="카테고리">
          {TABS.map((t) => (
            <NavLink key={t.to} to={t.to} className={({ isActive }) => `tab tab-${t.cat} ${isActive ? 'is-active' : ''}`}>
              <span className="tab-seed" aria-hidden="true" />
              {t.label}
            </NavLink>
          ))}
        </nav>
      </header>

      {!online && <div className="banner banner-warn">오프라인 — 지금은 저장되지 않습니다. 연결되면 최신 내용을 다시 불러옵니다.</div>}
      {openRestore && !loc.pathname.startsWith('/settings/backup') && (
        <Link to="/settings/backup" className="banner banner-warn">
          {openRestore.status === 'committed' ? '복원이 아직 확정되지 않았습니다. 확인하고 확정하거나 되돌리세요.' : '중간에 멈춘 복원이 있습니다. 눌러서 정리하세요.'}
        </Link>
      )}
      {loaded && backupAge > 14 && loc.pathname !== '/settings/backup' && (
        <Link to="/settings/backup" className="banner banner-quiet">
          마지막 백업: {daysAgo(settings?.last_backup_at)} · 백업 만들기
        </Link>
      )}

      <main className="main">
        <Outlet />
      </main>
    </div>
  );
}
