/* Research cockpit — demo simulation. No backend: every event below is scripted.
   The one thing worth watching in a demo is the judgement loop — a correction the
   human makes is applied to every later fetch, visibly, with attribution. */

const $ = (id) => document.getElementById(id);

const STAGES = [
  { id: 1, name: 'Raw material',   note: 'gather only' },
  { id: 2, name: 'Product truth',  note: 'product in isolation' },
  { id: 3, name: 'Market truth',   note: 'product vs world' },
  { id: 'gate', name: 'Viability gate', note: 'human decision' },
  { id: 4, name: 'Customer truth', note: 'after the gate only' },
  { id: 5, name: 'Synthesis',      note: 'artifacts leave here' },
];

const AVATARS = ['Burnt-out professional', 'Peri-menopausal', 'Tried-everything', 'Proxy: adult child'];
const AWARENESS = ['Unaware', 'Problem', 'Solution', 'Product', 'Most'];

// kind → what the agent calls it; `taint` marks sources a human may want to reject
const SOURCES = [
  { u: 'magnacalm.com/products/glycinate-90',            k: 'product page' },
  { u: 'magnacalm.com/assets/COA-2026-04.pdf',           k: 'COA' },
  { u: 'amazon.com/product-reviews/B0C…/?filter=3star',  k: 'reviews · 3★' },
  { u: 'reddit.com/r/Supplements/comments/1f2k…',        k: 'forum' },
  { u: 'trustpilot.com/review/magnacalm.com',            k: 'reviews' },
  { u: 'facebook.com/ads/library?q=magnesium+sleep',     k: 'ad library' },
  { u: 'top10supplementpicks.net/best-magnesium-2026',   k: 'listicle', taint: 'seo-listicle' },
  { u: 'pubmed.ncbi.nlm.nih.gov/31691644',               k: 'trial' },
  { u: 'calmwell.com/pages/subscribe',                   k: 'competitor' },
  { u: 'bestsupplementreviews.io/magnesium-roundup',     k: 'listicle', taint: 'seo-listicle' },
  { u: 'youtube.com/watch?v=8xQ2…  (comments)',          k: 'comments' },
  { u: 'examine.com/supplements/magnesium-glycinate',    k: 'reference' },
  { u: 'reddit.com/r/insomnia/comments/9d1x…',           k: 'forum' },
  { u: 'tiktok.com/@sleepdoc/video/7392…',               k: 'competitor' },
];

const VOC = [
  { q: 'I wake up at 3am and can\'t get back to sleep. Every single night.', s: 'r/insomnia · 214 upvotes', p: 'ev' },
  { q: 'Took it for a week, felt nothing, cancelled. Turns out you need six weeks.', s: 'Amazon 3★ · verified', p: 'ev' },
  { q: 'I\'m the one who has to remember mum\'s tablets now.', s: 'r/CaregiverSupport', p: 'ev' },
  { q: 'Buys for the guilt of not sleeping next to a partner who does', s: 'inferred from 3 threads', p: 'inf' },
];

const GAPS = [
  'No human trial at 400mg for the glycinate form — closest is 320mg citrate.',
  'Competitor CalmWell ad library empty in UK; only US creative captured.',
  'No proxy-buyer evidence for the peri-menopausal avatar.',
];

const state = {
  t: 0, running: false, paused: false, spend: 0,
  sources: 0, evidenced: 0, inferred: 0, gaps: 0,
  stage: null, done: new Set(), judgements: [], voc: [], gapList: [],
  cells: {}, blockedOnGate: false, timer: null, queue: [], qi: 0,
};

/* ---------- rendering ---------- */

function renderStages() {
  $('stages').innerHTML = STAGES.map((s) => {
    const done = state.done.has(s.id);
    const active = state.stage === s.id;
    const blocked = s.id === 'gate' && state.blockedOnGate;
    const cls = ['stage', done ? 'done' : '', active ? 'active' : '', blocked ? 'blocked' : ''].join(' ');
    const status = blocked ? 'awaiting you' : done ? 'complete' : active ? 'running' : s.note;
    return `<div class="${cls}"><span class="dot"></span><div>
      <div class="t">${typeof s.id === 'number' ? 'Stage ' + s.id + ' · ' : ''}${s.name}</div>
      <div class="s">${status}</div></div></div>`;
  }).join('');
}

function renderGrid() {
  const head = ['<div></div>', ...AWARENESS.map((a) => `<div class="h">${a}</div>`)].join('');
  const rows = AVATARS.map((av, r) => {
    const cells = AWARENESS.map((_, c) => {
      const v = state.cells[`${r}:${c}`];
      return `<div class="cell ${v || ''}"></div>`;
    }).join('');
    return `<div class="rh" title="${av}">${av}</div>${cells}`;
  }).join('');
  $('grid').innerHTML = head + rows;
}

function renderMetrics() {
  $('mSrc').textContent = state.sources;
  $('mEv').textContent = state.evidenced;
  $('mInf').textContent = state.inferred;
  $('mGap').textContent = state.gaps;
  $('cost').innerHTML = `Spend <span style="color:var(--ink)">$${state.spend.toFixed(2)}</span>`;
}

function renderVoc() {
  $('voc').innerHTML = state.voc.length ? state.voc.map((v) =>
    `<div class="item"><div class="q">“${v.q}”<span class="pill ${v.p}">${v.p === 'ev' ? 'evidenced' : 'inferred'}</span></div>
     <div class="src">${v.s}</div></div>`).join('') : '<p class="empty">Nothing yet.</p>';
}

function renderGaps() {
  $('gaps').innerHTML = state.gapList.length ? state.gapList.map((g) =>
    `<div class="item"><div class="q">${g}</div></div>`).join('') : '<p class="empty">Nothing yet.</p>';
}

function renderJudgements() {
  $('jCount').textContent = state.judgements.length ? `${state.judgements.length} active` : '';
  $('judgements').innerHTML = state.judgements.length ? state.judgements.map((j) =>
    `<div class="judge"><div class="w">${j.kind}</div><div>${j.text}</div>
     <div class="used">applied ${j.applied} time${j.applied === 1 ? '' : 's'} since${j.at ? ' · ' + j.at : ''}</div></div>`
  ).join('') : '<p class="empty">None yet. Use “Step in” to correct the agent mid-run.</p>';
}

function now(title, sub) { $('nowTitle').textContent = title; if (sub !== undefined) $('nowSub').textContent = sub; }

function trace(html, cls = '') {
  const el = $('trace');
  if (el.querySelector('.empty')) el.innerHTML = '';
  const p = document.createElement('p');
  if (cls) p.className = cls;
  p.innerHTML = `<span class="tag">${fmt(state.t)}</span>${html}`;
  el.appendChild(p);
  el.scrollTop = el.scrollHeight;
}

const fmt = (s) => `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;

/* ---------- crawl lanes ---------- */

function laneKey(u) { return u.replace(/[^a-z0-9]/gi, '').slice(0, 24); }

function addLane(src) {
  const el = $('lanes');
  if (el.querySelector('.empty')) el.innerHTML = '';
  const id = laneKey(src.u);
  const row = document.createElement('div');
  row.className = 'lane fetch';
  row.id = 'lane-' + id;
  row.innerHTML = `<span class="st">FETCH</span>
    <div style="flex:1;min-width:0"><div class="url">${src.u}</div><div class="bar"><i></i></div></div>
    <span class="kind">${src.k}</span>`;
  el.appendChild(row);
  let pct = 0;
  const bar = row.querySelector('.bar > i');
  const iv = setInterval(() => {
    if (state.paused) return;
    pct = Math.min(100, pct + 12 + Math.random() * 22);
    bar.style.width = pct + '%';
    if (pct >= 100) clearInterval(iv);
  }, 130);
  return row;
}

function settleLane(row, verdict, why) {
  row.className = 'lane ' + (verdict === 'ok' ? 'ok' : 'rej');
  row.querySelector('.st').textContent = verdict === 'ok' ? 'PARSED' : 'SKIPPED';
  const bar = row.querySelector('.bar');
  if (bar) bar.remove();
  if (why) {
    const k = row.querySelector('.kind');
    k.textContent = why;
    k.style.color = 'var(--infer)';
  }
  setTimeout(() => {
    row.style.opacity = '.45';
    if ($('lanes').children.length > 6) $('lanes').firstElementChild?.remove();
  }, 2600);
}

/* A source is skipped when a standing judgement says so — the demo's whole point. */
function judgementBlocking(src) {
  return state.judgements.find((j) => j.blocks && src.taint === j.blocks);
}

function crawl(src) {
  const row = addLane(src);
  state.sources += 1; renderMetrics();
  trace(`fetching <a href="#" onclick="return false">${src.u}</a>`);
  const block = judgementBlocking(src);
  setTimeout(() => {
    if (block) {
      settleLane(row, 'rej', 'per your rule');
      block.applied += 1; renderJudgements();
      state.sources -= 1; renderMetrics();
      trace(`skipped <a href="#" onclick="return false">${src.u}</a> — <span class="rule">your judgement: ${block.short}</span>`, 'rule');
    } else {
      settleLane(row, 'ok');
      state.evidenced += 2 + Math.floor(Math.random() * 3);
      state.spend += 0.04 + Math.random() * 0.09;
      renderMetrics();
    }
  }, 900 + Math.random() * 1100);
}

/* ---------- the scripted run ---------- */

function buildQueue() {
  const q = [];
  const step = (fn, wait) => q.push({ fn, wait });

  // Stage 1 — parallel gather
  step(() => { state.stage = 1; renderStages(); now('Stage 1 · Raw material', 'gathering only — no conclusions drawn here');
    trace('stage 1 started — <b>gather only</b>, per cheatsheet rule 1'); }, 900);
  step(() => { [0, 1, 2].forEach((i) => crawl(SOURCES[i])); trace('3 fetches in parallel'); }, 2200);
  step(() => { [3, 4, 5].forEach((i) => crawl(SOURCES[i])); }, 2200);
  step(() => { [6, 7, 8].forEach((i) => crawl(SOURCES[i]));
    trace('ad library: recording <b>first-seen dates</b> — longevity is the only outside performance signal'); }, 2400);
  step(() => { state.voc.push(VOC[0]); renderVoc(); trace('verbatim captured, three-axis coded (why bought / why stayed / why quit)'); }, 1200);
  step(() => { [9, 10].forEach((i) => crawl(SOURCES[i])); }, 2200);
  step(() => { state.voc.push(VOC[1]); renderVoc();
    trace('3★ reviews yielding the objection list — 41 captured'); }, 1400);
  step(() => { state.done.add(1); state.stage = 2; renderStages();
    now('Stage 2 · Product truth', 'ingredients, dose vs study, claim limits, COGS');
    trace('stage 1 saturated — new sources stopped producing new themes'); }, 1400);

  // Stage 2
  step(() => { crawl(SOURCES[11]);
    trace('dose vs study: product 400mg glycinate; nearest trial 320mg citrate'); }, 1800);
  step(() => { state.gapList.push(GAPS[0]); state.gaps += 1; renderGaps(); renderMetrics();
    trace('<b>gap recorded</b> — form mismatch, claim cannot rest on this trial'); }, 1300);
  step(() => { trace('claim limits set: structure-function permitted, disease claims not'); }, 1200);
  step(() => { state.done.add(2); state.stage = 3; renderStages();
    now('Stage 3 · Market truth', 'TAM/SAM, offers, sophistication, breaking point'); }, 1200);

  // Stage 3
  step(() => { [13].forEach((i) => crawl(SOURCES[i]));
    trace('counting competitors running the same claim, and how far they have escalated it'); }, 2000);
  step(() => { trace('sophistication: <b>stage 3</b> — claims are tired, compete on mechanism'); }, 1400);
  step(() => { state.gapList.push(GAPS[1]); state.gaps += 1; renderGaps(); renderMetrics(); }, 1100);
  step(() => { state.done.add(3); state.blockedOnGate = true; state.stage = 'gate'; renderStages();
    now('Viability gate', 'blocked — waiting for your decision');
    trace('<b>gate reached.</b> Stage 4 will not start until you decide.');
    openGate(); }, 0);
  return q;
}

function queueStage45() {
  const q = [];
  const step = (fn, wait) => q.push({ fn, wait });
  step(() => { state.done.add('gate'); state.stage = 4; renderStages();
    now('Stage 4 · Customer truth', 'avatars, awareness, language bank, identity layer'); }, 1000);
  step(() => { [12].forEach((i) => crawl(SOURCES[i]));
    trace('building avatars on three axes — situation, history, demographics last'); }, 2000);
  step(() => { state.voc.push(VOC[2]); renderVoc();
    trace('<b>proxy buyer detected</b> — adult child purchasing for a parent. Distinct avatar, not a variant.'); }, 1600);
  step(() => { ['0:1', '0:2', '1:1', '2:2'].forEach((k) => (state.cells[k] = 'ev')); renderGrid();
    state.evidenced += 6; renderMetrics(); }, 1200);
  step(() => { state.voc.push(VOC[3]); renderVoc(); state.inferred += 4; renderMetrics();
    ['1:2', '3:1'].forEach((k) => (state.cells[k] = 'inf')); renderGrid();
    trace('two cells marked <span class="rule">inferred</span> — plausible, not observed. Test before scaling.'); }, 1600);
  step(() => { state.gapList.push(GAPS[2]); state.gaps += 1; renderGaps(); renderMetrics(); }, 1100);
  step(() => { state.done.add(4); state.stage = 5; renderStages();
    now('Stage 5 · Synthesis', 'mechanism, LTV/CAC, claim ladder, positioning'); }, 1200);
  step(() => { ['2:1', '3:2', '0:3'].forEach((k) => (state.cells[k] = 'ev')); renderGrid();
    ['2:3'].forEach((k) => (state.cells[k] = 'inf')); renderGrid();
    state.evidenced += 5; renderMetrics();
    trace('angle map populated — 11 cells, 4 marked not-pursued with reasons'); }, 1800);
  step(() => { state.done.add(5); state.stage = null; state.running = false; renderStages();
    now('Run complete', 'angle map, dossier and gap list ready for handoff');
    trace('<b>run complete.</b> Every populated cell carries a provenance mark.');
    $('start').disabled = false; $('start').textContent = 'Run again';
    $('intervene').disabled = true; }, 0);
  return q;
}

function tick() {
  if (!state.running) return;
  state.t += 1;
  $('clock').textContent = fmt(state.t);
}

function pump() {
  if (!state.running || state.paused) return;
  if (state.qi >= state.queue.length) return;
  const { fn, wait } = state.queue[state.qi++];
  fn();
  if (wait > 0) setTimeout(pump, wait);
}

/* ---------- human intervention ---------- */

const STRATEGIES = [
  { id: 'seo-listicle', kind: 'Source rule', t: 'Reject SEO listicles and review-roundup sites',
    d: 'Marketing content dressed as review data. Skip these for the rest of the run and in future runs.',
    short: 'no SEO listicles', blocks: 'seo-listicle' },
  { id: 'three-star', kind: 'Weighting', t: 'Weight 3★ reviews above 5★ and 1★',
    d: 'The most honest text in commerce. Prioritise them when mining objections.', short: 'prioritise 3★' },
  { id: 'proxy', kind: 'Avatar rule', t: 'Always check for proxy buyers before finalising avatars',
    d: 'A parent buying for a child is a distinct buyer, not a variant of the sufferer.', short: 'check proxy buyers' },
  { id: 'verbatim', kind: 'Language rule', t: 'Never paraphrase customer language',
    d: '“I wake up at 3am” is usable; “sleep maintenance issues” is not.', short: 'keep verbatim' },
];

function openIntervene() {
  state.paused = true;
  $('pulse').style.animation = 'none';
  now('Paused', 'you stepped in — the agent is holding');
  const opts = STRATEGIES.map((s) => `
    <label class="opt" data-id="${s.id}">
      <input type="radio" name="strat" value="${s.id}" />
      <div><div class="t">${s.t}</div><div class="d">${s.d}</div></div>
    </label>`).join('');
  modal(`
    <h2>Step in</h2>
    <p class="lede">Correct the research strategy. This is stored as a standing judgement and applied for
      the rest of this run and every future run — the agent should not need telling twice.</p>
    ${opts}
    <label class="opt" data-id="custom">
      <input type="radio" name="strat" value="custom" />
      <div style="flex:1"><div class="t">Something else</div>
      <textarea id="custom" placeholder="e.g. Ignore the UK market entirely — we can't ship there."></textarea></div>
    </label>
    <div class="row">
      <button class="btn ghost" onclick="closeModal(true)">Cancel</button>
      <button class="btn" onclick="saveJudgement()">Save &amp; resume</button>
    </div>`);
  document.querySelectorAll('.opt').forEach((o) => o.addEventListener('click', () => {
    document.querySelectorAll('.opt').forEach((x) => x.classList.remove('sel'));
    o.classList.add('sel');
    o.querySelector('input').checked = true;
  }));
}

window.saveJudgement = function () {
  const sel = document.querySelector('input[name=strat]:checked');
  if (!sel) return closeModal(true);
  let j;
  if (sel.value === 'custom') {
    const txt = ($('custom').value || '').trim();
    if (!txt) return closeModal(true);
    j = { kind: 'Custom rule', text: txt, short: 'custom rule', applied: 0, at: fmt(state.t) };
  } else {
    const s = STRATEGIES.find((x) => x.id === sel.value);
    j = { kind: s.kind, text: s.t, short: s.short, blocks: s.blocks, applied: 0, at: fmt(state.t) };
  }
  state.judgements.push(j);
  renderJudgements();
  trace(`<span class="rule">judgement stored — ${j.text}</span>`, 'rule');
  closeModal();
};

const AUTO = new URLSearchParams(location.search).get('auto') === '1';

function openGate() {
  const crits = [
    ['Size', true, 'SAM £41m, derived upward from prevalence × reachable channels'],
    ['Margin', true, '£6.10 landed at £29 retail — 79% gross'],
    ['Mechanism availability', true, 'glycinate absorption angle unoccupied in the direct set'],
    ['Claim room', false, 'no trial at 400mg for this form — strongest claim sits two rungs down'],
    ['Structural churn', true, '30-day bottle vs 6-week time-to-effect — flagged, not fatal'],
  ];
  modal(`
    <h2>Viability gate</h2>
    <p class="lede">Reached after stage 3, before the expensive customer work. Four of five criteria pass.
      Failing one generally means reposition; two or more means drop.</p>
    ${crits.map(([n, ok, ev]) => `<div class="crit"><div><div>${n}</div><div class="ev">${ev}</div></div>
      <div class="${ok ? 'yes' : 'no'}">${ok ? 'pass' : 'fail'}</div></div>`).join('')}
    <div class="row">
      <button class="btn ghost" onclick="gateDecide('drop')">Drop</button>
      <button class="btn ghost" onclick="gateDecide('reposition')">Reposition</button>
      <button class="btn" onclick="gateDecide('proceed')">Proceed to stage 4</button>
    </div>`);
  // Unattended demo screen: hold the gate long enough to be read, then proceed.
  if (AUTO) setTimeout(() => window.gateDecide('proceed'), 4000);
}

window.gateDecide = function (d) {
  state.blockedOnGate = false;
  closeModal();
  trace(`<b>gate decision: ${d}</b> — recorded with the five criteria as evidence`);
  if (d === 'proceed') {
    state.queue = queueStage45(); state.qi = 0;
    now('Stage 4 · Customer truth', 'gate cleared');
    setTimeout(pump, 600);
  } else {
    state.running = false;
    now('Run stopped', `${d} — stage 4 never ran, which is the point of gating here`);
    $('start').disabled = false; $('start').textContent = 'Run again';
    $('intervene').disabled = true;
  }
};

function modal(html) {
  $('modalRoot').innerHTML = `<div class="scrim"><div class="modal">${html}</div></div>`;
}
window.closeModal = function (resume) {
  $('modalRoot').innerHTML = '';
  if (resume !== undefined || state.paused) {
    state.paused = false;
    $('pulse').style.animation = '';
    if (state.running && state.stage) now(`Stage ${state.stage} · resumed`, 'applying your judgements from here on');
    setTimeout(pump, 400);
  }
};

/* ---------- boot ---------- */

$('start').addEventListener('click', () => {
  Object.assign(state, {
    t: 0, running: true, paused: false, spend: 0, sources: 0, evidenced: 0, inferred: 0,
    gaps: 0, stage: null, done: new Set(), voc: [], gapList: [], cells: {}, blockedOnGate: false, qi: 0,
  });
  $('lanes').innerHTML = '<div class="empty">No active fetches</div>';
  $('trace').innerHTML = '';
  $('start').disabled = true; $('intervene').disabled = false;
  renderStages(); renderGrid(); renderMetrics(); renderVoc(); renderGaps();
  state.queue = buildQueue();
  clearInterval(state.timer);
  state.timer = setInterval(tick, 1000);
  pump();
});

$('intervene').addEventListener('click', openIntervene);

renderStages(); renderGrid(); renderMetrics(); renderJudgements();

// ?auto=1 starts the run on load — handy for an unattended demo screen, and
// it is how the headless smoke test drives the simulation.
if (new URLSearchParams(location.search).get('auto') === '1') {
  setTimeout(() => $('start').click(), 300);
}
