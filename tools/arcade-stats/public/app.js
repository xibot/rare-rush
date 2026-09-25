'use strict';
const $ = selector => document.querySelector(selector);
const number = value => new Intl.NumberFormat('en-US').format(value);
const date = value => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
const checkedTime = value => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value));
const views = {
  arcade: { title: 'Arcade', source: 'client-reported-arcade-events', days: '7', version: null, secondary: 'completedRuns', fields: ['uniquePlayers', 'startedRuns', 'completedRuns', 'survivedRuns', 'lostRuns', 'unfinishedRuns'], labels: ['Wallets', 'Started', 'Finished', 'Survived', 'Lost', 'Unfinished'] },
  testnet: { title: 'Testnet', source: 'onchain-testnet-runs', days: 'all', version: 'all', secondary: 'claimedRuns', fields: ['uniquePlayers', 'startedRuns', 'claimedRuns', 'abandonedRuns', 'openRuns', 'expiredRuns', 'unresolvedRuns'], labels: ['Wallets', 'Started', 'Claimed', 'Abandoned', 'Open', 'Expired', 'Unresolved'] },
};
let selectedGame = location.hash === '#testnet' ? 'testnet' : 'arcade';
const cache = new Map();
let current = null;
let loading = false;
let activeRequest = 0;
let activeAbort;
const viewKey = () => `${selectedGame}:${views[selectedGame].days}:${views[selectedGame].version ?? ''}`;

function cell(value, header = false) {
  const node = document.createElement(header ? 'th' : 'td');
  if (header) node.scope = 'row';
  node.textContent = typeof value === 'number' ? number(value) : value;
  return node;
}
function rows(target, entries, fields) {
  const fragment = document.createDocumentFragment();
  for (const [name, counts] of entries) {
    const row = document.createElement('tr');
    row.append(cell(name), ...fields.map(key => cell(counts[key])));
    fragment.append(row);
  }
  if (!entries.length) {
    const row = document.createElement('tr');
    const empty = cell('No runs recorded in this window.');
    empty.colSpan = fields.length + 1;
    row.append(empty);
    fragment.append(row);
  }
  $(target).replaceChildren(fragment);
}
function svgNode(name, attributes = {}, content = '') {
  const node = document.createElementNS('http://www.w3.org/2000/svg', name);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (content) node.textContent = content;
  return node;
}
function chart(daily) {
  const host = $('#chart'), view = views[selectedGame];
  const secondaryLabel = selectedGame === 'testnet' ? 'claimed' : 'finished';
  host.replaceChildren();
  if (!daily.length || !daily.some(day => day.startedRuns)) {
    const empty = document.createElement('p');
    empty.className = 'empty-chart';
    empty.textContent = `No ${view.title} runs were recorded in this window.`;
    host.append(empty);
    return;
  }
  const width = Math.max(host.clientWidth, 280, daily.length * 27 + 70), height = 220;
  const left = 42, top = 8, bottom = 181, plot = width - left - 12;
  const rawMax = Math.max(...daily.map(day => day.startedRuns));
  const maximum = Math.max(4, Math.ceil(rawMax / 4) * 4);
  const svg = svgNode('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `Daily ${view.title} starts and ${secondaryLabel} runs for ${daily.length} UTC dates. Exact counts are available under View daily numbers.` });
  for (let index = 0; index <= 4; index++) {
    const value = maximum * index / 4, y = bottom - (bottom - top) * value / maximum;
    svg.append(svgNode('line', { x1: left, x2: width - 8, y1: y, y2: y, stroke: index === 0 ? '#777' : '#333', 'stroke-dasharray': index === 0 ? 'none' : '2 5' }));
    svg.append(svgNode('text', { x: left - 10, y: y + 4, fill: '#999', 'font-family': 'Sometype,monospace', 'font-size': 10, 'text-anchor': 'end' }, number(value)));
  }
  const step = plot / daily.length, barWidth = Math.min(22, step * .28);
  daily.forEach((day, index) => {
    const center = left + step * (index + .5);
    for (const [key, offset, fill, label] of [['startedRuns', -barWidth - 1, '#ccff00', 'started'], [view.secondary, 1, '#fff', secondaryLabel]]) {
      const h = (bottom - top) * day[key] / maximum;
      const bar = svgNode('rect', { x: center + offset, y: bottom - h, width: barWidth, height: h, fill });
      bar.append(svgNode('title', {}, `${day.date}: ${number(day[key])} ${label}`));
      svg.append(bar);
    }
    const frequency = daily.length <= 10 ? (width < 500 ? 2 : 1) : daily.length <= 31 ? 3 : 7;
    if (index % frequency === 0 || index === daily.length - 1) {
      const label = new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }).format(new Date(`${day.date}T00:00:00Z`));
      svg.append(svgNode('text', { x: center, y: 207, fill: '#aaa', 'font-family': 'Sometype,monospace', 'font-size': 10, 'text-anchor': 'middle' }, label));
    }
  });
  host.append(svg);
}
function updateLabels() {
  const testnet = selectedGame === 'testnet', view = views[selectedGame];
  document.title = `Rare Rush | Private ${view.title} Stats`;
  $('#view-eyebrow').textContent = `${selectedGame.toUpperCase()} / YOUR FIELD NOTES`;
  $('#view-intro').replaceChildren(document.createTextNode('Who’s playing. How they rush.'), document.createElement('br'), document.createTextNode(`Your private view of ${testnet ? 'Testnet' : 'the Arcade'}.`));
  $('#source-label').textContent = testnet ? 'ONCHAIN / ROBINHOOD TESTNET' : 'CLIENT-REPORTED EVENTS';
  $('#contract-filter').hidden = !testnet;
  $('#third-label').textContent = testnet ? 'RUNS CLAIMED' : 'RUNS FINISHED';
  $('#third-note').textContent = testnet ? 'Confirmed claim transactions' : 'Survived + lost';
  $('#fourth-label').textContent = testnet ? 'UNRESOLVED RUNS' : 'TIMER SURVIVED';
  $('#first-outcome-label').textContent = testnet ? 'ABANDONED ONCHAIN' : 'LOST';
  $('#second-outcome').hidden = testnet;
  $('#outcomes-note').textContent = testnet ? 'Unresolved does not mean lost. See claim-window status below.' : 'Closing a tab may leave a run unfinished.';
  $('#chart-secondary-label').textContent = testnet ? 'CLAIMED' : 'FINISHED';
  document.querySelectorAll('.breakdown-secondary').forEach(node => { node.textContent = testnet ? 'Claimed' : 'Finished'; });
  $('#daily-caption').textContent = `Daily ${view.title} stats grouped by the UTC start date of each run`;
  $('#daily-head').replaceChildren(...['UTC date', ...view.labels].map(label => { const th = cell(label, true); th.scope = 'col'; return th; }));
  $('#method-source').textContent = testnet ? 'Windows use the run’s start date in UTC. Claims and abandonments belong to that same start date. These counts come from confirmed onchain records for the selected contracts.' : 'Windows use the run’s start date in UTC. A finish reported later belongs to that same start date. These are client-reported Arcade events, not independently verified player activity.';
  $('#testnet-method').hidden = !testnet;
  $('#backfill').textContent = testnet ? 'From contract deployment' : 'None';
  $('#snapshot-row').hidden = !testnet;
  $('#snapshot-time-row').hidden = !testnet;
  $('#metrics').setAttribute('aria-label', `${view.title} totals`);
  document.querySelectorAll('[data-game]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.game === selectedGame)));
  document.querySelectorAll('[data-days]').forEach(button => { button.setAttribute('aria-pressed', String(button.dataset.days === view.days)); if (button.dataset.days === 'all') button.textContent = testnet ? 'ALL HISTORY' : 'ALL TRACKED'; });
  document.querySelectorAll('[data-version]').forEach(button => button.setAttribute('aria-pressed', String(button.dataset.version === view.version)));
}
function clearCounts() {
  for (const selector of ['#unique-players', '#started-runs', '#completed-runs', '#survived-runs', '#lost-runs', '#unfinished-runs']) $(selector).textContent = '—';
  $('#survival-note').textContent = selectedGame === 'testnet' ? 'Awaiting chain snapshot' : 'Of finished runs';
  $('#window-label').textContent = `${views[selectedGame].days === 'all' ? 'All available time' : `${views[selectedGame].days} days`} · run start dates · UTC`;
  $('#last-checked').textContent = 'No snapshot loaded for this view';
  $('#first-observed').textContent = 'Not loaded';
  $('#snapshot-block').textContent = 'Not loaded';
  $('#snapshot-time').textContent = 'Not loaded';
  for (const [selector, cols] of [['#collection-rows', 4], ['#mode-rows', 4], ['#daily-rows', views[selectedGame].fields.length + 1]]) {
    const tr = document.createElement('tr'), td = cell('No data loaded for this view.'); td.colSpan = cols; tr.append(td); $(selector).replaceChildren(tr);
  }
  const empty = document.createElement('p'); empty.className = 'empty-chart'; empty.textContent = 'Counts appear after a successful connection.'; $('#chart').replaceChildren(empty);
}
function render(data) {
  const { totals } = data, testnet = selectedGame === 'testnet', view = views[selectedGame];
  const metrics = { '#unique-players': 'uniquePlayers', '#started-runs': 'startedRuns', '#completed-runs': testnet ? 'claimedRuns' : 'completedRuns', '#survived-runs': testnet ? 'unresolvedRuns' : 'survivedRuns', '#lost-runs': testnet ? 'abandonedRuns' : 'lostRuns', '#unfinished-runs': 'unfinishedRuns' };
  for (const [selector, key] of Object.entries(metrics)) if (key in totals) $(selector).textContent = number(totals[key]);
  $('#survival-note').textContent = testnet ? `${number(totals.openRuns)} within claim window · ${number(totals.expiredRuns)} expired` : totals.completedRuns ? `${Math.round(totals.survivedRuns / totals.completedRuns * 100)}% of finished runs` : 'No finished runs yet';
  const from = data.window.from ?? data.earliestObservedStart;
  $('#window-label').textContent = from ? `${date(from)} – ${date(Date.parse(data.window.to) - 1)} · run start dates · UTC` : 'All available time · run start dates · UTC';
  $('#last-checked').textContent = `Last checked ${checkedTime(data.generatedAt)} UTC · ${date(data.generatedAt)}`;
  $('#first-observed').textContent = data.earliestObservedStart ? `${date(data.earliestObservedStart)} · UTC` : 'No starts recorded';
  if (testnet) {
    $('#snapshot-block').textContent = `#${number(data.snapshot.blockNumber)} · chain ${data.snapshot.chainId}`;
    $('#snapshot-time').textContent = `${date(data.snapshot.blockTimestamp)} · ${checkedTime(data.snapshot.blockTimestamp)} UTC`;
  }
  rows('#collection-rows', [['GENESIS', data.byCollection.genesis], ['GENERATIONS', data.byCollection.generations]], ['uniquePlayers', 'startedRuns', view.secondary]);
  rows('#mode-rows', [['EASY', data.byDifficulty.easy], ['NORMAL', data.byDifficulty.normal], ['DEGEN', data.byDifficulty.degen]], ['uniquePlayers', 'startedRuns', view.secondary]);
  rows('#daily-rows', data.daily.map(day => [day.date, day]), view.fields);
  chart(data.daily);
}
async function refresh() {
  const requestId = ++activeRequest;
  activeAbort?.abort();
  activeAbort = new AbortController();
  const abort = activeAbort;
  loading = true;
  const requestedKey = viewKey(), requestedGame = selectedGame, requested = { ...views[selectedGame] };
  current = cache.get(requestedKey) ?? null;
  updateLabels();
  if (current) render(current); else clearCounts();
  const notice = $('#notice');
  notice.hidden = false;
  notice.className = 'notice';
  notice.textContent = current ? `Refreshing this ${requested.title} view…` : requestedGame === 'testnet' ? 'Reading Testnet contract history… The first check may take a moment.' : 'Connecting to private Arcade stats…';
  $('#refresh').disabled = true;
  $('#refresh').textContent = 'CHECKING…';
  $('#export').disabled = true;
  $('#metrics').setAttribute('aria-busy', 'true');
  const timer = setTimeout(() => abort.abort(), requestedGame === 'testnet' ? 25_000 : 15_000);
  try {
    const query = new URLSearchParams({ mode: requestedGame, days: requested.days });
    if (requestedGame === 'testnet') query.set('version', requested.version);
    const response = await fetch(`/stats?${query}`, { headers: { 'X-Rare-Rush-Local': '1' }, cache: 'no-store', signal: abort.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Stats could not be loaded.');
    if (data.version !== 1 || data.mode !== requestedGame || data.window?.days !== requested.days || !data.totals || !data.scope?.complete || data.scope?.source !== requested.source || data.scope?.ownerExcluded !== true || (requestedGame === 'testnet' && (data.selection?.version !== requested.version || !data.snapshot))) throw new Error('Stats could not be loaded.');
    if (requestId !== activeRequest || requestedKey !== viewKey()) return;
    current = data;
    cache.set(requestedKey, data);
    render(data);
    notice.hidden = true;
  } catch (error) {
    if (requestId !== activeRequest) return;
    notice.className = 'notice error';
    notice.textContent = `${error.name === 'AbortError' ? 'The local dashboard did not respond in time.' : error instanceof TypeError ? 'The local dashboard is offline. Start its local server, then refresh.' : error.message}${current ? ` Showing the last successful ${requested.title} snapshot for this exact view; these are not fresh counts.` : ` No ${requested.title} counts are available for this view yet.`}`;
  } finally {
    clearTimeout(timer);
    if (requestId === activeRequest) {
      loading = false;
      $('#refresh').disabled = false;
      $('#refresh').replaceChildren(document.createTextNode('REFRESH '), Object.assign(document.createElement('span'), { textContent: '↻' }));
      $('#metrics').setAttribute('aria-busy', 'false');
      $('#export').disabled = !current;
    }
  }
}
function csvCell(value) {
  let text = String(value);
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function downloadCsv() {
  if (!current || loading) return;
  const testnet = selectedGame === 'testnet', view = views[selectedGame];
  const data = [
    [`Rare Rush ${view.title} stats`, testnet ? 'Onchain testnet records; owner excluded; history from deployment' : 'Client-reported events; owner excluded; no historical backfill'],
    ['Generated at UTC', current.generatedAt],
    ['Window', current.window.days, 'UTC run start dates', current.window.from ?? 'all available time', current.window.to],
    ...(testnet ? [['Contracts', current.selection.version], ['Chain snapshot', current.snapshot.chainId, current.snapshot.blockNumber, current.snapshot.blockTimestamp], ['Unresolved runs', 'May be active, awaiting a claim, or expired; not confirmed losses']] : []),
    [],
    ['Group', 'Name', 'Unique playing wallets', ...view.labels.slice(1).map(label => `${label} runs`)],
    ['Total', 'All', ...view.fields.map(key => current.totals[key])],
    ...Object.entries(current.byCollection).map(([name, values]) => ['Collection', name, ...view.fields.map(key => values[key])]),
    ...Object.entries(current.byDifficulty).map(([name, values]) => ['Difficulty', name, ...view.fields.map(key => values[key])]),
    ...current.daily.map(day => ['UTC date', day.date, ...view.fields.map(key => day[key])]),
  ].map(row => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([data], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `rare-rush-${selectedGame}${testnet ? `-${current.selection.version}` : ''}-${current.window.days === 'all' ? 'all-time' : `${current.window.days}days`}-${current.generatedAt.slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function selectGame(game) {
  if (!(game in views) || selectedGame === game) return;
  selectedGame = game;
  history.replaceState(null, '', `#${game}`);
  void refresh();
}
for (const button of document.querySelectorAll('[data-game]')) button.addEventListener('click', () => selectGame(button.dataset.game));
for (const button of document.querySelectorAll('[data-days]')) button.addEventListener('click', () => {
  if (views[selectedGame].days === button.dataset.days) return;
  views[selectedGame].days = button.dataset.days;
  void refresh();
});
for (const button of document.querySelectorAll('[data-version]')) button.addEventListener('click', () => {
  if (views.testnet.version === button.dataset.version) return;
  views.testnet.version = button.dataset.version;
  void refresh();
});
window.addEventListener('hashchange', () => selectGame(location.hash === '#testnet' ? 'testnet' : 'arcade'));
$('#refresh').addEventListener('click', () => { if (!loading) void refresh(); });
$('#export').addEventListener('click', downloadCsv);
void refresh();
