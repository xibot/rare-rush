import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { GenesisRush } from '../index';
import { parseGenesisIdentity, type GenesisIdentity } from './protocol';
import '@rarefriends/friendsdk/frame.css';
import './game.css';

type PendingStart = { id: number; timeout: number; resolve: () => void; reject: (error: Error) => void };

function GenesisGameSession() {
  const [identity, setIdentity] = useState<GenesisIdentity | null>(null);
  const [paused, setPaused] = useState(false);
  const [status, setStatus] = useState<'connecting' | 'ready' | 'closed' | 'error' | 'standalone'>('connecting');
  const port = useRef<MessagePort | null>(null);
  const pending = useRef<PendingStart | null>(null);
  const nextId = useRef(0);

  const beforeRun = useCallback(() => new Promise<void>((resolve, reject) => {
    const connection = port.current;
    if (!connection) { reject(new Error('Your Genesis session ended. Reconnect in the arcade.')); return; }
    if (pending.current) { reject(new Error('Your Genesis ownership check is still running.')); return; }
    const id = ++nextId.current;
    const timeout = window.setTimeout(() => {
      if (pending.current?.id !== id) return;
      pending.current = null;
      reject(new Error('Your Genesis ownership check timed out. Try again.'));
    }, 35_000);
    pending.current = { id, timeout, resolve, reject };
    try { connection.postMessage({ type: 'start', id }); }
    catch {
      window.clearTimeout(timeout); pending.current = null;
      reject(new Error('Your Genesis session ended. Reconnect in the arcade.'));
    }
  }), []);

  useEffect(() => {
    if (window.parent === window) { setStatus('standalone'); return; }
    const parentOrigin = new URL(import.meta.url).origin;
    const nonce = crypto.randomUUID();
    let alive = true, initialized = false;
    let retry: number | undefined, timeout: number | undefined;
    const stopHandshake = () => {
      window.clearInterval(retry); window.clearTimeout(timeout);
      window.removeEventListener('message', receive);
    };
    const closeConnection = () => {
      if (pending.current) {
        window.clearTimeout(pending.current.timeout);
        pending.current.reject(new Error('Your Genesis session ended. Reconnect in the arcade.'));
        pending.current = null;
      }
      if (port.current) { port.current.onmessage = null; port.current.close(); port.current = null; }
    };
    function receive(event: MessageEvent<unknown>) {
      if (!alive || initialized || event.source !== window.parent || event.origin !== parentOrigin
        || !event.data || typeof event.data !== 'object' || event.ports.length !== 1) return;
      const message = event.data as Record<string, unknown>;
      if (message.type !== 'rarerush:genesis-init' || message.nonce !== nonce) return;
      const verifiedIdentity = parseGenesisIdentity(message.identity);
      if (!verifiedIdentity) return;
      initialized = true; stopHandshake();
      const connection = event.ports[0];
      port.current = connection;
      connection.onmessage = ({ data }: MessageEvent<unknown>) => {
        if (!alive || port.current !== connection || !data || typeof data !== 'object') return;
        const response = data as Record<string, unknown>;
        if (response.type === 'close') {
          closeConnection(); setIdentity(null); setPaused(true); setStatus('closed');
        } else if (response.type === 'pause' && typeof response.paused === 'boolean') {
          setPaused(response.paused);
        } else if (response.type === 'start-result' && Number.isSafeInteger(response.id)
          && pending.current?.id === response.id && typeof response.allowed === 'boolean') {
          const request = pending.current;
          if (!request) return;
          window.clearTimeout(request.timeout); pending.current = null;
          if (response.allowed) request.resolve();
          else request.reject(new Error('Could not confirm that you still own this Genesis. Reconnect in the arcade.'));
        }
      };
      connection.start(); setIdentity(verifiedIdentity); setPaused(false); setStatus('ready');
    }
    const ready = () => window.parent.postMessage({ type: 'rarerush:genesis-ready', nonce }, parentOrigin);
    const unloading = () => { alive = false; stopHandshake(); closeConnection(); };
    window.addEventListener('message', receive);
    window.addEventListener('pagehide', unloading);
    retry = window.setInterval(ready, 500);
    timeout = window.setTimeout(() => {
      if (!alive || initialized) return;
      stopHandshake(); setStatus('error');
    }, 40_000);
    ready();
    return () => {
      alive = false; stopHandshake(); closeConnection();
      window.removeEventListener('pagehide', unloading);
    };
  }, []);

  if (identity && status === 'ready') return <GenesisRush
    friendId={BigInt(identity.tokenId)} portraitUrl={identity.image} paused={paused} beforeRun={beforeRun} />;
  return <section className="genesis-child-status" role={status === 'error' ? 'alert' : 'status'}>
    <span>RARE RUSH · GENESIS</span>
    <h1>{status === 'connecting' ? 'LOADING YOUR FRIEND…' : status === 'closed' ? 'SESSION ENDED'
      : status === 'standalone' ? 'ENTER THROUGH THE ARCADE' : 'LET’S TRY THAT AGAIN'}</h1>
    <p>{status === 'connecting' ? 'Your Genesis is getting ready to rush.' : status === 'closed'
      ? 'Your wallet or Friend changed. Use the Genesis arcade controls to connect again.'
      : status === 'standalone' ? 'Open the Genesis arcade and connect your wallet to choose your Friend.'
      : 'The game could not connect. Use the Genesis arcade controls to try again.'}</p>
  </section>;
}

createRoot(document.getElementById('root')!).render(<GenesisGameSession />);
