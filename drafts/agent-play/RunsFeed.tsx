import { memo, useId, useMemo, useState } from 'react';
import { TokenCoin } from '../../games/rare-rush/CanonicalArt.tsx';
import { FriendSprite } from '../../games/rare-rush/RunnerArt.tsx';
import { GenesisRunnerSprite } from '../../games/rare-rush/genesis/GenesisRunnerSprite.tsx';
import { testRunArt } from '../../testnet-app/src/play/art.ts';
import { decodeRunArt, type RunRecord } from './feed-types.ts';
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
};

type EnvironmentFilter = 'all' | RunRecord['source'];
const ENVIRONMENTS = [
  ['all', 'ALL RUNS'], ['local', 'PREVIEW'], ['arcade', 'ARCADE'], ['testnet', 'TESTNET'],
] as const;
const PAGE_SIZE = 12;
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

function posterIndex(value: string) {
  let hash = 2166136261;
  for (const letter of value) hash = Math.imul(hash ^ letter.charCodeAt(0), 16777619);
  return hash >>> 0;
}

const RunCard = memo(function RunCard({ record, liked, onToggleLike, onOpen }: {
  record: RunRecord;
  liked: boolean;
  onToggleLike: RunsFeedProps['onToggleLike'];
  onOpen: RunsFeedProps['onOpen'];
}) {
  // Covers never step a replay. Decoding belongs to this mounted card, not each
  // render of the gallery or each frame of the game.
  const savedArt = useMemo(() => {
    try { return decodeRunArt(record); } catch { return undefined; }
  }, [record.art]);
  const sampleArt = useMemo(() => record.source === 'arcade'
    ? undefined : testRunArt(record.collection, record.tokenId, 'agent-play'),
  [record.source, record.collection, record.tokenId]);
  const art = savedArt ?? sampleArt;
  const title = `${collectionName(record.collection)} #${record.tokenId}`;
  const environment = environmentName(record.source);
  const index = posterIndex(record.id);
  const phase = record.metrics.phasesVisited[index % Math.max(1, record.metrics.phasesVisited.length)] ?? 'side';
  const heading = phase === 'up' ? '↑' : phase === 'down' ? '↓' : index % 2 ? '←' : '→';
  const light = index % 3 === 0;
  const hasCharacter = record.collection === 1 ? !!art?.portraitUrl : !!art?.sprites;
  const artLabel = savedArt && hasCharacter ? 'SAVED ONCHAIN ART' : sampleArt && hasCharacter ? 'SAMPLE ART' : 'ART NOT SAVED';
  const survived = record.metrics.outcome === 'survived';

  return (
    <article className="runs-feed-card" aria-label={`${title}, ${environment}, score ${count(record.metrics.score)}`} data-run-id={record.id}>
      <button type="button" className="runs-feed-cover" onClick={() => onOpen(record)} aria-label={`Watch ${title}, ${environment} run`} aria-haspopup="dialog" data-tone={light ? 'light' : 'dark'}>
        <svg className="runs-feed-poster" viewBox="0 0 360 280" aria-hidden="true" focusable="false">
          <rect width="360" height="280" fill={light ? '#fff' : '#090909'} />
          <g fill="none" stroke={light ? '#dedede' : '#292929'} strokeWidth="1">
            <path d="M0 70H360M0 140H360M0 210H360M72 0V280M144 0V280M216 0V280M288 0V280" />
            <path d="M0 280L144 140M360 280L216 140" />
          </g>
          <path d={phase === 'side' ? 'M0 237H63V222H131V237H245V215H302V237H360' : 'M39 280V166H54V81H39V0M321 280V191H306V108H321V0'} fill="none" stroke={light ? '#000' : '#fff'} strokeWidth="3" />
          <text x="277" y="181" textAnchor="middle" fill={light ? '#e3e3e3' : '#242424'} fontFamily="monospace" fontSize="142" fontWeight="bold">{heading}</text>
          <rect x="56" y="230" width="198" height="5" fill="#d6ff00" />
          <TokenCoin x={index % 2 ? 276 : 55} y={60} size={42} phase={(index % 6) / 4} />
          <TokenCoin x={index % 2 ? 62 : 283} y={174} size={27} phase={index % 3} />
          {hasCharacter ? <g transform="translate(112 82) scale(8.7)">
            {record.collection === 1 && art?.portraitUrl
              ? <GenesisRunnerSprite portraitUrl={art.portraitUrl} bodyId={art.bodyId} frame={index % 8} walking={false} />
              : art?.sprites && <FriendSprite sprites={art.sprites} frame={index % 8} walking={false} />}
          </g> : <TokenCoin x={116} y={92} size={128} />}
          <g fill={light ? '#000' : '#fff'}>
            <path d="M73 91h13v3H73zm5-5h3v13h-3zM284 221h10v2h-10zm4-4h2v10h-2z" />
          </g>
        </svg>
        <span className="runs-feed-cover-top"><span>{environment.toUpperCase()}</span><span>{durationLabel(record.metrics.elapsed)}</span></span>
        <span className="runs-feed-art-label">{artLabel}</span>
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

export function RunsFeed({ records, likes, onToggleLike, onOpen, onBack, loading, error, onRetry }: RunsFeedProps) {
  const id = useId();
  const [environment, setEnvironment] = useState<EnvironmentFilter>('all');
  const [likedOnly, setLikedOnly] = useState(false);
  const [sort, setSort] = useState<'newest' | 'score'>('newest');
  const [query, setQuery] = useState('');
  const [visible, setVisible] = useState(PAGE_SIZE);
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

      {error && <div className="runs-feed-error"><p role="alert">{error}</p><button type="button" onClick={onRetry}>RETRY RUNS</button></div>}
      {loading && <p className="runs-feed-loading" role="status">{records.length ? 'Updating saved runs…' : 'Loading saved runs…'}</p>}
      {!!filtered.length && <>
        <p className="runs-feed-showing" role="status">SHOWING {Math.min(visible, filtered.length)} OF {filtered.length} {filtered.length === 1 ? 'RUN' : 'RUNS'}</p>
        <div className="runs-feed-grid">{filtered.slice(0, visible).map(record => <RunCard key={record.id} record={record} liked={likes.has(record.id)} onToggleLike={onToggleLike} onOpen={onOpen} />)}</div>
        {visible < filtered.length && <div className="runs-feed-more"><button type="button" onClick={() => setVisible(value => value + PAGE_SIZE)}>LOAD MORE RUNS <span aria-hidden="true">↓</span></button></div>}
      </>}
      {!loading && !error && !filtered.length && <div className="runs-feed-empty">
        <span aria-hidden="true">{records.length ? '◇' : '↗'}</span>
        <h2>{!records.length ? 'YOUR NEXT RUN STARTS HERE.' : likedOnly ? 'NO LIKED RUNS HERE YET.' : 'NO MATCHING RUNS.'}</h2>
        <p>{!records.length ? 'Complete a run in Agent Play to save a score and watchable replay.' : likedOnly ? 'Like a run with its heart button, or adjust your filters.' : 'Try another collection, token ID, or environment.'}</p>
        <div>{!!records.length && <button type="button" onClick={resetFilters}>CLEAR FILTERS</button>}<button type="button" onClick={onBack}>BACK TO AGENT PLAY <span aria-hidden="true">↗</span></button></div>
      </div>}
      <p className="runs-feed-note">Illustrated covers · saved replays. Likes stay on this browser.</p>
    </section>
  );
}
