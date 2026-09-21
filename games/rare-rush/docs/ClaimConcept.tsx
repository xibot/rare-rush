import { decodeGenerationSprites, type GenerationSpriteManifest } from '@rarefriends/friendsdk/sprites';
import { getWorldPreset, renderWorld } from '@rarefriends/friendsdk/world';
import { CanonicalProp, TokenCoin } from '../CanonicalArt';
import { FriendSprite } from '../RunnerArt';
import cachedArt from '../landing/preview-art.json';

const friends = [cachedArt.friends[5], cachedArt.friends[0]].map(source => decodeGenerationSprites(
  BigInt(source.tokenId), source.familyId, source.seed, source.frames.map(BigInt),
  cachedArt.provenance.manifest as GenerationSpriteManifest,
));
const island = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(renderWorld(getWorldPreset('06-orbital-hex-complete')))}`;

function CollectArt() {
  return <svg className="claim-concept-art" viewBox="0 60 472 476" aria-hidden="true" focusable="false">
    <image href={island} x={-107} y={72} width={629} height={472}/>
    <g transform="translate(49 315) scale(10.625)"><FriendSprite sprites={friends[0]} frame={3} walking/></g>
    <TokenCoin x={238} y={310} size={74}/><TokenCoin x={332} y={266} size={64}/><TokenCoin x={407} y={236} size={58}/>
    <path d="M133 319q91-96 256-126" stroke="#ccff00" strokeWidth={2} fill="none" strokeDasharray="6 9"/>
    <path d="M24 489h425" stroke="#fff" strokeWidth={2}/>
    <path d="M34 503h34m20 0h34m20 0h34m20 0h34m20 0h34m20 0h34m20 0h34m20 0h34" stroke="#fff" strokeWidth={7}/>
  </svg>;
}

function SurviveArt() {
  return <svg className="claim-concept-art" viewBox="0 60 472 476" aria-hidden="true" focusable="false">
    <text x={236} y={210} textAnchor="middle" fill="#ccff00" fontFamily="var(--rush-font-display)" fontSize={110}>00:01</text>
    <path d="M77 250h319" stroke="#777" strokeWidth={3}/><path d="M77 250h18" stroke="#ccff00" strokeWidth={7}/>
    <g transform="translate(136 344) scale(9.125)"><FriendSprite sprites={friends[1]} frame={3} walking/></g>
    <CanonicalProp type="crate" x={323} y={410} width={87} height={79}/>
    <path d="M24 489h425" stroke="#fff" strokeWidth={2}/>
    <path d="M183 338q66-58 158 4" fill="none" stroke="#ccff00" strokeDasharray="6 9" strokeWidth={2}/>
    <path d="M383 332h20m-10-10v20" stroke="#ccff00" strokeWidth={4}/>
  </svg>;
}

function UnlockArt() {
  return <svg className="claim-concept-art" viewBox="0 60 472 476" aria-hidden="true" focusable="false">
    <path d="M142 233V139h23v-23h108v23h23v28" stroke="#ccff00" strokeWidth={16} fill="none" shapeRendering="crispEdges"/>
    <path d="M78 247h315v209H78z" fill="#000" stroke="#fff" strokeWidth={3}/>
    <TokenCoin x={140} y={257} size={190}/>
    <path d="M40 202h26m-13-13v26M410 396h24m-12-12v24" stroke="#ccff00" strokeWidth={4}/>
  </svg>;
}

export function ClaimConcept() {
  return <section className="claim-concept" id="survive-to-claim" aria-labelledby="claim-concept-title">
    <span className="status-tag">PLANNED CLAIM MECHANIC · NOT LIVE</span>
    <h3 id="claim-concept-title">Survive. Then <span>claim.</span></h3>
    <p className="claim-concept-intro">The proposed twist: your coins build the reward. Finishing the timer unlocks the claim.</p>
    <ol className="claim-concept-grid">
      <li><span className="claim-concept-step">01 / THE RUN</span><CollectArt/><div className="claim-concept-caption"><h4>Collect coins.</h4><p>Build your run’s reward, one pickup at a time.</p></div></li>
      <li><span className="claim-concept-step">02 / THE CHALLENGE</span><SurviveArt/><div className="claim-concept-caption"><h4>Survive the timer.</h4><p>Reach zero with at least one heart left.</p></div></li>
      <li><span className="claim-concept-step">03 / THE REWARD</span><UnlockArt/><div className="claim-concept-caption"><h4>Unlock the claim.</h4><p>Complete the run, pass verification, claim your earned RARERUSH.</p></div></li>
    </ol>
    <p className="claim-concept-rule"><strong>The stakes:</strong> under this proposed rule, losing all your hearts would forfeit that run’s claim.</p>
    <p className="claim-concept-current"><strong>Playing today?</strong> Your collected demo rewards stay in this session, even if you lose all your hearts. Real token claims aren’t live yet.</p>
  </section>;
}
