'use strict';
/* Chronos 84 — hábitos, diário com memória e estante de livros.
   Tudo fica salvo no próprio aparelho: textos no localStorage, arquivos (PDF/EPUB) no IndexedDB. */

/* ================= utilidades ================= */
const $ = (s, r = document) => r.querySelector(s);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
const pad = n => String(n).padStart(2, '0');
const keyOf = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const parseKey = k => { const [y, m, d] = k.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (k, n) => { const d = parseKey(k); d.setDate(d.getDate() + n); return keyOf(d); };
const todayKey = () => keyOf(new Date());
const daysBetween = (a, b) => Math.round((parseKey(b) - parseKey(a)) / 864e5);
const MES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN', 'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];
const MES_LONGO = ['JANEIRO', 'FEVEREIRO', 'MARÇO', 'ABRIL', 'MAIO', 'JUNHO', 'JULHO', 'AGOSTO', 'SETEMBRO', 'OUTUBRO', 'NOVEMBRO', 'DEZEMBRO'];
const DIA = ['DOM', 'SEG', 'TER', 'QUA', 'QUI', 'SEX', 'SÁB'];
const fmtDate = k => { const d = parseKey(k); return `${pad(d.getDate())}.${MES[d.getMonth()]}`; };
const fmtLong = k => { const d = parseKey(k); return `${DIA[d.getDay()]} · ${pad(d.getDate())}.${MES[d.getMonth()]}.${d.getFullYear()}`; };
const norm = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : 0;
const plural = (n, s, p) => n === 1 ? s : (p || s + 's');
const agoTxt = n => n <= 0 ? 'hoje' : n === 1 ? 'ontem' : n < 30 ? `há ${n} dias` : n < 60 ? 'há 1 mês' : n < 365 ? `há ${Math.round(n / 30)} meses` : `há ${Math.round(n / 365)} ${plural(Math.round(n / 365), 'ano')}`;
const fmtSize = b => b > 1048576 ? (b / 1048576).toFixed(1) + ' MB' : Math.max(1, Math.round(b / 1024)) + ' KB';
const excerpt = (t, n) => { t = String(t || '').replace(/\s+/g, ' ').trim(); return t.length > n ? t.slice(0, n - 1) + '…' : t; };
const byDateDesc = (a, b) => (b.date + (b.time || '')).localeCompare(a.date + (a.time || ''));
const tagClass = t => 'tg' + ([...norm(t)].reduce((h, c) => h + c.charCodeAt(0), 0) % 4);

const ICON = {
  gear: '<svg viewBox="0 0 24 24"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3M4.9 4.9l2.1 2.1M17 17l2.1 2.1M4.9 19.1L7 17M17 7l2.1-2.1"/></svg>',
  mic: '<svg viewBox="0 0 24 24"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5 11a7 7 0 0014 0M12 18v3"/></svg>',
  moon: '<svg viewBox="0 0 24 24"><path d="M20 14.5A8 8 0 019.5 4a8 8 0 1010.5 10.5z"/></svg>',
  pen: '<svg viewBox="0 0 24 24"><path d="M4 20l4-1 11-11-3-3L5 16z"/></svg>',
  star: '<svg viewBox="0 0 24 24"><path d="M12 3l2.5 6 6.5.5-5 4.2 1.6 6.3L12 16.6 6.4 20l1.6-6.3-5-4.2 6.5-.5z"/></svg>',
  study: '<svg viewBox="0 0 24 24"><path d="M2 9l10-5 10 5-10 5z M6 11v5c3 2 9 2 12 0v-5"/></svg>',
  book: '<svg viewBox="0 0 24 24"><path d="M4 4h5v16H4z M10 4h5v16h-5z M16 5l4 1-3 14-4-1z"/></svg>',
  search: '<svg viewBox="0 0 24 24"><circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/></svg>',
};

/* ================= estado ================= */
const KEY = 'chronos84.v1';
function seed() {
  const h = (cat, name, meta) => ({ id: uid(), cat, name, meta });
  return {
    v: 1, name: 'Mauro', goal: 12,
    habits: [
      h('sp', 'Oração da manhã', 'manhã'), h('sp', 'Leitura bíblica · 1 cap.', '1 cap.'),
      h('sp', 'Meditação', '10 min'), h('sp', 'Gratidão · 3 itens', 'noite'),
      h('st', 'Inglês', '30 min'), h('st', 'Leitura do livro atual', '20 págs'), h('st', 'Curso online · 1 aula', '1 aula'),
    ],
    log: {}, entries: [], books: [],
  };
}
let S = null;
try { S = JSON.parse(localStorage.getItem(KEY)); } catch (e) { S = null; }
if (!S || !S.v) S = seed();
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(S)); }
  catch (e) { toast('Não consegui salvar: o armazenamento do celular está cheio'); }
}

const cur = { tab: 'hoje', day: todayKey(), seg: 'sonho', q: '', lastToday: todayKey() };

/* ================= arquivos (IndexedDB) ================= */
const idb = (() => {
  let p;
  const db = () => p || (p = new Promise((res, rej) => {
    const r = indexedDB.open('chronos84', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('files');
    r.onsuccess = () => res(r.result);
    r.onerror = () => rej(r.error);
  }));
  const tx = (mode, fn) => db().then(d => new Promise((res, rej) => {
    const t = d.transaction('files', mode);
    const req = fn(t.objectStore('files'));
    t.oncomplete = () => res(req && req.result);
    t.onerror = () => rej(t.error);
  }));
  return {
    put: (k, v) => tx('readwrite', s => s.put(v, k)),
    get: k => tx('readonly', s => s.get(k)),
    del: k => tx('readwrite', s => s.delete(k)),
  };
})();

/* ================= hábitos ================= */
function dayPct(k) {
  if (!S.habits.length) return 0;
  const ids = new Set(S.habits.map(h => h.id));
  return (S.log[k] || []).filter(id => ids.has(id)).length / S.habits.length;
}
// Um dia conta na sequência quando pelo menos metade dos hábitos foi cumprida.
function streak() {
  let k = todayKey(), n = 0;
  if (dayPct(k) < .5) k = addDays(k, -1);
  while (dayPct(k) >= .5) { n++; k = addDays(k, -1); }
  return n;
}

/* ================= memória ================= */
const STOP = new Set(('a o e de da do das dos em no na nos nas um uma uns umas que com por para pra pro meu minha meus minhas ' +
  'eu voce se sobre os as ao aos sonho sonhos sonhei sonhar tem tens comum quando onde como qual quais foi era ser estar estou ' +
  'isso esse essa este esta mais menos muito muita ja nao sim ou mas ate dia dias me mim lembra lembro quero ver mostra mostre ' +
  'tive teve fiz fez sao sobre aquele aquela nisso nesse nessa porque entre todos todas cada algum alguma').split(' '));
const stem = t => t.length > 4 ? t.replace(/(oes|aes|ais|eis|ns|s)$/, '').slice(0, Math.max(4, t.length - 2)) : t;
const tokens = s => norm(s).split(/[^a-z0-9]+/).filter(w => w.length > 2 && !STOP.has(w));

function scoreEntries(ts, onlyType) {
  const stems = ts.map(stem), out = [];
  for (const e of S.entries) {
    if (onlyType && e.type !== onlyType) continue;
    const tags = e.tags.map(norm), body = norm(e.title + ' ' + e.text);
    let sc = 0;
    for (const s of stems) {
      if (tags.some(g => g.startsWith(s))) sc += 3;
      const m = body.split(s).length - 1;
      if (m) sc += Math.min(m, 3);
    }
    if (sc) out.push({ e, sc });
  }
  return out.sort((a, b) => b.sc - a.sc || byDateDesc(a.e, b.e));
}

function related(e) {
  const tags = new Set(e.tags.map(norm));
  const words = new Set(tokens(e.title + ' ' + e.text).map(stem).filter(w => w.length > 3));
  const out = [];
  for (const x of S.entries) {
    if (x.id === e.id) continue;
    let sc = 0;
    x.tags.forEach(t => { if (tags.has(norm(t))) sc += 3; });
    const xw = new Set(tokens(x.title + ' ' + x.text).map(stem));
    let shared = 0; words.forEach(w => { if (xw.has(w)) shared++; });
    sc += Math.min(shared, 4);
    // véspera: o dia anterior a um sonho (ou o sonho da manhã seguinte)
    if (x.type !== e.type) {
      const dream = e.type === 'sonho' ? e : x, day = e.type === 'sonho' ? x : e;
      if (day.date === dream.date || day.date === addDays(dream.date, -1)) sc += 2;
    }
    if (sc >= 3) out.push({ e: x, sc });
  }
  return out.sort((a, b) => b.sc - a.sc).slice(0, 5).map(r => r.e);
}

function tagCounts(type) {
  const m = {};
  S.entries.filter(e => !type || e.type === type).forEach(e => e.tags.forEach(t => { m[t] = (m[t] || 0) + 1; }));
  return Object.entries(m).sort((a, b) => b[1] - a[1]);
}

const term = (q, a) => `<div class="term"><div class="q">${esc(q)}</div><div class="a">${a}<span class="caret"></span></div></div>`;
const em = t => `<em>${esc(t)}</em>`;

function answer(q) {
  const nq = norm(q);
  const onlyType = /sonh/.test(nq) ? 'sonho' : /\b(dia a dia|meu dia|meus dias|rotina)\b/.test(nq) ? 'dia' : null;
  const ts = tokens(q);
  if (!ts.length) {
    const list = S.entries.filter(e => !onlyType || e.type === onlyType).sort(byDateDesc).slice(0, 8);
    if (!list.length) return term(q, 'Ainda não há registros para lembrar. Escreva no Diário e eu começo a ligar os pontos.');
    return term(q, `Seus ${list.length} registros mais recentes${onlyType === 'sonho' ? ' de sonhos' : ''}:`) + linksHtml(list);
  }
  const res = scoreEntries(ts, onlyType);
  const stems = ts.map(stem);
  const books = S.books.filter(b => stems.some(s => norm(b.title + ' ' + (b.author || '')).includes(s)));
  if (!res.length && !books.length) return term(q, `Não encontrei nada sobre ${ts.map(em).join(', ')} ainda. Tente outra palavra ou um marcador que você usa.`);

  const es = res.map(r => r.e);
  const dreams = es.filter(e => e.type === 'sonho'), days = es.filter(e => e.type === 'dia');
  const dates = [...new Set(es.map(e => e.date))].sort();
  const L = [];
  if (es.length) {
    const split = dreams.length && days.length ? ` (${dreams.length} ${plural(dreams.length, 'sonho')}, ${days.length} do dia)` : dreams.length ? ` de ${plural(dreams.length, 'sonho')}` : ' do dia';
    L.push(`Encontrei <em>${es.length} ${plural(es.length, 'registro')}</em>${split}.`);
    const last = dates[dates.length - 1];
    L.push(dates.length > 1 ? `O primeiro em ${em(fmtDate(dates[0]))}, o último ${agoTxt(daysBetween(last, todayKey()))}.` : `Foi ${agoTxt(daysBetween(last, todayKey()))}.`);

    const co = {};
    es.forEach(e => e.tags.forEach(t => { if (!stems.some(s => norm(t).startsWith(s))) co[t] = (co[t] || 0) + 1; }));
    const coTop = Object.entries(co).filter(([, c]) => c >= 2).sort((a, b) => b[1] - a[1]).slice(0, 3);
    if (coTop.length) L.push(`Costuma aparecer junto com ${coTop.map(([t, c]) => `${em(t)} (${c}×)`).join(', ')}.`);

    if (dreams.length) {
      const v = {}; let found = 0;
      dreams.forEach(d => {
        const prev = S.entries.filter(x => x.type === 'dia' && (x.date === addDays(d.date, -1) || x.date === d.date));
        if (prev.length) found++;
        prev.forEach(x => x.tags.forEach(t => { v[t] = (v[t] || 0) + 1; }));
      });
      const vt = Object.entries(v).sort((a, b) => b[1] - a[1]).slice(0, 3);
      if (found && vt.length) L.push(`Na véspera ${dreams.length > 1 ? 'desses sonhos' : 'desse sonho'} você escreveu sobre ${vt.map(([t, c]) => em(t) + (c > 1 ? ` (${c}×)` : '')).join(', ')}.`);
    }

    const logged = Object.keys(S.log);
    if (logged.length >= 7) {
      const diff = Math.round((avg(dates.map(dayPct)) - avg(logged.map(dayPct))) * 100);
      if (Math.abs(diff) >= 15) L.push(`Nesses dias seus hábitos ficaram <em>${Math.abs(diff)} pontos ${diff > 0 ? 'acima' : 'abaixo'}</em> da sua média.`);
    }
    const hum = days.filter(e => e.score && e.score.humor).map(e => e.score.humor);
    if (hum.length >= 2) {
      const all = S.entries.filter(e => e.type === 'dia' && e.score && e.score.humor).map(e => e.score.humor);
      L.push(`Humor médio nesses dias: <em>${avg(hum).toFixed(1)}</em> (sua média geral é ${avg(all).toFixed(1)}).`);
    }
  }
  if (books.length) L.push(`Na estante: ${books.map(b => em(b.title)).join(', ')}.`);
  return term(q, L.join(' ')) +
    (es.length ? linksHtml(es.slice(0, 12)) : '') +
    (books.length ? `<div class="links">${books.map(b => `<button class="link" data-act="open-book" data-id="${b.id}"><span class="d">LIVRO</span><span class="lt">${esc(b.title)}</span><span class="k">${statusLabel(b.status)}</span></button>`).join('')}</div>` : '');
}

/* ================= componentes ================= */
const linkHtml = e => `<button class="link" data-act="open-entry" data-id="${e.id}"><span class="d">${fmtDate(e.date)}</span><span class="lt">${esc(e.title || excerpt(e.text, 50) || 'Sem título')}</span><span class="k">${e.type === 'sonho' ? 'sonho' : 'dia'}</span></button>`;
const linksHtml = list => `<div class="links">${list.map(linkHtml).join('')}</div>`;
const tagsHtml = (tags, act) => tags && tags.length ? `<div class="tags">${tags.map(t => act ? `<button class="${tagClass(t)}" data-act="ask" data-q="${esc(t)}">${esc(t)}</button>` : `<span class="${tagClass(t)}">${esc(t)}</span>`).join('')}</div>` : '';
const meter = (label, v, c) => `<div class="meter" style="--c:var(--${c})"><div class="lbl"><span>${label}</span><span>${v}/10</span></div><div class="bars">${Array.from({ length: 10 }, (_, i) => `<i class="${i < v ? 'on' : ''}"></i>`).join('')}</div></div>`;
const metersHtml = e => e.type === 'sonho'
  ? (e.score && e.score.nitidez ? meter('NITIDEZ', e.score.nitidez, 'violet') : '')
  : (e.score ? (e.score.humor ? meter('HUMOR', e.score.humor, 'sun') : '') + (e.score.energia ? meter('ENERGIA', e.score.energia, 'cyan') : '') : '');
const statusLabel = s => ({ quero: 'quero ler', lendo: 'lendo', lido: 'lido' }[s] || s);
const GRADS = [['#ff2a6d', '#5b0f6b'], ['#05d9e8', '#1b2a8f'], ['#ffd319', '#ff2a6d'], ['#9d4dff', '#100830'], ['#39ff9e', '#0b4a5a'], ['#ff8b3d', '#3b0f5c']];
const coverHtml = (b, cls = '') => {
  const g = GRADS[[...b.title].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7) % GRADS.length];
  return `<div class="cover ${cls}" style="background:linear-gradient(170deg,${g[0]},${g[1]})"><span>${esc(b.title)}</span>${b.fileId ? `<em>${esc(b.fileType)}</em>` : ''}</div>`;
};

/* ================= telas ================= */
function vHoje() {
  const k = cur.day, isToday = k === todayKey(), p = dayPct(k), C = 263.9, done = new Set(S.log[k] || []);
  const hr = new Date().getHours();
  const hi = hr < 5 ? 'Boa noite' : hr < 12 ? 'Bom dia' : hr < 18 ? 'Boa tarde' : 'Boa noite';
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const d = addDays(todayKey(), -i), q = dayPct(d);
    week.push(`<button class="wk ${q >= 1 ? 'f' : q > 0 ? 'h' : ''} ${d === k ? 'sel' : ''}" data-act="day" data-k="${d}" aria-label="${fmtLong(d)}"><span>${DIA[parseKey(d).getDay()][0]}</span><i></i></button>`);
  }
  const mod = (cat, label) => {
    const hs = S.habits.filter(x => x.cat === cat), n = hs.filter(x => done.has(x.id)).length;
    return `<section class="mod ${cat}">
      <div class="mod-h"><h3>${label}</h3><span>${n}/${hs.length}</span><button class="icon-btn" data-act="manage" data-cat="${cat}" aria-label="Editar hábitos ${label}">${ICON.gear}</button></div>
      ${hs.length ? hs.map(x => `<button class="habit ${done.has(x.id) ? 'done' : ''}" data-act="toggle" data-id="${x.id}" aria-pressed="${done.has(x.id)}"><span class="box"></span><span class="t">${esc(x.name)}</span><span class="meta">${esc(x.meta || '')}</span></button>`).join('')
        : `<button class="empty-line" data-act="manage" data-cat="${cat}">+ ADICIONAR HÁBITO</button>`}
    </section>`;
  };
  const hasDream = S.entries.some(e => e.type === 'sonho' && e.date === k);
  const hasDay = S.entries.some(e => e.type === 'dia' && e.date === k);
  return `
  <header class="top">
    <div class="daynav">
      <button class="icon-btn" data-act="day" data-k="${addDays(k, -1)}" aria-label="Dia anterior">‹</button>
      <p class="h-eyebrow">${fmtLong(k)}</p>
      <button class="icon-btn" data-act="day" data-k="${addDays(k, 1)}" ${isToday ? 'disabled' : ''} aria-label="Próximo dia">›</button>
    </div>
    <div class="row"><h1 class="h-title">${isToday ? hi + (S.name ? ', ' + esc(S.name) : '') : 'Registro de ' + fmtDate(k)}</h1>
    <button class="icon-btn" data-act="settings" aria-label="Ajustes">${ICON.gear}</button></div>
  </header>
  ${installBanner()}
  <div class="hero">
    <div class="ring">
      <svg viewBox="0 0 100 100" aria-hidden="true">
        <defs><linearGradient id="rg" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#05d9e8"/><stop offset="1" stop-color="#ff2a6d"/></linearGradient></defs>
        <circle cx="50" cy="50" r="42" fill="none" stroke="#2a1a52" stroke-width="8"/>
        <circle cx="50" cy="50" r="42" fill="none" stroke="url(#rg)" stroke-width="8" stroke-dasharray="${C}" stroke-dashoffset="${(C * (1 - p)).toFixed(1)}" style="filter:drop-shadow(0 0 4px #05d9e8)"/>
      </svg>
      <div class="val"><div><strong>${Math.round(p * 100)}</strong><br><small>% ${isToday ? 'HOJE' : 'NO DIA'}</small></div></div>
    </div>
    <div class="streak">
      <span class="n">${streak()}</span>
      <span class="l">${plural(streak(), 'dia')} em sequência</span>
      <div class="week">${week.join('')}</div>
    </div>
  </div>
  ${mod('sp', 'ESPIRITUAL')}
  ${mod('st', 'ESTUDOS')}
  <div class="prompts">
    ${!hasDream ? `<button class="prompt m" data-act="new-entry" data-type="sonho" data-k="${k}">Sonhou com algo? <b>Registrar</b></button>` : ''}
    ${!hasDay ? `<button class="prompt c" data-act="new-entry" data-type="dia" data-k="${k}">Como foi o dia? <b>Escrever</b></button>` : ''}
  </div>`;
}

function vDiario() {
  const isS = cur.seg === 'sonho';
  const list = S.entries.filter(e => e.type === cur.seg).sort(byDateDesc);
  let html = '', lastM = '';
  for (const e of list) {
    const d = parseKey(e.date), m = MES_LONGO[d.getMonth()] + ' ' + d.getFullYear();
    if (m !== lastM) { html += `<div class="month">${m}</div>`; lastM = m; }
    html += `<button class="entry" data-act="open-entry" data-id="${e.id}">
      <div class="when"><span>${fmtDate(e.date)}${e.time ? ' · ' + e.time : ''}</span><b>◆ ${e.type === 'sonho' ? (e.lucid ? 'SONHO LÚCIDO' : 'SONHO') : DIA[d.getDay()]}</b></div>
      ${e.title ? `<h4>${esc(e.title)}</h4>` : ''}
      ${e.text ? `<p>${esc(e.text)}</p>` : ''}
      ${tagsHtml(e.tags)}
      ${metersHtml(e)}
    </button>`;
  }
  return `
  <header class="top"><p class="h-eyebrow">${S.entries.length} ${plural(S.entries.length, 'registro')}</p><h1 class="h-title">Diário</h1></header>
  <div class="seg" role="tablist">
    <button class="${isS ? 'on' : ''}" data-act="seg" data-seg="sonho" role="tab" aria-selected="${isS}">SONHOS</button>
    <button class="${!isS ? 'on' : ''}" data-act="seg" data-seg="dia" role="tab" aria-selected="${!isS}">DIA A DIA</button>
  </div>
  <button class="rec ${isS ? '' : 'c'}" data-act="new-entry" data-type="${cur.seg}"><span class="dot"></span>${isS ? 'REGISTRAR SONHO' : 'ESCREVER SOBRE HOJE'}<span class="wave"></span></button>
  ${list.length ? html : `<div class="empty"><b>${isS ? 'Nenhum sonho registrado.' : 'Nenhum dia registrado.'}</b>${isS ? 'Anote logo ao acordar, antes que o sonho se apague. Dá para ditar por voz.' : 'Escreva o que aconteceu, como você se sentiu e marque com palavras-chave.'}</div>`}`;
}

function vMemoria() {
  const n = S.entries.length;
  const first = n ? S.entries.map(e => e.date).sort()[0] : null;
  return `
  <header class="top"><p class="h-eyebrow">${n} ${plural(n, 'registro')}${first ? ' · desde ' + fmtDate(first) : ''}</p><h1 class="h-title">Núcleo de memória</h1></header>
  <div class="core" aria-hidden="true"><div class="orbit b"></div><div class="orbit"></div><div class="orb"></div></div>
  <form id="fAsk" class="ask" role="search">${ICON.search}<input id="askQ" value="${esc(cur.q)}" placeholder="Pergunte à sua memória…" enterkeyhint="search" autocomplete="off">${cur.q ? '<button type="button" data-act="clear-q" aria-label="Limpar">✕</button>' : ''}</form>
  ${cur.q ? answer(cur.q) : overview()}`;
}

function overview() {
  const nS = S.entries.filter(e => e.type === 'sonho').length, nD = S.entries.length - nS;
  const lidos = S.books.filter(b => b.status === 'lido').length;
  const stats = `<div class="stats">
    <div class="stat" style="--c:var(--magenta)"><b>${nS}</b><span>sonhos</span></div>
    <div class="stat" style="--c:var(--cyan)"><b>${nD}</b><span>dias</span></div>
    <div class="stat" style="--c:var(--sun)"><b>${streak()}</b><span>sequência</span></div>
    <div class="stat" style="--c:var(--violet)"><b>${lidos}</b><span>lidos</span></div></div>`;
  if (!S.entries.length) return stats + `<div class="empty"><b>A memória começa vazia.</b>Cada sonho e cada dia que você registrar entra aqui. Depois é só perguntar coisas como "quando sonhei com água?" ou "trabalho".</div>`;

  const t = todayKey(), parts = [stats];
  const marks = [[7, 'há 1 semana'], [30, 'há 1 mês'], [365, 'há 1 ano']];
  const back = [];
  marks.forEach(([n, l]) => { const k = addDays(t, -n); S.entries.filter(e => e.date === k).forEach(e => back.push([l, e])); });
  if (back.length) parts.push(`<section class="panel" style="--c:var(--sun)"><h3>NESTE DIA</h3><div class="links">${back.map(([l, e]) => linkHtml(e).replace(`<span class="d">${fmtDate(e.date)}</span>`, `<span class="d">${l}</span>`)).join('')}</div></section>`);

  const sym = tagCounts('sonho').slice(0, 10), th = tagCounts('dia').slice(0, 10);
  if (sym.length) parts.push(`<section class="panel" style="--c:var(--magenta)"><h3>SÍMBOLOS DOS SEUS SONHOS</h3><div class="tags">${sym.map(([g, c]) => `<button class="${tagClass(g)}" data-act="ask" data-q="${esc(g)}">${esc(g)} ×${c}</button>`).join('')}</div></section>`);
  if (th.length) parts.push(`<section class="panel" style="--c:var(--cyan)"><h3>TEMAS DO SEU DIA A DIA</h3><div class="tags">${th.map(([g, c]) => `<button class="${tagClass(g)}" data-act="ask" data-q="${esc(g)}">${esc(g)} ×${c}</button>`).join('')}</div></section>`);

  const humorOf = k => { const v = S.entries.filter(e => e.type === 'dia' && e.date === k && e.score && e.score.humor).map(e => e.score.humor); return v.length ? avg(v) : null; };
  const days14 = Array.from({ length: 14 }, (_, i) => addDays(t, i - 13));
  const hv = days14.map(humorOf);
  if (hv.some(v => v !== null)) {
    parts.push(`<section class="panel" style="--c:var(--sun)"><h3>HUMOR · 14 DIAS</h3>
      <div class="spark">${hv.map((v, i) => v === null ? `<i class="no" title="${fmtDate(days14[i])}"></i>` : `<i style="height:${v * 10}%" title="${fmtDate(days14[i])}: ${v.toFixed(1)}"></i>`).join('')}</div>
      <div class="spark-l"><span>${fmtDate(days14[0])}</span><span>hoje</span></div></section>`);
  }
  const pairs = S.entries.filter(e => e.type === 'dia' && e.score && e.score.humor && S.log[e.date]).map(e => [dayPct(e.date), e.score.humor]);
  const hiH = pairs.filter(p => p[0] >= .75).map(p => p[1]), loH = pairs.filter(p => p[0] < .75).map(p => p[1]);
  if (hiH.length >= 2 && loH.length >= 2) {
    parts.push(`<section class="panel"><h3>HÁBITOS × HUMOR</h3>${term('meus hábitos mudam meu humor?', `Nos dias em que você cumpriu 75% ou mais dos hábitos, seu humor médio foi <em>${avg(hiH).toFixed(1)}</em>. Nos outros dias, <em>${avg(loH).toFixed(1)}</em>.`)}</section>`);
  }
  parts.push(`<section class="panel"><h3>ÚLTIMOS REGISTROS</h3>${linksHtml(S.entries.slice().sort(byDateDesc).slice(0, 5))}</section>`);
  return parts.join('');
}

function vLivros() {
  const y = String(new Date().getFullYear());
  const lendo = S.books.filter(b => b.status === 'lendo'), quero = S.books.filter(b => b.status === 'quero'), lidos = S.books.filter(b => b.status === 'lido');
  const lidosAno = lidos.filter(b => (b.finished || '').startsWith(y)).length;
  const now = b => {
    const pct = b.pages ? Math.min(100, Math.round(b.page / b.pages * 100)) : 0;
    return `<div class="now" data-act="open-book" data-id="${b.id}" role="button" tabindex="0">
      ${coverHtml(b)}
      <div style="min-width:0">
        <p class="h-eyebrow" style="font-size:16px;color:var(--cyan)">LENDO AGORA</p>
        <h4>${esc(b.title)}</h4>${b.author ? `<div class="au">${esc(b.author)}</div>` : ''}
        <div class="prog"><i style="width:${pct}%"></i></div>
        <div class="pg"><span>pág. ${b.page || 0}${b.pages ? ' / ' + b.pages : ''}</span><button class="plus" data-act="page" data-id="${b.id}">+10 PÁGS</button><span>${b.pages ? pct + '%' : ''}</span></div>
      </div></div>`;
  };
  const cov = b => `<button data-act="open-book" data-id="${b.id}" aria-label="${esc(b.title)}">${coverHtml(b)}</button>`;
  return `
  <header class="top"><p class="h-eyebrow">Meta ${y} · ${lidosAno} de ${S.goal} lidos</p><h1 class="h-title">Estante</h1></header>
  <div class="goalbar"><i style="width:${Math.min(100, lidosAno / S.goal * 100)}%"></i></div>
  ${lendo.map(now).join('') || '<div class="empty small">Nenhum livro em leitura. Toque em um livro da fila e marque <b>Lendo</b>.</div>'}
  <div class="shelf-h"><h3>QUERO LER</h3><span>${quero.length} na fila</span></div>
  <div class="shelf">${quero.map(cov).join('')}<button class="add" data-act="new-book"><b>+</b>ANEXAR</button></div>
  ${lidos.length ? `<div class="shelf-h"><h3 class="y">LIDOS</h3><span>${lidos.length}</span></div><div class="shelf done">${lidos.slice().sort((a, b) => (b.finished || '').localeCompare(a.finished || '')).map(cov).join('')}</div>` : ''}
  <p class="muted tiny">Anexe o PDF ou EPUB do livro, ou cadastre só o título. Os arquivos ficam guardados no celular.</p>`;
}

/* ================= render ================= */
function render() {
  document.querySelectorAll('.tab[data-tab]').forEach(t => t.classList.toggle('on', t.dataset.tab === cur.tab));
  $('#view').innerHTML = ({ hoje: vHoje, diario: vDiario, memoria: vMemoria, livros: vLivros })[cur.tab]();
}

/* ================= folha inferior ================= */
function openSheet(html, mount) {
  const sh = $('#sheet'), card = $('#sheetCard'), wasOpen = !sh.hidden;
  card.innerHTML = html;
  sh.hidden = false;
  document.body.classList.add('lock');
  if (!wasOpen) history.pushState({ sheet: true }, '');
  card.scrollTop = 0;
  if (mount) mount(card);
}
function hideSheet() { $('#sheet').hidden = true; $('#sheetCard').innerHTML = ''; document.body.classList.remove('lock'); }
function closeSheet() {
  if ($('#sheet').hidden) return;
  if (history.state && history.state.sheet) history.back(); else hideSheet();
}
window.addEventListener('popstate', () => { if (!$('#sheet').hidden) hideSheet(); });

let toastT;
function toast(msg) {
  const t = $('#toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, 2600);
}

/* ---------- registro rápido ---------- */
function sheetQuick() {
  openSheet(`<h2 class="sh-title">Registrar</h2>
  <div class="quick">
    <button class="qk m" data-act="new-entry" data-type="sonho">${ICON.moon}<b>Sonho</b><span>logo ao acordar</span></button>
    <button class="qk c" data-act="new-entry" data-type="dia">${ICON.pen}<b>Dia a dia</b><span>o que aconteceu</span></button>
    <button class="qk m" data-act="manage" data-cat="sp">${ICON.star}<b>Hábito espiritual</b><span>novo ou editar</span></button>
    <button class="qk c" data-act="manage" data-cat="st">${ICON.study}<b>Hábito de estudo</b><span>novo ou editar</span></button>
    <button class="qk y wide" data-act="new-book">${ICON.book}<b>Livro</b><span>PDF, EPUB ou só o título</span></button>
  </div>`);
}

/* ---------- hábitos ---------- */
function commitHabitEdits(cat) {
  S.habits.filter(h => h.cat === cat).forEach(h => {
    const n = $('#hn-' + h.id), m = $('#hm-' + h.id);
    if (n && n.value.trim()) h.name = n.value.trim();
    if (m) h.meta = m.value.trim();
  });
}
function sheetHabits(cat) {
  const label = cat === 'sp' ? 'Espiritual' : 'Estudos';
  const hs = S.habits.filter(h => h.cat === cat);
  openSheet(`<h2 class="sh-title">Hábitos · ${label}</h2>
  <div class="list">${hs.map(h => `<div class="hrow"><input id="hn-${h.id}" value="${esc(h.name)}" aria-label="Nome do hábito"><input id="hm-${h.id}" value="${esc(h.meta || '')}" placeholder="meta" aria-label="Meta"><button class="icon-btn danger" data-act="del-habit" data-id="${h.id}" aria-label="Apagar ${esc(h.name)}">✕</button></div>`).join('') || '<p class="muted">Nenhum hábito ainda.</p>'}</div>
  <form id="fNewHabit" class="hrow"><input id="nhName" placeholder="Novo hábito" required aria-label="Novo hábito"><input id="nhMeta" placeholder="meta" aria-label="Meta do novo hábito"><button class="btn sm" type="submit" aria-label="Adicionar">+</button></form>
  <p class="muted tiny">A meta é um lembrete curto, como "10 min" ou "1 cap.".</p>
  <div class="actions"><button class="btn" data-act="save-habits" data-cat="${cat}">Salvar</button></div>`, c => {
    $('#fNewHabit', c).addEventListener('submit', e => {
      e.preventDefault();
      commitHabitEdits(cat);
      S.habits.push({ id: uid(), cat, name: $('#nhName').value.trim(), meta: $('#nhMeta').value.trim() });
      save(); render(); sheetHabits(cat);
      toast('Hábito adicionado');
    });
  });
}

/* ---------- diário ---------- */
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
function dictate(btn, ta) {
  if (btn._rec) { btn._rec.stop(); return; }
  const r = new SR();
  r.lang = 'pt-BR'; r.continuous = true; r.interimResults = false;
  r.onresult = ev => {
    for (let i = ev.resultIndex; i < ev.results.length; i++) {
      if (ev.results[i].isFinal) {
        const t = ev.results[i][0].transcript.trim();
        ta.value += (ta.value && !/\s$/.test(ta.value) ? ' ' : '') + t;
      }
    }
  };
  r.onerror = e => toast(e.error === 'not-allowed' ? 'Permita o uso do microfone para ditar' : 'O ditado parou');
  r.onend = () => { btn._rec = null; btn.classList.remove('on'); btn.querySelector('span').textContent = 'DITAR'; };
  try { r.start(); btn._rec = r; btn.classList.add('on'); btn.querySelector('span').textContent = 'PARAR'; }
  catch (e) { toast('Não consegui iniciar o ditado'); }
}
const range = (id, label, v) => `<label class="rng">${label} <output id="${id}o">${v}/10</output><input type="range" id="${id}" min="1" max="10" value="${v}"></label>`;

function sheetEntry(type, id, dateK) {
  const e = id ? S.entries.find(x => x.id === id) : null;
  if (e) type = e.type;
  const now = new Date(), isS = type === 'sonho', sc = (e && e.score) || {};
  const d = {
    date: e ? e.date : (dateK || todayKey()), time: e ? e.time : `${pad(now.getHours())}:${pad(now.getMinutes())}`,
    title: e ? e.title : '', text: e ? e.text : '', tags: e ? e.tags.join(', ') : '', lucid: !!(e && e.lucid),
  };
  const known = tagCounts(type).slice(0, 12).map(([t]) => t);
  openSheet(`<h2 class="sh-title">${e ? 'Editar' : 'Novo'} ${isS ? 'sonho' : 'registro do dia'}</h2>
  <form id="fEntry" class="form">
    <div class="two"><label>Data<input type="date" id="eDate" value="${d.date}" required></label><label>Hora<input type="time" id="eTime" value="${esc(d.time)}"></label></div>
    <label>Título<input id="eTitle" value="${esc(d.title)}" placeholder="${isS ? 'A escada que descia para o mar' : 'O dia em uma frase'}"></label>
    <label class="ta">${isS ? 'O que você sonhou' : 'O que aconteceu'}<textarea id="eText" rows="7" placeholder="${isS ? 'Lugares, pessoas, cores, sensações…' : 'Como foi, o que sentiu, o que aprendeu…'}">${esc(d.text)}</textarea>${SR ? `<button type="button" class="mic" id="eMic">${ICON.mic}<span>DITAR</span></button>` : ''}</label>
    <label>Marcadores <small>separados por vírgula</small><input id="eTags" value="${esc(d.tags)}" placeholder="${isS ? 'água, escada, voar' : 'família, trabalho, gratidão'}" autocapitalize="none"></label>
    ${known.length ? `<div class="tags pick">${known.map(t => `<button type="button" data-tag="${esc(t)}">+ ${esc(t)}</button>`).join('')}</div>` : ''}
    ${isS ? `<label class="check"><input type="checkbox" id="eLucid" ${d.lucid ? 'checked' : ''}> Sonho lúcido (eu sabia que estava sonhando)</label>${range('eNit', 'Nitidez', sc.nitidez || 6)}`
      : `${range('eHum', 'Humor', sc.humor || 6)}${range('eEne', 'Energia', sc.energia || 6)}`}
    <div class="actions"><button type="button" class="btn ghost" data-close>Cancelar</button><button class="btn" type="submit">Salvar</button></div>
  </form>`, c => {
    c.querySelectorAll('input[type=range]').forEach(r => r.addEventListener('input', () => { $('#' + r.id + 'o').textContent = r.value + '/10'; }));
    c.querySelectorAll('[data-tag]').forEach(b => b.addEventListener('click', () => {
      const inp = $('#eTags'), cur2 = inp.value.split(',').map(s => s.trim()).filter(Boolean);
      if (!cur2.includes(b.dataset.tag)) cur2.push(b.dataset.tag);
      inp.value = cur2.join(', ');
    }));
    const mic = $('#eMic', c); if (mic) mic.addEventListener('click', () => dictate(mic, $('#eText')));
    $('#fEntry', c).addEventListener('submit', ev => {
      ev.preventDefault();
      const m = $('#eMic'); if (m && m._rec) m._rec.stop();
      const title = $('#eTitle').value.trim(), text = $('#eText').value.trim();
      if (!title && !text) { toast('Escreva algo antes de salvar'); return; }
      const tags = [...new Set($('#eTags').value.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))];
      const data = {
        type, date: $('#eDate').value || todayKey(), time: $('#eTime').value, title, text, tags,
        lucid: isS ? $('#eLucid').checked : false,
        score: isS ? { nitidez: +$('#eNit').value } : { humor: +$('#eHum').value, energia: +$('#eEne').value },
        updated: Date.now(),
      };
      let saved;
      if (e) { Object.assign(e, data); saved = e; }
      else { saved = { id: uid(), created: Date.now(), ...data }; S.entries.push(saved); }
      save(); render();
      toast('Salvo na memória');
      sheetDetail(saved.id);
    });
  });
}

function sheetDetail(id) {
  const e = S.entries.find(x => x.id === id);
  if (!e) { closeSheet(); return; }
  const rel = related(e);
  openSheet(`<div class="when"><span>${fmtLong(e.date)}${e.time ? ' · ' + e.time : ''}</span><b>◆ ${e.type === 'sonho' ? (e.lucid ? 'SONHO LÚCIDO' : 'SONHO') : 'DIA A DIA'}</b></div>
  <h2 class="sh-title">${esc(e.title || 'Sem título')}</h2>
  ${e.text ? `<div class="fulltext">${esc(e.text).replace(/\n/g, '<br>')}</div>` : ''}
  ${tagsHtml(e.tags, true)}
  ${metersHtml(e)}
  <section class="conn"><h3>CONEXÕES DA MEMÓRIA</h3>${rel.length ? linksHtml(rel) : '<p class="muted">Ainda sem conexões. Elas aparecem quando outros registros compartilham marcadores, palavras ou a véspera do sonho.</p>'}</section>
  <div class="actions"><button class="btn ghost danger" data-act="del-entry" data-id="${e.id}">Apagar</button><button class="btn" data-act="edit-entry" data-id="${e.id}">Editar</button></div>`);
}

/* ---------- livros ---------- */
function sheetBook(id) {
  const b = id ? S.books.find(x => x.id === id) : null;
  const d = b || { title: '', author: '', pages: '', page: 0, status: 'quero' };
  openSheet(`
  <div class="bookhead">${b ? coverHtml(b, 'lg') : ''}<div style="min-width:0"><h2 class="sh-title">${b ? esc(b.title) : 'Novo livro'}</h2>${b && b.author ? `<p class="muted">${esc(b.author)}</p>` : ''}</div></div>
  <form id="fBook" class="form">
    <label>Título<input id="bTitle" value="${esc(d.title)}" required></label>
    <label>Autor<input id="bAuthor" value="${esc(d.author || '')}"></label>
    <div class="two"><label>Total de páginas<input id="bPages" type="number" min="0" inputmode="numeric" value="${d.pages || ''}"></label><label>Página atual<input id="bPage" type="number" min="0" inputmode="numeric" value="${d.page || 0}"></label></div>
    <div class="statuspick" role="radiogroup" aria-label="Situação">${[['quero', 'QUERO LER'], ['lendo', 'LENDO'], ['lido', 'LIDO']].map(([v, l]) => `<label><input type="radio" name="bStatus" value="${v}" ${d.status === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
    <div class="filebox">${b && b.fileId
      ? `<div class="fileinfo"><b>${esc(b.fileType)}</b>${esc(b.fileName)} <small class="muted">${fmtSize(b.fileSize || 0)}</small></div>
         <div class="two"><button type="button" class="btn ghost" data-act="open-file" data-id="${b.id}">Abrir arquivo</button><button type="button" class="btn ghost danger" data-act="del-file" data-id="${b.id}">Remover arquivo</button></div>`
      : `<label class="btn ghost">Anexar PDF ou EPUB<input type="file" id="bFile" accept=".pdf,.epub,application/pdf,application/epub+zip" hidden></label><p class="muted tiny" id="bFileName">Opcional. O arquivo fica guardado só neste celular.</p>`}</div>
    <div class="actions">${b ? `<button type="button" class="btn ghost danger" data-act="del-book" data-id="${b.id}">Apagar</button>` : '<button type="button" class="btn ghost" data-close>Cancelar</button>'}<button class="btn" type="submit">Salvar</button></div>
  </form>`, c => {
    const f = $('#bFile', c);
    if (f) f.addEventListener('change', () => {
      const file = f.files[0]; if (!file) return;
      $('#bFileName').textContent = `${file.name} · ${fmtSize(file.size)}`;
      if (!$('#bTitle').value.trim()) $('#bTitle').value = file.name.replace(/\.(pdf|epub)$/i, '').replace(/[_-]+/g, ' ').trim();
    });
    $('#fBook', c).addEventListener('submit', async ev => {
      ev.preventDefault();
      const status = c.querySelector('input[name=bStatus]:checked').value;
      const pages = parseInt($('#bPages').value, 10) || 0;
      let page = parseInt($('#bPage').value, 10) || 0;
      if (pages && page > pages) page = pages;
      const book = b || { id: uid(), added: todayKey() };
      if (status === 'lido' && book.status !== 'lido') { book.finished = todayKey(); if (pages) page = pages; }
      if (status === 'lendo' && !book.started) book.started = todayKey();
      Object.assign(book, { title: $('#bTitle').value.trim(), author: $('#bAuthor').value.trim(), pages, page, status });
      const file = f && f.files[0];
      if (file) {
        const fid = uid();
        try {
          await idb.put(fid, file);
          Object.assign(book, { fileId: fid, fileName: file.name, fileSize: file.size, fileType: /\.epub$/i.test(file.name) ? 'EPUB' : 'PDF' });
        } catch (err) { toast('Não consegui guardar o arquivo. O livro foi salvo sem ele.'); }
      }
      if (!b) S.books.push(book);
      save(); closeSheet(); render();
      toast(b ? 'Livro atualizado' : 'Livro na estante');
    });
  });
}

async function openFile(b) {
  try {
    const blob = await idb.get(b.fileId);
    if (!blob) { toast('Arquivo não encontrado neste celular'); return; }
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.target = '_blank'; a.rel = 'noopener';
    if (b.fileType !== 'PDF') a.download = b.fileName; // EPUB abre no app de leitura do celular
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 120000);
  } catch (e) { toast('Não consegui abrir o arquivo'); }
}

/* ---------- ajustes e backup ---------- */
let installEvt = null;
window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); installEvt = e; if (cur.tab === 'hoje') render(); });
window.addEventListener('appinstalled', () => { installEvt = null; toast('App instalado'); render(); });
const standalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
function installBanner() {
  if (standalone()) return '';
  if (installEvt) return `<button class="banner" data-act="install">⬇ INSTALAR NO CELULAR · <b>toque aqui</b></button>`;
  if (/iphone|ipad|ipod/i.test(navigator.userAgent)) return `<div class="banner">Para instalar: toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b></div>`;
  return '';
}

function download(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1500);
}

function sheetSettings() {
  openSheet(`<h2 class="sh-title">Ajustes</h2>
  <form id="fSet" class="form">
    <label>Seu nome<input id="sName" value="${esc(S.name)}"></label>
    <label>Meta de livros por ano<input id="sGoal" type="number" min="1" max="365" inputmode="numeric" value="${S.goal}"></label>
    <div class="actions"><button class="btn" type="submit">Salvar</button></div>
  </form>
  ${installEvt && !standalone() ? '<button class="btn" data-act="install">Instalar no celular</button>' : ''}
  <section class="conn"><h3>BACKUP</h3>
    <p class="muted">Seus dados ficam só neste celular. Exporte um backup de vez em quando e guarde no Drive ou no e-mail. Os arquivos PDF/EPUB não entram no backup.</p>
    <div class="actions"><button class="btn ghost" data-act="export">Exportar backup</button><label class="btn ghost">Importar backup<input type="file" id="sImport" accept="application/json,.json" hidden></label></div>
  </section>
  <section class="conn" style="--c:var(--magenta)"><h3>ZONA DE PERIGO</h3><button class="btn ghost danger" data-act="wipe">Apagar todos os dados</button></section>
  <p class="muted tiny">Chronos 84 · versão 1.0</p>`, c => {
    $('#fSet', c).addEventListener('submit', e => {
      e.preventDefault();
      S.name = $('#sName').value.trim();
      S.goal = Math.max(1, parseInt($('#sGoal').value, 10) || 12);
      save(); closeSheet(); render(); toast('Ajustes salvos');
    });
    $('#sImport', c).addEventListener('change', async ev => {
      const file = ev.target.files[0]; if (!file) return;
      try {
        const data = JSON.parse(await file.text());
        if (!data || !Array.isArray(data.habits) || !Array.isArray(data.entries)) throw new Error('formato');
        if (!confirm(`Importar backup com ${data.entries.length} registros e ${(data.books || []).length} livros? Os dados atuais deste celular serão substituídos.`)) return;
        S = Object.assign(seed(), data, { v: 1 });
        save(); closeSheet(); render(); toast('Backup importado');
      } catch (err) { toast('Esse arquivo não é um backup do Chronos 84'); }
    });
  });
}

/* ================= eventos ================= */
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act],[data-close],[data-tab]');
  if (!el) return;
  if (el.hasAttribute('data-close')) { closeSheet(); return; }
  if (el.dataset.tab) {
    cur.tab = el.dataset.tab;
    if (cur.tab === 'hoje') cur.day = todayKey();
    render(); window.scrollTo(0, 0); return;
  }
  const id = el.dataset.id;
  switch (el.dataset.act) {
    case 'quick': sheetQuick(); break;
    case 'day': if (el.dataset.k <= todayKey()) { cur.day = el.dataset.k; render(); } break;
    case 'toggle': {
      const a = S.log[cur.day] || (S.log[cur.day] = []);
      const i = a.indexOf(id);
      if (i >= 0) a.splice(i, 1); else { a.push(id); if (navigator.vibrate) navigator.vibrate(12); }
      if (!a.length) delete S.log[cur.day];
      save(); render(); break;
    }
    case 'manage': sheetHabits(el.dataset.cat); break;
    case 'save-habits': commitHabitEdits(el.dataset.cat); save(); closeSheet(); render(); toast('Hábitos salvos'); break;
    case 'del-habit': {
      const h = S.habits.find(x => x.id === id); if (!h) break;
      if (!confirm(`Apagar o hábito "${h.name}"? O histórico dele deixa de contar.`)) break;
      commitHabitEdits(h.cat);
      S.habits = S.habits.filter(x => x.id !== id);
      save(); render(); sheetHabits(h.cat); break;
    }
    case 'seg': cur.seg = el.dataset.seg; render(); break;
    case 'new-entry': sheetEntry(el.dataset.type, null, el.dataset.k); break;
    case 'open-entry': sheetDetail(id); break;
    case 'edit-entry': sheetEntry(null, id); break;
    case 'del-entry':
      if (!confirm('Apagar este registro do diário?')) break;
      S.entries = S.entries.filter(x => x.id !== id);
      save(); closeSheet(); render(); toast('Registro apagado'); break;
    case 'ask': cur.q = el.dataset.q; cur.tab = 'memoria'; hideSheetIfOpen(); render(); window.scrollTo(0, 0); break;
    case 'clear-q': cur.q = ''; render(); break;
    case 'new-book': sheetBook(null); break;
    case 'open-book': sheetBook(id); break;
    case 'page': {
      ev.stopPropagation();
      const b = S.books.find(x => x.id === id); if (!b) break;
      b.page = (b.page || 0) + 10;
      if (b.pages && b.page >= b.pages) { b.page = b.pages; toast('Chegou ao fim? Abra o livro e marque como Lido'); }
      save(); render(); break;
    }
    case 'open-file': { const b = S.books.find(x => x.id === id); if (b) openFile(b); break; }
    case 'del-file': {
      const b = S.books.find(x => x.id === id); if (!b) break;
      if (!confirm('Remover o arquivo deste livro? O livro continua na estante.')) break;
      idb.del(b.fileId).catch(() => {});
      delete b.fileId; delete b.fileName; delete b.fileSize; delete b.fileType;
      save(); render(); sheetBook(id); break;
    }
    case 'del-book': {
      const b = S.books.find(x => x.id === id); if (!b) break;
      if (!confirm(`Apagar "${b.title}" da estante?`)) break;
      if (b.fileId) idb.del(b.fileId).catch(() => {});
      S.books = S.books.filter(x => x.id !== id);
      save(); closeSheet(); render(); toast('Livro apagado'); break;
    }
    case 'settings': sheetSettings(); break;
    case 'install':
      if (installEvt) { installEvt.prompt(); installEvt.userChoice.finally(() => { installEvt = null; render(); }); }
      break;
    case 'export':
      download(`chronos84-backup-${todayKey()}.json`, new Blob([JSON.stringify(S, null, 1)], { type: 'application/json' }));
      toast('Backup exportado'); break;
    case 'wipe':
      if (!confirm('Apagar TODOS os dados deste celular? Hábitos, diário e livros. Não dá para desfazer.')) break;
      if (!confirm('Tem certeza? Faça um backup antes se quiser guardar algo.')) break;
      try { localStorage.removeItem(KEY); indexedDB.deleteDatabase('chronos84'); } catch (e) { /* segue */ }
      S = seed(); save(); closeSheet(); cur.tab = 'hoje'; render(); toast('Dados apagados'); break;
  }
});
function hideSheetIfOpen() { if (!$('#sheet').hidden) closeSheet(); }

// livro "lendo agora" é um div clicável: Enter também abre
document.addEventListener('keydown', ev => {
  if (ev.key === 'Enter' && ev.target.matches && ev.target.matches('.now[data-act]')) ev.target.click();
  if (ev.key === 'Escape') closeSheet();
});

document.addEventListener('submit', ev => {
  if (ev.target.id === 'fAsk') {
    ev.preventDefault();
    cur.q = $('#askQ').value.trim();
    render();
    if (document.activeElement) document.activeElement.blur();
  }
});

// virou o dia com o app aberto
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState !== 'visible') return;
  const t = todayKey();
  if (t !== cur.lastToday) { if (cur.day === cur.lastToday) cur.day = t; cur.lastToday = t; render(); }
});

/* ================= início ================= */
render();
if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
if ('serviceWorker' in navigator && location.protocol !== 'file:') {
  window.addEventListener('load', () => navigator.serviceWorker.register('sw.js').catch(() => {}));
}
