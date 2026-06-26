const USER_AGENT = 'Mozilla/5.0 (HonShilton research bot; +contact: admin@wotch.health)';
const TIMEOUT_MS = 25_000;

export async function fetchText(url: string): Promise<string> {
  const res = await fetch(url, {
    headers: { 'User-Agent': USER_AGENT },
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.text();
}
