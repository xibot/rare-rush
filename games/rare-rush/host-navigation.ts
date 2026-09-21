import { parseArcadeNavigation } from './navigation';
import { syncFriendPortraits, cleanupFriendPortraits } from './host-portraits';

/** Site chrome for the outer SDK host. Wallet, ownership and gameplay stay in FriendSDK. */
function enhanceGenerationsEntry(): void {
  const root = document.getElementById('root');
  if (!root) return;

  const update = () => {
    let pickerOpen = false;
    for (const frame of root.querySelectorAll<HTMLElement>('.rf-game-frame')) {
      let framePickerOpen = false;
      for (const menu of frame.querySelectorAll<HTMLElement>('.rf-frame-menu')) {
        const isPicker = menu.querySelector('.rf-frame-menu-heading h2')?.textContent?.trim() === 'Choose your Friend';
        menu.classList.toggle('rush-generations-menu', isPicker);
        if (!isPicker) {
          menu.querySelectorAll('.rush-generations-chrome, .rush-generations-caption').forEach(node => node.remove());
          continue;
        }
        pickerOpen = framePickerOpen = true;
        if (!menu.querySelector('.rush-generations-chrome')) {
          const chrome = document.createElement('div');
          chrome.className = 'rush-generations-chrome';
          // Static, project-owned markup only. No wallet or RPC values enter HTML.
          chrome.innerHTML = `<header class="rush-entry-header"><a class="rush-entry-logo" href="/" aria-label="Rare Rush by Xibot home"><img src="/favicon.svg" width="44" height="44" alt=""><span>RARE<span>RUSH</span><small>BY XIBOT</small></span></a><nav aria-label="Main navigation"><a href="/pitch/">PITCH</a><a href="/docs/">DOCS ↗</a></nav></header><div class="rush-entry-intro"><a class="rush-entry-collection" href="/arcade/">← CHOOSE COLLECTION</a><span class="rush-entry-kicker">THE NEXT GENERATION. THE SAME RUSH.</span><h1>Generations<br><span>unlocked.</span></h1><p>Bring your hardwired Generations Friend. Pick your mode. Make the run yours.</p></div>`;
          menu.prepend(chrome);
        }
        if (!menu.querySelector('.rush-generations-caption')) {
          const caption = document.createElement('p');
          caption.className = 'rush-generations-caption';
          caption.textContent = 'FriendSDK verifies your Generations NFT on Robinhood Chain. Generation 1 or later is required. Runs cost 1 demo RF; all fees and rewards are simulated. No transaction or signature is required.';
          menu.append(caption);
        }
        syncFriendPortraits(menu);
      }
      frame.classList.toggle('rush-generations-frame', framePickerOpen);
    }
    document.body.classList.toggle('rush-generations-selecting', pickerOpen);
    if (!pickerOpen) cleanupFriendPortraits();
  };

  const navigate = (event: MessageEvent<unknown>) => {
    const destination = parseArcadeNavigation(event.data);
    const frame = root.querySelector<HTMLIFrameElement>('.rf-frame-viewport > iframe');
    if (!destination || !frame?.contentWindow || event.source !== frame.contentWindow || event.origin !== 'null') return;
    if (destination === 'home') window.location.assign('/');
    else root.querySelector<HTMLButtonElement>('.rf-frame-toolbar button[aria-label="Choose Friend"]')?.click();
  };
  window.addEventListener('message', navigate);
  const observer = new MutationObserver(update);
  const observe = () => { observer.observe(root, { childList: true, characterData: true, subtree: true }); update(); };
  observe();
  window.addEventListener('pagehide', () => { observer.disconnect(); cleanupFriendPortraits(); window.removeEventListener('message', navigate); });
  window.addEventListener('pageshow', event => { if (event.persisted) { window.addEventListener('message', navigate); observe(); } });
}

if (window.self === window.top && /^\/play(?:\/|$)/.test(window.location.pathname)) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enhanceGenerationsEntry, { once: true });
  else enhanceGenerationsEntry();
}
