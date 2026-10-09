import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';

// ---------------- 알림(토스트) ----------------
type Toast = {
  id: number;
  text: string;
  kind: 'info' | 'error' | 'success';
  action?: { label: string; run: () => void };
  ms: number;
};

type DialogChoice = { value: string; label: string; tone?: 'danger' | 'primary' | 'plain' };
type DialogReq = {
  title: string;
  body?: ReactNode;
  choices: DialogChoice[];
  resolve: (v: string | null) => void;
};

type UiCtx = {
  toast: (text: string, opts?: { kind?: Toast['kind']; action?: Toast['action']; ms?: number }) => void;
  ask: (title: string, body: ReactNode, choices: DialogChoice[]) => Promise<string | null>;
  confirm: (title: string, body: ReactNode, okLabel: string, tone?: 'danger' | 'primary') => Promise<boolean>;
};

const Ctx = createContext<UiCtx | null>(null);

export function useUi() {
  const v = useContext(Ctx);
  if (!v) throw new Error('UiProvider missing');
  return v;
}

export function UiProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [dialog, setDialog] = useState<DialogReq | null>(null);
  const seq = useRef(0);

  const toast = useCallback<UiCtx['toast']>((text, opts) => {
    const id = ++seq.current;
    const t: Toast = { id, text, kind: opts?.kind ?? 'info', action: opts?.action, ms: opts?.ms ?? (opts?.action ? 7000 : 2600) };
    setToasts((list) => [...list.slice(-1), t]);
    setTimeout(() => setToasts((list) => list.filter((x) => x.id !== id)), t.ms);
  }, []);

  const ask = useCallback<UiCtx['ask']>(
    (title, body, choices) => new Promise((resolve) => setDialog({ title, body, choices, resolve })),
    [],
  );
  const confirm = useCallback<UiCtx['confirm']>(
    async (title, body, okLabel, tone = 'primary') =>
      (await ask(title, body, [
        { value: 'cancel', label: '취소', tone: 'plain' },
        { value: 'ok', label: okLabel, tone },
      ])) === 'ok',
    [ask],
  );

  const value = useMemo(() => ({ toast, ask, confirm }), [toast, ask, confirm]);

  const close = (v: string | null) => {
    dialog?.resolve(v);
    setDialog(null);
  };

  return (
    <Ctx.Provider value={value}>
      {children}
      <div className="toasts" aria-live="polite">
        {toasts.map((t) => (
          <div key={t.id} className={`toast toast-${t.kind}`}>
            <span>{t.text}</span>
            {t.action && (
              <button
                type="button"
                className="toast-action"
                onClick={() => {
                  t.action!.run();
                  setToasts((list) => list.filter((x) => x.id !== t.id));
                }}
              >
                {t.action.label}
              </button>
            )}
          </div>
        ))}
      </div>
      {dialog && <Dialog req={dialog} onClose={close} />}
    </Ctx.Provider>
  );
}

function Dialog({ req, onClose }: { req: DialogReq; onClose: (v: string | null) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const prev = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLButtonElement>('button:last-child')?.focus();
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose(null);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('keydown', onKey);
      prev?.focus?.();
    };
  }, [onClose]);
  return (
    <div className="scrim" onClick={() => onClose(null)}>
      <div className="dialog" role="alertdialog" aria-modal="true" aria-labelledby="dlg-title" ref={ref} onClick={(e) => e.stopPropagation()}>
        <h2 id="dlg-title">{req.title}</h2>
        {req.body && <div className="dialog-body">{req.body}</div>}
        <div className={`dialog-actions ${req.choices.length > 2 ? 'stacked' : ''}`}>
          {req.choices.map((c) => (
            <button key={c.value} type="button" className={`btn btn-${c.tone ?? 'plain'}`} onClick={() => onClose(c.value)}>
              {c.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
