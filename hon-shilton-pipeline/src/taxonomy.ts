// The controlled relation vocabulary (Hebrew) — the durable contract shared by
// the extraction prompt, validation, and the display layer. Grouped by category;
// anything that doesn't fit uses category 'אחר' with the raw phrase preserved.

export const CATEGORIES = ['משפחה', 'כספים', 'מקצועי', 'פוליטי', 'משפטי', 'אחר'] as const;
export type Category = (typeof CATEGORIES)[number];

export const RELATION_VOCAB: Record<Exclude<Category, 'אחר'>, string[]> = {
  'משפחה': ['בן/בת זוג של', 'הורה של', 'ילד/ה של', 'אח/אחות של', 'קרוב/ת משפחה של'],
  'כספים': ['בעלים של', 'שולט ב', 'בעל מניות ב', 'תרם ל', 'מימן את', 'השקיע ב', 'הלווה ל', 'שילם ל'],
  'מקצועי': ['מועסק על ידי', 'עובד ב', 'ייסד את', 'חבר דירקטוריון ב', 'יו״ר של', 'מנכ״ל של', 'שותף עסקי של', 'יועץ ל'],
  'פוליטי': ['חבר ב', 'מינה את', 'מונה על ידי', 'בעל ברית של', 'שר ב', 'ח״כ מטעם'],
  'משפטי': ['מייצג את', 'תבע את', 'נחקר על ידי', 'הואשם על ידי', 'מפקח על'],
};

// Inherently mutual relations: stored once, rendered undirected.
export const SYMMETRIC_RELATIONS = new Set<string>([
  'בן/בת זוג של',
  'אח/אחות של',
  'קרוב/ת משפחה של',
  'שותף עסקי של',
  'בעל ברית של',
]);

export const CONFIDENCE = ['low', 'med', 'high'] as const;
export type Confidence = (typeof CONFIDENCE)[number];

export function categoryOf(relation: string): Category {
  for (const cat of Object.keys(RELATION_VOCAB) as Exclude<Category, 'אחר'>[]) {
    if (RELATION_VOCAB[cat].includes(relation)) return cat;
  }
  return 'אחר';
}
