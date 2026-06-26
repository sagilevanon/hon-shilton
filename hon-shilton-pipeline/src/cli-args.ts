import { parseArgs } from 'node:util';

export function parseCli() {
  return parseArgs({
    args: process.argv.slice(2),
    allowPositionals: true,
    options: {
      db: { type: 'string' },
      limit: { type: 'string' },
      'delay-ms': { type: 'string' },
      fixture: { type: 'boolean' },
      force: { type: 'boolean' },
      'scrape-only': { type: 'boolean' },
    },
  });
}

export function firstUrl(positionals: string[], fallback: string): string {
  return positionals.find((a) => a.startsWith('http')) ?? fallback;
}
