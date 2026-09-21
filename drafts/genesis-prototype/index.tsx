import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrandMark } from '../../games/rare-rush/BrandMark';
import { GenesisRunnerSprite } from '../../games/rare-rush/genesis/GenesisRunnerSprite';
import { GENESIS_BODIES, pickGenesisBody } from '../../games/rare-rush/genesis/bodies';
import portrait from './portrait.json';
import './style.css';

const POSES = ['idle', 'run', 'jump', 'slide'] as const;
type Pose = typeof POSES[number];
const prefersReducedMotion = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

function GenesisLab() {
  const [bodyId, setBodyId] = useState(() => pickGenesisBody());
  const [pose, setPose] = useState<Pose>(() => prefersReducedMotion() ? 'idle' : 'run');
  const [paused, setPaused] = useState(prefersReducedMotion);
  const [elapsed, setElapsed] = useState(0);
  const clock = useRef(0);
  const film = useRef<HTMLDivElement>(null);
  const body = GENESIS_BODIES.find(candidate => candidate.id === bodyId)!;
  const frame = Math.floor(elapsed * 12 / 1000) % 8;
  const jump = pose === 'jump' ? Math.round(Math.sin((elapsed % 1400) / 1400 * Math.PI) * 36) : 0;

  useEffect(() => {
    if (paused) return;
    let animation = 0;
    let last = performance.now();
    let lastPaint = last;
    const tick = (now: number) => {
      clock.current += Math.min(100, now - last);
      last = now;
      if (now - lastPaint >= 1000 / 24) {
        setElapsed(clock.current);
        lastPaint = now;
      }
      animation = requestAnimationFrame(tick);
    };
    animation = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(animation);
  }, [paused]);

  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const reduceMotion = () => { if (media.matches) setPaused(true); };
    const leavePage = () => { if (document.hidden) setPaused(true); };
    media.addEventListener('change', reduceMotion);
    document.addEventListener('visibilitychange', leavePage);
    return () => {
      media.removeEventListener('change', reduceMotion);
      document.removeEventListener('visibilitychange', leavePage);
    };
  }, []);

  function choosePose(next: Pose) {
    clock.current = 0;
    setElapsed(0);
    setPose(next);
    setPaused(false);
  }

  function downloadSprites() {
    const frames = film.current?.querySelectorAll('svg');
    if (!frames || frames.length !== 8) return;
    const namespace = 'http://www.w3.org/2000/svg';
    const sheet = document.createElementNS(namespace, 'svg');
    sheet.setAttribute('width', '1280');
    sheet.setAttribute('height', '160');
    sheet.setAttribute('viewBox', '0 0 160 20');
    sheet.setAttribute('shape-rendering', 'crispEdges');
    const title = document.createElementNS(namespace, 'title');
    title.textContent = `Genesis 1 run cycle with ${body.familyName} Friend ${body.tokenId} body — Rare Rush by XIBOT; original artwork by Rare Friends`;
    sheet.append(title);
    frames.forEach((frameSvg, index) => {
      const cell = document.createElementNS(namespace, 'g');
      cell.setAttribute('transform', `translate(${index * 20 + 2} 2)`);
      for (const child of frameSvg.children) cell.append(child.cloneNode(true));
      sheet.append(cell);
    });
    const blob = new Blob([new XMLSerializer().serializeToString(sheet)], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `genesis-1-body-${body.tokenId}-run-sprites.svg`;
    document.body.append(link);
    link.click();
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  return <div className="genesis-lab" id="top" data-body-id={bodyId} data-pose={pose} data-paused={paused}>
    <a className="lab-skip" href="#lab-title">Skip to the showcase</a>
    <header className="lab-header">
      <a className="lab-logo" href="/" aria-label="Rare Rush by Xibot home"><BrandMark/></a>
      <nav aria-label="Main navigation"><a href="/">HOME</a><a href="/pitch/">PITCH</a><a className="lab-play" href="/genesis/">PLAY GENESIS ↗</a></nav>
    </header>
    <main>
      <section className="lab-intro" aria-labelledby="lab-title"><span className="lab-kicker">ORIGINAL PORTRAIT. NEW MOVES.</span><h1 id="lab-title">GENESIS <em>IN MOTION.</em></h1><p>Your Genesis face. A fresh body each run. Same rare energy.</p><span className="lab-badge">INTERACTIVE SHOWCASE · NO WALLET NEEDED</span></section>
      <div className="lab-showcase">
        <section className="lab-panel lab-portrait-panel" aria-labelledby="original-title"><h2 className="lab-panel-heading" id="original-title">01 / ORIGINAL GENESIS #1</h2><div className="lab-original-stage"><img src={portrait.image} width="112" height="112" alt="The unchanged original Genesis number 1 portrait"/></div><p className="lab-caption">Original on-chain portrait.<br/>Same pixels. Same colors.</p></section>
        <section className="lab-panel" aria-labelledby="animation-title"><div className="lab-panel-heading"><h2 id="animation-title">02 / GENESIS RUNNER</h2><span className="lab-action-label">{pose === 'slide' ? 'SLIDE / ½ HEIGHT' : `${pose.toUpperCase()} →`}</span></div>
          <svg className="lab-stage" viewBox="0 0 420 190" role="img" aria-label={`Genesis number 1 with a ${body.familyName} body, ${pose === 'idle' ? 'standing' : pose === 'run' ? 'running' : pose === 'jump' ? 'jumping' : 'sliding at half height'}${paused ? ', paused' : ''}.`}>
            <defs><pattern id="lab-floor" width="10" height="6" patternUnits="userSpaceOnUse" patternTransform={`translate(${pose === 'run' || pose === 'slide' ? -Math.floor(elapsed / 50) * 2 : 0} 0)`}><rect width="10" height="6" fill="#222"/><path d="M0 0h3v6H0z" fill="#fff"/></pattern></defs>
            <rect x={170 + jump / 2} y="163" width={80 - jump} height="2" fill="#777"/>
            <g transform={`translate(146 ${44 - jump}) scale(8)`}><g data-slide-squeeze={pose === 'slide'} transform={pose === 'slide' ? 'translate(0 7.5) scale(1 .5)' : undefined}><GenesisRunnerSprite portraitUrl={portrait.image} bodyId={bodyId} frame={frame} walking={pose !== 'idle'}/></g></g>
            <path d="M0 165h420" stroke="#fff" strokeWidth="2"/><rect y="167" width="420" height="6" fill="url(#lab-floor)"/>
          </svg>
          <div className="lab-body-controls"><div className="lab-body-caption" aria-live="polite"><strong>BODY / {body.familyName.toUpperCase()} #{body.tokenId}</strong><span>{GENESIS_BODIES.length} body options · one look per run</span></div><button type="button" onClick={() => setBodyId(previous => pickGenesisBody(previous))}>NEW BODY ↻</button></div>
          <div className="lab-controls" role="group" aria-label="Choose sprite animation">{POSES.map(action => <button type="button" key={action} aria-pressed={pose === action} onClick={() => choosePose(action)}>{action.toUpperCase()}</button>)}<button type="button" aria-pressed={paused} onClick={() => setPaused(value => !value)}>{paused ? 'PLAY' : 'PAUSE'}</button></div>
        </section>
      </div>
      <p className="lab-instruction"><strong>TRY THE MOVES →</strong> Tap a move. Slide squeezes the whole Friend. NEW BODY rolls another look; pause lets you inspect it.</p>
      <section className="lab-film-section" aria-labelledby="frames-title"><div className="lab-film-heading"><h2 id="frames-title">RUN CYCLE / 8 FRAMES</h2><button className="lab-download" type="button" onClick={downloadSprites}>DOWNLOAD SPRITES ↗</button></div><div className="lab-film" ref={film}>{Array.from({ length: 8 }, (_, index) => <figure key={index}><svg viewBox="-2 -2 20 20" role="img" aria-label={`Genesis run frame ${index + 1}`}><GenesisRunnerSprite portraitUrl={portrait.image} bodyId={bodyId} frame={index} walking/></svg><figcaption>0{index + 1}</figcaption></figure>)}</div></section>
      <div className="lab-features">
        <section><h2><span>01</span>GENESIS AT HEART</h2><p>Your original portrait stays yours. The runner combines that artwork with a Generations body, without changing your NFT.</p></section>
        <section><h2><span>02</span>NEW RUN. NEW BODY.</h2><p>Each run picks from {GENESIS_BODIES.length} compatible bodies, skipping the previous one. The body stays with you through every move, coin, and comeback.</p></section>
        <section><h2><span>03</span>SQUEEZE PAST</h2><p>Slide squeezes the whole Friend to duck under obstacles. Bodies are cosmetic: the same collision area, movement rules, and rewards apply to every look.</p></section>
      </div>
      <aside className="lab-next"><div><h2>MEET YOUR NEXT RUN.</h2><p>This showcase uses sample Genesis #1 and earns no rewards. Connect your own Genesis in the arcade for free entry and 100× simulated token rewards.</p></div><a href="/genesis/">PLAY YOUR GENESIS ↗</a></aside>
    </main>
    <footer className="lab-footer"><p>Genesis runner adaptation by XIBOT. Original portrait and body artwork by <a href="https://rarefriends.com/">Rare Friends</a>. This page uses the same body pool and sprite renderer as the Genesis arcade.</p><a href="/docs/">READ RARE RUSH 101 ↗</a></footer>
  </div>;
}

createRoot(document.getElementById('root')!).render(<GenesisLab/>);
