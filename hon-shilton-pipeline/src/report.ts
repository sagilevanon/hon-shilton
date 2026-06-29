import { IngestOutcome, type IngestReport } from './pipeline.js';
import { summarize, type OutcomeCounts } from './feed.js';

const LABELS: Record<IngestOutcome, string> = {
  [IngestOutcome.Ingested]: 'ingested ',
  [IngestOutcome.Cached]: 'cached   ',
  [IngestOutcome.PremiumSkipped]: 'premium  ',
  [IngestOutcome.ScrapeOnly]: 'scraped  ',
  [IngestOutcome.Irrelevant]: 'off-topic',
  [IngestOutcome.Error]: 'error    ',
};

export function logReport(report: IngestReport, index?: number, total?: number): void {
  const position = index != null && total != null ? `(${index + 1}/${total}) ` : '';
  console.log(`${position}[${LABELS[report.outcome]}] ${describe(report)}  ${report.url}`);
}

export function printSummary(reports: IngestReport[]): void {
  const counts = summarize(reports);
  console.log(`\ndone: ${reports.length} items — ${formatCounts(counts)}`);
}

function describe(report: IngestReport): string {
  const title = report.title ? `«${report.title}» ` : '';
  if (report.outcome === IngestOutcome.Ingested) {
    return `${title}${report.entities} entities, ${report.relations} relations`;
  }
  const reason = report.reason ?? '';
  if (title && reason) return `${title}— ${reason}`;
  return `${title}${reason}`.trim();
}

function formatCounts(counts: OutcomeCounts): string {
  return Object.values(IngestOutcome)
    .filter((outcome) => counts[outcome] > 0)
    .map((outcome) => `${outcome}: ${counts[outcome]}`)
    .join(', ');
}
