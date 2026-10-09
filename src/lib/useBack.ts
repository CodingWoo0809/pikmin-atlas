import { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

/** 앱 안에서 들어왔으면 뒤로, 주소로 바로 들어왔으면 지정한 화면으로 */
export function useBack(fallback: string) {
  const nav = useNavigate();
  return useCallback(() => {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0;
    if (idx > 0) nav(-1);
    else nav(fallback, { replace: true });
  }, [nav, fallback]);
}
