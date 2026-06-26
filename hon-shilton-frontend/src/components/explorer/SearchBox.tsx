import { useEffect, useRef, useState } from 'react';
import { Search, Loader2, CornerDownLeft } from 'lucide-react';
import { SearchAPI } from '@/services/api';
import { SearchResult } from '@/types';

type Variant = 'hero' | 'bar';

interface SearchBoxProps {
  onSelect: (result: SearchResult) => void;
  variant?: Variant;
  autoFocus?: boolean;
  placeholder?: string;
}

function useDebounced<T>(value: T, ms: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

const isPerson = (type: string) => type.toLowerCase() === 'person';

export default function SearchBox({ onSelect, variant = 'bar', autoFocus, placeholder }: SearchBoxProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [active, setActive] = useState(0);
  const debounced = useDebounced(query, 180);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let live = true;
    if (!open) return;
    setLoading(true);
    SearchAPI.query(debounced)
      .then((r) => live && (setResults(r), setActive(0)))
      .catch(() => live && setResults([]))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [debounced, open]);

  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as HTMLElement)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, []);

  const choose = (r: SearchResult) => {
    setQuery('');
    setOpen(false);
    onSelect(r);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') (e.preventDefault(), setActive((i) => Math.min(i + 1, results.length - 1)));
    else if (e.key === 'ArrowUp') (e.preventDefault(), setActive((i) => Math.max(i - 1, 0)));
    else if (e.key === 'Enter' && results[active]) choose(results[active]);
    else if (e.key === 'Escape') setOpen(false);
  };

  const hero = variant === 'hero';

  return (
    <div ref={rootRef} className="relative w-full">
      <div
        className="hs-rtl flex items-center gap-3 rounded-xl transition-shadow"
        style={{
          background: '#fbf8ef',
          border: `1px solid ${open ? 'var(--stamp)' : 'var(--paper-edge)'}`,
          boxShadow: open ? '0 0 0 4px rgba(200,16,46,0.12)' : 'inset 0 1px 2px rgba(0,0,0,0.07)',
          padding: hero ? '15px 20px' : '9px 14px',
          fontSize: hero ? '18px' : '15px',
        }}
      >
        <Search className={`shrink-0 ${hero ? 'h-6 w-6' : 'h-[18px] w-[18px]'}`} style={{ color: 'var(--stamp)' }} />
        <input
          autoFocus={autoFocus}
          dir="auto"
          value={query}
          onChange={(e) => (setQuery(e.target.value), setOpen(true))}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder={placeholder ?? 'חיפוש אדם או ארגון…'}
          className="w-full bg-transparent placeholder:text-[#8a8472] focus:outline-none"
          style={{ color: 'var(--ink)' }}
        />
        {loading && <Loader2 className="h-4 w-4 shrink-0 animate-spin" style={{ color: 'var(--brass)' }} />}
      </div>

      {open && (
        <div
          className="hs-rtl hs-paper hs-fade-up absolute z-50 mt-2 w-full overflow-hidden rounded-xl"
          role="listbox"
        >
          {results.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm" style={{ color: 'var(--ink-soft)' }}>
              {loading ? 'מחפש…' : query ? 'אין רשומות תואמות' : 'הקלידו שם של אדם או ארגון'}
            </div>
          ) : (
            <ul className="max-h-80 overflow-y-auto py-1.5">
              {results.map((r, i) => (
                <li key={r.id}>
                  <button
                    onMouseEnter={() => setActive(i)}
                    onClick={() => choose(r)}
                    className="flex w-full items-center gap-3 px-4 py-2.5 text-right transition-colors"
                    style={{ background: i === active ? 'rgba(194,161,77,0.16)' : 'transparent' }}
                  >
                    <span
                      className="h-2.5 w-2.5 shrink-0 rotate-45 rounded-[2px]"
                      style={{ background: isPerson(r.type) ? 'var(--ink)' : 'var(--brass)' }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="hs-display block truncate text-[15px] font-bold" style={{ color: 'var(--ink)' }}>
                        {r.name}
                      </span>
                      {r.description && (
                        <span className="block truncate text-xs" style={{ color: 'var(--ink-soft)' }}>
                          {r.description}
                        </span>
                      )}
                    </span>
                    <span
                      className="hs-mono shrink-0 rounded px-1.5 py-0.5 text-[11px]"
                      style={{ background: 'rgba(27,22,15,0.06)', color: 'var(--ink-soft)' }}
                    >
                      {r.degree}
                    </span>
                    {i === active && <CornerDownLeft className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--stamp)' }} />}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
