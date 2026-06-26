import { Edge } from '@/types';

// The five relation categories (+ "other"), mirroring the pipeline taxonomy.
// id gives a DOM-safe handle (Hebrew keys can't be SVG marker ids); color drives
// edge stroke, the filter legend, and the edge panel chip. key === Hebrew label.
export interface CategoryMeta {
  key: string;
  id: string;
  color: string;
}

export const CATEGORIES: CategoryMeta[] = [
  { key: 'משפחה', id: 'fam', color: '#E07A9B' },
  { key: 'כספים', id: 'fin', color: '#5FB87A' },
  { key: 'מקצועי', id: 'pro', color: '#59A9C9' },
  { key: 'פוליטי', id: 'pol', color: '#B58BD6' },
  { key: 'משפטי', id: 'leg', color: '#E0A93D' },
  { key: 'אחר', id: 'oth', color: '#9B9580' },
];

const BY_KEY = new Map(CATEGORIES.map((c) => [c.key, c]));
const FALLBACK = CATEGORIES[CATEGORIES.length - 1];

export const categoryMeta = (key?: string): CategoryMeta => (key ? BY_KEY.get(key) : undefined) ?? FALLBACK;
export const categoryColor = (key?: string): string => categoryMeta(key).color;

export const edgeKey = (e: Edge): string => String(e.id ?? `${e.source}-${e.target}-${e.relation}`);
