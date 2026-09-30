import { createRoot } from 'react-dom/client';
import { GameHost } from '@rarefriends/friendsdk/runtime';
import { parseChanceGame } from '@rarefriends/friendsdk/game';
import { createArcadePublicClient } from '../arcade-client';
import gameJson from '../game.json';
import '@rarefriends/friendsdk/frame.css';
import '@rarefriends/friendsdk/runtime.css';
import '../host.css';

// The SDK still owns connection, discovery, eligibility and the sandbox bridge.
// Supply its supported publicClient override for Robinhood's history range cap.
createRoot(document.getElementById('root')!).render(<GameHost definition={parseChanceGame(gameJson)}
  frameUrl="./game.html" publicClient={createArcadePublicClient()}/>);
