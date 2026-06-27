// Verification: a second Claude Code call that fact-checks one extracted
// relation against the exact quote it was based on. Catches misreads the
// extractor can make — denials ("denied funding"), wrong direction, or a quote
// that is about a different pair entirely. Returns supported true/false.

import { runClaude } from './claude.js';

export interface VerifyClaim {
  source: string;
  target: string;
  relation: string;
  directed: boolean;
  quote: string;
}

export interface Verdict {
  supported: boolean;
  reason?: string;
}

export type Verifier = (claim: VerifyClaim) => Promise<Verdict>;

export function arrow(directed: boolean): string {
  return directed ? '→' : '↔';
}

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    supported: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['supported'],
} as const;

const SYSTEM_PROMPT = [
  'You are a fact-checker for a public-transparency knowledge graph built from Israeli news.',
  'You are given ONE extracted relationship and the exact quote it was drawn from.',
  'Decide whether the quote really supports that relationship.',
  '',
  'Set supported=false when:',
  '- the quote denies or negates the relation (e.g. "הכחיש", "לא תרם", "denied funding"),',
  '- the quote is about a different pair of entities,',
  '- the direction is wrong (source and target are swapped),',
  '- the quote does not actually mention this relation.',
  'Set supported=true only when the quote clearly states or implies this exact relation',
  'between these two entities. An openly alleged relation ("לכאורה") still counts as',
  'supported — it is something the article reports.',
  'Give a one-line reason.',
].join('\n');

function userPrompt(c: VerifyClaim): string {
  return [
    'יחס שחולץ:',
    `${c.source} ${arrow(c.directed)} ${c.target}`,
    `סוג הקשר: ${c.relation} (${c.directed ? 'מכוון' : 'הדדי'})`,
    '',
    'הציטוט התומך מהכתבה:',
    `"${c.quote}"`,
    '',
    'האם הציטוט באמת תומך בקשר הזה?',
  ].join('\n');
}

export async function verifyClaim(claim: VerifyClaim): Promise<Verdict> {
  const so = (await runClaude({ prompt: userPrompt(claim), schema: SCHEMA, systemPrompt: SYSTEM_PROMPT, label: 'verify' })) as Verdict;
  if (!so || typeof so.supported !== 'boolean') {
    throw new Error('claude returned no verdict matching the schema');
  }
  return so;
}

export function verifyFixture(_claim: VerifyClaim): Verdict {
  return { supported: true, reason: 'fixture — plumbing only, not a real verdict' };
}
