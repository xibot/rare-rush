import { useCallback, useId, useMemo, useState } from 'react';
import type { RunRecord } from './feed-types.ts';
import { RunPreview } from './RunPreview.tsx';
import { planReplayPreviews } from './preview-plan.ts';
import type { ReplayPreviewCandidate } from './replay-preview.ts';
import './runs-feed.css';
import './leaderboard.css';

export type LeaderboardProps = {
  records: RunRecord[];
  loading: boolean;
  error?: string;
  onRetry: () => void;
  onOpen: (record: RunRecord) => void;
  onBrowseFeed: () => void;
  publicFeed?: boolean;
};

type DifficultyFilter = 'all' | RunRecord['difficulty'];
const DIFFICULTIES = ['all', 'easy', 'normal', 'degen'] as const;
const count = (value: number) => Math.max(0, Math.floor(value)).toLocaleString('en-US');
const environmentName = (source: RunRecord['source']) => source === 'local' ? 'PREVIEW' : source.toUpperCase();
const friendName = (record: RunRecord) => `${record.collection === 1 ? 'GENESIS' : 'GENERATIONS'} #${record.tokenId}`;

export function Leaderboard({ records, loading, error, onRetry, onOpen, onBrowseFeed, publicFeed = false }: LeaderboardProps) {
  const id = useId();
  const [difficulty, setDifficulty] = useState<DifficultyFilter>('all');
  const [catalogues, setCatalogues] = useState<ReadonlyMap<string, readonly ReplayPreviewCandidate[]>>(() => new Map());
  const receiveCandidates = useCallback((runId: string, candidates: readonly ReplayPreviewCandidate[]) => {
    setCatalogues(previous => previous.get(runId) === candidates ? previous : new Map(previous).set(runId, candidates));
  }, []);
  const ranked = useMemo(() => {
    const seen = new Set<string>();
    return records.filter(record => difficulty === 'all' || record.difficulty === difficulty)
      .sort((a, b) => b.metrics.score - a.metrics.score
        || (Date.parse(b.createdAt) || 0) - (Date.parse(a.createdAt) || 0)
        || a.id.localeCompare(b.id))
      .filter(record => {
        const friend = `${record.source}:${record.collection}:${record.tokenId}`;
        if (seen.has(friend)) return false;
        seen.add(friend);
        return true;
      });
  }, [records, difficulty]);
  const previewPlan = useMemo(() => planReplayPreviews(ranked, catalogues), [ranked, catalogues]);

  return <section className="rush-leaderboard" aria-labelledby={`${id}-title`}>
    <header className="leaderboard-heading">
      <div><p>{publicFeed ? 'PEOPLE. AGENTS. PERSONAL BESTS.' : 'YOUR FRIENDS. THEIR BEST RUNS.'}</p><h1 id={`${id}-title`}>LEADER<span>BOARD.</span></h1></div>
      <button type="button" className="leaderboard-feed-link" onClick={onBrowseFeed}>RUNS FEED <span aria-hidden="true">↗</span></button>
    </header>
    <p className="leaderboard-intro">Every Friend has a best run. Find the score to chase, then watch how it happened.</p>

    <section className="leaderboard-board" aria-labelledby={`${id}-best`}>
      <div className="leaderboard-section-heading">
        <div><p>ONE FRIEND. ONE BEST RUN.</p><h2 id={`${id}-best`}>BEST OF THE <span>RUSH.</span></h2></div>
        <span className="leaderboard-total">{count(records.length)} SAVED {records.length === 1 ? 'RUN' : 'RUNS'}</span>
      </div>
      <div className="leaderboard-toolbar">
        <div className="leaderboard-filters" role="group" aria-label="Leaderboard difficulty">
          {DIFFICULTIES.map(mode => <button key={mode} type="button" aria-pressed={difficulty === mode}
            onClick={() => setDifficulty(mode)}>{mode.toUpperCase()}</button>)}
        </div>
        <p>{publicFeed ? 'Best per Friend and environment among the loaded public runs.' : 'Best saved run per Friend and environment. Scheduled agent runs appear here too.'}</p>
      </div>

      {error && <div className="leaderboard-error"><p role="alert">{error}</p><button type="button" onClick={onRetry}>RETRY RUNS</button></div>}
      {loading && <p className="leaderboard-loading" role="status">{records.length ? 'Updating the leaderboard…' : 'Loading saved runs…'}</p>}
      {!!ranked.length && <>
        <div className="leaderboard-columns" aria-hidden="true"><span>RANK</span><span>REPLAY</span><span>FRIEND / RUN</span><span>POINTS</span><span>WATCH</span></div>
        <ol className="leaderboard-list" aria-label="Best saved runs by score">
          {ranked.map((record, index) => <li key={record.id} className="leaderboard-row" data-run-id={record.id}>
            <span className="leaderboard-rank" aria-label={`Rank ${index + 1}`}>{String(index + 1).padStart(2, '0')}</span>
            <button type="button" className="leaderboard-thumbnail" onClick={() => onOpen(record)} aria-haspopup="dialog"
              aria-label={`Watch ${friendName(record)}, ${environmentName(record.source)} ${record.difficulty} run`}>
              <RunPreview record={record} animate={false} candidateKey={previewPlan.get(record.id)} onCandidates={receiveCandidates} />
              <span className="leaderboard-thumbnail-play" aria-hidden="true">▶</span>
            </button>
            <div className="leaderboard-friend"><h3>{friendName(record)}</h3>
              <p><span>{environmentName(record.source)}</span><span>{record.difficulty.toUpperCase()}</span></p>
              <small data-outcome={record.metrics.outcome}>{record.metrics.outcome === 'survived' ? 'SURVIVED' : 'OUT OF HEARTS'}{record.agentJobId ? ' · AGENT JOB' : ''}</small>
            </div>
            <div className="leaderboard-score"><strong>{count(record.metrics.score)}</strong><span>POINTS</span></div>
            <button type="button" className="leaderboard-watch" onClick={() => onOpen(record)} aria-haspopup="dialog"
              aria-label={`Watch ${friendName(record)} replay`}>WATCH <span aria-hidden="true">↗</span></button>
          </li>)}
        </ol>
      </>}
      {!loading && !error && !ranked.length && <div className="leaderboard-empty">
        <span aria-hidden="true">→ ↑ ↓ ←</span>
        <h3>{records.length ? 'A NEW PACE. A NEW BEST.' : 'THE NEXT BEST RUN COULD BE YOURS.'}</h3>
        <p>{records.length ? `No saved ${difficulty} runs yet. Try another difficulty to see more Friends.` : 'Complete a run in Arcade, Testnet or Agent Play, then choose SAVE RUN.'}</p>
        <div>{records.length > 0 && <button type="button" onClick={() => setDifficulty('all')}>SHOW ALL MODES</button>}
          <button type="button" onClick={onBrowseFeed}>BROWSE RUNS FEED <span aria-hidden="true">↗</span></button></div>
      </div>}
      <p className="leaderboard-note">{publicFeed ? 'Ranked by recorded points from the public runs loaded here. This is not an all-time global ranking.' : 'Ranked by recorded points from your saved run library.'} Watch any run to see its full replay.</p>
    </section>
  </section>;
}
