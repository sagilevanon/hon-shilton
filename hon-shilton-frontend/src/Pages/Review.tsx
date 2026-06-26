import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ReviewAPI } from '@/services/api';
import { ReviewItem, ReviewAction } from '@/types';
import { categoryMeta } from '@/lib/graph';
import { Check, X, ChevronRight, ChevronLeft, ArrowRight, Loader2 } from 'lucide-react';

const PAGE_SIZE = 20;

export default function ReviewPage() {
  const [items, setItems] = useState<ReviewItem[]>([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [isLoading, setIsLoading] = useState(true);
  const [busyId, setBusyId] = useState<number | null>(null);

  const load = useCallback(async (at: number) => {
    setIsLoading(true);
    try {
      const queue = await ReviewAPI.queue(PAGE_SIZE, at);
      setItems(queue.items);
      setTotal(queue.total);
    } catch (error) {
      console.error('Error loading review queue:', error);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    load(offset);
  }, [offset, load]);

  const decide = async (id: number, action: ReviewAction) => {
    setBusyId(id);
    try {
      await ReviewAPI.decide(id, action);
      const nextOffset = items.length === 1 && offset > 0 ? offset - PAGE_SIZE : offset;
      if (nextOffset !== offset) setOffset(nextOffset);
      else await load(offset);
    } catch (error) {
      console.error('Error submitting decision:', error);
    } finally {
      setBusyId(null);
    }
  };

  const page = Math.floor(offset / PAGE_SIZE) + 1;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));

  return (
    <div className="hs-landing hs-rtl min-h-screen px-5 py-10">
      <div className="mx-auto max-w-4xl">
        <div className="mb-7 flex items-center justify-between gap-4">
          <div>
            <h1 className="hs-display text-4xl font-black" style={{ color: 'var(--bone)' }}>
              תור הביקורת
            </h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--bone-soft)' }}>
              {total} קשרים ממתינים לאישור
            </p>
          </div>
          <Link
            to="/"
            className="hs-chrome flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-semibold transition-opacity hover:opacity-80"
            style={{ color: 'var(--bone)' }}
          >
            <ArrowRight className="h-4 w-4" />
            חזרה לגרף
          </Link>
        </div>

        {isLoading ? (
          <div className="flex items-center gap-2 py-12" style={{ color: 'var(--bone-soft)' }}>
            <Loader2 className="h-4 w-4 animate-spin" style={{ color: 'var(--brass)' }} />
            טוען…
          </div>
        ) : items.length === 0 ? (
          <div className="hs-paper rounded-2xl p-10 text-center" style={{ color: 'var(--ink-soft)' }}>
            אין מה לבקר. קשרים חדשים יופיעו כאן לאחר הרצת הצנרת.
          </div>
        ) : (
          <div className="space-y-3">
            {items.map((item) => {
              const cat = categoryMeta(item.category);
              return (
                <div key={item.id} className="hs-paper rounded-2xl px-5 py-4">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span
                          className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-bold"
                          style={{ background: `${cat.color}22`, color: cat.color, border: `1px solid ${cat.color}55` }}
                        >
                          <span className="h-1.5 w-1.5 rounded-full" style={{ background: cat.color }} />
                          {cat.key}
                        </span>
                        <span className="hs-mono text-[11px]" style={{ color: 'var(--ink-soft)' }}>
                          {item.confidence}
                          {item.verification && item.verification !== 'unchecked' && ` · ${item.verification}`}
                        </span>
                      </div>
                      <div className="mt-2 leading-relaxed" style={{ color: 'var(--ink)' }}>
                        <span className="hs-display text-lg font-bold">{item.source}</span>
                        <span className="mx-1.5 text-sm font-semibold" style={{ color: cat.color }}>
                          {item.relation}
                        </span>
                        <span className="hs-display text-lg font-bold">{item.target}</span>
                      </div>
                      <div className="mt-2 space-y-1">
                        {item.sources.map((s, i) => (
                          <div key={i} className="text-sm" style={{ color: 'var(--ink-soft)' }}>
                            <a
                              href={s.url}
                              target="_blank"
                              rel="noreferrer"
                              className="font-bold underline"
                              style={{ color: 'var(--stamp)' }}
                            >
                              [{s.outlet}]
                            </a>{' '}
                            {s.quote && <span dir="auto">„{s.quote}”</span>}
                          </div>
                        ))}
                      </div>
                    </div>

                    <div className="flex shrink-0 gap-2">
                      <button
                        onClick={() => decide(item.id, 'approve')}
                        disabled={busyId === item.id}
                        className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-bold text-white transition-transform active:scale-95 disabled:opacity-50"
                        style={{ background: '#3f7d4f' }}
                      >
                        <Check className="h-4 w-4" />
                        אישור
                      </button>
                      <button
                        onClick={() => decide(item.id, 'reject')}
                        disabled={busyId === item.id}
                        className="flex items-center gap-1 rounded-lg px-3 py-2 text-sm font-bold text-white transition-transform active:scale-95 disabled:opacity-50"
                        style={{ background: 'var(--stamp)' }}
                      >
                        <X className="h-4 w-4" />
                        דחייה
                      </button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {total > PAGE_SIZE && (
          <div className="mt-6 flex items-center justify-center gap-4">
            <button
              disabled={offset === 0}
              onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}
              className="hs-chrome flex items-center gap-1 rounded-lg px-3 py-2 text-sm disabled:opacity-40"
              style={{ color: 'var(--bone)' }}
            >
              <ChevronRight className="h-4 w-4" />
              הקודם
            </button>
            <span className="hs-mono text-sm" style={{ color: 'var(--bone-soft)' }}>
              עמוד {page} מתוך {pageCount}
            </span>
            <button
              disabled={offset + PAGE_SIZE >= total}
              onClick={() => setOffset(offset + PAGE_SIZE)}
              className="hs-chrome flex items-center gap-1 rounded-lg px-3 py-2 text-sm disabled:opacity-40"
              style={{ color: 'var(--bone)' }}
            >
              הבא
              <ChevronLeft className="h-4 w-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
