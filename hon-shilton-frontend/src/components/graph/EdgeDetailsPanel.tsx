import { motion } from 'framer-motion';
import { Edge } from '@/types';
import { categoryMeta } from '@/lib/graph';
import { X, ExternalLink, Quote, Layers } from 'lucide-react';

interface EdgeDetailsPanelProps {
  edge: Edge;
  sourceName: string;
  targetName: string;
  onClose: () => void;
}

function formatDate(raw?: string | null): string | null {
  if (!raw) return null;
  const d = new Date(raw);
  return Number.isNaN(d.getTime()) ? raw : d.toLocaleDateString('he-IL', { year: 'numeric', month: 'short', day: 'numeric' });
}

export default function EdgeDetailsPanel({ edge, sourceName, targetName, onClose }: EdgeDetailsPanelProps) {
  const cat = categoryMeta(edge.category);
  const sources = edge.sources ?? [];

  return (
    <motion.aside
      initial={{ x: 360, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 360, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 34 }}
      className="hs-paper hs-rtl fixed bottom-6 right-6 top-24 z-40 flex w-[22rem] flex-col overflow-hidden rounded-2xl"
    >
      <div
        className="flex items-center justify-between px-5 py-3"
        style={{ borderBottom: '1px solid var(--paper-edge)', background: 'rgba(27,22,15,0.03)' }}
      >
        <span className="hs-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--ink-soft)' }}>
          קשר · RELATION
        </span>
        <button
          onClick={onClose}
          className="rounded-md p-1 transition-colors hover:bg-black/5"
          style={{ color: 'var(--ink-soft)' }}
          aria-label="סגירה"
        >
          <X className="h-[18px] w-[18px]" />
        </button>
      </div>

      <div className="px-6 pt-6">
        <span
          className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold"
          style={{ background: `${cat.color}22`, color: cat.color, border: `1px solid ${cat.color}55` }}
        >
          <span className="h-2 w-2 rounded-full" style={{ background: cat.color }} />
          {cat.key}
        </span>

        <div className="mt-4 leading-relaxed" style={{ color: 'var(--ink)' }}>
          <span className="hs-display text-xl font-bold">{sourceName}</span>
          <span className="mx-1.5 text-sm font-semibold" style={{ color: cat.color }}>
            {edge.relation}
          </span>
          <span className="hs-display text-xl font-bold">{targetName}</span>
        </div>

        <div className="mt-3 flex items-center gap-1.5 text-xs" style={{ color: 'var(--ink-soft)' }}>
          <Layers className="h-3.5 w-3.5" />
          {sources.length === 1 ? 'מקור אחד' : `${sources.length} מקורות`}
          {edge.directed === false && <span className="mr-1">· קשר הדדי</span>}
        </div>
      </div>

      <div className="mt-4 flex-1 overflow-y-auto px-6 pb-6">
        <div className="space-y-3">
          {sources.map((s, i) => {
            const date = formatDate(s.publishedDate);
            return (
              <div
                key={i}
                className="rounded-xl p-3.5"
                style={{ background: 'rgba(27,22,15,0.04)', border: '1px solid var(--paper-edge)' }}
              >
                <div className="flex items-center justify-between gap-2">
                  <a
                    href={s.url}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-bold transition-colors hover:opacity-80"
                    style={{ background: 'var(--ink)', color: 'var(--paper)' }}
                  >
                    [{s.outlet}]
                    <ExternalLink className="h-3 w-3" />
                  </a>
                  {date && (
                    <span className="hs-mono text-[11px]" style={{ color: 'var(--ink-soft)' }}>
                      {date}
                    </span>
                  )}
                </div>
                {s.quote && (
                  <blockquote className="mt-2.5 flex gap-1.5 text-sm leading-relaxed" style={{ color: 'var(--ink)' }}>
                    <Quote className="mt-0.5 h-3.5 w-3.5 shrink-0" style={{ color: cat.color }} />
                    <span>{s.quote}</span>
                  </blockquote>
                )}
              </div>
            );
          })}
          {sources.length === 0 && (
            <p className="text-sm" style={{ color: 'var(--ink-soft)' }}>
              אין מקור מצורף לקשר זה.
            </p>
          )}
        </div>
      </div>
    </motion.aside>
  );
}
