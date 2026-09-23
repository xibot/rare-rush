'use strict';
const $ = selector => document.querySelector(selector);
const number = value => new Intl.NumberFormat('en-US').format(value);
const date = value => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
const checkedTime = value => new Intl.DateTimeFormat('en-US', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(value));
let selected = '7';
let current = null;
let loading = false;

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
  const host = $('#chart');
  host.replaceChildren();
  if (!daily.length || !daily.some(day => day.startedRuns)) {
    const empty = document.createElement('p');
    empty.className = 'empty-chart';
    empty.textContent = 'No Arcade runs were recorded in this window.';
    host.append(empty);
    return;
  }
  const width = Math.max(host.clientWidth, 280, daily.length * 27 + 70), height = 220;
  const left = 42, top = 8, bottom = 181, plot = width - left - 12;
  const rawMax = Math.max(...daily.map(day => day.startedRuns));
  const maximum = Math.max(4, Math.ceil(rawMax / 4) * 4);
  const svg = svgNode('svg', { width, height, viewBox: `0 0 ${width} ${height}`, role: 'img', 'aria-label': `Daily starts and finishes for ${daily.length} UTC dates. Exact counts are available under View daily numbers.` });
  for (let index = 0; index <= 4; index++) {
    const value = maximum * index / 4, y = bottom - (bottom - top) * value / maximum;
    svg.append(svgNode('line', { x1: left, x2: width - 8, y1: y, y2: y, stroke: index === 0 ? '#777' : '#333', 'stroke-dasharray': index === 0 ? 'none' : '2 5' }));
    svg.append(svgNode('text', { x: left - 10, y: y + 4, fill: '#999', 'font-family': 'Sometype,monospace', 'font-size': 10, 'text-anchor': 'end' }, number(value)));
  }
  const step = plot / daily.length, barWidth = Math.min(22, step * .28);
  daily.forEach((day, index) => {
    const center = left + step * (index + .5);
    for (const [key, offset, fill, label] of [['startedRuns', -barWidth - 1, '#ccff00', 'started'], ['completedRuns', 1, '#fff', 'finished']]) {
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
function render(data) {
  const { totals } = data;
  const metrics = { '#unique-players': 'uniquePlayers', '#started-runs': 'startedRuns', '#completed-runs': 'completedRuns', '#survived-runs': 'survivedRuns', '#lost-runs': 'lostRuns', '#unfinished-runs': 'unfinishedRuns' };
  for (const [selector, key] of Object.entries(metrics)) $(selector).textContent = number(totals[key]);
  $('#survival-note').textContent = totals.completedRuns ? `${Math.round(totals.survivedRuns / totals.completedRuns * 100)}% of finished runs` : 'No finished runs yet';
  const from = data.window.from ?? data.earliestObservedStart;
  $('#window-label').textContent = from ? `${date(from)} – ${date(Date.parse(data.window.to) - 1)} · run start dates · UTC` : 'All tracked time · run start dates · UTC';
  $('#last-checked').textContent = `Last checked ${checkedTime(data.generatedAt)} UTC · ${date(data.generatedAt)}`;
  $('#first-observed').textContent = data.earliestObservedStart ? `${date(data.earliestObservedStart)} · UTC` : 'No starts recorded';
  rows('#collection-rows', [['GENESIS', data.byCollection.genesis], ['GENERATIONS', data.byCollection.generations]], ['uniquePlayers', 'startedRuns', 'completedRuns']);
  rows('#mode-rows', [['EASY', data.byDifficulty.easy], ['NORMAL', data.byDifficulty.normal], ['DEGEN', data.byDifficulty.degen]], ['uniquePlayers', 'startedRuns', 'completedRuns']);
  rows('#daily-rows', data.daily.map(day => [day.date, day]), ['uniquePlayers', 'startedRuns', 'completedRuns', 'survivedRuns', 'lostRuns', 'unfinishedRuns']);
  chart(data.daily);
}
async function refresh() {
  if (loading) return;
  loading = true;
  const requested = selected;
  const notice = $('#notice');
  notice.hidden = false;
  notice.className = 'notice';
  notice.textContent = current ? 'Refreshing this date window…' : 'Connecting to private Arcade stats…';
  $('#refresh').disabled = true;
  $('#refresh').textContent = 'CHECKING…';
  $('#export').disabled = true;
  $('#metrics').setAttribute('aria-busy', 'true');
  document.querySelectorAll('[data-days]').forEach(button => { button.disabled = true; });
  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), 15_000);
  try {
    const response = await fetch(`/stats?days=${requested}`, { headers: { 'X-Rare-Rush-Local': '1' }, cache: 'no-store', signal: abort.signal });
    const data = await response.json();
    if (!response.ok) throw new Error(typeof data.error === 'string' ? data.error : 'Stats could not be loaded.');
    if (data.version !== 1 || data.window?.days !== requested || !data.totals || !data.scope?.complete) throw new Error('Stats could not be loaded.');
    current = data;
    render(data);
    notice.hidden = true;
  } catch (error) {
    notice.className = 'notice error';
    notice.textContent = `${error.name === 'AbortError' ? 'The local dashboard did not respond in time.' : error instanceof TypeError ? 'The local dashboard is offline. Start its local server, then refresh.' : error.message}${current ? ' Showing the last successful view below; these are not fresh counts.' : ' No counts are available yet.'}`;
    // Keep the last real view and its matching selector when a new range fails.
    if (current) selected = current.window.days;
  } finally {
    clearTimeout(timer);
    loading = false;
    $('#refresh').disabled = false;
    $('#refresh').replaceChildren(document.createTextNode('REFRESH '), Object.assign(document.createElement('span'), { textContent: '↻' }));
    $('#metrics').setAttribute('aria-busy', 'false');
    $('#export').disabled = !current;
    document.querySelectorAll('[data-days]').forEach(button => { button.disabled = false; button.setAttribute('aria-pressed', String(button.dataset.days === selected)); });
  }
}
function csvCell(value) {
  let text = String(value);
  if (/^[=+@\-\t\r]/.test(text)) text = `'${text}`;
  return `"${text.replaceAll('"', '""')}"`;
}
function downloadCsv() {
  if (!current || loading) return;
  const columns = ['uniquePlayers', 'startedRuns', 'completedRuns', 'survivedRuns', 'lostRuns', 'unfinishedRuns'];
  const data = [
    ['Rare Rush Arcade stats', 'Client-reported events; owner excluded; no historical backfill'],
    ['Generated at UTC', current.generatedAt],
    ['Window', current.window.days, 'UTC run start dates', current.window.from ?? 'all tracked time', current.window.to],
    [],
    ['Group', 'Name', 'Unique playing wallets', 'Started runs', 'Finished runs', 'Survived runs', 'Lost runs', 'Unfinished runs'],
    ['Total', 'All', ...columns.map(key => current.totals[key])],
    ...Object.entries(current.byCollection).map(([name, values]) => ['Collection', name, ...columns.map(key => values[key])]),
    ...Object.entries(current.byDifficulty).map(([name, values]) => ['Difficulty', name, ...columns.map(key => values[key])]),
    ...current.daily.map(day => ['UTC date', day.date, ...columns.map(key => day[key])]),
  ].map(row => row.map(csvCell).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob([data], { type: 'text/csv;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = `rare-rush-arcade-${current.window.days}days-${current.generatedAt.slice(0, 10)}.csv`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
for (const button of document.querySelectorAll('[data-days]')) button.addEventListener('click', () => {
  if (loading || selected === button.dataset.days) return;
  selected = button.dataset.days;
  document.querySelectorAll('[data-days]').forEach(item => item.setAttribute('aria-pressed', String(item === button)));
  void refresh();
});
$('#refresh').addEventListener('click', () => void refresh());
$('#export').addEventListener('click', downloadCsv);
void refresh();
