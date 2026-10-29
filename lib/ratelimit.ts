// Minimal in-memory sliding-window limiter. Replace with Upstash/Redis if you run several instances.
const hits = new Map<string, number[]>();

export function rateLimit(key: string, limit = 60, windowMs = 60_000): boolean {
  const now = Date.now();
  if (!hits.has(key) && hits.size >= 5000) {
    // All callers use the same default window. Preserve live buckets at capacity.
    for (const [k, v] of hits) if (v.every((t) => now - t >= Math.max(windowMs, 60_000))) hits.delete(k);
    if (hits.size >= 5000) return false;
  }
  const recent = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= limit) {
    hits.set(key, recent);
    return false;
  }
  recent.push(now);
  hits.set(key, recent);

  if (hits.size > 5000) {
    for (const [k, v] of hits) if (v.every((t) => now - t >= windowMs)) hits.delete(k);
  }
  return true;
}
