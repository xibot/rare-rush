import { useEffect, useState } from 'react';

const KEY = 'rare-rush:agent-play:feed-likes:v1';
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-f0-9]{64}$/.test(id);
function parseLikes(raw: string | null): Set<string> {
  if (!raw) return new Set();
  const value: unknown = JSON.parse(raw);
  if (!Array.isArray(value) || value.length > 1000 || !value.every(validId)) throw new Error('Invalid local likes.');
  return new Set(value);
}

/** Private browser favorites, not counts or authenticated community votes. */
export function useFeedLikes() {
  const [likes, setLikes] = useState<ReadonlySet<string>>(() => {
    try { return parseLikes(localStorage.getItem(KEY)); } catch { return new Set(); }
  });
  const [error, setError] = useState('');
  useEffect(() => {
    const changed = (event: StorageEvent) => {
      if (event.key !== KEY && event.key !== null) return;
      try { setLikes(parseLikes(event.key === null ? null : event.newValue)); setError(''); }
      catch { /* Keep this tab's current likes if another tab stores invalid data. */ }
    };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  function toggleLike(id: string) {
    if (!validId(id)) return;
    const next = new Set(likes);
    if (next.has(id)) next.delete(id); else next.add(id);
    setLikes(next);
    try { localStorage.setItem(KEY, JSON.stringify([...next])); setError(''); }
    catch { setError('Your hearts are saved for this session. Browser storage is unavailable.'); }
  }
  return { likes, toggleLike, likesError: error };
}
