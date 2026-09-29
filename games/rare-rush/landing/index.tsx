import { useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { TokenCoin } from '../CanonicalArt';
import { SiteHeader } from '../SiteHeader';
import { SiteFooter } from '../SiteFooter';
import PreviewRun from './PreviewRun';
import { DIFFICULTIES, DIFFICULTY_ORDER } from '../difficulty';
import './landing.css';

function Landing() {
  useEffect(() => {
    // Cross-page fragment navigation happens before React creates the section.
    // Restore it after the content and fonts have established the final layout.
    const hash = window.location.hash;
    if (!hash) return;
    let id: string;
    try { id = decodeURIComponent(hash.slice(1)); } catch { return; }
    const target = document.getElementById(id);
    if (!target) return;
    let cancelled = false;
    void document.fonts.ready.then(() => {
      if (!cancelled && window.location.hash === hash) {
        target.scrollIntoView({ block: 'start', behavior: 'instant' });
      }
    });
    return () => { cancelled = true; };
  }, []);

  return <>
    <SiteHeader page="landing"/>
    <div className="rush-landing">

    <main>
      <section className="landing-hero" aria-labelledby="hero-title">
        <div className="hero-copy">
          <div className="landing-eyebrow"><span/> A LITTLE FRIEND. A LONG WAY TO GO.</div>
          <h1 id="hero-title"><span className="hero-small">SMALL FRIEND.</span><span>BIG RUSH.</span></h1>
          <p>Floating worlds. Bear coins. One big rush.<br/>Easy, Normal or Degen. How hard will you rush?</p>
          <div className="landing-actions">
            <a className="landing-cta" href="./free-play/">FREE PLAY <span aria-hidden="true">↗</span></a>
            <a className="landing-cta landing-cta-wallet" href="./arcade/#collections">PLAY ARCADE <span aria-hidden="true">↗</span></a>
          </div>
          <small className="entry-caption">Free Play: no wallet, just rush.<br/>Arcade: connect with your Genesis or Generations.</small>
        </div>
        <div className="hero-preview" id="preview">
          <div className="preview-caption"><span><i/> WATCH THE RARE TWIST</span><span>01 / THE ENDLESS WORLD</span></div>
          <PreviewRun/>
          <div className="preview-bottom-note"><span>YOUR NEXT RUN COULD BE BIGGER.</span><span>3 MODES. INFINITE AGAIN.</span></div>
        </div>
      </section>

      <section className="landing-mode-strip" aria-label="Difficulty options"><span>CHOOSE YOUR RUSH<br/><small>TIME / DEMO REWARDS PER COIN</small></span>{DIFFICULTY_ORDER.map(key => <div key={key}><b>{DIFFICULTIES[key].label}</b><span>{DIFFICULTIES[key].seconds}s · {DIFFICULTIES[key].rewardLabel}</span></div>)}</section>
      <section className="landing-rules" id="how-to-play" aria-label="How to play Rare Rush">
        <article><div className="rule-number">01 / GET MOVING</div><h2>Jump. Duck. Rush.</h2><p>Clear crystals and slide under bridges.<br/>{' '}Tap twice to double jump.</p><div className="rule-keys"><kbd>SPACE</kbd><span>JUMP</span><kbd>↓</kbd><span>SLIDE</span></div></article>
        <article><div className="rule-number">02 / GET BIGGER</div><h2>Coins make you grow.</h2><p>Collect bear coins and grow your Friend. Watch for giant flying coins: 2× the size, 10× the demo rewards. An obstacle hit brings you back down.</p><div className="rule-visual"><svg viewBox="0 0 30 30" aria-hidden="true"><TokenCoin size={30}/></svg><span>COLLECT</span><b>↗</b><span>GROW</span></div></article>
        <article><div className="rule-number">03 / GO YOUR WAY</div><h2>Find your pace.</h2><p>Speed up for distance. Slow down to line up<br/>{' '}your next jump. Three hearts. Make it count.</p><div className="rule-keys"><kbd>←</kbd><span>SLOW</span><kbd>→</kbd><span>FAST</span><small>TOUCH CONTROLS TOO</small></div></article>
      </section>
      <div className="landing-play-note"><span>BUILT FOR YOUR PHONE. READY FOR YOUR DESKTOP.</span><a href="./arcade/">YOUR TURN <span>↗</span></a></div>
    </main>

  </div>
  <SiteFooter/></>;
}

createRoot(document.getElementById('root')!).render(<Landing/>);
