import { Node } from '@/types';
import { Spline, X, Loader2, EyeOff, ArrowLeftRight, Plus } from 'lucide-react';

interface ExcludeChip {
  id: number;
  name: string;
}

interface ConnectionControlsProps {
  fromName: string;
  toName: string;
  hops: number;
  includeHubs: boolean;
  pathCount: number;
  exclude: ExcludeChip[];
  suppressedHubs: Node[];
  noPath: boolean;
  loading: boolean;
  onHops: (n: number) => void;
  onToggleHubs: () => void;
  onRemoveExclude: (id: number) => void;
  onClear: () => void;
}

const MIN_HOPS = 2;
const MAX_HOPS = 6;

export default function ConnectionControls({
  fromName,
  toName,
  hops,
  includeHubs,
  pathCount,
  exclude,
  suppressedHubs,
  noPath,
  loading,
  onHops,
  onToggleHubs,
  onRemoveExclude,
  onClear,
}: ConnectionControlsProps) {
  const hubsHidden = !includeHubs && suppressedHubs.length > 0;

  return (
    <div className="hs-chrome hs-rtl absolute bottom-6 left-1/2 z-30 w-[min(92vw,40rem)] -translate-x-1/2 rounded-2xl px-5 py-4">
      <div className="flex items-center gap-3">
        <Spline className="h-4 w-4 shrink-0" style={{ color: 'var(--stamp)' }} />
        <div className="flex min-w-0 flex-1 items-center gap-2 text-sm" style={{ color: 'var(--bone)' }}>
          <span className="truncate font-bold" style={{ color: 'var(--brass)' }}>{fromName}</span>
          <ArrowLeftRight className="h-3.5 w-3.5 shrink-0" style={{ color: 'var(--bone-soft)' }} />
          <span className="truncate font-bold" style={{ color: 'var(--stamp)' }}>{toName}</span>
        </div>
        <span className="hs-mono shrink-0 text-[11px]" style={{ color: 'var(--bone-soft)' }}>
          {loading ? (
            <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--brass)' }} />
          ) : noPath ? (
            'אין מסלול'
          ) : (
            `${pathCount} מסלולים`
          )}
        </span>
        <button
          onClick={onClear}
          className="shrink-0 rounded-md p-1 transition-colors hover:bg-white/10"
          style={{ color: 'var(--bone-soft)' }}
          aria-label="סגירת מצב חיבור"
        >
          <X className="h-[18px] w-[18px]" />
        </button>
      </div>

      <div className="mt-3.5 flex flex-wrap items-center gap-x-5 gap-y-3">
        <label className="flex items-center gap-2.5 text-xs" style={{ color: 'var(--bone-soft)' }}>
          <span>עומק</span>
          <input
            type="range"
            min={MIN_HOPS}
            max={MAX_HOPS}
            value={hops}
            onChange={(e) => onHops(Number(e.target.value))}
            className="hs-range w-28"
            aria-label="עומק חיפוש"
          />
          <b className="hs-mono text-[13px]" style={{ color: 'var(--bone)' }}>{hops}</b>
        </label>

        <button
          onClick={onToggleHubs}
          className="flex items-center gap-2 rounded-md px-2 py-1 text-xs transition-colors hover:bg-white/5"
          style={{ color: includeHubs ? 'var(--bone)' : 'var(--bone-soft)', opacity: includeHubs ? 1 : 0.85 }}
        >
          <EyeOff className="h-3.5 w-3.5" style={{ color: includeHubs ? 'var(--brass)' : 'var(--bone-soft)' }} />
          {includeHubs ? 'כולל צמתים מרכזיים' : 'הצגת צמתים מרכזיים'}
        </button>

        {exclude.map((c) => (
          <button
            key={c.id}
            onClick={() => onRemoveExclude(c.id)}
            className="group flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs transition-colors"
            style={{ background: 'rgba(200,16,46,0.16)', color: 'var(--bone)', border: '1px solid var(--brass-line)' }}
          >
            <X className="h-3 w-3" style={{ color: 'var(--stamp)' }} />
            <span className="max-w-[8rem] truncate">{c.name}</span>
          </button>
        ))}
      </div>

      {hubsHidden && (
        <div
          className="mt-3 flex items-start gap-2 rounded-lg px-3 py-2 text-xs leading-relaxed"
          style={{ background: 'rgba(194,161,77,0.1)', color: 'var(--bone-soft)' }}
        >
          <Plus className="mt-0.5 h-3.5 w-3.5 shrink-0 rotate-45" style={{ color: 'var(--brass)' }} />
          <span>
            עקפנו {suppressedHubs.length} צמתים מרכזיים ({suppressedHubs.map((h) => h.name).join('، ')}).{' '}
            <button onClick={onToggleHubs} className="font-bold underline" style={{ color: 'var(--brass)' }}>
              להצגתם
            </button>
          </span>
        </div>
      )}

      {noPath && !loading && (
        <div
          className="mt-3 rounded-lg px-3 py-2 text-xs leading-relaxed"
          style={{ background: 'rgba(200,16,46,0.1)', color: 'var(--bone)' }}
        >
          לא נמצא מסלול עד {hops} צעדים.{' '}
          {hops < MAX_HOPS && (
            <button onClick={() => onHops(hops + 1)} className="font-bold underline" style={{ color: 'var(--brass)' }}>
              הגדלת העומק
            </button>
          )}
          {hubsHidden && (
            <>
              {hops < MAX_HOPS && ' · '}
              <button onClick={onToggleHubs} className="font-bold underline" style={{ color: 'var(--brass)' }}>
                הכללת צמתים מרכזיים
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
