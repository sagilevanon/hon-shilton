// Extraction: turn an article into structured entities + relations by calling
// Claude Code HEADLESSLY (no Anthropic API SDK, no API key — uses the local
// `claude` login). Verified against claude v2.1.x:
//   claude -p "<prompt>" --output-format json --json-schema <schema> \
//          --append-system-prompt "<instructions>" --model opus
// The validated object comes back in the envelope's `structured_output` field.

import { spawn } from 'node:child_process';
import { CATEGORIES, CONFIDENCE, RELATION_VOCAB } from './taxonomy.js';
import type { ArticleInput, ExtractionResult } from './types.js';

const MODEL = process.env.GRAPH_EXTRACT_MODEL ?? 'opus';
const TIMEOUT_MS = Number(process.env.GRAPH_EXTRACT_TIMEOUT_MS ?? 360_000);

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    entities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          canonical_name: { type: 'string' },
          type: { type: 'string', enum: ['person', 'organization'] },
          subtype: { type: ['string', 'null'] },
          aliases: { type: 'array', items: { type: 'string' } },
          qid: { type: ['string', 'null'] },
          description: { type: ['string', 'null'] },
        },
        required: ['canonical_name', 'type'],
      },
    },
    relations: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          source: { type: 'string' },
          target: { type: 'string' },
          relation: { type: 'string' },
          category: { type: 'string', enum: [...CATEGORIES] },
          raw_phrase: { type: ['string', 'null'] },
          directed: { type: 'boolean' },
          confidence: { type: 'string', enum: [...CONFIDENCE] },
          quote: { type: 'string' },
        },
        required: ['source', 'target', 'relation', 'category', 'directed', 'confidence', 'quote'],
      },
    },
  },
  required: ['entities', 'relations'],
} as const;

function systemPrompt(): string {
  const vocab = (Object.keys(RELATION_VOCAB) as (keyof typeof RELATION_VOCAB)[])
    .map((cat) => `  ${cat}: ${RELATION_VOCAB[cat].join(', ')}`)
    .join('\n');
  return [
    'You extract a knowledge graph from Israeli news articles for a public-transparency project.',
    'Given ONE article, return only entities and relationships the article itself states or clearly implies.',
    '',
    'ENTITIES — real people and organizations named in the article:',
    '- canonical_name: full canonical HEBREW name (e.g. "בנימין נתניהו", not "ביבי" or "ראש הממשלה").',
    '- type: "person" or "organization".',
    '- subtype (organizations only, optional): company | ngo | political_party | government_body | media_outlet.',
    '- aliases: other names/nicknames/titles (Hebrew and English), e.g. ["ביבי","Netanyahu"].',
    '- qid: Wikidata QID ONLY if confident (e.g. "Q42993"), else null. World knowledge is allowed for name/aliases/qid.',
    '- description: one short Hebrew line, optional.',
    '',
    'RELATIONSHIPS — directed binary links between two entities, referenced by their canonical_name:',
    '- relation: pick the BEST term from this controlled vocabulary; if none fits, use "אחר":',
    vocab,
    '- category: the matching category above, or "אחר".',
    '- raw_phrase: when relation="other" (or to preserve nuance), the short phrasing from the text.',
    '- directed: true for asymmetric relations (owns, donated_to, parent_of); false for mutual ones',
    '  (spouse_of, sibling_of, relative_of, business_partner, allied_with).',
    '- confidence: "high" if stated as fact, "med" if clearly implied, "low" if alleged/uncertain.',
    '- quote: the VERBATIM sentence (or minimal span) from the article body supporting the relation. Mandatory.',
    '',
    'RULES:',
    '- Base relationships ONLY on THIS article\'s text, never outside knowledge. The quote must truly support the relation.',
    '- Direction: source is the actor (owner/funder/parent/employer), target is the object.',
    '- Never emit a relationship you cannot ground in a real quote. Prefer fewer, well-supported links over speculation.',
    '- Skip incidental mentions that carry no relationship.',
  ].join('\n');
}

function userPrompt(a: ArticleInput): string {
  const tags = a.tags?.length ? `\nתגיות (רמזים לישויות): ${a.tags.join(', ')}\n` : '\n';
  return `חלץ ישויות ויחסים מכתבת ה-ynet הבאה.\nכותרת: ${a.title}${tags}\nגוף הכתבה:\n${a.body}`;
}

export async function extractWithClaude(article: ArticleInput): Promise<ExtractionResult> {
  const args = [
    '-p',
    userPrompt(article),
    '--output-format',
    'json',
    '--json-schema',
    JSON.stringify(SCHEMA),
    '--append-system-prompt',
    systemPrompt(),
    '--model',
    MODEL,
  ];

  return new Promise((resolve, reject) => {
    const proc = spawn('claude', args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
    let out = '';
    let err = '';
    const timer = setTimeout(() => {
      proc.kill('SIGKILL');
      reject(new Error(`claude extraction timed out after ${TIMEOUT_MS}ms`));
    }, TIMEOUT_MS);

    proc.stdout.on('data', (d) => (out += d));
    proc.stderr.on('data', (d) => (err += d));
    proc.on('error', (e) => {
      clearTimeout(timer);
      reject(new Error(`failed to spawn claude (is the CLI installed/on PATH?): ${e.message}`));
    });
    proc.on('close', (code) => {
      clearTimeout(timer);
      if (code !== 0) return reject(new Error(`claude exited ${code}: ${(err || out).slice(0, 600)}`));
      let envelope: { structured_output?: ExtractionResult; result?: string };
      try {
        envelope = JSON.parse(out);
      } catch (e) {
        return reject(new Error(`could not parse claude JSON output: ${(e as Error).message}`));
      }
      const so = envelope.structured_output;
      if (!so || !Array.isArray(so.entities) || !Array.isArray(so.relations)) {
        return reject(new Error('claude returned no structured_output matching the schema'));
      }
      resolve(so);
    });
  });
}

// Deterministic, deliberately-synthetic output for plumbing verification only
// (no Claude Code call). Logged loudly by the caller; never real extraction.
export function extractFixture(_article: ArticleInput): ExtractionResult {
  return {
    entities: [
      {
        canonical_name: 'בנימין נתניהו',
        type: 'person',
        aliases: ['ביבי', 'Benjamin Netanyahu'],
        qid: 'Q42993',
        description: 'ראש ממשלת ישראל',
      },
      {
        canonical_name: 'הליכוד',
        type: 'organization',
        subtype: 'political_party',
        qid: 'Q133235',
        description: 'מפלגה פוליטית בישראל',
      },
    ],
    relations: [
      {
        source: 'בנימין נתניהו',
        target: 'הליכוד',
        relation: 'חבר ב',
        category: 'פוליטי',
        directed: true,
        confidence: 'high',
        quote: '(fixture — לא חולץ מהכתבה; לאימות הצנרת בלבד)',
      },
    ],
  };
}
