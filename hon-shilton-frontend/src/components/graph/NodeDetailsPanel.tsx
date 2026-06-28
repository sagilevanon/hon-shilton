import { motion } from 'framer-motion';
import { Node } from '@/types';
import { X, User, Building2, Share2, ExternalLink, Spline, EyeOff } from 'lucide-react';

interface NodeDetailsPanelProps {
  node: Node;
  onClose: () => void;
  onExpand: (id: number) => void;
  onTrace?: (id: number) => void;
  onExclude?: (id: number) => void;
}

const isPerson = (t: string) => t.toLowerCase() === 'person';

export default function NodeDetailsPanel({ node, onClose, onExpand, onTrace, onExclude }: NodeDetailsPanelProps) {
  const person = isPerson(node.type);
  const tone = person ? 'var(--ink)' : 'var(--brass)';
  const aliases = node.aliases ?? [];

  return (
    <motion.aside
      initial={{ x: 360, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 360, opacity: 0 }}
      transition={{ type: 'spring', stiffness: 320, damping: 34 }}
      className="hs-paper hs-rtl fixed bottom-6 right-6 top-24 z-40 flex w-80 flex-col overflow-hidden rounded-2xl"
    >
      <div
        className="flex items-center justify-between px-5 py-3"
        style={{ borderBottom: '1px solid var(--paper-edge)', background: 'rgba(27,22,15,0.03)' }}
      >
        <span className="hs-mono text-[11px] uppercase tracking-[0.18em]" style={{ color: 'var(--ink-soft)' }}>
          תיק · {person ? 'PERSON' : 'ORG'}
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

      <div className="flex-1 overflow-y-auto">
        <div className="px-6 pt-6 text-center">
          <div
            className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-xl"
            style={{ background: tone, color: 'var(--paper)' }}
          >
            {person ? <User className="h-8 w-8" /> : <Building2 className="h-8 w-8" />}
          </div>
          <h2 className="hs-display text-2xl font-bold leading-tight" style={{ color: 'var(--ink)' }}>
            {node.name}
          </h2>
          {node.description && (
            <p className="mt-2.5 text-sm leading-relaxed" style={{ color: 'var(--ink-soft)' }}>
              {node.description}
            </p>
          )}
        </div>

        {aliases.length > 0 && (
          <div className="mt-5 px-6">
            <div className="hs-mono mb-2 text-[10px] uppercase tracking-[0.18em]" style={{ color: 'var(--ink-soft)' }}>
              ידוע גם כ
            </div>
            <div className="flex flex-wrap gap-1.5">
              {aliases.map((a) => (
                <span
                  key={a}
                  dir="auto"
                  className="rounded-md px-2 py-0.5 text-xs font-semibold"
                  style={{ background: 'rgba(27,22,15,0.06)', color: 'var(--ink)' }}
                >
                  {a}
                </span>
              ))}
            </div>
          </div>
        )}

        {node.qid && (
          <div className="mt-5 px-6">
            <a
              href={`https://www.wikidata.org/wiki/${node.qid}`}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 text-sm font-semibold transition-opacity hover:opacity-80"
              style={{ color: 'var(--stamp)' }}
            >
              <ExternalLink className="h-3.5 w-3.5" />
              ויקינתונים · {node.qid}
            </a>
          </div>
        )}
      </div>

      <div className="space-y-2 p-5">
        <button
          onClick={() => onExpand(node.id)}
          className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-3 text-sm font-bold text-white transition-transform active:scale-[0.99]"
          style={{ background: 'var(--stamp)' }}
        >
          <Share2 className="h-4 w-4" />
          הרחבת הקשרים של צומת זה
        </button>

        {onTrace && (
          <button
            onClick={() => onTrace(node.id)}
            className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-bold transition-colors"
            style={{ border: '1px solid var(--paper-edge)', color: 'var(--ink)' }}
          >
            <Spline className="h-4 w-4" style={{ color: 'var(--stamp)' }} />
            מציאת קשר לישות אחרת
          </button>
        )}

        {onExclude && (
          <button
            onClick={() => onExclude(node.id)}
            className="flex w-full items-center justify-center gap-2 rounded-lg px-4 py-2.5 text-sm font-semibold transition-colors"
            style={{ border: '1px solid var(--paper-edge)', color: 'var(--ink-soft)' }}
          >
            <EyeOff className="h-4 w-4" />
            החרגת הצומת מהמסלול
          </button>
        )}
      </div>
    </motion.aside>
  );
}
