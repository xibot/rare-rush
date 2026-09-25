import { memo, useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import type { RunRecord } from './feed-types.ts';
import { RunPreview } from './RunPreview.tsx';
import './runs-feed.css';

export type RunsFeedProps = {
  records: RunRecord[];
  likes: ReadonlySet<string>;
  onToggleLike: (id: string) => void;
  onOpen: (record: RunRecord) => void;
  onBack: () => void;
  loading: boolean;
  error?: string;
  onRetry: () => void;
  previewsPaused?: boolean;
};

type EnvironmentFilter = 'all' | RunRecord['source'];
const ENVIRONMENTS = [
  ['all', 'ALL RUNS'], ['local', 'PREVIEW'], ['arcade', 'ARCADE'], ['testnet', 'TESTNET'],
] as const;
const PAGE_SIZE = 12;
const MAX_ANIMATED_PREVIEWS = 4;
const environmentName = (source: RunRecord['source']) => source === 'local' ? 'Preview' : source === 'arcade' ? 'Arcade' : 'Testnet';
const collectionName = (collection: RunRecord['collection']) => collection === 1 ? 'Genesis' : 'Generations';
const count = (value: number) => Math.max(0, Math.floor(value)).toLocaleString('en-US');

function durationLabel(seconds: number) {
  const elapsed = Math.max(0, Math.floor(seconds));
  return `${Math.floor(elapsed / 60)}:${String(elapsed % 60).padStart(2, '0')}`;
}

function savedTime(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Saved run' : date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

const RunCard = memo(function RunCard({ record, liked, animate, onToggleLike, onOpen }: {
  record: RunRecord;
  liked: boolean;
  animate: boolean;
  onToggleLike: RunsFeedProps['onToggleLike'];
  onOpen: RunsFeedProps['onOpen'];
}) {
  const title = `${collectionName(record.collection)} #${record.tokenId}`;
  const environment = environmentName(record.source);
  const survived = record.metrics.outcome === 'survived';

  return (
    <article className="runs-feed-card" aria-label={`${title}, ${environment}, score ${count(record.metrics.score)}`} data-run-id={record.id}>
      <button type="button" className="runs-feed-cover" onClick={() => onOpen(record)} aria-label={`Watch ${title}, ${environment} run`} aria-haspopup="dialog" data-preview-id={record.id} data-preview-animated={animate}>
        <RunPreview record={record} animate={animate} />
        <span className="runs-feed-cover-top"><span>{environment.toUpperCase()}</span><span>{durationLabel(record.metrics.elapsed)}</span></span>
        <span className="runs-feed-preview-label">GAMEPLAY PREVIEW</span>
        <span className="runs-feed-watch"><svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5 3 13 8 5 13Z" fill="currentColor" /></svg> WATCH REPLAY</span>
      </button>

      <div className="runs-feed-card-body">
        <div className="runs-feed-card-title">
          <button type="button" onClick={() => onOpen(record)} aria-label={`Open ${title} run details`} aria-haspopup="dialog">{title}</button>
          <button type="button" className="runs-feed-like" aria-pressed={liked} aria-label={`Like run ${title}`} title={liked ? 'Remove like on this browser' : 'Like on this browser'} onClick={() => onToggleLike(record.id)}>
            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20.5 3.9 12.4C-1.5 7 6.3.2 12 6.1 17.7.2 25.5 7 20.1 12.4Z" fill={liked ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" /></svg>
          </button>
        </div>
        <div className="runs-feed-run-meta"><span>{record.difficulty.toUpperCase()}</span><span data-outcome={record.metrics.outcome}>{survived ? 'SURVIVED' : 'OUT OF HEARTS'}</span></div>
        <div className="runs-feed-card-score"><span>SCORE<strong>{count(record.metrics.score)}</strong></span><span>{count(record.metrics.coins)} COINS<small>{count(record.metrics.distance)} m</small></span></div>
        <time dateTime={record.createdAt}>{savedTime(record.createdAt)}</time>
      </div>
    </article>
  );
});

export function RunsFeed({ records, likes, onToggleLike, onOpen, onBack, loading, error, onRetry, previewsPaused = false }: RunsFeedProps) {
  const id = useId();
  const [environment, setEnvironment] = useState<EnvironmentFilter>('all');
  const [likedOnly, setLikedOnly] = useState(false);
  const [sort, setSort] = useState<'newest' | 'score'>('newest');
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);
  const [previewsEnabled, setPreviewsEnabled] = useState(true);
  const [reducedMotion, setReducedMotion] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  const [pageVisible, setPageVisible] = useState(() => !document.hidden);
  const [visibleCovers, setVisibleCovers] = useState<ReadonlySet<string>>(() => new Set());
  const grid = useRef<HTMLDivElement>(null);
  const actions = useRef({ onOpen, onToggleLike });
  actions.current = { onOpen, onToggleLike };
  const openRun = useCallback((record: RunRecord) => actions.current.onOpen(record), []);
  const toggleLike = useCallback((runId: string) => actions.current.onToggleLike(runId), []);
  const filtered = useMemo(() => {
    const terms = query.toLowerCase().replace(/#/g, '').trim().split(/\s+/).filter(Boolean);
    return records.filter(record => {
      if (environment !== 'all' && record.source !== environment) return false;
      if (likedOnly && !likes.has(record.id)) return false;
      const searchable = `${collectionName(record.collection)} ${record.tokenId}`.toLowerCase();
      return terms.every(term => searchable.includes(term));
    }).sort((a, b) => {
      const scoreOrder = sort === 'score' ? b.metrics.score - a.metrics.score : 0;
      return scoreOrder || (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0) || a.id.localeCompare(b.id);
    });
  }, [records, environment, likedOnly, likes, query, sort]);
  const shownRecords = filtered.slice(0, visible);
  const shownIds = shownRecords.map(record => record.id).join(',');
  const motionEnabled = previewsEnabled && !reducedMotion;
  const animatedIds = new Set(shownRecords.filter(record => visibleCovers.has(record.id))
    .slice(0, MAX_ANIMATED_PREVIEWS).map(record => record.id));

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const motionChanged = () => setReducedMotion(media.matches);
    const visibilityChanged = () => setPageVisible(!document.hidden);
    motionChanged();
    visibilityChanged();
    media.addEventListener('change', motionChanged);
    document.addEventListener('visibilitychange', visibilityChanged);
    return () => {
      media.removeEventListener('change', motionChanged);
      document.removeEventListener('visibilitychange', visibilityChanged);
    };
  }, []);

  useEffect(() => {
    setVisibleCovers(previous => previous.size ? new Set() : previous);
    if (!grid.current || typeof IntersectionObserver === 'undefined') return;
    const inView = new Set<string>();
    let active = true;
    const observer = new IntersectionObserver(entries => {
      if (!active) return;
      for (const entry of entries) {
        const runId = (entry.target as HTMLElement).dataset.previewId;
        if (!runId) continue;
        if (entry.isIntersecting && entry.intersectionRatio >= .25) inView.add(runId);
        else inView.delete(runId);
      }
      setVisibleCovers(previous => previous.size === inView.size && [...previous].every(runId => inView.has(runId))
        ? previous : new Set(inView));
    }, { threshold: .25 });
    grid.current.querySelectorAll<HTMLElement>('[data-preview-id]').forEach(cover => observer.observe(cover));
    return () => { active = false; observer.disconnect(); };
  }, [shownIds]);

  function resetFilters() {
    setEnvironment('all');
    setLikedOnly(false);
    setQuery('');
    setVisible(PAGE_SIZE);
  }

  return (
    <section className="runs-feed" aria-labelledby={`${id}-title`}>
      <button type="button" className="runs-feed-back" onClick={onBack}><span aria-hidden="true">←</span> AGENT PLAY</button>
      <div className="runs-feed-heading">
        <div><p>SAVED RUNS · LIKES ON THIS BROWSER</p><h1 id={`${id}-title`}>RUNS <span>FEED.</span></h1></div>
        <span className="runs-feed-total">{count(records.length)} SAVED</span>
      </div>
      <p className="runs-feed-intro">Every locally saved run, wins and losses. Open one to watch its replay.</p>

      <div className="runs-feed-toolbar">
        <div className="runs-feed-filters" role="group" aria-label="Filter runs by environment">
          {ENVIRONMENTS.map(([value, label]) => <button key={value} type="button" aria-pressed={environment === value} onClick={() => { setEnvironment(value); setVisible(PAGE_SIZE); }}>{label}</button>)}
        </div>
        <button type="button" className="runs-feed-liked-filter" aria-pressed={likedOnly} onClick={() => { setLikedOnly(value => !value); setVisible(PAGE_SIZE); }}><span aria-hidden="true">♥</span> LIKED</button>
        <div className="runs-feed-search-sort">
          <label className="runs-feed-search">FIND A FRIEND<input type="search" value={query} onChange={event => { setQuery(event.target.value); setVisible(PAGE_SIZE); }} placeholder="Genesis #73" /></label>
          <label className="runs-feed-sort">SORT BY<select value={sort} onChange={event => { setSort(event.target.value as 'newest' | 'score'); setVisible(PAGE_SIZE); }}><option value="newest">Newest first</option><option value="score">Highest score</option></select></label>
        </div>
      </div>

      <div className="runs-feed-preview-controls">
        <button type="button" aria-label="ANIMATED PREVIEWS" aria-pressed={motionEnabled} disabled={reducedMotion}
          aria-describedby={reducedMotion ? `${id}-motion-note` : undefined}
          onClick={() => setPreviewsEnabled(value => !value)}>
          <span aria-hidden="true">{motionEnabled ? 'Ⅱ' : '▶'}</span> ANIMATED PREVIEWS <b aria-hidden="true">{motionEnabled ? 'ON' : 'OFF'}</b>
        </button>
        {reducedMotion && <p id={`${id}-motion-note`}>Motion is off in your system settings.</p>}
      </div>

      {error && <div className="runs-feed-error"><p role="alert">{error}</p><button type="button" onClick={onRetry}>RETRY RUNS</button></div>}
      {loading && <p className="runs-feed-loading" role="status">{records.length ? 'Updating saved runs…' : 'Loading saved runs…'}</p>}
      {!!filtered.length && <>
        <p className="runs-feed-showing" role="status">SHOWING {Math.min(visible, filtered.length)} OF {filtered.length} {filtered.length === 1 ? 'RUN' : 'RUNS'}</p>
        <div ref={grid} className="runs-feed-grid">{shownRecords.map(record => <RunCard key={record.id} record={record} liked={likes.has(record.id)}
          animate={motionEnabled && !previewsPaused && pageVisible && animatedIds.has(record.id)} onToggleLike={toggleLike} onOpen={openRun} />)}</div>
        {visible < filtered.length && <div className="runs-feed-more"><button type="button" onClick={() => setVisible(value => value + PAGE_SIZE)}>LOAD MORE RUNS <span aria-hidden="true">↓</span></button></div>}
      </>}
      {!loading && !error && !filtered.length && <div className="runs-feed-empty">
        <span aria-hidden="true">{records.length ? '◇' : '↗'}</span>
        <h2>{!records.length ? 'YOUR NEXT RUN STARTS HERE.' : likedOnly ? 'NO LIKED RUNS HERE YET.' : 'NO MATCHING RUNS.'}</h2>
        <p>{!records.length ? 'Complete a run in Agent Play to save a score and watchable replay.' : likedOnly ? 'Like a run with its heart button, or adjust your filters.' : 'Try another collection, token ID, or environment.'}</p>
        <div>{!!records.length && <button type="button" onClick={resetFilters}>CLEAR FILTERS</button>}<button type="button" onClick={onBack}>BACK TO AGENT PLAY <span aria-hidden="true">↗</span></button></div>
      </div>}
      <p className="runs-feed-note">Short gameplay previews · full saved replays. Likes stay on this browser.</p>
    </section>
  );
}
