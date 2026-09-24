// Small helpers shared by every data-source fetcher (INA, MADES, ...).

export async function fetchJSON(url, ms = 20000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, { signal: ctrl.signal, headers: { 'User-Agent': 'Mozilla/5.0' } });
    clearTimeout(timer);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    clearTimeout(timer);
    return null;
  }
}

export function isoDate(d) { return d.toISOString().slice(0, 10); }
export function daysAgo(n) { const d = new Date(); d.setDate(d.getDate() - n); return isoDate(d); }
export const today = () => isoDate(new Date());

export function daysSince(dateStr) {
  if (!dateStr) return null;
  return Math.floor((Date.now() - new Date(dateStr)) / 86400000);
}

export async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let idx = 0;
  async function worker() {
    while (idx < items.length) {
      const i = idx++;
      results[i] = await fn(items[i], i);
    }
  }
  await Promise.all(Array.from({ length: limit }, worker));
  return results;
}

// Shared rising/falling/steady call: compares the mean of the earliest ~3
// points in the window against the mean of the most recent ~3, with a
// threshold scaled to the series' own baseline. `history` is
// [{date, value}], oldest first.
export function classifyTrend(history, windowDays) {
  if (!history || history.length < 2) return { history: [], trend: null, change: null, windowDays };

  const chunk = Math.max(1, Math.min(3, Math.floor(history.length / 3)));
  const early = history.slice(0, chunk);
  const recent = history.slice(-chunk);
  const earlyMean = early.reduce((a, b) => a + b.value, 0) / early.length;
  const recentMean = recent.reduce((a, b) => a + b.value, 0) / recent.length;
  const change = Math.round((recentMean - earlyMean) * 100) / 100;

  const threshold = Math.max(0.03, Math.abs(earlyMean) * 0.03);
  const trend = change > threshold ? 'rising' : change < -threshold ? 'falling' : 'steady';

  return { history, trend, change, windowDays };
}
