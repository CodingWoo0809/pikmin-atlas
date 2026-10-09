import { useRef, useState } from 'react';
import { daysAgo, formatBytes, formatDate, Icon, ProgressBar } from '../components/bits';
import { validateBackupZip, type ValidatedBackup } from '../lib/backup';
import {
  beginRestore,
  cancelRestore,
  commitRestore,
  createBackup,
  finalizeRestore,
  markBackupDone,
  rollbackRestore,
  saveBlob,
  uploadRestorePhotos,
} from '../lib/backupService';
import { dataErrorMessage } from '../lib/errors';
import { sha256Hex } from '../lib/photos';
import { useBack } from '../lib/useBack';
import { useAtlas } from '../state/atlas';
import { useAuth } from '../state/auth';
import { useUi } from '../state/ui';

const FREE_STORAGE = 1024 * 1024 * 1024;

type Prog = { done: number; total: number; label: string } | null;

export function BackupPage() {
  const back = useBack('/settings');
  const { ownerId } = useAuth();
  const { places, categories, photos, settings, openRestore, online, refresh } = useAtlas();
  const { toast, confirm, ask } = useUi();
  const [prog, setProg] = useState<Prog>(null);
  const [busy, setBusy] = useState(false);
  const [checking, setChecking] = useState(false);
  const [candidate, setCandidate] = useState<{ name: string; backup: ValidatedBackup } | null>(null);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [lastResult, setLastResult] = useState<{ places: number; deco_categories: number; photos: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const onProgress = (done: number, total: number, label: string) => setProg({ done, total, label });

  const makeBackup = async () => {
    if (!online) return toast('오프라인 — 백업을 만들 수 없습니다.', { kind: 'error' });
    setBusy(true);
    try {
      const b = await createBackup(onProgress);
      saveBlob(b.blob, b.filename);
      await markBackupDone();
      await refresh(true);
      toast(`백업 파일을 만들었습니다 (${formatBytes(b.blob.size)}). 파일 앱·PC 등 안전한 곳에 보관하세요.`, { kind: 'success', ms: 6000 });
    } catch (e) {
      toast(`백업 실패: ${e instanceof Error ? e.message : dataErrorMessage(e as Error)}`, { kind: 'error', ms: 7000 });
    } finally {
      setBusy(false);
      setProg(null);
    }
  };

  const check = async (file?: File) => {
    if (!file) return;
    setCandidate(null);
    setErrors(null);
    setLastResult(null);
    setChecking(true);
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const r = await validateBackupZip(bytes, (d) => sha256Hex(d));
      if (r.ok) setCandidate({ name: file.name, backup: r.backup });
      else setErrors(r.errors);
    } catch {
      setErrors(['파일을 읽지 못했습니다. 크기가 너무 크면 PC에서 시도하세요.']);
    } finally {
      setChecking(false);
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const live = places.filter((p) => !p.deleted_at);
  const currentSummary = {
    mushroom: live.filter((p) => p.category === 'mushroom').length,
    bigflower: live.filter((p) => p.category === 'bigflower').length,
    deco: live.filter((p) => p.category === 'deco').length,
    deleted: places.length - live.length,
    categories: categories.filter((c) => !c.deleted_at).length,
    photos: photos.size,
  };
  let currentBytes = 0;
  photos.forEach((p) => (currentBytes += p.bytes));

  const restore = async () => {
    if (!candidate || !ownerId) return;
    if (!online) return toast('오프라인 — 복원할 수 없습니다.', { kind: 'error' });
    const s = candidate.backup.summary;
    const ok1 = await confirm(
      '현재 도감이 교체됩니다',
      <p>
        지금 도감의 모든 장소·분류·휴지통이 백업({formatDate(s.createdAt)}) 상태로 바뀝니다. 진행하기 전에 지금 도감의 안전 백업 파일을 먼저 내려받습니다.
      </p>,
      '계속',
      'danger',
    );
    if (!ok1) return;
    const ok2 = await confirm('정말 복원할까요?', <p>복원 후에도 "복원 되돌리기"로 지금 상태로 돌아올 수 있습니다.</p>, '복원 시작', 'danger');
    if (!ok2) return;

    setBusy(true);
    let sid: string | null = null;
    let uploaded: string[] = [];
    try {
      // 1) 안전 백업 (기기에 저장)
      const safety = await createBackup(onProgress, '안전 백업: 사진 내려받는 중');
      saveBlob(safety.blob, safety.filename.replace('backup', 'safety-backup'));
      // 2) 서버 스냅숏
      setProg({ done: 0, total: 1, label: '서버에 안전 스냅숏 저장 중' });
      sid = await beginRestore();
      // 3) 사진 업로드 (기존 파일·DB는 그대로)
      const photoList = [...photos.values()];
      let up = await uploadRestorePhotos(candidate.backup, ownerId, photoList, onProgress);
      uploaded = up.uploaded;
      while (up.failed.length) {
        const c = await ask(
          '사진 일부를 올리지 못했습니다',
          <p>사진 파일 {up.failed.length}개를 올리지 못했습니다. 지금 도감은 아직 바뀌지 않았습니다.</p>,
          [
            { value: 'retry', label: '다시 시도', tone: 'primary' },
            { value: 'cancel', label: '복원 취소', tone: 'plain' },
          ],
        );
        if (c !== 'retry') {
          await cancelRestore(sid, uploaded, photoList);
          await refresh(true);
          toast('복원을 취소했습니다. 도감은 바뀌지 않았습니다.');
          return;
        }
        const failed = new Set(up.failed);
        const retryBackup = { ...candidate.backup, data: { ...candidate.backup.data, photos: candidate.backup.data.photos.filter((p) => [...failed].some((f) => f.includes(p.id))) } };
        up = await uploadRestorePhotos(retryBackup, ownerId, photoList, onProgress);
        uploaded = [...uploaded, ...up.uploaded];
      }
      // 4) DB 교체 (서버 트랜잭션 — 실패하면 원래 상태 유지)
      setProg({ done: 0, total: 1, label: '도감 교체 중' });
      try {
        const res = await commitRestore(sid, candidate.backup, ownerId);
        setLastResult(res);
      } catch (e) {
        await cancelRestore(sid, uploaded, photoList).catch(() => undefined);
        throw new Error(`도감 교체에 실패해 원래 상태를 유지했습니다. (${dataErrorMessage(e as Error)})`);
      }
      setCandidate(null);
      await refresh(true);
      toast('복원했습니다. 내용을 확인한 뒤 "복원 확정"을 누르세요.', { kind: 'success', ms: 6000 });
    } catch (e) {
      if (sid) await refresh(true);
      toast(e instanceof Error ? e.message : dataErrorMessage(e as Error), { kind: 'error', ms: 8000 });
    } finally {
      setBusy(false);
      setProg(null);
    }
  };

  const doFinalize = async () => {
    if (!openRestore) return;
    const ok = await confirm('복원 확정', <p>확정하면 복원 전 상태로 되돌릴 수 없고, 복원 전에만 쓰던 사진 파일이 정리됩니다.</p>, '확정');
    if (!ok) return;
    setBusy(true);
    try {
      await finalizeRestore(openRestore.id);
      setLastResult(null);
      await refresh(true);
      toast('복원을 확정했습니다.', { kind: 'success' });
    } catch (e) {
      toast(`확정 실패: ${dataErrorMessage(e as Error)}`, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const doRollback = async () => {
    if (!openRestore) return;
    const ok = await confirm('복원 되돌리기', <p>복원하기 직전의 도감으로 되돌립니다.</p>, '되돌리기', 'danger');
    if (!ok) return;
    setBusy(true);
    try {
      await rollbackRestore(openRestore.id);
      setLastResult(null);
      await refresh(true);
      toast('복원 전 상태로 되돌렸습니다.', { kind: 'success' });
    } catch (e) {
      toast(`되돌리기 실패: ${dataErrorMessage(e as Error)}`, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const doCancelPending = async () => {
    if (!openRestore) return;
    setBusy(true);
    try {
      await cancelRestore(openRestore.id, [], [...photos.values()]);
      await refresh(true);
      toast('멈춘 복원을 정리했습니다. 도감은 바뀌지 않았습니다. 남은 파일은 설정 → 저장공간 정리에서 지울 수 있습니다.', { kind: 'success', ms: 6000 });
    } catch (e) {
      toast(`정리 실패: ${dataErrorMessage(e as Error)}`, { kind: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="page page-narrow">
      <div className="page-head">
        <button type="button" className="icon-btn" onClick={back} aria-label="뒤로">
          <Icon name="back" />
        </button>
        <h1 className="grow">백업·복원</h1>
      </div>

      {prog && (
        <div className="panel">
          <ProgressBar {...prog} />
          <p className="hint">화면을 닫거나 다른 앱으로 이동하지 마세요.</p>
        </div>
      )}

      {openRestore && (
        <div className="panel panel-warn">
          {openRestore.status === 'committed' ? (
            <>
              <h2>복원 확인 대기 중</h2>
              {lastResult && (
                <p>
                  서버에서 다시 센 결과: 장소 {lastResult.places}곳(휴지통 포함) · 분류 {lastResult.deco_categories}개 · 사진 {lastResult.photos}장
                </p>
              )}
              <p className="hint">{formatDate(openRestore.created_at)}에 시작한 복원입니다. 도감을 둘러보고 괜찮으면 확정하세요. 확정하기 전까지 되돌릴 수 있습니다.</p>
              <div className="row-gap">
                <button type="button" className="btn btn-primary" onClick={doFinalize} disabled={busy}>
                  복원 확정
                </button>
                <button type="button" className="btn btn-danger-outline" onClick={doRollback} disabled={busy}>
                  복원 되돌리기
                </button>
              </div>
            </>
          ) : (
            <>
              <h2>중간에 멈춘 복원</h2>
              <p className="hint">사진을 올리던 중 멈췄습니다. 도감은 바뀌지 않았습니다. 정리한 뒤 다시 복원하세요.</p>
              <button type="button" className="btn btn-plain" onClick={doCancelPending} disabled={busy}>
                멈춘 복원 정리
              </button>
            </>
          )}
        </div>
      )}

      <div className="panel">
        <h2>백업 만들기</h2>
        <p>장소·분류·휴지통 항목과 압축된 사진을 ZIP 파일 하나로 내려받습니다.</p>
        <p className="hint">
          마지막 백업: {daysAgo(settings?.last_backup_at)} · 사진 {photos.size}장 ({formatBytes(currentBytes)})
        </p>
        <button type="button" className="btn btn-primary" onClick={makeBackup} disabled={busy || !online}>
          백업 ZIP 내려받기
        </button>
        <p className="hint">무료 플랜에는 자동 백업이 없으니 정기적으로 만들어 두세요. 사진이 많으면 PC에서 하는 것이 안정적입니다.</p>
      </div>

      <div className="panel">
        <h2>백업에서 복원</h2>
        <p>현재 도감 전체를 백업 시점 상태로 바꿉니다. 먼저 파일을 검사하며, 검사만으로는 아무것도 바뀌지 않습니다.</p>
        <input ref={fileRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => check(e.target.files?.[0])} />
        <button type="button" className="btn btn-plain" onClick={() => fileRef.current?.click()} disabled={busy || checking || !!openRestore}>
          {checking ? '검사 중…' : '백업 ZIP 고르기'}
        </button>
        {openRestore && <p className="hint">위의 복원을 먼저 확정하거나 되돌려야 새로 복원할 수 있습니다.</p>}

        {errors && (
          <div className="check-fail">
            <p>
              <strong>이 파일로는 복원할 수 없습니다.</strong> 도감은 바뀌지 않았습니다.
            </p>
            <ul className="problems">
              {errors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          </div>
        )}

        {candidate && (
          <div className="compare">
            <p className="ok-text">✓ 파일 검사 통과 — {candidate.name}</p>
            <table>
              <thead>
                <tr>
                  <th scope="col" />
                  <th scope="col">백업 ({formatDate(candidate.backup.summary.createdAt)})</th>
                  <th scope="col">지금 도감</th>
                </tr>
              </thead>
              <tbody>
                <tr><th scope="row">버섯</th><td>{candidate.backup.summary.mushroom}</td><td>{currentSummary.mushroom}</td></tr>
                <tr><th scope="row">빅플라워</th><td>{candidate.backup.summary.bigflower}</td><td>{currentSummary.bigflower}</td></tr>
                <tr><th scope="row">데코 후보</th><td>{candidate.backup.summary.deco}</td><td>{currentSummary.deco}</td></tr>
                <tr><th scope="row">데코 분류</th><td>{candidate.backup.summary.categories}</td><td>{currentSummary.categories}</td></tr>
                <tr><th scope="row">휴지통</th><td>{candidate.backup.summary.deleted}</td><td>{currentSummary.deleted}</td></tr>
                <tr><th scope="row">사진</th><td>{candidate.backup.summary.photos}</td><td>{currentSummary.photos}</td></tr>
              </tbody>
            </table>
            {currentBytes + candidate.backup.summary.photoBytes > FREE_STORAGE * 0.9 && (
              <p className="field-error">
                복원하는 동안 지금 사진과 백업 사진이 함께 저장되어 약 {formatBytes(currentBytes + candidate.backup.summary.photoBytes)}가 필요합니다. 무료 한도(1GB)에 가까워 실패할 수 있습니다.
              </p>
            )}
            <div className="form-actions">
              <button type="button" className="btn btn-plain" onClick={() => setCandidate(null)} disabled={busy}>
                취소
              </button>
              <button type="button" className="btn btn-danger" onClick={restore} disabled={busy || !online}>
                이 백업으로 복원
              </button>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
