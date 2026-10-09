import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { daysAgo, formatBytes, Icon } from '../components/bits';
import { dataErrorMessage } from '../lib/errors';
import { listAllFiles, removeFiles } from '../lib/photos';
import { useBack } from '../lib/useBack';
import { useAtlas } from '../state/atlas';
import { useAuth } from '../state/auth';
import { useUi } from '../state/ui';
import { NewPasswordForm } from './AuthPages';

export function SettingsPage() {
  const back = useBack('/mushroom');
  const { changePassword, logout, ownerId } = useAuth();
  const { places, categories, photos, settings, online } = useAtlas();
  const { confirm, toast } = useUi();
  const [scan, setScan] = useState<{ orphans: { path: string; size: number }[]; total: number; bytes: number } | null>(null);
  const [scanning, setScanning] = useState(false);

  const stats = useMemo(() => {
    const live = places.filter((p) => !p.deleted_at);
    let bytes = 0;
    photos.forEach((p) => (bytes += p.bytes));
    return {
      mushroom: live.filter((p) => p.category === 'mushroom').length,
      bigflower: live.filter((p) => p.category === 'bigflower').length,
      deco: live.filter((p) => p.category === 'deco').length,
      trashed: places.length - live.length,
      cats: categories.filter((c) => !c.deleted_at).length,
      photos: photos.size,
      bytes,
    };
  }, [places, categories, photos]);

  const runScan = async () => {
    if (!ownerId) return;
    setScanning(true);
    try {
      const files = await listAllFiles(ownerId);
      const used = new Set<string>();
      photos.forEach((p) => {
        used.add(p.path);
        if (p.thumb_path) used.add(p.thumb_path);
      });
      const orphans = files.filter((f) => !used.has(f.path));
      setScan({ orphans, total: files.length, bytes: files.reduce((s, f) => s + f.size, 0) });
    } catch (e) {
      toast(`확인 실패: ${dataErrorMessage(e as Error)}`, { kind: 'error' });
    } finally {
      setScanning(false);
    }
  };

  const cleanup = async () => {
    if (!scan || scan.orphans.length === 0) return;
    const ok = await confirm(
      `안 쓰는 파일 ${scan.orphans.length}개 삭제`,
      <p>어떤 장소·분류도 쓰지 않는 사진 파일입니다. 확정하지 않은 복원이 있다면 먼저 확정하거나 되돌린 뒤 정리하세요.</p>,
      '삭제',
      'danger',
    );
    if (!ok) return;
    const done = await removeFiles(scan.orphans.map((o) => o.path));
    toast(done ? '정리했습니다.' : '일부 파일을 지우지 못했습니다. 잠시 후 다시 시도하세요.', { kind: done ? 'success' : 'error' });
    await runScan();
  };

  return (
    <section className="page page-narrow">
      <div className="page-head">
        <button type="button" className="icon-btn" onClick={back} aria-label="뒤로">
          <Icon name="back" />
        </button>
        <h1 className="grow">설정</h1>
      </div>

      <div className="panel">
        <h2>데이터</h2>
        <Link to="/settings/import" className="row-link">
          <span>
            <strong>CSV·JSON 가져오기</strong>
            <small>미리보기로 확인한 뒤 새 기록만 추가합니다</small>
          </span>
          <Icon name="back" size={16} />
        </Link>
        <Link to="/settings/backup" className="row-link">
          <span>
            <strong>백업·복원</strong>
            <small>마지막 백업: {daysAgo(settings?.last_backup_at)}</small>
          </span>
          <Icon name="back" size={16} />
        </Link>
        <Link to="/trash" className="row-link">
          <span>
            <strong>휴지통</strong>
            <small>{stats.trashed}곳 보관 중</small>
          </span>
          <Icon name="back" size={16} />
        </Link>
      </div>

      <div className="panel">
        <h2>사용량</h2>
        <dl className="stats">
          <div><dt>버섯</dt><dd>{stats.mushroom}</dd></div>
          <div><dt>빅플라워</dt><dd>{stats.bigflower}</dd></div>
          <div><dt>데코 후보</dt><dd>{stats.deco}</dd></div>
          <div><dt>데코 분류</dt><dd>{stats.cats}</dd></div>
          <div><dt>사진</dt><dd>{stats.photos}</dd></div>
          <div><dt>사진 용량</dt><dd>{formatBytes(stats.bytes)}</dd></div>
        </dl>
        <p className="hint">Supabase 무료 플랜의 파일 저장 한도는 1GB입니다(변경될 수 있음). 1주일 넘게 쓰지 않으면 프로젝트가 일시정지될 수 있으니, 그때는 대시보드에서 Resume project를 누르세요.</p>
      </div>

      <div className="panel">
        <h2>저장공간 정리</h2>
        <p className="hint">사진을 바꾸거나 지울 때 파일 삭제가 실패하면 쓰지 않는 파일이 남을 수 있습니다.</p>
        <button type="button" className="btn btn-plain" onClick={runScan} disabled={scanning || !online}>
          {scanning ? '확인 중…' : '안 쓰는 파일 찾기'}
        </button>
        {scan && (
          <div className="scan-result">
            <p>
              저장소 파일 {scan.total}개 ({formatBytes(scan.bytes)}) 중 안 쓰는 파일 <strong>{scan.orphans.length}개</strong> (
              {formatBytes(scan.orphans.reduce((s, o) => s + o.size, 0))})
            </p>
            {scan.orphans.length > 0 && (
              <button type="button" className="btn btn-danger-outline btn-sm" onClick={cleanup}>
                안 쓰는 파일 삭제
              </button>
            )}
          </div>
        )}
      </div>

      <div className="panel">
        <h2>비밀번호 바꾸기</h2>
        <NewPasswordForm withCurrent submitLabel="비밀번호 바꾸기" onSubmit={(next, current) => changePassword(current, next)} />
      </div>

      <div className="panel">
        <h2>로그아웃</h2>
        <div className="row-gap">
          <button type="button" className="btn btn-plain" onClick={() => logout(false)}>
            이 기기에서 로그아웃
          </button>
          <button
            type="button"
            className="btn btn-plain"
            onClick={async () => {
              if (await confirm('모든 기기에서 로그아웃', <p>iPhone과 PC 모두 다시 로그인해야 합니다.</p>, '모두 로그아웃')) await logout(true);
            }}
          >
            모든 기기에서 로그아웃
          </button>
        </div>
      </div>

      <div className="panel">
        <h2>비밀번호를 잊었을 때</h2>
        <p className="hint">
          Supabase 대시보드 → 프로젝트 → SQL Editor에서 저장소의 <code>docs/OPERATIONS.md</code> "비밀번호 복구" SQL에 새 비밀번호(소문자, 6~12자)를 넣고 실행한 뒤, 새 비밀번호로 로그인하세요.
        </p>
      </div>
      <p className="hint center">빌드 {__BUILD_TIME__.slice(0, 16).replace('T', ' ')}</p>
    </section>
  );
}
