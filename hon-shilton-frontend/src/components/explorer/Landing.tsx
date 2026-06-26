import { useEffect, useState } from 'react';
import { SearchAPI } from '@/services/api';
import { SearchResult } from '@/types';
import SearchBox from './SearchBox';

interface LandingProps {
  onSelect: (result: SearchResult) => void;
}

const isPerson = (t: string) => t.toLowerCase() === 'person';

export default function Landing({ onSelect }: LandingProps) {
  const [suggested, setSuggested] = useState<SearchResult[]>([]);

  useEffect(() => {
    SearchAPI.query('', 8)
      .then(setSuggested)
      .catch(() => setSuggested([]));
  }, []);

  return (
    <div className="hs-landing flex min-h-screen items-center justify-center px-5 py-12">
      <div className="relative w-full max-w-2xl">
        <div
          className="hs-paper absolute inset-0 rounded-2xl"
          style={{ transform: 'rotate(-1.4deg)', opacity: 0.55 }}
          aria-hidden
        />
        <div className="hs-paper hs-fade-up hs-rtl relative rounded-2xl px-8 py-10 sm:px-14 sm:py-12">
          <div className="mb-8 flex items-center justify-between gap-4">
            <span className="hs-stamp inline-block" style={{ transform: 'rotate(-2deg)' }}>
              רשומה ציבורית
            </span>
            <span className="hs-mono text-[11px] tracking-wider" style={{ color: 'var(--ink-soft)' }}>
              תיק&nbsp;·&nbsp;FILE No. HS-001
            </span>
          </div>

          <h1
            className="hs-display text-6xl font-black leading-none sm:text-7xl"
            style={{ color: 'var(--ink)', letterSpacing: '-0.01em' }}
          >
            הון־שלטון
          </h1>
          <div className="mt-5 h-px w-full" style={{ background: 'var(--brass-line)' }} />
          <p className="mt-5 max-w-xl text-lg leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
            מי מחזיק את מי. תיק חי של הקשרים בין אנשים וארגונים בישראל — נשען על ציטוטים מתוך כתבות החדשות, מקור אחר מקור.
          </p>

          <div className="mt-8">
            <SearchBox variant="hero" onSelect={onSelect} placeholder="הזינו שם של אדם או ארגון לפתיחת התיק…" />
          </div>

          {suggested.length > 0 && (
            <div className="mt-9">
              <div
                className="hs-mono mb-3 text-[11px] uppercase tracking-[0.18em]"
                style={{ color: 'var(--ink-soft)' }}
              >
                נושאים פתוחים לחקירה
              </div>
              <div className="flex flex-wrap gap-2">
                {suggested.map((s) => (
                  <button
                    key={s.id}
                    data-suggestion
                    onClick={() => onSelect(s)}
                    className="hs-suggest group flex items-center gap-2 rounded-md px-3 py-1.5 text-sm font-semibold transition-colors"
                    style={{ border: '1px solid var(--paper-edge)', color: 'var(--ink)' }}
                  >
                    <span
                      className="h-2 w-2 rotate-45 rounded-[1px]"
                      style={{ background: isPerson(s.type) ? 'var(--ink)' : 'var(--brass)' }}
                    />
                    {s.name}
                    <span className="hs-mono text-[11px]" style={{ color: 'var(--ink-soft)' }}>
                      {s.degree}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
