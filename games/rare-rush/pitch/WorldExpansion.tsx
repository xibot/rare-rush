import { decodeGenerationSprites, type GenerationSpriteManifest } from '@rarefriends/friendsdk/sprites';
import { getWorldPreset, renderWorld } from '@rarefriends/friendsdk/world';
import { CanonicalProp, TokenCoin } from '../CanonicalArt';
import { FriendSprite } from '../RunnerArt';
import cachedArt from '../landing/preview-art.json';

// Static compositions of the same canonical artwork used in the social concept
// board. Captions remain HTML so they reflow and stay readable on small screens.
const friends = [5, 0, 6].map((index) => {
  const source = cachedArt.friends[index];
  return decodeGenerationSprites(BigInt(source.tokenId), source.familyId, source.seed,
    source.frames.map(BigInt), cachedArt.provenance.manifest as GenerationSpriteManifest);
});
const islands = ['06-orbital-hex', '04-rooftop-terrace', '05-tidal-islands', '03-crystal-mesa', '02-circuit-courtyard']
  .map((preset) => `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderWorld(getWorldPreset(`${preset}-complete`)))}`);

function Island({ x, y, width, index }: { x: number; y: number; width: number; index: number }) {
  return <image href={islands[index]} x={x} y={y} width={width} height={width * .75}/>;
}

function Friend({ x, y, size, index = 0, frame = 3, flip = false }: { x: number; y: number; size: number; index?: number; frame?: number; flip?: boolean }) {
  return <g transform={`translate(${x} ${y}) ${flip ? `translate(${size} 0) scale(-1 1)` : ''} scale(${size / 16})`}><FriendSprite sprites={friends[index]} frame={frame} walking/></g>;
}

function Arrow({ x, y, rotate = 0 }: { x: number; y: number; rotate?: number }) {
  return <g transform={`translate(${x} ${y}) rotate(${rotate})`} fill="none" stroke="#ccff00" strokeWidth="3"><path d="M-11 0h22M4-8l8 8-8 8"/></g>;
}

function PathArt() {
  return <svg className="pitch-world-art" viewBox="0 70 472 519" aria-hidden="true" focusable="false">
    <Island x={26} y={77} width={440} index={0}/>
    <Island x={-225} y={270} width={520} index={1}/>
    <Island x={191} y={325} width={435} index={2}/>
    <path d="M216 227v108M132 401l84-66 110 90M216 335v151" fill="none" stroke="#ccff00" strokeWidth="2" strokeDasharray="5 7"/>
    <Friend x={161} y={288} size={92}/>
    <Arrow x={216} y={247} rotate={270}/><Arrow x={132} y={401} rotate={150}/><Arrow x={326} y={425} rotate={30}/><Arrow x={216} y={489} rotate={90}/>
  </svg>;
}

function StakesArt() {
  return <svg className="pitch-world-art" viewBox="0 70 472 519" aria-hidden="true" focusable="false">
    <Island x={-100} y={30} width={660} index={3}/>
    <CanonicalProp type="bridge" x={268} y={288} width={153} height={80}/>
    <CanonicalProp type="crystal" x={260} y={415} width={94} height={115}/>
    <CanonicalProp type="crate" x={387} y={442} width={89} height={80}/>
    <path d="M23 524h446M31 542h446" stroke="#fff" strokeWidth="2"/>
    <path d="M36 532h40m20 0h40m20 0h40m20 0h40m20 0h40m20 0h40m20 0h40" stroke="#fff" strokeWidth="6"/>
    <Friend x={91} y={315} size={124} index={1}/>
    <TokenCoin x={202} y={340} size={45}/><TokenCoin x={252} y={304} size={45}/><TokenCoin x={305} y={301} size={45}/>
    <path d="M118 300q50-86 129-89" stroke="#ccff00" strokeDasharray="5 8" fill="none" strokeWidth="2"/>
  </svg>;
}

function BossArt() {
  return <svg className="pitch-world-art" viewBox="0 70 472 519" aria-hidden="true" focusable="false">
    <Island x={-50} y={298} width={590} index={4}/>
    <path d="M95 122h295" stroke="#fff" strokeWidth="17"/>
    <path d="M104 122h195" stroke="#ccff00" strokeWidth="9"/>
    <Friend x={182} y={213} size={249} index={2} frame={0} flip/>
    <Friend x={33} y={409} size={105}/>
    <path d="M142 402l22-30-14 35 29-8M114 286h20m-10-10v20" fill="none" stroke="#ccff00" strokeWidth="3"/>
  </svg>;
}

export function WorldExpansion() {
  return <section className="pitch-worlds" id="future-worlds" aria-labelledby="worlds-title">
    <div className="pitch-section-heading">
      <div><span className="pitch-kicker">05 / IMAGINE THE NEXT RUN</span><h2 id="worlds-title">The world<br/>gets <em>bigger.</em></h2></div>
      <div className="pitch-world-intro"><span className="pitch-status">FUTURE CONCEPTS</span><p>Right, up, down, and surprise leftward runs are already playable. These concepts go further: player-chosen routes, new stages, and bosses.</p></div>
    </div>
    <div className="pitch-world-grid">
      <article><span className="pitch-card-index">01 / BRANCHING WORLDS</span><PathArt/><div className="pitch-world-caption"><h3>Choose your path.</h3><p>Today the track changes direction for you. A future version could let you choose routes between floating lands.</p></div></article>
      <article><span className="pitch-card-index">02 / NEW CHALLENGES</span><StakesArt/><div className="pitch-world-caption"><h3>Raise the stakes.</h3><p>Tougher stages, new obstacles, and trickier combinations that put your timing to the test.</p></div></article>
      <article><span className="pitch-card-index">03 / BIG ENCOUNTERS</span><BossArt/><div className="pitch-world-caption"><h3>Meet the boss.</h3><p>A bigger kind of rush. Boss encounters could give your Friend a whole new challenge.</p></div></article>
    </div>
  </section>;
}
