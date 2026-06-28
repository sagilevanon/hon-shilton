// Verification: a second Claude Code call that fact-checks extracted relations
// against the exact quotes they were based on. Catches misreads the extractor
// can make — denials ("denied funding"), wrong direction, or a quote that is
// about a different pair entirely. One call checks a whole batch of claims and
// returns one verdict per claim, in order.

import { runClaude } from './claude.js';

export interface VerifyClaim {
  source: string;
  target: string;
  relation: string;
  directed: boolean;
  quote: string;
}

export interface Verdict {
  index?: number;
  supported: boolean;
  reason?: string;
}

export type BatchVerifier = (claims: VerifyClaim[]) => Promise<Verdict[]>;

export function arrow(directed: boolean): string {
  return directed ? '→' : '↔';
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    verdicts: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          index: { type: 'integer' },
          supported: { type: 'boolean' },
          reason: { type: 'string' },
        },
        required: ['index', 'supported'],
      },
    },
  },
  required: ['verdicts'],
} as const;

const SYSTEM_PROMPT = [
  'You are a fact-checker for a public-transparency knowledge graph built from Israeli news.',
  'You are given a NUMBERED list of extracted relationships, each with the exact quote it was drawn from.',
  'For EACH item, decide whether the quote really supports that relationship.',
  '',
  'Set supported=false when:',
  '- the quote denies or negates the relation (e.g. "הכחיש", "לא תרם", "denied funding"),',
  '- the quote is about a different pair of entities,',
  '- the direction is wrong (source and target are swapped),',
  '- the quote does not actually mention this relation.',
  'Set supported=true only when the quote clearly states or implies this exact relation',
  'between these two entities. An openly alleged relation ("לכאורה") still counts as',
  'supported — it is something the article reports.',
  'Return a "verdicts" array with EXACTLY one entry per input item. Set "index" to the',
  'item number it judges (the #N in the prompt) so each verdict binds to its own claim.',
  'Give a one-line reason for each.',
].join('\n');

function claimBlock(c: VerifyClaim, i: number): string {
  return [
    `#${i + 1}`,
    `${c.source} ${arrow(c.directed)} ${c.target}`,
    `סוג הקשר: ${c.relation} (${c.directed ? 'מכוון' : 'הדדי'})`,
    `הציטוט התומך: "${c.quote}"`,
  ].join('\n');
}

function userPrompt(claims: VerifyClaim[]): string {
  return [
    `להלן ${claims.length} יחסים שחולצו. עבור כל אחד, האם הציטוט באמת תומך בקשר?`,
    '',
    claims.map(claimBlock).join('\n\n'),
  ].join('\n');
}

export async function verifyClaims(claims: VerifyClaim[]): Promise<Verdict[]> {
  if (claims.length === 0) return [];
  const so = (await runClaude({
    prompt: userPrompt(claims),
    schema: SCHEMA,
    systemPrompt: SYSTEM_PROMPT,
    label: 'verify',
  })) as { verdicts?: Verdict[] };
  if (!so || !Array.isArray(so.verdicts) || !so.verdicts.every(isVerdict)) {
    throw new Error('claude returned no verdicts matching the schema');
  }
  return so.verdicts;
}

// A real verdict must carry a boolean `supported`; structured output is not
// guaranteed to honour the schema, and an element missing it would otherwise be
// read as falsy and silently auto-reject a valid edge.
function isVerdict(v: unknown): v is Verdict {
  return typeof v === 'object' && v !== null && typeof (v as Verdict).supported === 'boolean';
}

export function verifyClaimsFixture(claims: VerifyClaim[]): Verdict[] {
  return claims.map(() => ({ supported: true, reason: 'fixture — plumbing only, not a real verdict' }));
}
