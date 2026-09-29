import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { createRoot } from 'react-dom/client';
import { FreeRush } from '../index';
import { FriendSprite } from '../RunnerArt';
import { SiteHeader } from '../SiteHeader';
import { SiteFooter } from '../SiteFooter';
import { SAMPLE_FRIENDS } from './samples';
import '../navigation.css';
import './free-play.css';

function FreePlayPage() {
  const [selected, setSelected] = useState<number | null>(null);
  const [worldWidth, setWorldWidth] = useState(960);
  const game = useRef<HTMLDivElement>(null);
  const pickerHeading = useRef<HTMLHeadingElement>(null);
  const didChoose = useRef(false);

  useEffect(() => {
    if (selected === null) {
      if (didChoose.current) pickerHeading.current?.focus({ preventScroll: true });
      return;
    }
    const element = game.current;
    if (!element) return;
    element.focus({ preventScroll: true });
    const observer = new ResizeObserver(([entry]) => setWorldWidth(entry.contentRect.width <= 600 ? 520 : 960));
    observer.observe(element);
    return () => observer.disconnect();
  }, [selected]);

  function chooseFriend() {
    // Unmounting also releases the previous run's inputs, audio, and animation.
    setSelected(null);
  }

  return <div className="free-play-page">
    <a className="free-play-skip" href="#free-play-main">Skip to Free Play</a>
    <SiteHeader page="free-play"/>
    <main className="free-play-main" id="free-play-main" tabIndex={-1}>
      <div className="free-play-hero">
        <div><span className="free-play-kicker">YOU’RE THE PLAYER</span><h1>FREE <span>PLAY</span></h1></div>
        <p>No wallet. Just rush.</p>
      </div>
      {selected === null ? <section className="free-play-picker" aria-labelledby="sample-heading">
        <div className="free-play-picker-heading"><h2 id="sample-heading" ref={pickerHeading} tabIndex={-1}>Choose a sample Friend</h2><p>Pick a look. Every Friend plays the same.</p></div>
        <div className="free-play-samples">
          {SAMPLE_FRIENDS.map((friend, index) => <button type="button" key={friend.label} data-testid="sample-friend" onClick={() => { didChoose.current = true; setSelected(index); }}>
            <span className="free-play-sample-art"><svg viewBox="-3 -3 22 22" aria-hidden="true"><FriendSprite sprites={friend.sprites} frame={0}/></svg></span>
            <span className="free-play-sample-label">{friend.label}</span>
            <span className="free-play-sample-action" aria-hidden="true">CHOOSE <span>↗</span></span>
          </button>)}
        </div>
        <p className="free-play-sample-note">Public sample artwork. Play with your keyboard or the on-screen touch controls.</p>
      </section> : <div className="free-play-game" ref={game} tabIndex={-1} aria-label={`${SAMPLE_FRIENDS[selected].label} selected. Free Play game.`} style={{ '--free-world-ratio': `${worldWidth} / 500` } as CSSProperties}>
        <FreeRush sprites={SAMPLE_FRIENDS[selected].sprites} onChooseFriend={chooseFriend} onNavigate={destination => { if (destination === 'friends') chooseFriend(); else window.location.assign('/'); }}/>
      </div>}
    </main>
    <SiteFooter/>
  </div>;
}

createRoot(document.getElementById('root')!).render(<FreePlayPage/>);
