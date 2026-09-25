/** Shared site chrome. Only fixed project-owned copy and URLs enter this markup. */
export function siteFooterMarkup(site: 'main' | 'testnet' = 'main'): string {
  const main = site === 'testnet' ? 'https://rarerush.app' : '';
  const note = site === 'testnet'
    ? 'Play to mint with test NFTs on Robinhood testnet.<br>All tokens are valueless test assets. Wallet transactions use test ETH.'
    : 'Arcade rewards are simulated. Nothing is minted or charged in Arcade.<br>Play with your Genesis or eligible Generations NFT on Robinhood Chain.';
  return `<div class="rush-site-footer-shell"><footer class="rush-site-footer">
    <div class="rush-site-footer-copy"><b>RARE RUSH BY <a class="rush-footer-highlight" href="https://x.com/xavieriturralde" target="_blank" rel="noopener noreferrer">XIBOT</a> / VIBEATHON BUILD</b><p>${note}</p></div>
    <nav class="rush-site-footer-links" aria-label="Footer navigation">
      <a class="rush-footer-highlight" href="${main}/pitch/">RARE RUSH PITCH ↗</a>
      <a class="rush-footer-highlight" href="${main}/docs/">RARE RUSH DOCS ↗</a>
      <a href="https://github.com/spokesz/friendsdk">BUILT WITH FRIENDSDK ↗</a>
      <a href="https://rarefriends.com/">ART &amp; WORLD BY RARE FRIENDS ↗</a>
    </nav>
  </footer></div>`;
}
