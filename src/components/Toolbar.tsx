import { SORT_LABEL, type SortKey } from '../lib/types';
import { Icon } from './bits';

export function Toolbar(props: {
  sort: SortKey;
  onSort: (s: SortKey) => void;
  favOnly: boolean;
  onFavOnly: (v: boolean) => void;
  query: string;
  onQuery: (q: string) => void;
  count: number;
}) {
  return (
    <div className="toolbar">
      <label className="search">
        <Icon name="search" size={17} />
        <input type="search" placeholder="이름·설명 검색" value={props.query} onChange={(e) => props.onQuery(e.target.value)} aria-label="검색" enterKeyHint="search" />
      </label>
      <div className="toolbar-row">
        <label className="select">
          <span className="sr-only">정렬</span>
          <select value={props.sort} onChange={(e) => props.onSort(e.target.value as SortKey)}>
            {(Object.keys(SORT_LABEL) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABEL[k]}
              </option>
            ))}
          </select>
        </label>
        <button type="button" className={`chip ${props.favOnly ? 'is-on' : ''}`} aria-pressed={props.favOnly} onClick={() => props.onFavOnly(!props.favOnly)}>
          <Icon name={props.favOnly ? 'star-fill' : 'star'} size={15} />
          즐겨찾기만
        </button>
        <span className="count">{props.count}곳</span>
      </div>
    </div>
  );
}
