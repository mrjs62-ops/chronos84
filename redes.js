'use strict';
/* Chronos 84 — aba REDES: aulas narradas e treino por voz para a CCNA.
   Tudo offline: a voz que fala é a do próprio celular (speechSynthesis) e o microfone usa o reconhecimento
   de voz do navegador (no Android/Chrome ele precisa de internet, a não ser que o pacote offline de pt-BR esteja instalado).
   Revisão espaçada (caixas de Leitner): acertou, a pergunta volta mais tarde; errou, volta já no próximo treino. */

const NET_COLORS = { 1: 'var(--cyan)', 2: 'var(--violet)', 3: 'var(--magenta)', 4: 'var(--sun)', 5: '#ff8b3d', 6: '#39ff9e' };
const NET_INT = [0, 1, 3, 7, 14, 30]; // dias até rever, por caixa
const NET_SIZE = 10;                   // perguntas por treino
const LETRAS = ['A', 'B', 'C', 'D', 'E'];

function netState() {
  if (!S.net) S.net = {};
  const n = S.net;
  n.q = n.q || {}; n.aula = n.aula || {}; n.dias = n.dias || {};
  n.cfg = Object.assign({ hands: true, rate: 1, opts: true }, n.cfg || {});
  return n;
}
const netQid = (m, i) => m.id + '-' + i;
const netMod = id => NET.find(m => m.id === id);
const netAll = () => NET.flatMap(m => m.q.map((q, i) => ({ m, q, id: netQid(m, i) })));
const netDue = id => { const r = netState().q[id]; return !r || daysBetween(r.last, todayKey()) >= NET_INT[r.b]; };
const isMC = q => Array.isArray(q.o);
const shuffle = a => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
const fmtCode = t => esc(t).replace(/`([^`]+)`/g, '<code>$1</code>');

/* ================= voz: falar ================= */
let sayTok = 0, recNow = null, ptVoiceCache = null;
function ptVoice() {
  if (ptVoiceCache || !window.speechSynthesis) return ptVoiceCache;
  const vs = speechSynthesis.getVoices();
  ptVoiceCache = vs.find(v => /pt[-_]BR/i.test(v.lang) && /google/i.test(v.name)) || vs.find(v => /pt[-_]BR/i.test(v.lang)) || vs.find(v => /^pt/i.test(v.lang)) || null;
  return ptVoiceCache;
}
if (window.speechSynthesis) speechSynthesis.onvoiceschanged = () => { ptVoiceCache = null; ptVoice(); };

// deixa o texto "falável": IPs, barras, siglas com ponto, código
function speakable(t) {
  return String(t)
    .replace(/`/g, '')
    .replace(/(\d+)\.(\d+)\.(\d+)\.(\d+)/g, '$1 ponto $2 ponto $3 ponto $4')
    .replace(/802\.(\w+)/g, (m, x) => 'oito zero dois ponto ' + x.replace(/^(\d+)([a-z]+)$/i, (s, n, l) => n + ' ' + l.split('').join(' ')))
    .replace(/\s\/(\d+)/g, ' barra $1')
    .replace(/::/g, ' dois-pontos duplo ')
    .replace(/\(#\)/g, '').replace(/\(>\)/g, '')
    .replace(/[→]/g, ', ')
    .replace(/\s+/g, ' ').trim();
}
// frases curtas: o Chrome às vezes corta falas longas
function chunks(t) {
  const out = [];
  t.split(/(?<=[.!?:;])\s+/).forEach(s => {
    while (s.length > 220) { const k = s.lastIndexOf(',', 220); const cut = k > 60 ? k + 1 : 220; out.push(s.slice(0, cut)); s = s.slice(cut).trim(); }
    if (s) out.push(s);
  });
  return out;
}
function voiceStop() {
  sayTok++;
  try { if (window.speechSynthesis) speechSynthesis.cancel(); } catch (e) { /* ok */ }
  if (recNow) { try { recNow.abort(); } catch (e) { /* ok */ } recNow = null; }
}
function say(text) {
  const my = ++sayTok;
  if (!window.speechSynthesis) return Promise.resolve(false);
  try { speechSynthesis.cancel(); } catch (e) { /* ok */ }
  const parts = chunks(speakable(text));
  return new Promise(res => {
    let i = 0;
    const next = () => {
      if (my !== sayTok) return res(false);
      if (i >= parts.length) return res(true);
      const u = new SpeechSynthesisUtterance(parts[i++]);
      u.lang = 'pt-BR'; const v = ptVoice(); if (v) u.voice = v;
      u.rate = netState().cfg.rate;
      let done = false;
      const fin = () => { if (done) return; done = true; clearTimeout(guard); setTimeout(next, 60); };
      const guard = setTimeout(fin, 4000 + u.text.length * 110 / u.rate);
      u.onend = fin; u.onerror = fin;
      speechSynthesis.speak(u);
    };
    setTimeout(next, 80);
  });
}

/* ================= voz: ouvir ================= */
function listen(onPart) {
  return new Promise(res => {
    if (!SR) return res({ alts: [], err: 'unsupported' });
    const r = new SR();
    r.lang = 'pt-BR'; r.interimResults = true; r.maxAlternatives = 5; r.continuous = false;
    const finals = []; let err = null;
    r.onresult = ev => {
      for (let i = ev.resultIndex; i < ev.results.length; i++) {
        const x = ev.results[i];
        if (x.isFinal) { finals.push(Array.from(x).map(a => a.transcript.trim()).filter(Boolean)); onPart && onPart(finals.map(f => f[0]).join(' '), true); }
        else onPart && onPart(x[0].transcript, false);
      }
    };
    r.onerror = e => { err = e.error; };
    r.onend = () => {
      if (recNow === r) recNow = null;
      const alts = finals.length === 1 ? finals[0] : finals.length ? [finals.map(f => f[0]).join(' ')] : [];
      res({ alts, err });
    };
    try { r.start(); recNow = r; } catch (e) { res({ alts: [], err: 'start' }); }
  });
}

/* ================= entender a resposta ================= */
const NUMW = { zero: 0, um: 1, uma: 1, dois: 2, duas: 2, tres: 3, quatro: 4, cinco: 5, seis: 6, sete: 7, oito: 8, nove: 9, dez: 10, onze: 11, doze: 12, treze: 13, quatorze: 14, catorze: 14, quinze: 15, dezesseis: 16, dezessete: 17, dezoito: 18, dezenove: 19, vinte: 20, trinta: 30, quarenta: 40, cinquenta: 50, sessenta: 60, setenta: 70, oitenta: 80, noventa: 90, cem: 100, cento: 100, duzentos: 200, trezentos: 300, quatrocentos: 400, quinhentos: 500, seiscentos: 600, setecentos: 700, oitocentos: 800, novecentos: 900, mil: 1000 };
function numberize(s) {
  const w = s.split(' '), out = [];
  let acc = null, total = 0;
  const flush = () => { if (acc !== null || total) out.push(String(total + (acc || 0))); acc = null; total = 0; };
  for (let i = 0; i < w.length; i++) {
    const t = w[i];
    if (t in NUMW) { const v = NUMW[t]; if (v === 1000) { total += (acc || 1) * 1000; acc = 0; } else acc = (acc || 0) + v; }
    else if (t === 'e' && (acc !== null || total) && w[i + 1] in NUMW) { /* "vinte e seis" */ }
    else { flush(); out.push(t); }
  }
  flush();
  return out.join(' ');
}
function netNorm(s) {
  let t = norm(s).replace(/[“”"'`´,;!?()\[\]{}]/g, ' ').replace(/[-_]/g, ' ').replace(/\s+/g, ' ').trim();
  t = numberize(t);
  t = t.replace(/\bbarra\s*(?=\d)/g, '/').replace(/\/\s+(?=\d)/g, '/');
  for (let k = 0; k < 3; k++) t = t.replace(/(\d)\s+ponto\s+(\d)/g, '$1.$2');
  t = t.replace(/\.(?=\s|$)/g, ' ');
  t = t.replace(/\b(?:[a-z] ){2,}[a-z]\b/g, m => m.replace(/ /g, '')); // "o s p f" -> "ospf"
  return t.replace(/\s+/g, ' ').trim();
}
const hasPhrase = (t, p) => (' ' + t + ' ').includes(' ' + p + ' ');

function netCommand(raw) {
  const t = netNorm(raw);
  if (t.split(' ').length > 4) return null;
  if (/\b(repet\w*|de novo|outra vez|nao entendi)\b/.test(t)) return 'repetir';
  if (/\b(nao sei|pula|pular|pule|passa|desisto)\b/.test(t)) return 'naosei';
  if (/^(parar|para|pare|encerrar|encerra|sair|chega)( o treino| treino| aqui)?$/.test(t)) return 'parar';
  return null;
}

const LET = { a: 0, b: 1, be: 1, c: 2, ce: 2, se: 2, d: 3, de: 3 };
const ORD = { primeira: 0, '1': 0, segunda: 1, '2': 1, terceira: 2, '3': 2, quarta: 3, '4': 3 };
const NET_STOP = new Set(['o', 'a', 'os', 'as', 'de', 'da', 'do', 'das', 'dos', 'e', 'em', 'no', 'na', 'nos', 'nas', 'um', 'uma', 'para', 'por', 'com', 'que', 'se', 'ao', 'ou', 'so', 'mais', 'é', 'eh']);
const toks = s => netNorm(s).split(' ').filter(w => w && !NET_STOP.has(w));

// devolve o índice (na ordem mostrada) da alternativa que a pessoa falou, ou null
function pickOption(shown, raws) {
  for (const raw of raws) {
    const t = netNorm(raw);
    let m = t.match(/\b(?:letra|alternativa|opcao|resposta|item)\s+([a-d]|be|ce|se|de)\b/);
    if (m && LET[m[1]] < shown.length) return LET[m[1]];
    m = t.match(/^(?:(?:a )?letra )?([a-d]|be|ce|de)$/);
    if (m && LET[m[1]] < shown.length) return LET[m[1]];
    m = t.match(/^(?:a )?(primeira|segunda|terceira|quarta)(?: alternativa| opcao)?$/) || t.match(/\b(?:alternativa|opcao|numero)\s+([1-4])\b/);
    if (m && ORD[m[1]] < shown.length) return ORD[m[1]];
  }
  // a frase inteira, na ordem (resolve alternativas com as mesmas palavras em ordem diferente)
  const on = shown.map(o => toks(o).join(' '));
  for (const raw of raws) {
    const t = toks(raw).join(' ');
    const hits = on.map((o, i) => [o, i]).filter(([o]) => o.length > 1 && hasPhrase(t, o)).sort((x, y) => y[0].length - x[0].length);
    if (hits.length) return hits[0][1];
  }
  // pelo conteúdo: palavras que só aparecem numa alternativa valem mais
  const ot = shown.map(o => [...new Set(toks(o))]);
  const freq = {}; ot.forEach(ws => ws.forEach(w => { freq[w] = (freq[w] || 0) + 1; }));
  let best = null;
  for (const raw of raws) {
    const said = new Set(toks(raw));
    if (!said.size) continue;
    const sc = ot.map(ws => { let tot = 0, hit = 0; ws.forEach(w => { const wt = 1 / freq[w]; tot += wt; if (said.has(w)) hit += wt; }); return tot ? hit / tot : 0; });
    const order = sc.map((v, i) => [v, i]).sort((x, y) => y[0] - x[0]);
    if (order[0][0] >= 0.3 && order[0][0] > (order[1] ? order[1][0] : 0) * 1.5) { best = order[0][1]; break; }
  }
  return best;
}
function matchOpen(q, raws) {
  return raws.some(raw => {
    const t = netNorm(raw);
    return q.ok.some(alt => Array.isArray(alt) ? alt.every(p => hasPhrase(t, netNorm(p))) : hasPhrase(t, netNorm(alt)));
  });
}

/* ================= tela principal ================= */
function netStreak() {
  const d = netState().dias; let k = todayKey(), n = 0;
  if (!(d[k] && d[k].n)) k = addDays(k, -1);
  while (d[k] && d[k].n) { n++; k = addDays(k, -1); }
  return n;
}
function netModStats(m) {
  const n = netState();
  let dom = 0, seen = 0, due = 0;
  m.q.forEach((q, i) => { const r = n.q[netQid(m, i)]; if (r) seen++; if (r && r.b >= 3) dom++; if (netDue(netQid(m, i))) due++; });
  return { dom, seen, due, tot: m.q.length };
}
function vRedes() {
  const n = netState(), cfg = n.cfg, hoje = n.dias[todayKey()] || { n: 0, ok: 0 };
  const all = netAll(), dom = all.filter(x => (n.q[x.id] || {}).b >= 3).length, due = all.filter(x => netDue(x.id)).length;
  const totN = Object.values(n.dias).reduce((s, d) => s + d.n, 0), totOk = Object.values(n.dias).reduce((s, d) => s + d.ok, 0);
  const st = (c, v, l) => `<div class="stat" style="--c:${c}"><b>${v}</b><span>${l}</span></div>`;
  const mods = NET.map((m, i) => {
    const s = netModStats(m), c = NET_COLORS[m.dom];
    return `<div class="netmod" style="--c:${c}">
      <div class="nm-h"><span class="nm-n">${pad(i + 1)}</span><div class="nm-t"><b>${esc(m.nome)}</b><small>${esc(NET_DOM[m.dom])} · ${s.dom}/${s.tot} dominadas${n.aula[m.id] ? '' : ' · aula nova'}</small></div></div>
      <div class="prog"><i style="width:${Math.round(s.dom / s.tot * 100)}%;background:${c};box-shadow:0 0 8px ${c}"></i></div>
      <div class="nm-a"><button class="plus" data-act="net-aula" data-mod="${m.id}">▶ AULA</button><button class="plus" data-act="net-go" data-mod="${m.id}">${ICON.mic} TREINAR</button></div>
    </div>`;
  }).join('');
  return `
  <header class="top"><p class="h-eyebrow">Estudos · CCNA 200-301</p><h1 class="h-title">Laboratório de Redes</h1></header>
  <div class="stats">${st('var(--cyan)', hoje.n, 'hoje')}${st('var(--sun)', totN ? Math.round(totOk / totN * 100) + '%' : '—', 'acerto')}${st('var(--magenta)', dom, 'dominadas')}${st('var(--violet)', netStreak(), plural(netStreak(), 'dia'))}</div>
  <button class="btn netgo" data-act="net-go">${ICON.mic} TREINO POR VOZ</button>
  <p class="muted tiny">${NET_SIZE} perguntas por treino · ${due} de ${all.length} para revisar hoje. As que você erra voltam antes.</p>
  ${SR ? '' : '<div class="empty small">Este navegador não reconhece voz. Use o Chrome no Android; aqui você ainda pode responder tocando nas alternativas ou digitando.</div>'}
  <section class="netcfg">
    <button class="tgl ${cfg.hands ? 'on' : ''}" data-act="net-hands" aria-pressed="${cfg.hands}"><i></i><span><b>Mãos livres</b><small>lê a pergunta e já abre o microfone</small></span></button>
    <div class="seg three netrate">${[[0.9, 'DEVAGAR'], [1, 'NORMAL'], [1.15, 'RÁPIDO']].map(([r, l]) => `<button class="${cfg.rate === r ? 'on' : ''}" data-act="net-rate" data-r="${r}">${l}</button>`).join('')}</div>
  </section>
  <div class="shelf-h"><h3 style="color:var(--cyan)">MÓDULOS</h3><span>${NET.length} temas</span></div>
  ${mods}
  <p class="muted tiny">Comandos de voz durante o treino: "repetir", "não sei", "parar". Nas alternativas, diga "letra B" ou o conteúdo da resposta.</p>`;
}

/* ================= aula ================= */
let aulaNow = null;
function sheetAula(id) {
  const m = netMod(id); if (!m) return;
  voiceStop();
  netState().aula[id] = todayKey(); save();
  const c = NET_COLORS[m.dom];
  openSheet(`<p class="h-eyebrow" style="color:${c}">${esc(NET_DOM[m.dom])} · AULA</p>
  <h2 class="sh-title">${esc(m.nome)}</h2>
  <button class="btn" id="aulaPlay" data-act="net-aula-play">▶ OUVIR AULA</button>
  <div class="aula" style="--c:${c}">${m.aula.map((b, i) => `<section class="ab" id="ab-${i}" data-act="net-aula-from" data-i="${i}"><h4>${esc(b.h)}</h4><p>${fmtCode(b.p)}</p></section>`).join('')}</div>
  <p class="muted tiny">Toque num bloco para ouvir a partir dele.</p>
  <div class="actions"><button class="btn ghost" data-close>Fechar</button><button class="btn" data-act="net-go" data-mod="${m.id}">${ICON.mic} Treinar este tema</button></div>`);
  aulaNow = { id, playing: false };
}
async function aulaPlay(from) {
  const a = aulaNow; if (!a) return;
  const m = netMod(a.id), btn = $('#aulaPlay');
  if (a.playing && from == null) { voiceStop(); return; }
  voiceStop();
  const me = {}; a.run = me; a.playing = true;
  if (btn) btn.textContent = '■ PARAR';
  for (let i = from || 0; i < m.aula.length; i++) {
    document.querySelectorAll('.ab').forEach(e => e.classList.toggle('reading', e.id === 'ab-' + i));
    const el = $('#ab-' + i); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    const ok = await say(m.aula[i].h + '. ' + m.aula[i].p);
    if (!ok || a.run !== me || aulaNow !== a) break;
  }
  if (a.run === me) {
    a.playing = false;
    document.querySelectorAll('.ab').forEach(e => e.classList.remove('reading'));
    const b = $('#aulaPlay'); if (b) b.textContent = '▶ OUVIR AULA';
  }
}

/* ================= treino ================= */
let NQ = null;
const alive = s => NQ === s && !$('#sheet').hidden;

function netPick(modId) {
  const n = netState();
  const pool = netAll().filter(x => !modId || x.m.id === modId);
  const due = shuffle(pool.filter(x => netDue(x.id))).sort((a, b) => ((n.q[a.id] || { b: -1 }).b) - ((n.q[b.id] || { b: -1 }).b));
  const rest = pool.filter(x => !netDue(x.id)).sort((a, b) => n.q[a.id].last.localeCompare(n.q[b.id].last));
  return due.concat(rest).slice(0, NET_SIZE).map(x => Object.assign({}, x, { shown: isMC(x.q) ? shuffle(x.q.o) : null }));
}
function netGo(modId) {
  voiceStop(); aulaNow = null;
  NQ = { mod: modId || null, list: netPick(modId), i: 0, ok: 0, miss: [], phase: 'ask', tries: 0 };
  showQ(NQ, true);
}
const curItem = s => s.list[s.i];
const correctIdx = it => it.shown.indexOf(it.q.o[0]);
const answerText = it => isMC(it.q) ? `letra ${LETRAS[correctIdx(it)]}, ${it.q.o[0]}` : it.q.r;
function questionSpeech(it) {
  let t = it.q.t;
  if (isMC(it.q) && netState().cfg.opts) t += ' ' + it.shown.map((o, i) => `${LETRAS[i]}: ${o}.`).join(' ');
  return t;
}

function qHtml(s) {
  const it = curItem(s), q = it.q, c = NET_COLORS[it.m.dom], fb = s.phase === 'fb';
  const opts = isMC(q) ? `<div class="opts">${it.shown.map((o, i) => {
    const cls = fb ? (i === correctIdx(it) ? 'ok' : i === s.chosen ? 'bad' : 'dim') : '';
    return `<button class="opt ${cls}" data-act="net-opt" data-i="${i}" ${fb ? 'disabled' : ''}><b>${LETRAS[i]}</b><span>${fmtCode(o)}</span></button>`;
  }).join('')}</div>`
    : (fb ? '' : `<form id="fNetAns" class="netans"><input id="netAnsIn" placeholder="ou digite a resposta" autocomplete="off" enterkeyhint="send"><button class="btn sm" type="submit">OK</button></form>`);
  const feedback = fb ? `<div class="fb ${s.right ? 'ok' : 'bad'}">
      <b>${s.right ? '✓ CORRETO' : s.skipped ? '→ RESPOSTA' : '✕ NÃO É ISSO'}</b>
      ${s.right ? '' : `<p>Resposta: <em>${fmtCode(isMC(q) ? LETRAS[correctIdx(it)] + ') ' + q.o[0] : q.r)}</em></p>`}
      <p>${fmtCode(q.ex)}</p>
      ${!s.right && !s.skipped && s.heard ? `<button class="linkbtn" data-act="net-override">Eu respondi certo, o app ouviu errado</button>` : ''}
    </div>` : '';
  const ctl = fb
    ? `<div class="actions"><button class="btn ghost" data-act="net-end">Encerrar</button><button class="btn" data-act="net-next">${s.i + 1 < s.list.length ? 'Próxima ›' : 'Ver resultado'}</button></div>`
    : `<div class="qctl">
        <button class="icon-btn" data-act="net-rep" aria-label="Repetir a pergunta">↻</button>
        <button class="bigmic ${s.listening ? 'on' : ''}" data-act="net-mic" aria-label="${s.listening ? 'Parar de ouvir' : 'Responder por voz'}" ${SR ? '' : 'disabled'}>${ICON.mic}</button>
        <button class="icon-btn" data-act="net-skip" aria-label="Não sei">?</button>
      </div>`;
  return `<div class="qz" style="--c:${c}">
    <div class="qz-top"><span>${esc(it.m.nome)}</span><span>${s.i + 1}/${s.list.length} · ${s.ok} ✓</span></div>
    <div class="goalbar"><i style="width:${s.i / s.list.length * 100}%"></i></div>
    <p class="qz-q">${fmtCode(q.t)}</p>
    ${opts}
    <div class="heard" id="netHeard">${s.heard ? 'VOCÊ DISSE: <em>' + esc(s.heard) + '</em>' : s.hint ? esc(s.hint) : (SR ? 'Toque no microfone e responda.' : 'Toque na resposta.')}</div>
    ${feedback}
    ${ctl}
  </div>`;
}
function paintQ(s) { if (alive(s) || (NQ === s && $('#sheet').hidden && s.first)) { openSheet(qHtml(s)); s.first = false; } }

async function showQ(s, first) {
  s.phase = 'ask'; s.heard = ''; s.hint = ''; s.tries = 0; s.listening = false; s.first = !!first;
  paintQ(s);
  if (netState().cfg.hands) {
    const ok = await say(questionSpeech(curItem(s)));
    if (ok && alive(s) && s.phase === 'ask') setTimeout(() => { if (alive(s) && s.phase === 'ask' && !s.listening) listenAnswer(s); }, 250);
  }
}
async function listenAnswer(s) {
  if (!SR || s.phase !== 'ask') return;
  voiceStop();
  const my = s.lt = (s.lt || 0) + 1;
  s.listening = true; s.heard = ''; s.hint = 'Ouvindo…';
  paintQ(s);
  const { alts, err } = await listen((txt) => { const h = $('#netHeard'); if (h && alive(s) && s.lt === my) h.innerHTML = 'VOCÊ DISSE: <em>' + esc(txt) + '</em>'; });
  if (!alive(s) || s.phase !== 'ask' || s.lt !== my) return;
  s.listening = false;
  if (!alts.length) {
    s.hint = err === 'not-allowed' || err === 'service-not-allowed' ? 'Permita o microfone nas configurações do Chrome.'
      : err === 'network' ? 'O reconhecimento de voz precisa de internet. Responda tocando ou digitando.'
      : err === 'aborted' ? '' : 'Não ouvi nada. Toque no microfone e fale.';
    paintQ(s); return;
  }
  s.heard = alts[0];
  const cmd = netCommand(alts[0]);
  if (cmd === 'repetir') { s.heard = ''; return showQ(s); }
  if (cmd === 'parar') return netFinish(s);
  if (cmd === 'naosei') return grade(s, false, { skipped: true });
  const it = curItem(s);
  if (isMC(it.q)) {
    const idx = pickOption(it.shown, alts);
    if (idx == null) {
      s.tries++;
      s.hint = '';
      paintQ(s);
      if (s.tries <= 2 && netState().cfg.hands) {
        const ok = await say('Não entendi. Diga a letra, por exemplo: letra B.');
        if (ok && alive(s) && s.phase === 'ask') listenAnswer(s);
      }
      return;
    }
    return grade(s, idx === correctIdx(it), { chosen: idx });
  }
  return grade(s, matchOpen(it.q, alts), {});
}
function netRecord(id, right) {
  const n = netState(), k = todayKey();
  const r = n.q[id] || (n.q[id] = { b: 0, n: 0, ok: 0, last: k });
  r.n++; r.last = k; r.prevB = r.b;
  if (right) { r.ok++; r.b = Math.min(NET_INT.length - 1, r.b + 1); } else r.b = 0;
  const d = n.dias[k] || (n.dias[k] = { n: 0, ok: 0 });
  d.n++; if (right) d.ok++;
  save();
}
async function grade(s, right, o) {
  const it = curItem(s);
  s.phase = 'fb'; s.right = right; s.skipped = !!o.skipped; s.chosen = o.chosen;
  netRecord(it.id, right);
  if (right) s.ok++; else s.miss.push(it);
  if (navigator.vibrate) navigator.vibrate(right ? 15 : [30, 60, 30]);
  paintQ(s);
  const txt = right ? 'Correto! ' + it.q.ex : (s.skipped ? 'A resposta é: ' : 'Não é isso. A resposta certa é: ') + answerText(it) + '. ' + it.q.ex;
  const ok = await say(txt);
  if (ok && alive(s) && s.phase === 'fb' && netState().cfg.hands) setTimeout(() => { if (alive(s) && s.phase === 'fb') netNext(s); }, 900);
}
function netOverride(s) {
  const it = curItem(s); if (s.phase !== 'fb' || s.right) return;
  const n = netState(), r = n.q[it.id], d = n.dias[todayKey()];
  if (r) { r.ok++; r.b = Math.min(NET_INT.length - 1, (r.prevB || 0) + 1); }
  if (d) d.ok++;
  s.ok++; s.miss = s.miss.filter(x => x !== it); s.right = true;
  save(); voiceStop(); paintQ(s);
}
function netNext(s) {
  voiceStop();
  if (s.i + 1 >= s.list.length) return netFinish(s);
  s.i++; showQ(s);
}
function netFinish(s) {
  voiceStop();
  const answered = s.i + (s.phase === 'fb' ? 1 : 0);
  s.phase = 'end';
  const pct = answered ? Math.round(s.ok / answered * 100) : 0;
  openSheet(`<div class="qz" style="--c:var(--cyan)">
    <p class="h-eyebrow">TREINO CONCLUÍDO</p>
    <h2 class="sh-title">${s.ok} de ${answered} certas · ${pct}%</h2>
    ${s.miss.length ? `<section class="panel"><h3>PARA REVER</h3>${s.miss.map(it => `<div class="miss"><p>${fmtCode(it.q.t)}</p><em>${fmtCode(isMC(it.q) ? it.q.o[0] : it.q.r)}</em></div>`).join('')}</section>` : '<div class="empty">Nenhum erro. <b>Excelente.</b></div>'}
    <div class="actions"><button class="btn ghost" data-close>Fechar</button><button class="btn" data-act="net-go" ${s.mod ? `data-mod="${s.mod}"` : ''}>Novo treino</button></div>
  </div>`);
  NQ = null;
  if (cur.tab === 'redes') render();
  say(answered ? `Treino concluído. Você acertou ${s.ok} de ${answered}.` + (s.miss.length ? ' As que errou vão voltar no próximo treino.' : ' Mandou muito bem.') : 'Treino encerrado.');
}
// chamado por hideSheet (app.js): fechar a folha cala a voz e solta o microfone
function netStop() { voiceStop(); NQ = null; aulaNow = null; }

/* ================= eventos ================= */
document.addEventListener('click', ev => {
  const el = ev.target.closest('[data-act^="net-"]');
  if (!el) return;
  const s = NQ;
  switch (el.dataset.act) {
    case 'net-go': netGo(el.dataset.mod); break;
    case 'net-aula': sheetAula(el.dataset.mod); break;
    case 'net-aula-play': aulaPlay(); break;
    case 'net-aula-from': aulaPlay(+el.dataset.i); break;
    case 'net-hands': { const c = netState().cfg; c.hands = !c.hands; save(); render(); break; }
    case 'net-rate': netState().cfg.rate = +el.dataset.r; save(); render(); say('Velocidade da voz ajustada.'); break;
    case 'net-mic': if (!s) break; if (s.listening) { voiceStop(); s.listening = false; s.hint = ''; paintQ(s); } else listenAnswer(s); break;
    case 'net-rep': if (s) { voiceStop(); showQ(s); } break;
    case 'net-skip': if (s && s.phase === 'ask') { voiceStop(); grade(s, false, { skipped: true }); } break;
    case 'net-opt': if (s && s.phase === 'ask') { voiceStop(); const i = +el.dataset.i; grade(s, i === correctIdx(curItem(s)), { chosen: i }); } break;
    case 'net-next': if (s) netNext(s); break;
    case 'net-end': if (s) netFinish(s); break;
    case 'net-override': if (s) netOverride(s); break;
  }
});
document.addEventListener('submit', ev => {
  if (ev.target.id !== 'fNetAns') return;
  ev.preventDefault();
  const s = NQ, v = $('#netAnsIn').value.trim();
  if (!s || s.phase !== 'ask' || !v) return;
  voiceStop(); s.heard = v;
  grade(s, matchOpen(curItem(s).q, [v]), {});
});
