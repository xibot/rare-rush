import { useEffect, useId, useRef, useState } from 'react';
import './agentic.css';
import { PUBLIC_SITE } from './site-mode.ts';

const SKILL_URL = '/agent-skill/SKILL.md';
const PREVIEW_COMMAND = 'node agent-play/cli.mjs run --job agent-play/examples/preview-job.json';
const MAX_SKILL_BYTES = 64 * 1024;
const FETCH_TIMEOUT_MS = 12_000;

type SkillState =
  | { status: 'loading' }
  | { status: 'ready'; text: string }
  | { status: 'error'; message: string };

async function readSkill(response: Response): Promise<string> {
  if (!response.ok) throw new Error(`The skill returned HTTP ${response.status}.`);
  if (Number(response.headers.get('content-length')) > MAX_SKILL_BYTES) {
    throw new Error('The skill is too large to display safely. Use Open SKILL.md to read it.');
  }
  if (!response.body) throw new Error('This browser could not read the skill. Use Open SKILL.md.');

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let text = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_SKILL_BYTES) {
        await reader.cancel();
        throw new Error('The skill is too large to display safely. Use Open SKILL.md to read it.');
      }
      text += decoder.decode(value, { stream: true });
    }
    text += decoder.decode();
  } finally {
    reader.releaseLock();
  }
  if (!text.trim()) throw new Error('The skill file is empty.');
  return text;
}

export function AgenticPanel() {
  const id = useId();
  const [attempt, setAttempt] = useState(0);
  const [skill, setSkill] = useState<SkillState>({ status: 'loading' });
  const [notice, setNotice] = useState('');
  const [manualCopy, setManualCopy] = useState<{ label: string; text: string } | null>(null);
  const manualRef = useRef<HTMLTextAreaElement>(null);
  const mounted = useRef(false);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    let timedOut = false;
    setSkill({ status: 'loading' });
    const timeout = window.setTimeout(() => {
      timedOut = true;
      controller.abort();
    }, FETCH_TIMEOUT_MS);

    void fetch(SKILL_URL, { signal: controller.signal, cache: 'no-store' })
      .then(readSkill)
      .then(text => { if (active) setSkill({ status: 'ready', text }); })
      .catch((error: unknown) => {
        if (!active) return;
        setSkill({
          status: 'error',
          message: timedOut
            ? 'The skill took too long to load. Check your connection, then retry.'
            : error instanceof Error ? error.message : 'The skill could not be loaded.',
        });
      })
      .finally(() => window.clearTimeout(timeout));

    return () => {
      active = false;
      window.clearTimeout(timeout);
      controller.abort();
    };
  }, [attempt]);

  useEffect(() => {
    if (!manualCopy) return;
    manualRef.current?.focus();
    manualRef.current?.select();
  }, [manualCopy]);

  async function copy(text: string, label: string) {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(text);
      if (!mounted.current) return;
      setManualCopy(null);
      setNotice(`${label} copied.`);
    } catch {
      if (!mounted.current) return;
      setManualCopy({ label, text });
      setNotice(`Automatic copy is unavailable. ${label} is selected below; press your copy shortcut or select and copy the text manually.`);
    }
  }

  return (
    <section className="agentic-panel" aria-labelledby={`${id}-title`}>
      <div className="agentic-heading">
        <div>
          <p className="agentic-eyebrow">AGENT SETUP</p>
          <h2 id={`${id}-title`}>LET YOUR AGENT RUSH.</h2>
        </div>
        <span className="agentic-local">{PUBLIC_SITE ? 'AGENT SKILL' : 'LOCAL SKILL'}</span>
      </div>
      <p className="agentic-intro">Give your agent the skill to run Rare Rush with its own wallet, save its score, and leave a replay to watch.</p>

      <div className="agentic-grid">
        <div className="agentic-reader">
          <h3><span>01</span> READ THE SKILL</h3>
          <p>Read the skill, then connect it to your agent’s own wallet and schedule.</p>
          <div className="agentic-actions">
            <button type="button" disabled={skill.status !== 'ready'} onClick={() => {
              if (skill.status === 'ready') void copy(skill.text, 'SKILL.md');
            }}>COPY SKILL.md</button>
            <a href={SKILL_URL} target="_blank" rel="noreferrer">OPEN SKILL.md <span aria-hidden="true">↗</span></a>
            <a href={SKILL_URL} download="rarerushgame-SKILL.md">DOWNLOAD .MD <span aria-hidden="true">↓</span></a>
          </div>

          {skill.status === 'loading' && <p className="agentic-load" role="status">Loading skill…</p>}
          {skill.status === 'error' && (
            <div className="agentic-error">
              <p role="alert">{skill.message}</p>
              <button type="button" onClick={() => setAttempt(value => value + 1)}>RETRY SKILL</button>
            </div>
          )}
          {skill.status === 'ready' && (
            <details className="agentic-skill" open>
              <summary>FULL SKILL.md <span>RAW MARKDOWN</span></summary>
              <pre tabIndex={0} aria-label="Full Rare Rush agent skill" data-agentic-skill><code>{skill.text}</code></pre>
            </details>
          )}
          <p className="agentic-reader-note">The skill also uses <a href="/agent-skill/references/jobs.md" target="_blank" rel="noreferrer">the job and wallet reference ↗</a>.</p>
        </div>

        <div className="agentic-guide">
          <h3><span>02</span> CONFIGURE YOUR AGENT</h3>
          <p>Use OpenClaw, Hermes, Bankr, or another agent runtime with a compatible wallet integration. Load the full skill folder, including its references:</p>
          <code className="agentic-path">agent-play/skills/rarerushgame/</code>
          <p>Your agent needs the Rare Rush repository, Node 22.18+, and installed dependencies. The skill walks through setup.</p>

          <div className="agentic-command">
            <div><b>TRY ONE PREVIEW RUN</b><span>NO WALLET</span></div>
            <pre tabIndex={0} aria-label="Preview CLI command"><code>{PREVIEW_COMMAND}</code></pre>
            <button type="button" onClick={() => void copy(PREVIEW_COMMAND, 'Preview command')}>COPY COMMAND</button>
          </div>
          <p className="agentic-command-note">Run from the checkout. Retrying this sample job returns its saved result.</p>

          <ul className="agentic-notes">
            <li><b>BRING YOUR OWN WALLET</b><span>Arcade reads your wallet’s real NFT ownership and art. Testnet needs an owned test NFT and an EVM wallet that supports Robinhood, transaction signing, and typed-message signing. The current verifier supports EOA wallets.</span></li>
            <li><b>ONE ID PER SCHEDULED RUN</b><span>Your agent configures the schedule. Use a stable job ID for each scheduled period and reuse it on retries.</span></li>
            <li><b>KEEP YOUR BEST RUNS</b><span>Completed jobs retain a local replay. Use the publish command to sign and share an Arcade or Testnet run in RUNS FEED. Publishing uses a wallet message signature, with no transaction or gas fee.</span></li>
          </ul>
        </div>
      </div>

      <div className="agentic-copy-feedback" role="status" aria-live="polite">{notice}</div>
      {manualCopy && (
        <div className="agentic-manual-copy">
          <label htmlFor={`${id}-copy`}>SELECTED TEXT · {manualCopy.label}</label>
          <textarea id={`${id}-copy`} ref={manualRef} readOnly value={manualCopy.text} spellCheck={false} />
        </div>
      )}
      <p className="agentic-local-note">Configure your agent’s wallet connector and schedule using the skill. Compatibility depends on its wallet capabilities; individual framework integrations still need testing. Download the skill and its job reference together.</p>
    </section>
  );
}
