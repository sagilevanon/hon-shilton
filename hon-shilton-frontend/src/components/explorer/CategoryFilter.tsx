import { CATEGORIES } from '@/lib/graph';

interface CategoryFilterProps {
  active: Set<string>;
  counts: Record<string, number>;
  onToggle: (key: string) => void;
}

export default function CategoryFilter({ active, counts, onToggle }: CategoryFilterProps) {
  return (
    <div
      className="hs-chrome hs-rtl absolute bottom-6 left-6 z-20 w-60 rounded-xl px-4 py-3 text-xs"
      style={{ color: 'var(--bone-soft)' }}
    >
      <div className="hs-mono mb-2.5 text-[10px] uppercase tracking-[0.18em]" style={{ color: 'var(--bone-soft)' }}>
        סינון לפי קטגוריה
      </div>
      <div className="space-y-1">
        {CATEGORIES.map((c) => {
          const on = active.has(c.key);
          const n = counts[c.key] ?? 0;
          return (
            <button
              key={c.key}
              onClick={() => onToggle(c.key)}
              className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 transition-colors hover:bg-white/5"
              style={{ opacity: on ? 1 : 0.4 }}
            >
              <span
                className="h-2.5 w-4 rounded-full"
                style={{ background: c.color, boxShadow: on ? `0 0 0 1px ${c.color}` : 'none' }}
              />
              <span style={{ color: 'var(--bone)' }}>{c.key}</span>
              <span className="hs-mono mr-auto text-[11px]" style={{ color: 'var(--bone-soft)' }}>
                {n}
              </span>
            </button>
          );
        })}
      </div>

      <div className="my-2.5 h-px w-full" style={{ background: 'var(--brass-line)' }} />

      <div className="space-y-1.5">
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--person)' }} /> אדם
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: 'var(--org)' }} /> ארגון
        </div>
        <div className="flex items-center gap-2">
          <span className="h-[3px] w-5 rounded-full" style={{ background: 'var(--brass)' }} /> עובי = מספר מקורות
        </div>
      </div>
    </div>
  );
}
