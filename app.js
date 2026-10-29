'use strict';
/* Gramm – private Kalorien-App. Alles läuft im Browser, Daten liegen in IndexedDB auf dem Gerät. */

// ---------- Hilfsfunktionen ----------
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const r0 = n => Math.round(Number(n) || 0);
const r1 = n => Math.round((Number(n) || 0) * 10) / 10;
const fmt = n => r0(n).toLocaleString('de-DE');
const fmt1 = n => r1(n).toLocaleString('de-DE', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
const num = v => { if (v === null || v === undefined || v === '') return NaN; return Number(String(v).replace(',', '.')); };
const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
const toDateStr = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const parseDate = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d); };
const addDays = (s, n) => { const d = parseDate(s); d.setDate(d.getDate() + n); return toDateStr(d); };
const todayStr = () => toDateStr(new Date());
const nowTime = () => { const d = new Date(); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const MONTHS = ['Jan', 'Feb', 'März', 'Apr', 'Mai', 'Juni', 'Juli', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];
const shortDate = s => { const d = parseDate(s); return `${d.getDate()}. ${MONTHS[d.getMonth()]}`; };
function niceDate(s) {
  const t = todayStr();
  if (s === t) return 'Heute';
  if (s === addDays(t, -1)) return 'Gestern';
  if (s === addDays(t, 1)) return 'Morgen';
  const d = parseDate(s);
  return `${DAYS[d.getDay()]}, ${d.getDate()}. ${MONTHS[d.getMonth()]}`;
}
function mondayOf(s) { const d = parseDate(s); const wd = (d.getDay() + 6) % 7; d.setDate(d.getDate() - wd); return toDateStr(d); }

const MEALS = [
  { id: 'breakfast', name: 'Frühstück' },
  { id: 'lunch', name: 'Mittagessen' },
  { id: 'dinner', name: 'Abendessen' },
  { id: 'snack', name: 'Snacks' },
];
const mealName = id => (MEALS.find(m => m.id === id) || MEALS[3]).name;
function defaultMeal() {
  const h = new Date().getHours();
  if (h < 10) return 'breakfast';
  if (h < 15) return 'lunch';
  if (h < 21) return 'dinner';
  return 'snack';
}

// Supplements: Ohne Eintrag für einen Tag gelten alle täglichen als genommen.
function takenFor(rec) { return new Set(rec ? rec.taken : S.supps.filter(x => x.daily !== false).map(x => x.id)); }
const SUPP_NUTRIENTS = [
  ['vitD_ug', 'Vitamin D', 'µg'], ['vitK2_ug', 'Vitamin K2', 'µg'], ['vitC_mg', 'Vitamin C', 'mg'], ['zinc_mg', 'Zink', 'mg'],
  ['epa_mg', 'EPA', 'mg'], ['dha_mg', 'DHA', 'mg'], ['vitE_mg', 'Vitamin E', 'mg'], ['creatine_g', 'Kreatin', 'g'],
];

// ---------- Datenbank ----------
const DB_NAME = 'gramm';
const DB_VER = 2;
const STORES = { entries: 'id', foods: 'id', dishes: 'id', weights: 'date', waist: 'date', water: 'date', phases: 'id', settings: 'key', suppLog: 'date' };
let dbPromise;
function db() {
  if (!dbPromise) dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VER);
    req.onupgradeneeded = () => {
      const d = req.result;
      for (const [name, key] of Object.entries(STORES)) {
        if (!d.objectStoreNames.contains(name)) {
          const s = d.createObjectStore(name, { keyPath: key });
          if (name === 'entries') s.createIndex('date', 'date');
          if (name === 'foods') s.createIndex('barcode', 'barcode');
        }
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(store, mode);
    const s = t.objectStore(store);
    let out;
    const r = fn(s);
    if (r && 'onsuccess' in r) r.onsuccess = () => { out = r.result; };
    t.oncomplete = () => { if (mode === 'readwrite' && store !== 'settings') scheduleSync(); resolve(out); };
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}
const dbGet = (st, k) => tx(st, 'readonly', s => s.get(k));
const dbAll = st => tx(st, 'readonly', s => s.getAll());
const dbPut = (st, v) => tx(st, 'readwrite', s => s.put(v));
const dbDel = (st, k) => tx(st, 'readwrite', s => s.delete(k));
const dbClear = st => tx(st, 'readwrite', s => s.clear());
const entriesOn = date => tx('entries', 'readonly', s => s.index('date').getAll(date));
const entriesBetween = (a, b) => tx('entries', 'readonly', s => s.index('date').getAll(IDBKeyRange.bound(a, b)));
async function dbPutMany(st, arr) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(st, 'readwrite');
    const s = t.objectStore(st);
    arr.forEach(v => s.put(v));
    t.oncomplete = () => { if (st !== 'settings') scheduleSync(); resolve(); };
    t.onerror = () => reject(t.error);
  });
}

// ---------- Einstellungen ----------
const DEFAULTS = {
  goalKcal: 2900, goalP: 180, goalF: 80, goalC: 365,
  waterGoal: 3000, glassSize: 250,
  apiKey: '', model: 'claude-sonnet-5-5',
  ghToken: '', ghRepo: '', autoSync: true, lastSync: 0, dirty: 0, vorgabenVersion: 0,
  supps: [],
  seeded: false,
};
const S = { ...DEFAULTS };
async function loadSettings() {
  const all = await dbAll('settings');
  all.forEach(r => { S[r.key] = r.value; });
}
async function setSetting(key, value) { S[key] = value; await dbPut('settings', { key, value }); }

// Startdaten: Toms Plan bis Sommer 2027
const SEED_PHASES = [
  { name: 'Erstes Defizit', type: 'defizit', start: '2026-11-02', end: '2026-12-20', kcal: 2500, p: 180, f: 70, c: 290 },
  { name: 'Feiertage', type: 'erhaltung', start: '2026-12-21', end: '2027-01-03', kcal: 2900, p: 180, f: 80, c: 365 },
  { name: 'Aufbau', type: 'erhaltung', start: '2027-01-04', end: '2027-01-31', kcal: 2900, p: 180, f: 80, c: 365 },
  { name: 'Großes Defizit', type: 'defizit', start: '2027-02-01', end: '2027-06-27', kcal: 2400, p: 180, f: 65, c: 275 },
  { name: 'Diät-Pause Ostern', type: 'erhaltung', start: '2027-03-22', end: '2027-03-28', kcal: 2900, p: 180, f: 80, c: 365 },
  { name: 'Sommer', type: 'erhaltung', start: '2027-06-28', end: '2027-08-31', kcal: 2800, p: 180, f: 75, c: 350 },
];
async function seedIfNeeded() {
  if (S.seeded) return;
  const existing = await dbAll('phases');
  if (!existing.length) await dbPutMany('phases', SEED_PHASES.map(p => ({ id: uid(), ...p })));
  await setSetting('seeded', true);
}

let PHASES = [];
async function loadPhases() { PHASES = (await dbAll('phases')).sort((a, b) => a.start.localeCompare(b.start)); }
function phaseFor(date) {
  // Die Phase mit dem spätesten Start gewinnt, so liegt eine Pause über einem Defizit.
  return PHASES.filter(p => p.start <= date && date <= p.end).sort((a, b) => b.start.localeCompare(a.start))[0] || null;
}
function goalsFor(date) {
  const p = phaseFor(date);
  if (p) return { kcal: p.kcal, p: p.p, f: p.f, c: p.c, phase: p };
  return { kcal: S.goalKcal, p: S.goalP, f: S.goalF, c: S.goalC, phase: null };
}

// ---------- Oberfläche: Grundgerüst ----------
const state = { tab: 'diary', date: todayStr(), weightRange: 84, statsRange: 30 };
const view = () => $('#view');

function toast(msg, ms = 2400) {
  const root = $('#toast-root');
  root.innerHTML = `<div class="toast" role="status">${esc(msg)}</div>`;
  clearTimeout(toast.t);
  toast.t = setTimeout(() => { root.innerHTML = ''; }, ms);
}

let sheetCleanup = null;
function openSheet(title, bodyHtml, { onClose } = {}) {
  closeSheet();
  const root = $('#sheet-root');
  root.innerHTML = `<div class="backdrop" data-close="1"><div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="grab"></div><div class="sheet-head"><h2>${esc(title)}</h2><button class="iconbtn" data-close="1" aria-label="Schließen">✕</button></div><div class="sheet-body">${bodyHtml}</div></div></div>`;
  sheetCleanup = onClose || null;
  root.querySelector('.backdrop').addEventListener('click', e => { if (e.target.dataset.close) closeSheet(); });
  return root.querySelector('.sheet-body');
}
function closeSheet() {
  if (sheetCleanup) { try { sheetCleanup(); } catch (e) { /* egal */ } sheetCleanup = null; }
  $('#sheet-root').innerHTML = '';
}
function setSheetBody(html) { const b = $('#sheet-root .sheet-body'); if (b) b.innerHTML = html; return b; }
function sheetOpen() { return !!$('#sheet-root .sheet'); }

function switchTab(tab) {
  state.tab = tab;
  $$('nav.tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
  window.scrollTo(0, 0);
  render();
}
async function render() {
  const t = state.tab;
  if (t === 'diary') await renderDiary();
  else if (t === 'weight') await renderWeight();
  else if (t === 'stats') await renderStats();
  else if (t === 'settings') await renderSettings();
}

// ---------- Nährwerte ----------
const NKEYS = ['kcal', 'p', 'f', 'c', 'fib', 'sug', 'salt'];
function calc(per100, grams) {
  const k = (Number(grams) || 0) / 100;
  const o = {};
  NKEYS.forEach(n => { o[n] = (per100[n] || 0) * k; });
  return o;
}
function sumEntries(list) {
  const o = {};
  NKEYS.forEach(n => { o[n] = 0; });
  list.forEach(e => NKEYS.forEach(n => { o[n] += Number(e[n]) || 0; }));
  return o;
}
function nutriHtml(v) {
  return `<div class="nutri num"><div><b>${fmt(v.kcal)}</b><span>kcal</span></div><div><b>${fmt1(v.p)}</b><span>Eiweiß</span></div><div><b>${fmt1(v.f)}</b><span>Fett</span></div><div><b>${fmt1(v.c)}</b><span>KH</span></div></div>`;
}

// ---------- Tagebuch ----------
async function renderDiary() {
  const date = state.date;
  const [entries, waterRec, weightRec, suppRec] = await Promise.all([entriesOn(date), dbGet('water', date), dbGet('weights', date), dbGet('suppLog', date)]);
  const taken = takenFor(suppRec);
  const g = goalsFor(date);
  const tot = sumEntries(entries);
  const left = g.kcal - tot.kcal;
  const pct = Math.min(1, g.kcal ? tot.kcal / g.kcal : 0);
  const C = 2 * Math.PI * 52;
  const ringColor = left < 0 ? 'var(--danger)' : 'var(--accent)';
  const macroRow = (lab, val, goal, color) => {
    const w = goal ? Math.min(100, (val / goal) * 100) : 0;
    const over = val > goal * 1.05;
    return `<div class="macro"><div class="lab"><span>${lab}</span><span class="num ${over ? 'over' : ''}">${fmt(val)} / ${fmt(goal)} g</span></div><div class="track"><i style="width:${w}%;background:${color}"></i></div></div>`;
  };
  const water = waterRec ? waterRec.ml : 0;
  const glasses = Math.max(1, Math.ceil(S.waterGoal / S.glassSize));
  const full = Math.floor(water / S.glassSize);
  let glassHtml = '';
  for (let i = 0; i < Math.max(glasses, full); i++) glassHtml += `<span class="glass ${i < full ? 'full' : ''}"></span>`;

  const mealsHtml = MEALS.map(m => {
    const list = entries.filter(e => e.meal === m.id).sort((a, b) => (a.created || 0) - (b.created || 0));
    const s = sumEntries(list);
    const rows = list.map(e => `<div class="entry" data-edit="${e.id}"><div style="min-width:0"><div class="name">${esc(e.name)}</div><div class="meta num">${e.grams ? fmt(e.grams) + ' g · ' : ''}E ${fmt(e.p)} · F ${fmt(e.f)} · KH ${fmt(e.c)}</div></div><div class="kc num">${fmt(e.kcal)}</div></div>`).join('');
    return `<section class="card"><div class="meal-head"><h3>${m.name}</h3><span class="muted small num">${fmt(s.kcal)} kcal</span></div>${rows ? `<div style="margin-top:6px">${rows}</div>` : ''}<button class="addbtn" data-add="${m.id}">+ Essen hinzufügen</button>${list.length ? `<div class="row between" style="margin-top:4px"><button class="linkbtn" data-savedish="${m.id}">Als Gericht speichern</button><button class="linkbtn" data-copymeal="${m.id}">Von gestern kopieren</button></div>` : `<div class="row" style="margin-top:4px"><button class="linkbtn" data-copymeal="${m.id}">Von gestern kopieren</button></div>`}</section>`;
  }).join('');

  view().innerHTML = `
    <div class="datebar">
      <button class="iconbtn" data-day="-1" aria-label="Vorheriger Tag">‹</button>
      <button class="lbl" id="datelbl">${esc(niceDate(date))}</button>
      <button class="iconbtn" data-day="1" aria-label="Nächster Tag">›</button>
    </div>
    <input type="date" id="datepick" class="hidden" value="${date}">
    <section class="card">
      <div class="row between" style="margin-bottom:10px">
        <span class="chip">${g.phase ? esc(g.phase.name) : 'Standard-Ziel'}</span>
        <span class="muted small num">Ziel ${fmt(g.kcal)} kcal</span>
      </div>
      <div class="summary">
        <div class="ring">
          <svg viewBox="0 0 120 120"><circle cx="60" cy="60" r="52" fill="none" stroke="var(--card2)" stroke-width="12"/><circle cx="60" cy="60" r="52" fill="none" stroke="${ringColor}" stroke-width="12" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="${C * (1 - pct)}"/></svg>
          <div class="center"><span class="big num ${left < 0 ? 'over' : ''}">${fmt(Math.abs(left))}</span><span class="tiny muted">${left < 0 ? 'kcal zu viel' : 'kcal übrig'}</span><span class="tiny muted num">${fmt(tot.kcal)} / ${fmt(g.kcal)}</span></div>
        </div>
        <div class="macros">
          ${macroRow('Eiweiß', tot.p, g.p, 'var(--prot)')}
          ${macroRow('Fett', tot.f, g.f, 'var(--fat)')}
          ${macroRow('Kohlenhydrate', tot.c, g.c, 'var(--carb)')}
        </div>
      </div>
    </section>
    <section class="card">
      <div class="row between"><h3 style="margin:0">Wasser</h3><span class="muted small num">${fmt1(water / 1000)} / ${fmt1(S.waterGoal / 1000)} l</span></div>
      <div class="glasses">${glassHtml}</div>
      <div class="btns" style="margin-top:10px"><button class="btn" data-water="-1">− Glas</button><button class="btn primary" data-water="1">+ Glas (${S.glassSize} ml)</button></div>
    </section>
    ${S.supps.length ? `<section class="card"><div class="row between"><h3 style="margin:0">Supplements</h3><span class="muted small num">${S.supps.filter(x => taken.has(x.id)).length} / ${S.supps.length}</span></div><div class="quick" style="margin-top:8px">${S.supps.map(x => `<button class="suppbtn ${taken.has(x.id) ? 'on' : ''}" data-supp="${x.id}" aria-pressed="${taken.has(x.id)}">${taken.has(x.id) ? '✓ ' : ''}${esc(x.name)}${x.dose ? ' · ' + esc(x.dose) : ''}</button>`).join('')}</div></section>` : ''}
    ${date === todayStr() && !weightRec ? `<section class="card row between"><span>Heute noch nicht gewogen.</span><button class="btn primary" id="quickweigh">Gewicht eintragen</button></section>` : ''}
    ${mealsHtml}
  `;

  $$('[data-day]').forEach(b => b.onclick = () => { state.date = addDays(state.date, Number(b.dataset.day)); renderDiary(); });
  $('#datelbl').onclick = () => { const p = $('#datepick'); if (p.showPicker) { try { p.classList.remove('hidden'); p.showPicker(); } catch (e) { p.classList.remove('hidden'); p.focus(); } } else { p.classList.remove('hidden'); p.focus(); } };
  $('#datepick').onchange = e => { if (e.target.value) { state.date = e.target.value; renderDiary(); } };
  $$('[data-water]').forEach(b => b.onclick = async () => {
    const delta = Number(b.dataset.water) * S.glassSize;
    const cur = (await dbGet('water', date))?.ml || 0;
    await dbPut('water', { date, ml: Math.max(0, cur + delta) });
    renderDiary();
  });
  $$('[data-add]').forEach(b => b.onclick = () => openAddSheet(b.dataset.add));
  $$('[data-edit]').forEach(el => el.onclick = () => openEditEntry(el.dataset.edit));
  $$('[data-savedish]').forEach(b => b.onclick = () => saveMealAsDish(b.dataset.savedish));
  $$('[data-copymeal]').forEach(b => b.onclick = () => copyMealFromYesterday(b.dataset.copymeal));
  const qw = $('#quickweigh'); if (qw) qw.onclick = () => openWeightSheet(todayStr());
  $$('[data-supp]').forEach(b => b.onclick = async () => {
    const id = b.dataset.supp;
    if (taken.has(id)) taken.delete(id); else taken.add(id);
    await dbPut('suppLog', { date, taken: Array.from(taken) });
    renderDiary();
  });
}

async function addEntry({ name, grams, per100, meal, foodId, totals }) {
  const v = totals || calc(per100, grams);
  const e = { id: uid(), date: state.date, meal, name, grams: grams ? Number(grams) : 0, foodId: foodId || null, per100: per100 || null, created: Date.now(), ...v };
  await dbPut('entries', e);
  return e;
}

async function copyMealFromYesterday(meal) {
  const y = addDays(state.date, -1);
  const list = (await entriesOn(y)).filter(e => e.meal === meal);
  if (!list.length) { toast(`Gestern gab es kein ${mealName(meal)}.`); return; }
  await dbPutMany('entries', list.map(e => ({ ...e, id: uid(), date: state.date, created: Date.now() })));
  toast(`${list.length} Einträge kopiert.`);
  renderDiary();
}

async function saveMealAsDish(meal) {
  const list = (await entriesOn(state.date)).filter(e => e.meal === meal);
  if (!list.length) return;
  const body = openSheet('Als Gericht speichern', `
    <p class="muted small" style="margin:0">Das Gericht enthält ${list.length} Zutaten mit ${fmt(sumEntries(list).kcal)} kcal.</p>
    <label class="f">Name des Gerichts<input type="text" id="dishname" placeholder="z. B. Mein Frühstück"></label>
    <button class="btn primary block" id="dishsave">Speichern</button>`);
  $('#dishname', body).focus();
  $('#dishsave', body).onclick = async () => {
    const name = $('#dishname', body).value.trim();
    if (!name) { toast('Bitte gib einen Namen ein.'); return; }
    const items = list.map(e => ({ name: e.name, grams: e.grams, per100: e.per100, totals: { kcal: e.kcal, p: e.p, f: e.f, c: e.c } }));
    await dbPut('dishes', { id: uid(), name, items, created: Date.now() });
    closeSheet();
    toast('Gericht gespeichert.');
  };
}

async function openEditEntry(id) {
  const e = await dbGet('entries', id);
  if (!e) return;
  const hasPer100 = e.per100 && e.grams;
  const body = openSheet('Eintrag bearbeiten', `
    <div class="t" style="font-weight:700">${esc(e.name)}</div>
    ${hasPer100 ? `<label class="f">Menge in Gramm<input type="number" inputmode="decimal" id="eg" value="${e.grams}"></label>` : `
      <div class="grid2">
        <label class="f">Kalorien<input type="number" inputmode="decimal" id="ek" value="${r0(e.kcal)}"></label>
        <label class="f">Eiweiß (g)<input type="number" inputmode="decimal" id="ep" value="${r1(e.p)}"></label>
        <label class="f">Fett (g)<input type="number" inputmode="decimal" id="ef" value="${r1(e.f)}"></label>
        <label class="f">Kohlenhydrate (g)<input type="number" inputmode="decimal" id="ec" value="${r1(e.c)}"></label>
      </div>`}
    <label class="f">Mahlzeit<select id="em">${MEALS.map(m => `<option value="${m.id}" ${m.id === e.meal ? 'selected' : ''}>${m.name}</option>`).join('')}</select></label>
    <div id="eprev">${nutriHtml(e)}</div>
    <div class="btns"><button class="btn danger" id="edel">Löschen</button><button class="btn primary" id="esave">Speichern</button></div>`);
  const upd = () => { if (hasPer100) $('#eprev', body).innerHTML = nutriHtml(calc(e.per100, num($('#eg', body).value))); };
  if (hasPer100) $('#eg', body).oninput = upd;
  $('#edel', body).onclick = async () => { await dbDel('entries', id); closeSheet(); toast('Eintrag gelöscht.'); renderDiary(); };
  $('#esave', body).onclick = async () => {
    let v;
    if (hasPer100) {
      const g = num($('#eg', body).value);
      if (!(g > 0)) { toast('Bitte gib eine Menge über 0 ein.'); return; }
      e.grams = g; v = calc(e.per100, g);
    } else {
      v = { kcal: num($('#ek', body).value) || 0, p: num($('#ep', body).value) || 0, f: num($('#ef', body).value) || 0, c: num($('#ec', body).value) || 0 };
    }
    Object.assign(e, v, { meal: $('#em', body).value });
    await dbPut('entries', e);
    closeSheet(); renderDiary();
  };
}

// ---------- Hinzufügen-Dialog ----------
let addMeal = 'breakfast';
let addTab = 'search';
function openAddSheet(meal) {
  addMeal = meal || defaultMeal();
  addTab = 'search';
  openSheet(`${mealName(addMeal)} hinzufügen`, '', { onClose: stopScanner });
  renderAddSheet();
}
function renderAddSheet() {
  stopScanner();
  const tabs = [['search', 'Suchen'], ['scan', 'Barcode'], ['photo', 'Foto'], ['mine', 'Meine']];
  const body = setSheetBody(`<div class="seg" role="tablist">${tabs.map(([id, l]) => `<button role="tab" data-at="${id}" class="${addTab === id ? 'on' : ''}">${l}</button>`).join('')}</div><div id="addpane" style="display:flex;flex-direction:column;gap:12px"></div>`);
  $$('[data-at]', body).forEach(b => b.onclick = () => { addTab = b.dataset.at; renderAddSheet(); });
  const pane = $('#addpane', body);
  if (addTab === 'search') renderSearchPane(pane);
  else if (addTab === 'scan') renderScanPane(pane);
  else if (addTab === 'photo') renderPhotoPane(pane);
  else renderMinePane(pane);
}

function foodRow(f, extra = '') {
  const p = f.per100 || {};
  const sub = [f.brand, `${fmt(p.kcal)} kcal / 100 g`].filter(Boolean).join(' · ');
  return `<button class="item" data-food="${esc(f.id)}" ${extra}><div style="min-width:0"><div class="t">${f.fav ? '★ ' : ''}${esc(f.name)}</div><div class="s">${esc(sub)}</div></div><div class="r num">E ${fmt(p.p)} g</div></button>`;
}

let searchCache = new Map();
async function renderSearchPane(pane) {
  const foods = await dbAll('foods');
  const recent = foods.filter(f => f.lastUsed).sort((a, b) => b.lastUsed - a.lastUsed).slice(0, 12);
  pane.innerHTML = `
    <input type="search" id="q" placeholder="Lebensmittel suchen, z. B. Skyr" autocomplete="off" enterkeyhint="search">
    <div id="results"><div class="sectionlbl">Zuletzt verwendet</div><div class="list">${recent.length ? recent.map(f => foodRow(f)).join('') : '<div class="empty">Noch nichts eingetragen. Suche oben oder scanne einen Barcode.</div>'}</div></div>
    <button class="btn" id="quickentry">Schnell-Eintrag nur mit Kalorien</button>`;
  const local = new Map(foods.map(f => [f.id, f]));
  const bindRows = root => $$('[data-food]', root).forEach(b => b.onclick = () => {
    const f = local.get(b.dataset.food) || searchCache.get(b.dataset.food);
    if (f) openAmountSheet(f);
  });
  bindRows(pane);
  $('#quickentry', pane).onclick = openQuickEntry;
  const q = $('#q', pane);
  let timer, seq = 0;
  q.oninput = () => {
    clearTimeout(timer);
    const term = q.value.trim();
    const res = $('#results', pane);
    if (term.length < 2) { renderSearchPane(pane).then(() => { const nq = $('#q', pane); nq.value = term; nq.focus(); }); return; }
    const lt = term.toLowerCase();
    const mine = foods.filter(f => (f.name + ' ' + (f.brand || '')).toLowerCase().includes(lt)).slice(0, 15);
    res.innerHTML = `${mine.length ? `<div class="sectionlbl">Meine Lebensmittel</div><div class="list">${mine.map(f => foodRow(f)).join('')}</div>` : ''}<div class="sectionlbl">Datenbank</div><div id="offres"><span class="spinner"></span></div>`;
    bindRows(res);
    timer = setTimeout(async () => {
      const my = ++seq;
      try {
        const found = await offSearch(term);
        if (my !== seq) return;
        const box = $('#offres', pane); if (!box) return;
        const known = new Set(mine.map(f => f.barcode).filter(Boolean));
        const list = found.filter(f => !known.has(f.barcode));
        list.forEach(f => searchCache.set(f.id, f));
        box.innerHTML = list.length ? `<div class="list">${list.map(f => foodRow(f)).join('')}</div>` : '<div class="empty">Nichts gefunden. Versuch einen anderen Begriff oder trag es selbst ein.</div>';
        bindRows(box);
      } catch (err) {
        const box = $('#offres', pane);
        if (box) box.innerHTML = `<div class="empty">Die Datenbank ist gerade nicht erreichbar. Prüf deine Internetverbindung.</div>`;
      }
    }, 450);
  };
  q.focus();
}

function openQuickEntry() {
  const body = openSheet('Schnell-Eintrag', `
    <label class="f">Name<input type="text" id="qn" placeholder="z. B. Döner"></label>
    <div class="grid2">
      <label class="f">Kalorien<input type="number" inputmode="decimal" id="qk"></label>
      <label class="f">Eiweiß (g)<input type="number" inputmode="decimal" id="qp"></label>
      <label class="f">Fett (g)<input type="number" inputmode="decimal" id="qf"></label>
      <label class="f">Kohlenhydrate (g)<input type="number" inputmode="decimal" id="qc"></label>
    </div>
    <label class="f">Mahlzeit<select id="qm">${MEALS.map(m => `<option value="${m.id}" ${m.id === addMeal ? 'selected' : ''}>${m.name}</option>`).join('')}</select></label>
    <button class="btn primary block" id="qsave">Eintragen</button>`);
  $('#qn', body).focus();
  $('#qsave', body).onclick = async () => {
    const kcal = num($('#qk', body).value);
    if (!(kcal >= 0)) { toast('Bitte gib die Kalorien ein.'); return; }
    await addEntry({ name: $('#qn', body).value.trim() || 'Schnell-Eintrag', meal: $('#qm', body).value, totals: { kcal, p: num($('#qp', body).value) || 0, f: num($('#qf', body).value) || 0, c: num($('#qc', body).value) || 0 } });
    closeSheet(); toast('Eingetragen.'); renderDiary();
  };
}

// ---------- Menge wählen ----------
async function openAmountSheet(food) {
  const stored = await dbGet('foods', food.id);
  if (stored) food = { ...food, ...stored };
  const serving = food.servingG > 0 ? food.servingG : null;
  const startG = food.lastGrams || serving || 100;
  const body = openSheet(food.name, `
    ${food.brand ? `<div class="muted small" style="margin-top:-6px">${esc(food.brand)}</div>` : ''}
    <div class="muted small">Pro 100 g: ${fmt(food.per100.kcal)} kcal · E ${fmt1(food.per100.p)} · F ${fmt1(food.per100.f)} · KH ${fmt1(food.per100.c)}</div>
    <label class="f">Menge in Gramm<input type="number" inputmode="decimal" id="ag" value="${startG}"></label>
    <div class="quick">${[50, 100, 150, 200, 250].map(g => `<button data-g="${g}">${g} g</button>`).join('')}${serving ? `<button data-g="${serving}">1 Portion (${fmt(serving)} g)</button>` : ''}</div>
    <div id="aprev"></div>
    <label class="f">Mahlzeit<select id="am">${MEALS.map(m => `<option value="${m.id}" ${m.id === addMeal ? 'selected' : ''}>${m.name}</option>`).join('')}</select></label>
    <div class="btns"><button class="btn" id="afav">${food.fav ? '★ Favorit' : '☆ Als Favorit'}</button><button class="btn primary" id="aadd">Eintragen</button></div>`);
  const g = $('#ag', body);
  const upd = () => { $('#aprev', body).innerHTML = nutriHtml(calc(food.per100, num(g.value))); };
  g.oninput = upd; upd();
  g.select();
  $$('[data-g]', body).forEach(b => b.onclick = () => { g.value = b.dataset.g; upd(); });
  $('#afav', body).onclick = async () => {
    food.fav = !food.fav;
    await dbPut('foods', stripFood(food));
    $('#afav', body).textContent = food.fav ? '★ Favorit' : '☆ Als Favorit';
  };
  $('#aadd', body).onclick = async () => {
    const grams = num(g.value);
    if (!(grams > 0)) { toast('Bitte gib eine Menge über 0 ein.'); return; }
    food.lastUsed = Date.now(); food.lastGrams = grams;
    await dbPut('foods', stripFood(food));
    await addEntry({ name: food.name, grams, per100: food.per100, meal: $('#am', body).value, foodId: food.id });
    closeSheet(); toast(`${food.name} eingetragen.`); renderDiary();
  };
}
function stripFood(f) {
  return { id: f.id, name: f.name, brand: f.brand || '', barcode: f.barcode || '', per100: f.per100, servingG: f.servingG || 0, source: f.source || 'custom', fav: !!f.fav, lastUsed: f.lastUsed || 0, lastGrams: f.lastGrams || 0 };
}

// ---------- Meine Lebensmittel und Gerichte ----------
async function renderMinePane(pane) {
  const [foods, dishes] = await Promise.all([dbAll('foods'), dbAll('dishes')]);
  const favs = foods.filter(f => f.fav).sort((a, b) => a.name.localeCompare(b.name));
  const custom = foods.filter(f => !f.fav && (f.source === 'custom' || f.source === 'ai')).sort((a, b) => a.name.localeCompare(b.name));
  pane.innerHTML = `
    <div class="btns"><button class="btn primary" id="newfood">Neues Lebensmittel</button></div>
    <div class="sectionlbl">Gerichte</div>
    <div class="list">${dishes.length ? dishes.map(d => { const t = sumEntries(d.items.map(i => i.totals)); return `<button class="item" data-dish="${d.id}"><div style="min-width:0"><div class="t">${esc(d.name)}</div><div class="s">${d.items.length} Zutaten</div></div><div class="r num">${fmt(t.kcal)} kcal</div></button>`; }).join('') : '<div class="empty">Speichere eine Mahlzeit im Tagebuch als Gericht.</div>'}</div>
    <div class="sectionlbl">Favoriten</div>
    <div class="list">${favs.length ? favs.map(f => foodRow(f)).join('') : '<div class="empty">Noch keine Favoriten.</div>'}</div>
    <div class="sectionlbl">Eigene Lebensmittel</div>
    <div class="list">${custom.length ? custom.map(f => foodRow(f)).join('') : '<div class="empty">Noch keine eigenen Lebensmittel.</div>'}</div>`;
  const map = new Map(foods.map(f => [f.id, f]));
  $$('[data-food]', pane).forEach(b => b.onclick = () => openAmountSheet(map.get(b.dataset.food)));
  $$('[data-dish]', pane).forEach(b => b.onclick = () => openDishSheet(dishes.find(d => d.id === b.dataset.dish)));
  $('#newfood', pane).onclick = () => openFoodForm();
}

function openDishSheet(dish) {
  const body = openSheet(dish.name, `
    <div class="list">${dish.items.map(i => `<div class="item" style="cursor:default"><div style="min-width:0"><div class="t">${esc(i.name)}</div><div class="s num">${i.grams ? fmt(i.grams) + ' g' : ''}</div></div><div class="r num">${fmt(i.totals.kcal)} kcal</div></div>`).join('')}</div>
    <label class="f">Portion<select id="dp"><option value="0.5">Halbe Portion</option><option value="1" selected>Ganze Portion</option><option value="1.5">1,5 Portionen</option><option value="2">Doppelte Portion</option></select></label>
    <div id="dprev"></div>
    <label class="f">Mahlzeit<select id="dm">${MEALS.map(m => `<option value="${m.id}" ${m.id === addMeal ? 'selected' : ''}>${m.name}</option>`).join('')}</select></label>
    <div class="btns"><button class="btn danger" id="ddel">Gericht löschen</button><button class="btn primary" id="dadd">Eintragen</button></div>`);
  const upd = () => {
    const k = num($('#dp', body).value);
    const t = sumEntries(dish.items.map(i => i.totals));
    $('#dprev', body).innerHTML = nutriHtml({ kcal: t.kcal * k, p: t.p * k, f: t.f * k, c: t.c * k });
  };
  $('#dp', body).onchange = upd; upd();
  $('#ddel', body).onclick = async () => { await dbDel('dishes', dish.id); closeSheet(); toast('Gericht gelöscht.'); };
  $('#dadd', body).onclick = async () => {
    const k = num($('#dp', body).value);
    const meal = $('#dm', body).value;
    for (const i of dish.items) {
      const t = i.totals;
      await addEntry({ name: i.name, grams: i.grams ? i.grams * k : 0, per100: i.per100, meal, totals: { kcal: t.kcal * k, p: t.p * k, f: t.f * k, c: t.c * k } });
    }
    closeSheet(); toast(`${dish.name} eingetragen.`); renderDiary();
  };
}

function openFoodForm(prefill = {}, { afterSave } = {}) {
  const p = prefill.per100 || {};
  const v = x => (x === undefined || x === null || Number.isNaN(x) ? '' : r1(x));
  const body = openSheet(prefill.id ? 'Lebensmittel bearbeiten' : 'Neues Lebensmittel', `
    <label class="f">Name<input type="text" id="fn" value="${esc(prefill.name || '')}" placeholder="z. B. Haferflocken"></label>
    <label class="f">Marke (optional)<input type="text" id="fb" value="${esc(prefill.brand || '')}"></label>
    <div class="sectionlbl" style="margin:0">Nährwerte pro 100 g</div>
    <div class="grid2">
      <label class="f">Kalorien<input type="number" inputmode="decimal" id="fk" value="${v(p.kcal)}"></label>
      <label class="f">Eiweiß (g)<input type="number" inputmode="decimal" id="fp" value="${v(p.p)}"></label>
      <label class="f">Fett (g)<input type="number" inputmode="decimal" id="ff" value="${v(p.f)}"></label>
      <label class="f">Kohlenhydrate (g)<input type="number" inputmode="decimal" id="fc" value="${v(p.c)}"></label>
      <label class="f">Ballaststoffe (g)<input type="number" inputmode="decimal" id="ffib" value="${v(p.fib)}"></label>
      <label class="f">davon Zucker (g)<input type="number" inputmode="decimal" id="fsug" value="${v(p.sug)}"></label>
      <label class="f">Salz (g)<input type="number" inputmode="decimal" id="fsalt" value="${v(p.salt)}"></label>
    </div>
    <label class="f">Portion in Gramm (optional)<input type="number" inputmode="decimal" id="fs" value="${prefill.servingG || ''}"></label>
    <label class="f">Barcode (optional)<input type="text" inputmode="numeric" id="fbc" value="${esc(prefill.barcode || '')}"></label>
    <button class="btn primary block" id="fsave">Speichern und Menge wählen</button>`);
  $('#fn', body).focus();
  $('#fsave', body).onclick = async () => {
    const name = $('#fn', body).value.trim();
    const kcal = num($('#fk', body).value);
    if (!name) { toast('Bitte gib einen Namen ein.'); return; }
    if (!(kcal >= 0)) { toast('Bitte gib die Kalorien pro 100 g ein.'); return; }
    const food = stripFood({
      ...prefill,
      id: prefill.id || 'c_' + uid(), name, brand: $('#fb', body).value.trim(),
      barcode: $('#fbc', body).value.trim(), servingG: num($('#fs', body).value) || 0,
      per100: { kcal, p: num($('#fp', body).value) || 0, f: num($('#ff', body).value) || 0, c: num($('#fc', body).value) || 0, fib: num($('#ffib', body).value) || 0, sug: num($('#fsug', body).value) || 0, salt: num($('#fsalt', body).value) || 0 },
      source: prefill.source || 'custom',
    });
    await dbPut('foods', food);
    if (afterSave) afterSave(food); else openAmountSheet(food);
  };
}

// ---------- Open Food Facts ----------
function offToFood(p) {
  const n = p.nutriments || {};
  let kcal = Number(n['energy-kcal_100g']);
  if (!Number.isFinite(kcal) && Number.isFinite(Number(n['energy-kj_100g']))) kcal = Number(n['energy-kj_100g']) / 4.184;
  if (!Number.isFinite(kcal) && Number.isFinite(Number(n.energy_100g))) kcal = Number(n.energy_100g) / 4.184;
  if (!Number.isFinite(kcal)) return null;
  const name = (p.product_name_de || p.product_name || p.generic_name || '').trim();
  if (!name) return null;
  return {
    id: 'off_' + p.code, barcode: String(p.code || ''), name,
    brand: (p.brands || '').split(',')[0].trim(),
    per100: { kcal, p: Number(n.proteins_100g) || 0, f: Number(n.fat_100g) || 0, c: Number(n.carbohydrates_100g) || 0, fib: Number(n.fiber_100g) || 0, sug: Number(n.sugars_100g) || 0, salt: Number(n.salt_100g) || 0 },
    servingG: Number(p.serving_quantity) || 0, source: 'off',
  };
}
const OFF_FIELDS = 'code,product_name,product_name_de,generic_name,brands,nutriments,serving_quantity';
async function offSearch(term) {
  const url = `https://de.openfoodfacts.org/cgi/search.pl?search_terms=${encodeURIComponent(term)}&search_simple=1&action=process&json=1&page_size=30&sort_by=unique_scans_n&fields=${OFF_FIELDS}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  return (data.products || []).map(offToFood).filter(Boolean);
}
async function offBarcode(code) {
  const res = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}.json?fields=${OFF_FIELDS}`);
  if (res.status === 404) return null;
  if (!res.ok) throw new Error('HTTP ' + res.status);
  const data = await res.json();
  if (data.status !== 1 || !data.product) return null;
  return offToFood({ ...data.product, code: data.product.code || code });
}

// ---------- Barcode-Scanner ----------
// iPhones haben keine eingebaute Barcode-Erkennung. Dann laden wir eine Ersatz-Erkennung nach.
const SCAN_FORMATS = ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128'];
const POLYFILL_URL = 'https://cdn.jsdelivr.net/npm/barcode-detector@2.2.11/dist/iife/pure.js';
let detectorPromise = null, scanStream = null, scanTimer = null;
function getDetector() {
  if (!detectorPromise) detectorPromise = (async () => {
    if ('BarcodeDetector' in window) {
      try {
        const have = await window.BarcodeDetector.getSupportedFormats();
        const want = SCAN_FORMATS.filter(f => have.includes(f));
        if (want.includes('ean_13')) return new window.BarcodeDetector({ formats: want });
      } catch (e) { /* Ersatz nehmen */ }
    }
    await loadScript(POLYFILL_URL);
    return new window.BarcodeDetectionAPI.BarcodeDetector({ formats: SCAN_FORMATS });
  })().catch(e => { detectorPromise = null; throw e; });
  return detectorPromise;
}
function stopScanner() {
  if (scanTimer) { clearTimeout(scanTimer); scanTimer = null; }
  if (scanStream) { scanStream.getTracks().forEach(t => t.stop()); scanStream = null; }
}
function loadScript(src) {
  return new Promise((resolve, reject) => {
    if (document.querySelector(`script[src="${src}"]`) && window.BarcodeDetectionAPI) { resolve(); return; }
    const s = document.createElement('script');
    s.src = src; s.onload = resolve; s.onerror = () => reject(new Error('Laden fehlgeschlagen'));
    document.head.appendChild(s);
  });
}
function renderScanPane(pane) {
  pane.innerHTML = `
    <div id="scanarea"><button class="btn primary block" id="startscan">Kamera starten</button></div>
    <label class="btn block" style="text-align:center">Foto vom Barcode machen<input type="file" accept="image/*" capture="environment" id="barcodephoto" class="hidden"></label>
    <div class="muted small">Halte den Barcode gerade und nah, etwa 10 bis 15 cm. Klappt die Kamera nicht, nimm den Foto-Knopf.</div>
    <div class="row"><input type="text" inputmode="numeric" id="manualcode" placeholder="Barcode eintippen"><button class="btn" id="lookup">Suchen</button></div>
    <div id="scanresult"></div>`;
  getDetector().catch(() => {});
  $('#startscan', pane).onclick = () => startScanner(pane);
  $('#barcodephoto', pane).onchange = e => scanPhoto(e.target.files[0], pane);
  const go = () => { const c = $('#manualcode', pane).value.replace(/\D/g, ''); if (c.length >= 6) handleBarcode(c, pane); else toast('Der Barcode ist zu kurz.'); };
  $('#lookup', pane).onclick = go;
  $('#manualcode', pane).onkeydown = e => { if (e.key === 'Enter') go(); };
}
function onBarcodeFound(code, pane) {
  stopScanner();
  if (navigator.vibrate) navigator.vibrate(60);
  const area = $('#scanarea', pane);
  if (area) { area.innerHTML = `<button class="btn block" id="startscan">Nochmal scannen</button>`; $('#startscan', pane).onclick = () => startScanner(pane); }
  handleBarcode(code, pane);
}
async function startScanner(pane) {
  const area = $('#scanarea', pane);
  if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { toast('Die Kamera geht hier nicht. Nimm den Foto-Knopf.', 4000); return; }
  area.innerHTML = `<div class="scanbox"><video id="scanvideo" playsinline muted autoplay></video><div class="aim"></div></div><div class="muted small" id="scanhint" style="margin-top:6px"><span class="spinner"></span> Kamera startet …</div><button class="btn block" id="stopscan" style="margin-top:8px">Abbrechen</button>`;
  $('#stopscan', pane).onclick = () => { stopScanner(); renderScanPane(pane); };
  let detector;
  try {
    [detector, scanStream] = await Promise.all([
      getDetector(),
      navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false }),
    ]);
  } catch (e) {
    stopScanner();
    const denied = e && (e.name === 'NotAllowedError' || e.name === 'SecurityError');
    area.innerHTML = `<div class="empty">${denied ? 'Die Kamera ist für Gramm nicht erlaubt. Am iPhone: Einstellungen, Safari, Kamera auf „Erlauben“. Oder nimm den Foto-Knopf.' : 'Die Kamera oder die Erkennung konnte nicht starten. Nimm den Foto-Knopf.'}</div><button class="btn block" id="startscan">Nochmal versuchen</button>`;
    $('#startscan', pane).onclick = () => startScanner(pane);
    return;
  }
  const video = $('#scanvideo', pane);
  if (!video) { stopScanner(); return; }
  video.srcObject = scanStream;
  try { await video.play(); } catch (e) { /* iOS startet trotzdem */ }
  const hint = $('#scanhint', pane); if (hint) hint.textContent = 'Barcode in den Rahmen halten.';
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  const tick = async () => {
    if (!scanStream) return;
    try {
      const w = video.videoWidth, h = video.videoHeight;
      if (w && h) {
        // Nur die Mitte auswerten, das ist schneller und genauer
        const cw = Math.round(w * 0.8), ch = Math.round(h * 0.5);
        canvas.width = cw; canvas.height = ch;
        ctx.drawImage(video, (w - cw) / 2, (h - ch) / 2, cw, ch, 0, 0, cw, ch);
        const codes = await detector.detect(canvas);
        const hit = codes.find(c => /^\d{6,14}$/.test(c.rawValue));
        if (hit) { onBarcodeFound(hit.rawValue, pane); return; }
      }
    } catch (e) { /* nächstes Bild */ }
    scanTimer = setTimeout(tick, 150);
  };
  tick();
}
async function scanPhoto(file, pane) {
  if (!file) return;
  const out = $('#scanresult', pane);
  out.innerHTML = `<span class="spinner"></span> <span class="muted small">Barcode wird gesucht …</span>`;
  try {
    const detector = await getDetector();
    const url = URL.createObjectURL(file);
    const img = await new Promise((res, rej) => { const i = new Image(); i.onload = () => res(i); i.onerror = rej; i.src = url; });
    const tries = [1, 0.5];
    let code = null;
    for (const sc of tries) {
      const c = document.createElement('canvas');
      const s = Math.min(1, 2000 / Math.max(img.width, img.height)) * sc;
      c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      const codes = await detector.detect(c);
      const hit = codes.find(x => /^\d{6,14}$/.test(x.rawValue));
      if (hit) { code = hit.rawValue; break; }
    }
    URL.revokeObjectURL(url);
    if (code) { if (navigator.vibrate) navigator.vibrate(60); handleBarcode(code, pane); }
    else out.innerHTML = '<div class="empty">Kein Barcode erkannt. Fotografier ihn gerade, scharf und bildfüllend.</div>';
  } catch (e) {
    out.innerHTML = '<div class="empty">Die Erkennung konnte nicht laden. Prüf dein Internet oder tipp den Barcode ein.</div>';
  }
}
async function handleBarcode(code, pane) {
  const out = $('#scanresult', pane);
  out.innerHTML = `<span class="spinner"></span>`;
  const all = await dbAll('foods');
  const local = all.find(f => f.barcode === code);
  if (local) { openAmountSheet(local); return; }
  try {
    const food = await offBarcode(code);
    if (food) { openAmountSheet(food); return; }
    out.innerHTML = `<div class="empty">Produkt ${esc(code)} ist nicht in der Datenbank.</div><div class="btns"><button class="btn" id="bcphoto">Mit Foto erkennen</button><button class="btn primary" id="bcnew">Selbst eintragen</button></div>`;
    $('#bcnew', pane).onclick = () => openFoodForm({ barcode: code });
    $('#bcphoto', pane).onclick = () => { pendingBarcode = code; addTab = 'photo'; renderAddSheet(); };
  } catch (e) {
    out.innerHTML = `<div class="empty">Die Datenbank ist gerade nicht erreichbar. Prüf deine Internetverbindung.</div>`;
  }
}

// ---------- Foto-Erkennung mit Claude ----------
let pendingBarcode = '';
function renderPhotoPane(pane) {
  if (!S.apiKey) {
    pane.innerHTML = `<div class="card"><h3>API-Schlüssel fehlt</h3><p class="muted small" style="margin:0 0 10px">Für die Foto-Erkennung brauchst du einen Claude-API-Schlüssel. Du trägst ihn einmal unter Ziele → Foto-Erkennung ein.</p><button class="btn primary block" id="gokey">Zu den Einstellungen</button></div>`;
    $('#gokey', pane).onclick = () => { closeSheet(); switchTab('settings'); setTimeout(() => $('#apikey')?.scrollIntoView({ block: 'center' }), 50); };
    return;
  }
  pane.innerHTML = `
    <p class="muted small" style="margin:0">Fotografier am besten die Nährwerttabelle. Bei einem Teller schätzt die KI die Werte.</p>
    <div class="btns">
      <label class="btn primary" style="text-align:center">Foto machen<input type="file" accept="image/*" capture="environment" id="camin" class="hidden"></label>
      <label class="btn" style="text-align:center">Aus Galerie<input type="file" accept="image/*" id="galin" class="hidden"></label>
    </div>
    <label class="f">Hinweis für die KI (optional)<input type="text" id="hint" placeholder="z. B. Skyr Natur, ich esse 250 g"></label>
    <div id="photoout"></div>`;
  const handle = async file => {
    if (!file) return;
    const out = $('#photoout', pane);
    let img;
    try { img = await resizeImage(file, 1400); } catch (e) { out.innerHTML = '<div class="empty">Das Bild konnte nicht gelesen werden.</div>'; return; }
    out.innerHTML = `<img class="preview-img" src="data:image/jpeg;base64,${img}" alt="Dein Foto"><div class="row" style="justify-content:center;margin-top:10px"><span class="spinner"></span><span class="muted small">KI liest die Nährwerte …</span></div>`;
    try {
      const r = await analyzePhoto(img, $('#hint', pane).value.trim());
      showPhotoResult(r, pane, img);
    } catch (e) {
      out.innerHTML = `<img class="preview-img" src="data:image/jpeg;base64,${img}" alt="Dein Foto"><div class="empty">${esc(e.message || 'Erkennung fehlgeschlagen.')}</div>`;
    }
  };
  $('#camin', pane).onchange = e => handle(e.target.files[0]);
  $('#galin', pane).onchange = e => handle(e.target.files[0]);
}
function resizeImage(file, max) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const im = new Image();
    im.onload = () => {
      const s = Math.min(1, max / Math.max(im.width, im.height));
      const c = document.createElement('canvas');
      c.width = Math.round(im.width * s); c.height = Math.round(im.height * s);
      c.getContext('2d').drawImage(im, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL('image/jpeg', 0.85).split(',')[1]);
    };
    im.onerror = () => { URL.revokeObjectURL(url); reject(new Error('Bild nicht lesbar')); };
    im.src = url;
  });
}
const PHOTO_PROMPT = `Du bist ein Ernährungs-Assistent. Analysiere das Foto.
Fall A: Es zeigt eine Verpackung oder Nährwerttabelle. Lies die Werte pro 100 g exakt ab. Wenn nur Werte pro Portion da sind, rechne auf 100 g um.
Fall B: Es zeigt eine Mahlzeit oder ein Lebensmittel ohne Tabelle. Schätze realistische Werte pro 100 g und die Menge auf dem Foto in Gramm.
Antworte NUR mit JSON, ohne Text davor oder danach, in genau diesem Format:
{"name":"kurzer deutscher Name","brand":"Marke oder leer","type":"label oder meal","per100":{"kcal":0,"protein":0,"fat":0,"carbs":0,"fiber":0,"sugar":0,"salt":0},"servingGrams":null,"estimatedGrams":null,"confidence":"hoch, mittel oder niedrig","note":"ein kurzer Satz auf Deutsch"}
servingGrams ist die Portionsgröße laut Verpackung, sonst null. estimatedGrams ist die geschätzte Menge auf dem Foto bei einer Mahlzeit, sonst null.`;
async function analyzePhoto(base64, hint) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-api-key': S.apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
    },
    body: JSON.stringify({
      model: S.model || DEFAULTS.model,
      max_tokens: 700,
      messages: [{ role: 'user', content: [
        { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: base64 } },
        { type: 'text', text: PHOTO_PROMPT + (hint ? `\nHinweis vom Nutzer: ${hint}` : '') },
      ] }],
    }),
  });
  if (!res.ok) {
    let msg = `Fehler ${res.status}.`;
    try { const j = await res.json(); if (j.error?.message) msg += ' ' + j.error.message; } catch (e) { /* egal */ }
    if (res.status === 401) msg = 'Der API-Schlüssel ist ungültig. Prüf ihn unter Ziele.';
    if (res.status === 404) msg = 'Das KI-Modell wurde nicht gefunden. Prüf den Modellnamen unter Ziele.';
    throw new Error(msg);
  }
  const data = await res.json();
  const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join('');
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) throw new Error('Die KI hat keine lesbaren Werte geliefert. Versuch ein schärferes Foto.');
  let j;
  try { j = JSON.parse(m[0]); } catch (e) { throw new Error('Die Antwort der KI war unvollständig. Versuch es nochmal.'); }
  return j;
}
function showPhotoResult(r, pane, img) {
  const p = r.per100 || {};
  const food = {
    name: r.name || 'Unbekanntes Lebensmittel', brand: r.brand || '', barcode: pendingBarcode || '',
    per100: { kcal: num(p.kcal) || 0, p: num(p.protein) || 0, f: num(p.fat) || 0, c: num(p.carbs) || 0, fib: num(p.fiber) || 0, sug: num(p.sugar) || 0, salt: num(p.salt) || 0 },
    servingG: num(r.servingGrams) || 0, source: 'ai',
  };
  pendingBarcode = '';
  const grams = num(r.estimatedGrams) || food.servingG || 100;
  const out = $('#photoout', pane);
  out.innerHTML = `
    <img class="preview-img" src="data:image/jpeg;base64,${img}" alt="Dein Foto">
    <div class="card" style="display:flex;flex-direction:column;gap:10px">
      <div class="row between"><b>${esc(food.name)}</b><span class="chip">Sicherheit: ${esc(r.confidence || '–')}</span></div>
      ${r.note ? `<div class="muted small">${esc(r.note)}</div>` : ''}
      <div class="muted small">Pro 100 g: ${fmt(food.per100.kcal)} kcal · E ${fmt1(food.per100.p)} · F ${fmt1(food.per100.f)} · KH ${fmt1(food.per100.c)}</div>
      <div class="muted tiny">Prüf die Werte kurz. Die KI kann sich verlesen.</div>
      <div class="btns"><button class="btn" id="pedit">Werte anpassen</button><button class="btn primary" id="puse">Übernehmen</button></div>
    </div>`;
  const save = async f => { const s = stripFood({ ...f, id: f.id || 'ai_' + uid(), lastGrams: grams }); await dbPut('foods', s); return s; };
  $('#puse', pane).onclick = async () => { const s = await save(food); openAmountSheet(s); };
  $('#pedit', pane).onclick = () => openFoodForm({ ...food, source: 'ai' }, { afterSave: f => openAmountSheet({ ...f, lastGrams: grams }) });
}

// ---------- Gewicht ----------
async function openWeightSheet(date) {
  const cur = await dbGet('weights', date);
  const all = await dbAll('weights');
  const last = all.sort((a, b) => b.date.localeCompare(a.date))[0];
  const body = openSheet('Gewicht eintragen', `
    <div class="grid2">
      <label class="f">Datum<input type="date" id="wd" value="${date}"></label>
      <label class="f">Uhrzeit<input type="time" id="wt" value="${cur && cur.time ? cur.time : nowTime()}"></label>
    </div>
    <label class="f">Gewicht in kg<input type="number" inputmode="decimal" step="0.1" id="wk" value="${cur ? cur.kg : (last ? last.kg : '')}"></label>
    <div class="muted small">Am besten morgens nach der Toilette und vor dem Frühstück.</div>
    <button class="btn primary block" id="wsave">Speichern</button>`);
  $('#wk', body).select();
  $('#wsave', body).onclick = async () => {
    const kg = num($('#wk', body).value);
    const d = $('#wd', body).value;
    if (!(kg > 20 && kg < 400)) { toast('Bitte gib ein gültiges Gewicht ein.'); return; }
    if (!d) { toast('Bitte wähl ein Datum.'); return; }
    const time = $('#wt', body).value || '';
    if (d !== date && cur) await dbDel('weights', date);
    await dbPut('weights', { date: d, kg: r1(kg), time });
    closeSheet(); toast('Gewicht gespeichert.'); render();
  };
}
async function openWaistSheet() {
  const today = todayStr();
  const cur = await dbGet('waist', today);
  const body = openSheet('Bauchumfang eintragen', `
    <label class="f">Datum<input type="date" id="bd" value="${today}"></label>
    <label class="f">Umfang in cm, auf Höhe vom Bauchnabel<input type="number" inputmode="decimal" step="0.5" id="bc" value="${cur ? cur.cm : ''}"></label>
    <button class="btn primary block" id="bsave">Speichern</button>`);
  $('#bc', body).focus();
  $('#bsave', body).onclick = async () => {
    const cm = num($('#bc', body).value);
    const d = $('#bd', body).value;
    if (!(cm > 30 && cm < 250)) { toast('Bitte gib einen gültigen Umfang ein.'); return; }
    await dbPut('waist', { date: d, cm: r1(cm) });
    closeSheet(); toast('Bauchumfang gespeichert.'); renderWeight();
  };
}

function avg(arr) { return arr.length ? arr.reduce((a, b) => a + b, 0) / arr.length : NaN; }
function weeklyAverages(weights) {
  const map = new Map();
  weights.forEach(w => { const k = mondayOf(w.date); if (!map.has(k)) map.set(k, []); map.get(k).push(w.kg); });
  return Array.from(map.entries()).map(([week, kgs]) => ({ week, avg: avg(kgs), n: kgs.length })).sort((a, b) => a.week.localeCompare(b.week));
}
function trendAdvice(weights) {
  const t = todayStr();
  const last7 = weights.filter(w => w.date > addDays(t, -7) && w.date <= t).map(w => w.kg);
  const prev7 = weights.filter(w => w.date > addDays(t, -14) && w.date <= addDays(t, -7)).map(w => w.kg);
  if (last7.length < 3 || prev7.length < 3) return { text: 'Für eine Empfehlung brauche ich mindestens drei Werte in jeder der letzten zwei Wochen.', cls: '' , change: NaN, cur: avg(last7) };
  const cur = avg(last7), prev = avg(prev7), change = cur - prev;
  const ph = phaseFor(t);
  if (!ph) return { text: `Dein Schnitt hat sich um ${change > 0 ? '+' : ''}${fmt1(change)} kg verändert. Ohne aktive Phase gibt es keine Empfehlung.`, cls: '', change, cur, prev };
  const type = ph.type;
  let text, cls = 'ok';
  if (type === 'defizit') {
    if (change > -0.3) { text = 'Du verlierst weniger als 0,3 kg pro Woche. Bleibt das zwei Wochen so, iss 150 kcal weniger.'; cls = 'warn'; }
    else if (change < -0.8) { text = 'Du verlierst mehr als 0,8 kg pro Woche. Iss 150 kcal mehr, um Muskeln zu schützen.'; cls = 'warn'; }
    else text = 'Perfektes Tempo. Lass die Kalorien so.';
  } else {
    if (change > 0.3) { text = 'Dein Gewicht steigt. Bleibt das zwei Wochen so, iss 150 kcal weniger.'; cls = 'warn'; }
    else if (change < -0.3) { text = 'Du nimmst ab, obwohl du halten willst. Iss 150 kcal mehr.'; cls = 'warn'; }
    else text = 'Dein Gewicht ist stabil. Lass die Kalorien so.';
  }
  return { text, cls, change, cur, prev };
}

async function renderWeight() {
  const [weights, waist] = await Promise.all([dbAll('weights'), dbAll('waist')]);
  weights.sort((a, b) => a.date.localeCompare(b.date));
  waist.sort((a, b) => a.date.localeCompare(b.date));
  const t = todayStr();
  const latest = weights[weights.length - 1];
  const adv = trendAdvice(weights);
  const from = state.weightRange ? addDays(t, -state.weightRange) : '0000';
  const shown = weights.filter(w => w.date >= from);
  // gleitender 7-Tage-Schnitt
  const rolling = shown.map(w => {
    const win = weights.filter(x => x.date > addDays(w.date, -7) && x.date <= w.date).map(x => x.kg);
    return { date: w.date, y: avg(win) };
  });
  const weeks = weeklyAverages(weights).reverse().slice(0, 12);
  const ranges = [[28, '4 W'], [84, '12 W'], [182, '6 M'], [0, 'Alles']];
  const ph = phaseFor(t);

  view().innerHTML = `
    <section class="card">
      <div class="row between"><h3 style="margin:0">Gewicht</h3>${ph ? `<span class="chip">${esc(ph.name)}</span>` : ''}</div>
      <div class="stats" style="margin-top:10px">
        <div class="stat"><b>${latest ? fmt1(latest.kg) : '–'}</b><span>Zuletzt kg</span></div>
        <div class="stat"><b>${Number.isFinite(adv.cur) ? fmt1(adv.cur) : '–'}</b><span>Schnitt 7 Tage</span></div>
        <div class="stat"><b class="${Number.isFinite(adv.change) ? '' : 'muted'}">${Number.isFinite(adv.change) ? (adv.change > 0 ? '+' : '') + fmt1(adv.change) : '–'}</b><span>Zur Vorwoche</span></div>
      </div>
      <div class="advice ${adv.cls}" style="margin-top:10px">${esc(adv.text)}</div>
      <button class="btn primary block" id="addweight" style="margin-top:10px">Gewicht eintragen</button>
    </section>
    <section class="card">
      <div class="seg" style="margin-bottom:10px">${ranges.map(([d, l]) => `<button data-wr="${d}" class="${state.weightRange === d ? 'on' : ''}">${l}</button>`).join('')}</div>
      ${shown.length >= 2 ? lineChart(shown.map(w => ({ date: w.date, y: w.kg })), rolling, { unit: 'kg' }) : '<div class="empty">Trag mindestens zwei Tage ein, dann siehst du hier deinen Verlauf.</div>'}
      <div class="legend"><span style="--c:var(--muted)">Tageswert</span><span style="--c:var(--accent)">Schnitt 7 Tage</span></div>
    </section>
    <section class="card">
      <h3>Wochenschnitt</h3>
      ${weeks.length ? `<div style="overflow-x:auto"><table class="t"><thead><tr><th>Woche ab</th><th class="r">Werte</th><th class="r">Schnitt</th><th class="r">Änderung</th></tr></thead><tbody>${weeks.map((w, i) => { const prev = weeks[i + 1]; const ch = prev ? w.avg - prev.avg : NaN; return `<tr><td>${shortDate(w.week)}</td><td class="r">${w.n}</td><td class="r">${fmt1(w.avg)} kg</td><td class="r">${Number.isFinite(ch) ? (ch > 0 ? '+' : '') + fmt1(ch) : '–'}</td></tr>`; }).join('')}</tbody></table></div>` : '<div class="empty">Noch keine Werte.</div>'}
    </section>
    <section class="card">
      <div class="row between"><h3 style="margin:0">Bauchumfang</h3><button class="btn" id="addwaist">Eintragen</button></div>
      ${waist.length >= 2 ? `<div style="margin-top:10px">${lineChart(waist.map(w => ({ date: w.date, y: w.cm })), null, { unit: 'cm', dots: true })}</div>` : ''}
      ${waist.length ? `<table class="t" style="margin-top:8px"><tbody>${waist.slice().reverse().slice(0, 8).map((w, i, arr) => { const prev = arr[i + 1]; const ch = prev ? w.cm - prev.cm : NaN; return `<tr><td>${shortDate(w.date)}</td><td class="r">${fmt1(w.cm)} cm</td><td class="r muted">${Number.isFinite(ch) ? (ch > 0 ? '+' : '') + fmt1(ch) : ''}</td><td class="r"><button class="linkbtn" data-delwaist="${w.date}">Löschen</button></td></tr>`; }).join('')}</tbody></table>` : '<div class="empty" style="margin-top:6px">Miss einmal pro Woche auf Höhe vom Bauchnabel.</div>'}
    </section>
    <section class="card">
      <h3>Alle Einträge</h3>
      ${weights.length ? `<table class="t"><tbody>${weights.slice().reverse().slice(0, 60).map(w => `<tr><td>${niceDate(w.date)}${w.time ? `<span class="muted small"> · ${esc(w.time)} Uhr</span>` : ''}</td><td class="r">${fmt1(w.kg)} kg</td><td class="r"><button class="linkbtn" data-editw="${w.date}">Ändern</button> · <button class="linkbtn" data-delw="${w.date}">Löschen</button></td></tr>`).join('')}</tbody></table>` : '<div class="empty">Noch keine Einträge.</div>'}
    </section>`;
  $('#addweight').onclick = () => openWeightSheet(t);
  $('#addwaist').onclick = openWaistSheet;
  $$('[data-wr]').forEach(b => b.onclick = () => { state.weightRange = Number(b.dataset.wr); renderWeight(); });
  $$('[data-editw]').forEach(b => b.onclick = () => openWeightSheet(b.dataset.editw));
  $$('[data-delw]').forEach(b => b.onclick = async () => { await dbDel('weights', b.dataset.delw); toast('Eintrag gelöscht.'); renderWeight(); });
  $$('[data-delwaist]').forEach(b => b.onclick = async () => { await dbDel('waist', b.dataset.delwaist); renderWeight(); });
}

// ---------- Diagramme ----------
function niceTicks(min, max, count = 4) {
  if (min === max) { min -= 1; max += 1; }
  const span = max - min;
  const raw = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(raw)));
  const step = [1, 2, 2.5, 5, 10].map(m => m * mag).find(s => span / s <= count + 0.5) || 10 * mag;
  const lo = Math.floor(min / step) * step, hi = Math.ceil(max / step) * step;
  const ticks = [];
  for (let v = lo; v <= hi + step / 1000; v += step) ticks.push(Math.round(v * 1000) / 1000);
  return { lo, hi, ticks };
}
function lineChart(points, line, { unit = '', dots = false } = {}) {
  const W = 340, H = 190, L = 38, R = 12, T = 10, B = 24;
  const ys = points.map(p => p.y).concat(line ? line.map(p => p.y) : []).filter(Number.isFinite);
  const { lo, hi, ticks } = niceTicks(Math.min(...ys), Math.max(...ys));
  const t0 = parseDate(points[0].date).getTime(), t1 = parseDate(points[points.length - 1].date).getTime();
  const span = Math.max(1, t1 - t0);
  const x = d => L + ((parseDate(d).getTime() - t0) / span) * (W - L - R);
  const y = v => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);
  const fmtTick = v => (unit === 'kg' || unit === 'cm') && hi - lo < 10 ? fmt1(v) : fmt(v);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Verlauf in ${unit}">`;
  ticks.forEach(v => { s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${fmtTick(v)}</text>`; });
  const labels = [points[0].date, points[Math.floor((points.length - 1) / 2)].date, points[points.length - 1].date].filter((d, i, a) => a.indexOf(d) === i);
  labels.forEach((d, i) => { const anchor = i === 0 ? 'start' : (i === labels.length - 1 ? 'end' : 'middle'); s += `<text x="${x(d)}" y="${H - 6}" text-anchor="${anchor}">${shortDate(d)}</text>`; });
  if (line && line.length >= 2) {
    const path = line.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
    s += `<path class="area" d="${path} L${x(line[line.length - 1].date).toFixed(1)},${H - B} L${x(line[0].date).toFixed(1)},${H - B} Z"/>`;
    points.forEach(p => { s += `<circle class="dot" cx="${x(p.date)}" cy="${y(p.y)}" r="2.6"/>`; });
    s += `<path class="line" d="${path}"/>`;
    const e = line[line.length - 1];
    s += `<circle class="end" cx="${x(e.date)}" cy="${y(e.y)}" r="4.5"/>`;
  } else {
    const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(p.date).toFixed(1)},${y(p.y).toFixed(1)}`).join(' ');
    s += `<path class="line" d="${path}"/>`;
    if (dots) points.forEach(p => { s += `<circle class="end" cx="${x(p.date)}" cy="${y(p.y)}" r="3.5"/>`; });
  }
  return s + '</svg>';
}
function barChart(days) {
  // days: [{date, kcal, goal}]
  const W = 340, H = 190, L = 38, R = 8, T = 10, B = 24;
  const max = Math.max(...days.map(d => Math.max(d.kcal, d.goal)), 1000);
  const { hi, ticks } = niceTicks(0, max);
  const n = days.length;
  const bw = (W - L - R) / n;
  const y = v => T + (1 - v / hi) * (H - T - B);
  let s = `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Kalorien pro Tag">`;
  ticks.forEach(v => { s += `<line class="grid" x1="${L}" x2="${W - R}" y1="${y(v)}" y2="${y(v)}"/><text x="${L - 6}" y="${y(v) + 3}" text-anchor="end">${fmt(v)}</text>`; });
  days.forEach((d, i) => {
    if (d.kcal > 0) {
      const h = (H - B) - y(d.kcal);
      const ok = d.kcal <= d.goal * 1.05;
      s += `<rect class="bar ${ok ? 'ok' : ''}" x="${(L + i * bw + bw * 0.15).toFixed(1)}" y="${y(d.kcal).toFixed(1)}" width="${(bw * 0.7).toFixed(1)}" height="${Math.max(0, h).toFixed(1)}" rx="${Math.min(3, bw * 0.2).toFixed(1)}"/>`;
    }
  });
  const gpath = days.map((d, i) => `${i ? 'L' : 'M'}${(L + i * bw).toFixed(1)},${y(d.goal).toFixed(1)} L${(L + (i + 1) * bw).toFixed(1)},${y(d.goal).toFixed(1)}`).join(' ');
  s += `<path class="goal" d="${gpath}"/>`;
  const idx = [0, Math.floor((n - 1) / 2), n - 1].filter((v, i, a) => a.indexOf(v) === i);
  idx.forEach((i, k) => { const anchor = k === 0 ? 'start' : (k === idx.length - 1 ? 'end' : 'middle'); const xx = k === 0 ? L : (k === idx.length - 1 ? W - R : L + (i + 0.5) * bw); s += `<text x="${xx}" y="${H - 6}" text-anchor="${anchor}">${shortDate(days[i].date)}</text>`; });
  return s + '</svg>';
}

// ---------- Statistik ----------
async function renderStats() {
  const t = todayStr();
  const n = state.statsRange;
  const from = addDays(t, -(n - 1));
  const entries = await entriesBetween(from, t);
  const byDay = new Map();
  entries.forEach(e => { if (!byDay.has(e.date)) byDay.set(e.date, []); byDay.get(e.date).push(e); });
  const days = [];
  for (let i = 0; i < n; i++) {
    const d = addDays(from, i);
    const s = sumEntries(byDay.get(d) || []);
    days.push({ date: d, ...s, goal: goalsFor(d).kcal, goals: goalsFor(d) });
  }
  const logged = days.filter(d => d.kcal > 0);
  const a = k => avg(logged.map(d => d[k]));
  const onTarget = logged.filter(d => Math.abs(d.kcal - d.goal) <= d.goal * 0.1).length;
  const protHit = logged.filter(d => d.p >= d.goals.p * 0.9).length;
  const ranges = [[7, '7 Tage'], [30, '30 Tage'], [90, '90 Tage']];
  const avgGoal = avg(logged.map(d => d.goal));
  view().innerHTML = `
    <div class="seg">${ranges.map(([d, l]) => `<button data-sr="${d}" class="${n === d ? 'on' : ''}">${l}</button>`).join('')}</div>
    <section class="card">
      <h3>Kalorien pro Tag</h3>
      ${logged.length ? barChart(days) : '<div class="empty">Noch keine Einträge in diesem Zeitraum.</div>'}
      <div class="legend"><span style="--c:var(--accent)">Im Ziel</span><span style="--c:var(--carb)">Über dem Ziel</span><span style="--c:var(--accent);opacity:.7">Gestrichelt: Ziel</span></div>
    </section>
    <section class="card">
      <h3>Durchschnitt pro Tag</h3>
      <div class="muted small" style="margin:-4px 0 10px">Nur Tage mit Einträgen, das sind ${logged.length} von ${n}.</div>
      <div class="stats">
        <div class="stat"><b>${logged.length ? fmt(a('kcal')) : '–'}</b><span>kcal</span></div>
        <div class="stat"><b>${logged.length ? fmt(a('p')) : '–'}</b><span>Eiweiß g</span></div>
        <div class="stat"><b>${logged.length ? fmt(avgGoal) : '–'}</b><span>Ziel kcal</span></div>
        <div class="stat"><b>${logged.length ? fmt(a('f')) : '–'}</b><span>Fett g</span></div>
        <div class="stat"><b>${logged.length ? fmt(a('c')) : '–'}</b><span>KH g</span></div>
        <div class="stat"><b>${logged.length ? fmt(a('kcal') - avgGoal) : '–'}</b><span>Abweichung</span></div>
        <div class="stat"><b>${logged.length ? fmt(a('fib')) : '–'}</b><span>Ballast g</span></div>
        <div class="stat"><b>${logged.length ? fmt(a('sug')) : '–'}</b><span>Zucker g</span></div>
        <div class="stat"><b>${logged.length ? fmt1(a('salt')) : '–'}</b><span>Salz g</span></div>
      </div>
      <div class="muted tiny" style="margin-top:8px">Richtwerte: mindestens 30 g Ballaststoffe, höchstens 50 g Zucker und 6 g Salz am Tag. Fehlende Werte in der Datenbank zählen als 0.</div>
    </section>
    <section class="card">
      <h3>Treffer</h3>
      <div class="stats" style="grid-template-columns:1fr 1fr">
        <div class="stat"><b>${onTarget} / ${logged.length}</b><span>Tage im Kalorienziel</span></div>
        <div class="stat"><b>${protHit} / ${logged.length}</b><span>Tage mit genug Eiweiß</span></div>
      </div>
    </section>`;
  $$('[data-sr]').forEach(b => b.onclick = () => { state.statsRange = Number(b.dataset.sr); renderStats(); });
}

// ---------- Ziele und Einstellungen ----------
async function renderSettings() {
  await loadPhases();
  const t = todayStr();
  const cur = phaseFor(t);
  view().innerHTML = `
    <section class="card">
      <div class="row between"><h3 style="margin:0">Phasen</h3><button class="btn" id="addphase">+ Phase</button></div>
      <p class="muted small" style="margin:6px 0 4px">Jede Phase hat eigene Ziele. Überschneiden sich zwei, gilt die mit dem späteren Start.</p>
      <div class="list">${PHASES.length ? PHASES.map(p => `<button class="item" data-phase="${p.id}"><div style="min-width:0"><div class="t">${cur && cur.id === p.id ? '● ' : ''}${esc(p.name)}</div><div class="s">${shortDate(p.start)} – ${shortDate(p.end)} ${p.end.slice(0, 4)} · ${p.type === 'defizit' ? 'Defizit' : 'Erhaltung'}</div></div><div class="r num">${fmt(p.kcal)} kcal<div class="s">E ${p.p} · F ${p.f} · KH ${p.c}</div></div></button>`).join('') : '<div class="empty">Keine Phasen angelegt.</div>'}</div>
    </section>
    <section class="card">
      <h3>Standard-Ziel ohne Phase</h3>
      <div class="grid2">
        <label class="f">Kalorien<input type="number" inputmode="decimal" id="gk" value="${S.goalKcal}"></label>
        <label class="f">Eiweiß (g)<input type="number" inputmode="decimal" id="gp" value="${S.goalP}"></label>
        <label class="f">Fett (g)<input type="number" inputmode="decimal" id="gf" value="${S.goalF}"></label>
        <label class="f">Kohlenhydrate (g)<input type="number" inputmode="decimal" id="gc" value="${S.goalC}"></label>
      </div>
      <button class="btn primary block" id="savegoal" style="margin-top:10px">Speichern</button>
    </section>
    <section class="card">
      <h3>Wasser</h3>
      <div class="grid2">
        <label class="f">Tagesziel in ml<input type="number" inputmode="numeric" id="wg" value="${S.waterGoal}"></label>
        <label class="f">Glasgröße in ml<input type="number" inputmode="numeric" id="ws" value="${S.glassSize}"></label>
      </div>
      <button class="btn block" id="savewater" style="margin-top:10px">Speichern</button>
    </section>
    <section class="card">
      <h3>Supplements</h3>
      <p class="muted small" style="margin:0 0 8px">Alle Supplements gelten jeden Tag als genommen. Tipp im Tagebuch eins an, wenn du es ausgelassen hast. Claude kann diese Liste auch selbst aktualisieren.</p>
      <div class="list">${S.supps.length ? S.supps.map(x => `<div class="item" style="cursor:default"><div style="min-width:0"><div class="t">${esc(x.name)}</div><div class="s">${esc(x.dose || '')}</div></div><button class="linkbtn" data-delsupp="${x.id}">Löschen</button></div>`).join('') : '<div class="empty">Noch keine Supplements.</div>'}</div>
      <div class="grid2" style="margin-top:8px"><input type="text" id="suppname" placeholder="Name, z. B. Kreatin"><input type="text" id="suppdose" placeholder="Menge, z. B. 5 g"></div>
      <button class="btn block" id="addsupp" style="margin-top:8px">Hinzufügen</button>
    </section>
    <section class="card">
      <h3>Sync mit Claude</h3>
      <p class="muted small" style="margin:0 0 10px">Die App speichert deine Daten automatisch in deinem privaten GitHub-Speicher. Von dort kann Claude sie lesen. Das ist gleichzeitig ein Backup.</p>
      <label class="f">Speicher, Format: benutzername/gramm-daten<input type="text" id="ghrepo" value="${esc(S.ghRepo)}" placeholder="benutzername/gramm-daten" autocomplete="off" autocapitalize="off"></label>
      <label class="f" style="margin-top:8px">GitHub-Token<input type="password" id="ghtoken" value="${esc(S.ghToken)}" placeholder="github_pat_…" autocomplete="off"></label>
      <label class="row small" style="margin-top:10px;gap:8px"><input type="checkbox" id="autosync" ${S.autoSync ? 'checked' : ''}> Automatisch synchronisieren</label>
      <div class="muted small" id="syncstatus" style="margin-top:6px">${syncStatusText()}</div>
      <div class="btns" style="margin-top:10px"><button class="btn" id="savegh">Speichern</button><button class="btn primary" id="syncnow">Jetzt synchronisieren</button></div>
      <button class="linkbtn" id="ghrestore" style="margin-top:6px">Daten von GitHub wiederherstellen</button>
    </section>
    <section class="card">
      <h3>Foto-Erkennung</h3>
      <p class="muted small" style="margin:0 0 10px">Dein Claude-API-Schlüssel bleibt nur auf diesem Gerät. Jede Erkennung kostet ein paar Cent über dein API-Guthaben.</p>
      <label class="f">API-Schlüssel<input type="password" id="apikey" value="${esc(S.apiKey)}" placeholder="sk-ant-…" autocomplete="off"></label>
      <label class="f" style="margin-top:8px">Modell<input type="text" id="model" value="${esc(S.model)}"></label>
      <button class="btn block" id="savekey" style="margin-top:10px">Speichern</button>
    </section>
    <section class="card">
      <h3>Backup</h3>
      <p class="muted small" style="margin:0 0 10px">Speichere regelmäßig ein Backup. Wenn du den Browser-Speicher löschst, sind sonst alle Daten weg.</p>
      <div class="btns"><button class="btn primary" id="export">Backup speichern</button><label class="btn" style="text-align:center">Backup laden<input type="file" accept="application/json,.json" id="import" class="hidden"></label></div>
    </section>
    <section class="card help">
      <h3>Hilfe</h3>
      <p><b>Zum Startbildschirm:</b> Am iPhone in Safari auf Teilen und dann „Zum Home-Bildschirm“. Am Android-Handy in Chrome im Menü auf „App installieren“.</p>
      <p><b>Barcode:</b> Die Kamera funktioniert nur, wenn die App über HTTPS läuft, zum Beispiel auf GitHub Pages.</p>
      <p><b>Wiegen:</b> Jeden Morgen nach der Toilette. Entscheidend ist der Wochenschnitt.</p>
      <p><b>Sync:</b> Nach jeder Änderung sendet die App automatisch. Oben rechts siehst du „✓ Gesendet“. Steht dort „Wartet“, wird es beim nächsten Öffnen nachgeholt.</p>
    </section>
    <section class="card">
      <h3>Alles löschen</h3>
      <p class="muted small" style="margin:0 0 10px">Löscht alle Einträge, Lebensmittel und Einstellungen auf diesem Gerät.</p>
      <button class="btn danger block" id="wipe">Alle Daten löschen</button>
    </section>
    <p class="muted tiny" style="text-align:center">Gramm · Nährwerte aus Open Food Facts</p>`;

  $('#addphase').onclick = () => openPhaseSheet();
  $$('[data-phase]').forEach(b => b.onclick = () => openPhaseSheet(PHASES.find(p => p.id === b.dataset.phase)));
  $('#savegoal').onclick = async () => {
    const vals = { goalKcal: num($('#gk').value), goalP: num($('#gp').value), goalF: num($('#gf').value), goalC: num($('#gc').value) };
    if (Object.values(vals).some(v => !(v >= 0))) { toast('Bitte fülle alle Felder mit Zahlen.'); return; }
    for (const [k, v] of Object.entries(vals)) await setSetting(k, v);
    toast('Standard-Ziel gespeichert.');
  };
  $('#savewater').onclick = async () => {
    const g = num($('#wg').value), s = num($('#ws').value);
    if (!(g > 0 && s > 0)) { toast('Bitte gib gültige Werte ein.'); return; }
    await setSetting('waterGoal', g); await setSetting('glassSize', s);
    toast('Wasser-Ziel gespeichert.');
  };
  $('#savekey').onclick = async () => {
    await setSetting('apiKey', $('#apikey').value.trim());
    await setSetting('model', $('#model').value.trim() || DEFAULTS.model);
    toast('Foto-Erkennung gespeichert.');
  };
  $('#export').onclick = exportData;
  $('#addsupp').onclick = async () => {
    const name = $('#suppname').value.trim();
    if (!name) { toast('Bitte gib einen Namen ein.'); return; }
    await setSetting('supps', [...S.supps, { id: uid(), name, dose: $('#suppdose').value.trim(), daily: true }]);
    scheduleSync(); renderSettings();
  };
  $$('[data-delsupp]').forEach(b => b.onclick = async () => { await setSetting('supps', S.supps.filter(x => x.id !== b.dataset.delsupp)); scheduleSync(); renderSettings(); });
  const saveGh = async () => {
    await setSetting('ghRepo', $('#ghrepo').value.trim().replace(/^https?:\/\/github\.com\//, '').replace(/\/$/, ''));
    await setSetting('ghToken', $('#ghtoken').value.trim());
    await setSetting('autoSync', $('#autosync').checked);
  };
  $('#savegh').onclick = async () => { await saveGh(); toast('Sync-Einstellungen gespeichert.'); };
  $('#syncnow').onclick = async () => { await saveGh(); setSyncBadge('pending'); await syncNow(false); const st = $('#syncstatus'); if (st) st.textContent = syncStatusText(); };
  $('#ghrestore').onclick = async () => { await saveGh(); restoreFromGitHub(); };
  $('#import').onchange = e => importData(e.target.files[0]);
  $('#wipe').onclick = () => {
    const body = openSheet('Wirklich alles löschen?', `<p style="margin:0">Alle Einträge, Gewichte, Lebensmittel und Einstellungen werden gelöscht. Das lässt sich nicht rückgängig machen.</p><div class="btns"><button class="btn" data-close="1" id="wno">Abbrechen</button><button class="btn danger" id="wyes">Endgültig löschen</button></div>`);
    $('#wno', body).onclick = closeSheet;
    $('#wyes', body).onclick = async () => {
      for (const st of Object.keys(STORES)) await dbClear(st);
      Object.assign(S, DEFAULTS);
      await setSetting('seeded', true);
      await loadPhases();
      closeSheet(); toast('Alle Daten gelöscht.'); renderSettings();
    };
  };
}

function openPhaseSheet(p) {
  const isNew = !p;
  p = p || { name: '', type: 'defizit', start: todayStr(), end: addDays(todayStr(), 42), kcal: S.goalKcal, p: S.goalP, f: S.goalF, c: S.goalC };
  const body = openSheet(isNew ? 'Neue Phase' : 'Phase bearbeiten', `
    <label class="f">Name<input type="text" id="pn" value="${esc(p.name)}" placeholder="z. B. Defizit"></label>
    <label class="f">Art<select id="pt"><option value="defizit" ${p.type === 'defizit' ? 'selected' : ''}>Defizit, ich will abnehmen</option><option value="erhaltung" ${p.type !== 'defizit' ? 'selected' : ''}>Erhaltung, ich will halten</option></select></label>
    <div class="grid2">
      <label class="f">Start<input type="date" id="ps" value="${p.start}"></label>
      <label class="f">Ende<input type="date" id="pe" value="${p.end}"></label>
      <label class="f">Kalorien<input type="number" inputmode="decimal" id="pk" value="${p.kcal}"></label>
      <label class="f">Eiweiß (g)<input type="number" inputmode="decimal" id="pp" value="${p.p}"></label>
      <label class="f">Fett (g)<input type="number" inputmode="decimal" id="pf" value="${p.f}"></label>
      <label class="f">Kohlenhydrate (g)<input type="number" inputmode="decimal" id="pc" value="${p.c}"></label>
    </div>
    <div class="muted small" id="pcheck"></div>
    <div class="btns">${isNew ? '' : '<button class="btn danger" id="pdel">Löschen</button>'}<button class="btn primary" id="psave">Speichern</button></div>`);
  const check = () => {
    const k = num($('#pk', body).value), pr = num($('#pp', body).value), f = num($('#pf', body).value), c = num($('#pc', body).value);
    const sum = pr * 4 + f * 9 + c * 4;
    $('#pcheck', body).textContent = Number.isFinite(sum) ? `Makros ergeben ${fmt(sum)} kcal. Ziel sind ${fmt(k)} kcal.` : '';
  };
  ['#pk', '#pp', '#pf', '#pc'].forEach(s => { $(s, body).oninput = check; });
  check();
  $('#psave', body).onclick = async () => {
    const v = {
      id: p.id || uid(), name: $('#pn', body).value.trim() || 'Phase', type: $('#pt', body).value,
      start: $('#ps', body).value, end: $('#pe', body).value,
      kcal: num($('#pk', body).value), p: num($('#pp', body).value), f: num($('#pf', body).value), c: num($('#pc', body).value),
    };
    if (!v.start || !v.end || v.end < v.start) { toast('Das Ende muss nach dem Start liegen.'); return; }
    if ([v.kcal, v.p, v.f, v.c].some(x => !(x >= 0))) { toast('Bitte fülle alle Ziele mit Zahlen.'); return; }
    await dbPut('phases', v);
    closeSheet(); toast('Phase gespeichert.'); renderSettings();
  };
  if (!isNew) $('#pdel', body).onclick = async () => { await dbDel('phases', p.id); closeSheet(); toast('Phase gelöscht.'); renderSettings(); };
}

async function exportData() {
  const out = await exportObject();
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const name = `gramm-backup-${todayStr()}.json`;
  const file = new File([blob], name, { type: 'application/json' });
  // Am Handy ist Teilen oft praktischer, sonst normaler Download
  if (navigator.canShare && navigator.canShare({ files: [file] }) && /Android|iPhone|iPad/i.test(navigator.userAgent)) {
    try { await navigator.share({ files: [file], title: 'Gramm Backup' }); toast('Backup erstellt.'); return; } catch (e) { if (e.name === 'AbortError') return; }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob); a.download = name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast('Backup gespeichert.');
}
async function importData(file) {
  if (!file) return;
  let json;
  try { json = JSON.parse(await file.text()); } catch (e) { toast('Die Datei ist kein gültiges Backup.'); return; }
  confirmImport(json);
}
function confirmImport(json) {
  if (!json || json.app !== 'gramm' || !json.data) { toast('Die Datei ist kein Gramm-Backup.'); return; }
  const counts = (json.data.entries || []).length;
  const body = openSheet('Backup laden?', `<p style="margin:0">Das Backup vom ${esc((json.exported || '').slice(0, 10))} mit ${counts} Essens-Einträgen ersetzt alle Daten auf diesem Gerät.</p><div class="btns"><button class="btn" id="ino">Abbrechen</button><button class="btn primary" id="iyes">Backup laden</button></div>`);
  $('#ino', body).onclick = closeSheet;
  $('#iyes', body).onclick = async () => {
    const keep = { apiKey: S.apiKey, ghToken: S.ghToken, ghRepo: S.ghRepo, autoSync: S.autoSync };
    for (const st of Object.keys(STORES)) {
      await dbClear(st);
      if (Array.isArray(json.data[st]) && json.data[st].length) await dbPutMany(st, json.data[st]);
    }
    Object.assign(S, DEFAULTS);
    await loadSettings();
    for (const [k, v] of Object.entries(keep)) if (v && !S[k]) await setSetting(k, v);
    await loadPhases();
    closeSheet(); toast('Backup geladen.'); render();
  };
}


// ---------- Sync mit GitHub, damit Claude mitlesen kann ----------
let syncTimer = null, syncing = false, syncPending = false;
function syncReady() { return !!(S.ghToken && /^[\w.-]+\/[\w.-]+$/.test(S.ghRepo)); }
function scheduleSync() {
  if (!S.autoSync || !syncReady()) return;
  syncPending = true;
  // Merken, dass etwas offen ist. So wird es beim nächsten Start nachgeholt, falls das Handy die App vorher stoppt.
  S.dirty = Date.now();
  dbPut('settings', { key: 'dirty', value: S.dirty }).catch(() => {});
  setSyncBadge('pending');
  clearTimeout(syncTimer);
  syncTimer = setTimeout(() => syncNow(true), 1200);
}
function needsSync() { return syncReady() && S.autoSync && (!S.dirty || (S.dirty || 0) > (S.lastSync || 0) || Date.now() - (S.lastSync || 0) > 3 * 3600 * 1000); }
function setSyncBadge(state) {
  const el = document.getElementById('syncbadge');
  if (!el) return;
  if (!syncReady()) { el.hidden = true; return; }
  el.hidden = false;
  el.dataset.state = state;
  el.textContent = state === 'ok' ? '✓ Gesendet' : state === 'busy' ? 'Sendet …' : state === 'error' ? 'Nicht gesendet' : 'Wartet …';
}
function syncStatusText() {
  if (!syncReady()) return 'Noch nicht eingerichtet.';
  if (!S.lastSync) return 'Noch nie synchronisiert.';
  const d = new Date(S.lastSync);
  return `Zuletzt synchronisiert: ${niceDate(toDateStr(d))}, ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')} Uhr.`;
}
function b64encode(str) {
  const bytes = new TextEncoder().encode(str);
  let bin = '';
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
  return btoa(bin);
}
async function gh(path, opts = {}, accept = 'application/vnd.github+json') {
  return fetch(`https://api.github.com/repos/${S.ghRepo}/contents/${path}`, {
    ...opts,
    headers: { Authorization: `Bearer ${S.ghToken}`, Accept: accept, 'X-GitHub-Api-Version': '2022-11-28', ...(opts.body ? { 'Content-Type': 'application/json' } : {}) },
    cache: 'no-store',
  });
}
function ghMessage(status) {
  if (status === 401) return 'Der GitHub-Token ist ungültig oder abgelaufen.';
  if (status === 403) return 'Der Token darf in diesen Speicher nicht schreiben. Prüf die Rechte „Contents: Read and write“.';
  if (status === 404) return 'Den Speicher gibt es nicht. Prüf den Namen benutzername/gramm-daten.';
  return `GitHub hat mit Fehler ${status} geantwortet.`;
}
async function ghPut(path, content, message) {
  let sha;
  const head = await gh(path);
  if (head.ok) sha = (await head.json()).sha;
  else if (head.status !== 404) throw new Error(ghMessage(head.status));
  const res = await gh(path, { method: 'PUT', body: JSON.stringify({ message, content: b64encode(content), ...(sha ? { sha } : {}) }) });
  if (!res.ok) throw new Error(ghMessage(res.status));
}
async function exportObject() {
  const out = { app: 'gramm', version: 2, exported: new Date().toISOString(), data: {} };
  for (const st of Object.keys(STORES)) {
    let rows = await dbAll(st);
    if (st === 'settings') rows = rows.filter(r => r.key !== 'apiKey' && r.key !== 'ghToken');
    out.data[st] = rows;
  }
  return out;
}
async function syncNow(silent) {
  if (!syncReady()) { if (!silent) toast('Trag zuerst Speicher und Token ein.'); return false; }
  if (syncing) { syncPending = true; return false; }
  syncing = true; syncPending = false; clearTimeout(syncTimer);
  const started = Date.now();
  setSyncBadge('busy');
  try {
    const data = await exportObject();
    const stamp = new Date().toISOString().slice(0, 16).replace('T', ' ');
    await ghPut('gramm-daten.json', JSON.stringify(data, null, 1), `Daten ${stamp}`);
    await ghPut('bericht.md', await buildReport(), `Bericht ${stamp}`);
    await setSetting('lastSync', started);
    setSyncBadge((S.dirty || 0) > started ? 'pending' : 'ok');
    if (!silent) toast('Mit GitHub synchronisiert.');
    return true;
  } catch (e) {
    const msg = e instanceof TypeError ? 'Keine Verbindung zu GitHub. Prüf dein Internet.' : e.message;
    if (!silent) toast(msg, 4000); else console.warn('Sync:', msg);
    setSyncBadge('error');
    return false;
  } finally {
    syncing = false;
    if (syncPending) scheduleSync();
  }
}
async function restoreFromGitHub() {
  if (!syncReady()) { toast('Trag zuerst Speicher und Token ein.'); return; }
  let json;
  try {
    const res = await gh('gramm-daten.json', {}, 'application/vnd.github.raw+json');
    if (!res.ok) { toast(res.status === 404 ? 'Im Speicher liegen noch keine Daten.' : ghMessage(res.status), 4000); return; }
    json = await res.json();
  } catch (e) { toast('Die Daten konnten nicht geladen werden.'); return; }
  confirmImport(json);
}

// Vorgaben, die Claude in den Speicher legt, zum Beispiel die Supplement-Liste
async function loadVorgaben() {
  if (!syncReady()) return;
  try {
    const res = await gh('vorgaben.json', {}, 'application/vnd.github.raw+json');
    if (!res.ok) return;
    const v = await res.json();
    if (!v || !(v.version > (S.vorgabenVersion || 0))) return;
    if (Array.isArray(v.supplements)) await setSetting('supps', v.supplements);
    // Einträge, die Claude hinzufügt. Nur neu anlegen, nie vorhandene überschreiben.
    const allowed = { entries: 'id', foods: 'id', suppLog: 'date', weights: 'date', water: 'date' };
    for (const [st, rows] of Object.entries(v.add || {})) {
      if (!allowed[st] || !Array.isArray(rows)) continue;
      for (const row of rows) {
        const key = row && row[allowed[st]];
        if (!key || await dbGet(st, key)) continue;
        await dbPut(st, row);
      }
    }
    // Korrekturen von Claude: überschreiben gezielt einzelne Einträge.
    for (const [st, rows] of Object.entries(v.set || {})) {
      if (!allowed[st] || !Array.isArray(rows)) continue;
      for (const row of rows) { if (row && row[allowed[st]]) await dbPut(st, row); }
    }
    await setSetting('vorgabenVersion', v.version);
    toast(v.message || 'Von Claude aktualisiert.', 3500);
    scheduleSync();
    if (!sheetOpen()) render();
  } catch (e) { /* ohne Netz einfach später */ }
}

// Lesbarer Bericht für Claude
async function buildReport() {
  const t = todayStr();
  const from = addDays(t, -13);
  const [entries, weights, water, supps, foods] = await Promise.all([entriesBetween(from, t), dbAll('weights'), dbAll('water'), dbAll('suppLog'), dbAll('foods')]);
  weights.sort((a, b) => a.date.localeCompare(b.date));
  const waterMap = new Map(water.map(w => [w.date, w.ml]));
  const suppMap = new Map(supps.map(s => [s.date, s]));
  const ph = phaseFor(t);
  const L = [];
  L.push('# Gramm-Bericht', '', `Stand: ${new Date().toLocaleString('de-DE')}`);
  L.push(`Aktuelle Phase: ${ph ? `${ph.name} (${ph.type}), ${ph.kcal} kcal, E ${ph.p} g, F ${ph.f} g, KH ${ph.c} g` : `keine, Standard ${S.goalKcal} kcal`}`);
  L.push(`Supplements laut Liste: ${S.supps.length ? S.supps.map(x => x.name + (x.dose ? ' ' + x.dose : '')).join(', ') : 'keine eingetragen'}`);
  L.push('', '## Gewicht, letzte 28 Tage');
  const wRecent = weights.filter(w => w.date >= addDays(t, -27));
  L.push(wRecent.length ? wRecent.map(w => `- ${w.date}${w.time ? ' um ' + w.time + ' Uhr' : ''}: ${w.kg} kg`).join('\n') : '- keine Werte');
  const weeks = weeklyAverages(weights).slice(-6);
  if (weeks.length) { L.push('', 'Wochenschnitte (Woche ab Montag):'); weeks.forEach(w => L.push(`- ${w.week}: ${r1(w.avg)} kg aus ${w.n} Werten`)); }
  L.push('', '## Ernährung, letzte 14 Tage');
  for (let i = 13; i >= 0; i--) {
    const d = addDays(t, -i);
    const list = entries.filter(e => e.date === d);
    const s = sumEntries(list);
    const g = goalsFor(d);
    const sp = takenFor(suppMap.get(d));
    L.push('', `### ${d} (${niceDate(d)}), Ziel ${g.kcal} kcal`);
    if (S.supps.length) {
      L.push(`- Supplements: ${S.supps.map(x => (sp.has(x.id) ? '✓ ' : '✗ ') + x.name).join(', ')}`);
      const tot = {};
      S.supps.filter(x => sp.has(x.id) && x.nutrients).forEach(x => Object.entries(x.nutrients).forEach(([k, v]) => { tot[k] = (tot[k] || 0) + Number(v); }));
      const parts = SUPP_NUTRIENTS.filter(([k]) => tot[k]).map(([k, n, u]) => `${n} ${r1(tot[k])} ${u}`);
      if (parts.length) L.push(`- Aus Supplements: ${parts.join(' · ')}`);
    }
    if (!list.length) { L.push('Keine Essens-Einträge.'); continue; }
    L.push(`Summe: ${r0(s.kcal)} kcal · Eiweiß ${r0(s.p)} g · Fett ${r0(s.f)} g · KH ${r0(s.c)} g · Ballaststoffe ${r0(s.fib)} g · Zucker ${r0(s.sug)} g · Salz ${r1(s.salt)} g · Wasser ${r1((waterMap.get(d) || 0) / 1000)} l`);
    MEALS.forEach(m => {
      const ml = list.filter(e => e.meal === m.id);
      if (ml.length) L.push(`- ${m.name}: ` + ml.map(e => `${e.name}${e.grams ? ' ' + r0(e.grams) + ' g' : ''} (${r0(e.kcal)} kcal)`).join('; '));
    });
  }
  const favs = foods.filter(f => f.fav).map(f => f.name);
  if (favs.length) L.push('', `Favoriten: ${favs.join(', ')}`);
  return L.join('\n') + '\n';
}

// ---------- Start ----------
async function init() {
  try {
    await loadSettings();
    await seedIfNeeded();
    await loadPhases();
  } catch (e) {
    view().innerHTML = `<div class="card">Der Speicher konnte nicht geöffnet werden. Im privaten Modus funktioniert die App eventuell nicht.</div>`;
    return;
  }
  $$('nav.tabs button').forEach(b => b.onclick = () => switchTab(b.dataset.tab));
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && sheetOpen()) closeSheet(); });
  // Wenn die App über Mitternacht offen bleibt, springt "Heute" mit
  let lastToday = todayStr();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && todayStr() !== lastToday) {
      if (state.date === lastToday) state.date = todayStr();
      lastToday = todayStr();
      if (!sheetOpen()) render();
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden' && syncPending) syncNow(true);
    if (document.visibilityState === 'visible' && needsSync()) syncNow(true);
  });
  window.addEventListener('online', () => { if (needsSync()) syncNow(true); });
  setSyncBadge(syncReady() && (S.dirty || 0) > (S.lastSync || 0) ? 'pending' : 'ok');
  if (needsSync()) setTimeout(() => syncNow(true), 800);
  setTimeout(loadVorgaben, 300);
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') loadVorgaben(); });
  $('#syncbadge').onclick = () => syncNow(false);
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
  render();
  if ('serviceWorker' in navigator && location.protocol !== 'file:') navigator.serviceWorker.register('sw.js').catch(() => {});
}
init();
