import { useMemo, useRef, useState } from 'react';
import { Icon } from '../components/bits';
import { coordText } from '../lib/coords';
import { dataErrorMessage } from '../lib/errors';
import { buildPayload, readImportFile, rowStatus, summarize, SAMPLE_CSV, SAMPLE_JSON, type ImportRow } from '../lib/importer';
import { sb } from '../lib/supabase';
import { saveBlob } from '../lib/download';
import { useBack } from '../lib/useBack';
import { CATEGORY_LABEL } from '../lib/types';
import { useAtlas } from '../state/atlas';
import { useUi } from '../state/ui';

type Loaded = Awaited<ReturnType<typeof readImportFile>> & { fileName: string };

export function ImportPage() {
  const back = useBack('/settings');
  const { places, categories, online, refresh } = useAtlas();
  const { toast, confirm } = useUi();
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [rows, setRows] = useState<ImportRow[]>([]);
  const [filter, setFilter] = useState<'all' | 'error' | 'duplicate'>('all');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ places: number; categories: number; skipped: number; errors: number } | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const pick = async (file?: File) => {
    if (!file) return;
    setResult(null);
    try {
      const r = await readImportFile(file, places, categories);
      setLoaded({ ...r, fileName: file.name });
      setRows(r.rows);
      setFilter(r.rows.some((x) => x.errors.length) ? 'error' : 'all');
    } catch {
      toast('파일을 읽지 못했습니다.', { kind: 'error' });
    } finally {
      if (fileRef.current) fileRef.current.value = '';
    }
  };

  const sum = useMemo(() => summarize(rows), [rows]);
  const visible = rows.filter((r) => filter === 'all' || rowStatus(r) === filter);
  const dupCount = rows.filter((r) => rowStatus(r) === 'duplicate').length;

  const setAction = (line: number, action: ImportRow['action']) => setRows((rs) => rs.map((r) => (r.line === line ? { ...r, action } : r)));
  const setAllDup = (action: ImportRow['action']) => setRows((rs) => rs.map((r) => (r.duplicateOf ? { ...r, action } : r)));

  const run = async () => {
    if (!loaded || busy) return;
    if (!online) return toast('오프라인 — 가져올 수 없습니다.', { kind: 'error' });
    const payload = buildPayload(rows, categories, loaded.extraCategories);
    if (payload.places.length === 0 && payload.new_categories.length === 0) return toast('추가할 행이 없습니다.');
    const ok = await confirm(
      '가져오기 실행',
      <p>
        장소 {payload.places.length}곳{payload.new_categories.length ? `, 새 데코 분류 ${payload.new_categories.length}개` : ''}를 추가합니다. 기존 기록은 바뀌지 않습니다.
      </p>,
      '추가하기',
    );
    if (!ok) return;
    setBusy(true);
    try {
      const { data, error } = await sb().rpc('import_records', { payload });
      if (error) throw error;
      const r = data as { places: number; categories: number };
      setResult({ places: r.places, categories: r.categories, skipped: sum.skip, errors: sum.error });
      setLoaded(null);
      setRows([]);
      await refresh(true);
      toast(`가져오기 완료: ${r.places}곳 추가`, { kind: 'success' });
    } catch (e) {
      toast(`가져오기 실패 — 아무것도 추가되지 않았습니다. (${dataErrorMessage(e as Error)})`, { kind: 'error', ms: 7000 });
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
        <h1 className="grow">CSV·JSON 가져오기</h1>
      </div>

      {result && (
        <div className="panel panel-ok">
          <h2>가져오기 결과</h2>
          <p>
            추가 {result.places}곳 · 새 분류 {result.categories}개 · 중복 건너뜀 {result.skipped}행 · 오류 {result.errors}행
          </p>
        </div>
      )}

      <div className="panel">
        <p>
          엑셀에서 저장한 CSV(UTF-8 또는 한글 CP949)와 JSON을 읽을 수 있습니다. 사진은 가져오지 않습니다(사진은 ZIP 복원으로만).
        </p>
        <p className="hint">
          열: <code>이름, 카테고리, 위도, 경도, 설명, 즐겨찾기, 데코분류</code> (영문 <code>name, category, lat, lng, description, favorite, deco_category</code>도 가능). 카테고리는 버섯·빅플라워·데코.
          같은 카테고리에서 좌표를 소수점 다섯째 자리까지 반올림해 같으면 중복으로 봅니다.
        </p>
        <div className="row-gap">
          <input ref={fileRef} type="file" accept=".csv,.json,text/csv,application/json" hidden onChange={(e) => pick(e.target.files?.[0])} />
          <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()} disabled={busy}>
            파일 고르기
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => saveBlob(new Blob(['\uFEFF' + SAMPLE_CSV], { type: 'text/csv' }), 'nomad-atlas-sample.csv')}>
            CSV 예시
          </button>
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => saveBlob(new Blob([SAMPLE_JSON], { type: 'application/json' }), 'nomad-atlas-sample.json')}>
            JSON 예시
          </button>
        </div>
      </div>

      {loaded && (
        <div className="panel">
          <h2>미리보기 — {loaded.fileName}</h2>
          {loaded.fileErrors.length > 0 ? (
            <ul className="problems">
              {loaded.fileErrors.map((e) => (
                <li key={e}>{e}</li>
              ))}
            </ul>
          ) : (
            <>
              <p className="hint">
                {loaded.encoding === 'cp949' ? '한글(CP949) 인코딩으로 읽었습니다. ' : loaded.encoding === 'utf-8' ? 'UTF-8로 읽었습니다. ' : ''}
                전체 {rows.length}행
              </p>
              <div className="import-summary">
                <span className="pill pill-ok">추가 {sum.add}</span>
                <span className="pill pill-dup">중복 건너뜀 {sum.skip}</span>
                <span className="pill pill-err">오류 {sum.error}</span>
              </div>
              {loaded.newCategoryNames.length > 0 && <p className="hint">새로 만들 데코 분류: {loaded.newCategoryNames.join(', ')}</p>}
              <div className="row-gap">
                <div className="seg" role="group" aria-label="보기">
                  {(['all', 'error', 'duplicate'] as const).map((f) => (
                    <button key={f} type="button" className={filter === f ? 'is-on' : ''} onClick={() => setFilter(f)}>
                      {f === 'all' ? '전체' : f === 'error' ? '오류' : '중복'}
                    </button>
                  ))}
                </div>
                {dupCount > 0 && (
                  <>
                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => setAllDup('skip')}>
                      중복 모두 건너뛰기
                    </button>
                    <button type="button" className="btn btn-quiet btn-sm" onClick={() => setAllDup('add')}>
                      중복 모두 추가
                    </button>
                  </>
                )}
              </div>
              <ul className="import-rows">
                {visible.slice(0, 500).map((r) => {
                  const s = rowStatus(r);
                  return (
                    <li key={r.line} className={`import-row is-${s}`}>
                      <span className="import-line">{r.line}행</span>
                      <div className="import-main">
                        <p>
                          <strong>{r.name || '(이름 없음)'}</strong> {r.category && <span className={`cat-label cat-label-${r.category}`}>{CATEGORY_LABEL[r.category]}</span>}
                          {r.decoCategoryName && <span className="hint"> · {r.decoCategoryName}</span>}
                        </p>
                        {r.lat != null && r.lng != null && <p className="hint">{coordText(r.lat, r.lng)}</p>}
                        {r.errors.map((e) => (
                          <p key={e} className="field-error">
                            {e}
                          </p>
                        ))}
                        {s === 'duplicate' && (
                          <div className="dup-choice">
                            <span className="hint">{r.duplicateOf === 'existing' ? '이미 등록된 장소와 같은 좌표' : '이 파일 위쪽 행과 같은 좌표'}</span>
                            <select value={r.action} onChange={(e) => setAction(r.line, e.target.value as ImportRow['action'])} aria-label={`${r.line}행 처리`}>
                              <option value="skip">건너뛰기</option>
                              <option value="add">그래도 추가</option>
                            </select>
                          </div>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
              {visible.length > 500 && <p className="hint">처음 500행만 보여 줍니다.</p>}
              <div className="form-actions">
                <button type="button" className="btn btn-plain" onClick={() => setLoaded(null)} disabled={busy}>
                  취소
                </button>
                <button type="button" className="btn btn-primary" onClick={run} disabled={busy || sum.add === 0 || !online}>
                  {busy ? '가져오는 중…' : `${sum.add}곳 추가하기`}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}
