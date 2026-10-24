// Coalesce the inbox + summary fetch made together by every client. Invalidation
// discards the promise too: a late old query cannot repopulate a newer snapshot.
const entries = new Map<string, { until: number; value: Promise<unknown> }>();
export function cachedInbox<T>(key: string, load: () => Promise<T>): Promise<T> {
  const previous = entries.get(key);
  if (previous && previous.until > Date.now()) return previous.value as Promise<T>;
  if (entries.size >= 500) entries.delete(entries.keys().next().value!);
  const entry = { until: Date.now() + 1500, value: load() };
  entries.set(key, entry);
  entry.value.catch(() => { if (entries.get(key) === entry) entries.delete(key); });
  return entry.value;
}
export function invalidateInbox(userId?: string, supportPresence = false) {
  for (const key of entries.keys()) {
    if (supportPresence || key.startsWith("admin:") || key === `member:${userId}`) entries.delete(key);
  }
}
