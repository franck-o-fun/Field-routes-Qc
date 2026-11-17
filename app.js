/* Field routes. Everything is saved on this device (localStorage + IndexedDB). */
(() => {
"use strict";

const C = window.FR_CONFIG;
const CRM = C.crmName || "the CRM";   // brand name shown for the CRM (white label)
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const money = n => new Intl.NumberFormat(LOC, { style: "currency", currency: "CAD" }).format(n);
const cents = n => Math.round(n * 100) / 100;

const LS = {
  get(k, d) { try { const v = localStorage.getItem("fr." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("fr." + k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } }
};

/* ---------- language: French by default, English from Reports ---------- */
const LANG = LS.get("lang", "fr") === "en" ? "en" : "fr";
const LOC = LANG === "fr" ? "fr-CA" : "en-CA";
const FRS = window.LA_RUN_FR || {};
const missingFr = new Set();     // English text with no French yet (shown in English meanwhile)
function tr(key, vals) {
  let out = key;
  if (LANG === "fr") { if (FRS[key] != null) out = FRS[key]; else missingFr.add(key); }
  return vals.length ? out.replace(/\{(\d+)\}/g, (_, i) => vals[i] != null ? vals[i] : "") : out;
}
const tt = (str, ...v) => tr(str, v);                                                  // tt("Save")
const T = (strs, ...v) => tr(strs.reduce((a, x, i) => a + "{" + (i - 1) + "}" + x), v);   // T`${n} stores`: key "{0} stores"
const pl = n => (LANG === "fr" ? Math.abs(n) < 2 : n === 1) ? "" : "s";               // plural "s", French rule for 0 and 1
// The page's fixed text (index.html) is written in English and translated once at start.
function translatePage() {
  document.documentElement.lang = LANG;
  if (LANG !== "fr") return;
  const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let n = walk.nextNode(); n; n = walk.nextNode()) { const k = n.textContent.trim(); if (k && FRS[k] != null) n.textContent = n.textContent.replace(k, FRS[k]); }
  for (const el of document.querySelectorAll("[placeholder],[aria-label]")) for (const a of ["placeholder", "aria-label"]) { const k = el.getAttribute(a); if (k && FRS[k] != null) el.setAttribute(a, FRS[k]); }
}

/* ---------- dates, always in the territory's time zone ---------- */
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: C.timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
const today = () => dayFmt.format(new Date());
const fromYmd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
const toYmd = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = fromYmd(s); d.setUTCDate(d.getUTCDate() + n); return toYmd(d); };
const weekday = s => new Intl.DateTimeFormat(LOC, { weekday: "long", timeZone: "UTC" }).format(fromYmd(s));
const niceDate = s => new Intl.DateTimeFormat(LOC, { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(fromYmd(s));
const mondayOf = s => addDays(s, -((fromYmd(s).getUTCDay() + 6) % 7));
const shortDate = s => new Intl.DateTimeFormat(LOC, { month: "short", day: "numeric", timeZone: "UTC" }).format(fromYmd(s));
const daysBetween = (a, b) => Math.round((fromYmd(b) - fromYmd(a)) / 864e5);
const maxDate = arr => arr.filter(Boolean).sort().pop() || "";
const ago = s => { const n = daysBetween(s, today()); return n <= 0 ? tt("today") : n === 1 ? tt("yesterday") : T`${n} days ago`; };
const normTxt = x => String(x || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, " ").trim();

/* ---------- IndexedDB ---------- */
let dbp = null;
function db() {
  if (dbp) return dbp;
  dbp = new Promise((res, rej) => {
    const rq = indexedDB.open("field-routes", 1);
    rq.onupgradeneeded = () => {
      const d = rq.result;
      d.createObjectStore("notes", { keyPath: "id", autoIncrement: true }).createIndex("storeId", "storeId");
      d.createObjectStore("orders", { keyPath: "id", autoIncrement: true }).createIndex("storeId", "storeId");
      d.createObjectStore("mileage", { keyPath: "key" });
    };
    rq.onsuccess = () => res(rq.result);
    rq.onerror = () => rej(rq.error);
  });
  return dbp;
}
async function tx(store, mode, fn) {
  const d = await db();
  return new Promise((res, rej) => {
    const t = d.transaction(store, mode);
    const rq = fn(t.objectStore(store));
    t.oncomplete = () => res(rq && rq.result);
    t.onerror = t.onabort = () => rej(t.error);
  });
}
const all = store => tx(store, "readonly", s => s.getAll());
const put = (store, v) => tx(store, "readwrite", s => s.put(v));

/* ---------- state ---------- */
const lists = window.STORE_LISTS.map(l => ({ id: l.id, name: l.name, stores: l.stores.slice() }));
for (const s of LS.get("custom", [])) { const l = lists.find(x => x.id === s.listId) || lists[0]; l.stores.push(s); }
const byId = new Map();
lists.forEach(l => l.stores.forEach(s => { s.listId = l.id; byId.set(s.id, s); }));
const nameCount = {}; byId.forEach(s => { nameCount[s.name] = (nameCount[s.name] || 0) + 1; });
const label = s => nameCount[s.name] > 1 ? `${s.name} ${s.storeNo ? "#" + s.storeNo : s.city}` : s.name;
const regionOf = s => String(s.region || "").replace(/\s*\(.*?\)\s*/g, "").trim();

const S = {
  tab: "stores",
  listId: LS.get("list", lists[0].id),
  region: "", q: "",
  hideDone: LS.get("hideDone", false),
  route: LS.get("route", []).filter(id => byId.has(id)),
  start: LS.get("start", null),
  info: LS.get("routeInfo", null),
  geo: LS.get("geo", {}),
  rep: LS.get("rep", C.defaultRep),
  meta: LS.get("storeMeta", {}),
  drafts: LS.get("drafts", {}),
  done: new Set(),
  lastLocal: {},   // storeId -> { visit, order }: latest dates saved on this phone
  due: LS.get("due", null),           // last visit and last order for every store, from the CRM
  dueFilter: LS.get("dueFilter", "all"),
  line: null
};
if (!lists.some(l => l.id === S.listId)) S.listId = lists[0].id;
const curList = () => lists.find(l => l.id === S.listId);
const routeKey = () => JSON.stringify([S.route, S.start && [S.start.lat, S.start.lng]]);
const infoOk = () => S.info && S.info.key === routeKey();

/* ---------- small UI helpers ---------- */
let toastT;
function toast(msg, err) {
  const t = $("#toast"); t.textContent = msg; t.className = "toast" + (err ? " err" : ""); t.hidden = false;
  clearTimeout(toastT); toastT = setTimeout(() => { t.hidden = true; }, err ? 6500 : 3800);
}
function setTab(tab) {
  S.tab = tab; document.body.dataset.tab = tab;
  document.querySelectorAll(".tabs button").forEach(b => b.classList.toggle("on", b.dataset.tab === tab));
  if (tab === "route") renderRoute();
  if (tab === "map" || tab === "stores") fetchDue().catch(() => {});
  if (tab === "more") renderReports();
  setTimeout(() => map && map.invalidateSize(), 60);
}
let sheetClose = null;
function openSheet(title, html, foot, onClose) {
  closeSheet(true); sheetSeq++;
  $("#sheetTitle").textContent = title;
  $("#sheetContent").innerHTML = html; $("#sheetContent").scrollTop = 0;
  const f = $("#sheetFoot"); f.hidden = !foot; f.innerHTML = foot || "";
  $("#sheet").hidden = false; sheetClose = onClose || null;
}
let sheetSeq = 0;   // changes every time the sheet shows something new
function closeSheet(silent) {
  if ($("#sheet").hidden) return;
  $("#sheet").hidden = true;
  const fn = sheetClose; sheetClose = null; if (fn) fn();
  if (!silent) { renderStores(); refreshMarkers(); }
}
$("#sheet").addEventListener("click", e => { if (e.target.closest("[data-close]")) closeSheet(); });

/* ---------- stores list ---------- */
function shownStores(anyStatus) {
  const q = S.q.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return curList().stores.filter(s => {
    if (S.region && regionOf(s) !== S.region) return false;
    if (!anyStatus && S.dueFilter !== "all") { const c = statusFor(s.id).cls; if (S.dueFilter === "reorder" ? c !== "red" : c !== "red" && c !== "amber") return false; }
    if (S.hideDone && S.done.has(s.id)) return false;
    if (!q) return true;
    const hay = [s.name, s.city, s.address, s.storeNo, s.postal].join(" ").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    return hay.includes(q);
  });
}
function renderFilters() {
  $("#listSel").innerHTML = lists.map(l => `<option value="${esc(l.id)}">${esc(l.name)}</option>`).join("");
  $("#listSel").value = S.listId;
  const regs = [...new Set(curList().stores.map(regionOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  if (!regs.includes(S.region)) S.region = "";
  $("#regionSel").innerHTML = `<option value="">${tt("All regions")}</option>` + regs.map(r => `<option>${esc(r)}</option>`).join("");
  $("#regionSel").value = S.region;
  $("#hideDone").checked = S.hideDone;
}
function paintDueSeg() {
  let red = 0, amber = 0;
  for (const s of shownStores(true)) { const c = statusFor(s.id).cls; if (c === "red") red++; else if (c === "amber") amber++; }
  const lab = { all: tt("All"), due: T`Due · ${red + amber}`, reorder: T`Reorder · ${red}` };
  document.querySelectorAll(".dueSeg").forEach(g => g.querySelectorAll("button[data-due]").forEach(b => {
    b.textContent = lab[b.dataset.due]; b.classList.toggle("on", b.dataset.due === S.dueFilter); b.setAttribute("aria-pressed", b.dataset.due === S.dueFilter);
  }));
  const pb = $("#planDue"); if (pb) pb.textContent = T`Plan a run from due stores (${red + amber})`;
}
function setDueFilter(v) { S.dueFilter = v; LS.set("dueFilter", v); renderStores(); refreshMarkers(true); }
document.addEventListener("click", e => { const b = e.target.closest(".dueSeg button[data-due]"); if (b) setDueFilter(b.dataset.due); });
function renderCount() {
  paintDueSeg();
  const n = shownStores().length;
  $("#count").textContent = T`${n} store${pl(n)} shown · ${S.route.length} on today's route` + (G.pending ? T` · ${G.pending} to sync` : "");
}
function renderStores() {
  const shown = shownStores();
  renderCount();
  $("#storeList").innerHTML = shown.length ? shown.map(s => {
    const inR = S.route.includes(s.id), g = S.geo[s.id];
    const st = S.done.has(s.id) ? null : statusFor(s.id);
    const due = st && st.cls === "red" ? ` <span class="tag due-red">${tt("Reorder due")}</span>` : st && st.cls === "amber" ? ` <span class="tag due-amber">${tt("Visit due")}</span>` : "";
    const tags = (S.done.has(s.id) ? `<span class="tag done">${tt("Done today")}</span>` : "") +
      (!s.address ? `<span class="tag nomap">${tt("No address")}</span>` : g && g.approx ? `<span class="tag">${tt("Approx. pin")}</span>` : "");
    return `<li class="${inR ? "in" : ""}">
      <button class="pick" type="button" data-id="${esc(s.id)}" aria-pressed="${inR}">
        <span class="tick">${inR ? "✓" : ""}</span>
        <span style="min-width:0"><span class="s-name">${esc(s.name)}${s.storeNo ? ` <span class="tag">#${esc(s.storeNo)}</span>` : ""}${due}</span>
        <span class="s-sub">${esc([s.address, s.city].filter(Boolean).join(", ") || tt("No address"))}${tags}</span></span>
      </button>
      <button class="open" type="button" data-open="${esc(s.id)}" aria-label="${T`Open ${esc(s.name)}`}">›</button></li>`;
  }).join("") : `<li class="empty" style="display:block">${tt("No store matches. Clear the search, pick another region or show all stores.")}</li>`;
  const b = $("#routeBadge"); b.hidden = !S.route.length; b.textContent = S.route.length;
}
$("#storeList").addEventListener("click", e => {
  const o = e.target.closest("[data-open]"); if (o) return openStore(o.dataset.open);
  const p = e.target.closest(".pick"); if (p) toggleRoute(p.dataset.id);
});
$("#listSel").addEventListener("change", e => { S.listId = e.target.value; LS.set("list", S.listId); S.region = ""; renderFilters(); renderStores(); refreshMarkers(true); geocodeAll(); });
$("#regionSel").addEventListener("change", e => { S.region = e.target.value; renderStores(); refreshMarkers(true); });
$("#search").addEventListener("input", e => { S.q = e.target.value; renderStores(); });
$("#hideDone").addEventListener("change", e => { S.hideDone = e.target.checked; LS.set("hideDone", S.hideDone); renderStores(); });
$("#planDue").addEventListener("click", planDueRun);
$("#addShown").addEventListener("click", () => {
  const add = shownStores().filter(s => !S.route.includes(s.id));
  if (!add.length) return toast(tt("Every store on screen is already on the route."));
  add.forEach(s => S.route.push(s.id)); routeChanged(); toast(T`${add.length} store${pl(add.length)} added to today's route.`);
});

/* ---------- route basics ---------- */
function routeChanged(keepInfo) {
  LS.set("route", S.route); prefetchRoute();
  if (!keepInfo) { S.info = null; LS.set("routeInfo", null); setLine(null); }
  renderStores(); refreshMarkers(); if (S.tab === "route") renderRoute();
}
function toggleRoute(id) {
  const i = S.route.indexOf(id);
  if (i >= 0) S.route.splice(i, 1); else S.route.push(id);
  routeChanged();
}

/* ---------- map ---------- */
let map = null; const markers = new Map(); let meMarker = null;
function initMap() {
  if (!window.L) { $("#map").innerHTML = `<p class="empty">${tt("The map could not load. Check your connection and reopen the app.")}</p>`; return; }
  map = L.map("map", { zoomControl: true }).setView([46.2, -72.6], 7);
  L.tileLayer(C.tiles, { maxZoom: 19, attribution: "© OpenStreetMap" }).addTo(map);
  map.on("popupopen", e => { const id = e.popup._frId; if (id) e.popup.setContent(popupHtml(id)); });
  $("#map").addEventListener("click", e => {
    const b = e.target.closest("[data-act]"); if (!b) return;
    const id = b.dataset.id, act = b.dataset.act;
    if (act === "route") { toggleRoute(id); const m = markers.get(id); if (m && m.getPopup()) m.getPopup().setContent(popupHtml(id)); }
    else { map.closePopup(); if (act === "order") openOrder(id); if (act === "note") openNote(id); if (act === "record") openStore(id); }
  });
}
function popupHtml(id) {
  const s = byId.get(id), g = S.geo[id], inR = S.route.includes(id);
  return `<div class="pop"><b>${esc(s.name)}</b><span>${esc([s.address, s.city, s.postal].filter(Boolean).join(", "))}</span>
    ${S.done.has(id) ? `<small class="pst ok">${tt("Done today")}</small>` : (st => st.cls === "new" ? "" : `<small class="pst ${st.cls}">${esc(st.text)}</small>`)(statusFor(id))}
    ${s.phone ? `<small>${esc(s.phone)}</small>` : ""}${g && g.approx ? `<small>${tt("Approximate pin: the address did not match a building.")}</small>` : ""}
    <div class="acts"><button class="primary" data-act="order" data-id="${esc(id)}">${tt("Order")}</button>
    <button data-act="route" data-id="${esc(id)}">${inR ? tt("Remove from route") : tt("Add to route")}</button>
    <button data-act="note" data-id="${esc(id)}">${tt("Add a note")}</button>
    <button data-act="record" data-id="${esc(id)}">${tt("Store record")}</button></div></div>`;
}
function refreshMarkers(fit) {
  if (!map) return;
  const want = new Map();
  const shown = new Set(shownStores().map(s => s.id));
  for (const s of curList().stores) if (S.geo[s.id] && S.geo[s.id].lat && (shown.has(s.id) || S.route.includes(s.id))) want.set(s.id, s);
  for (const id of S.route) if (S.geo[id] && S.geo[id].lat) want.set(id, byId.get(id));
  for (const [id, m] of markers) if (!want.has(id)) { m.remove(); markers.delete(id); }
  const pts = [];
  for (const [id] of want) {
    const g = S.geo[id], n = S.route.indexOf(id), st = S.done.has(id) ? "ok" : statusFor(id).cls;
    const icon = L.divIcon({ className: "", iconSize: n >= 0 ? [30, 30] : [22, 22],
      html: `<div class="pin st-${st}${n >= 0 ? " route" : ""}${g.approx ? " approx" : ""}">${n >= 0 ? n + 1 : ""}</div>` });
    let m = markers.get(id);
    if (!m) { m = L.marker([g.lat, g.lng], { icon }).addTo(map); const p = L.popup({ maxWidth: 300, autoPanPaddingTopLeft: L.point(10, 170), autoPanPaddingBottomRight: L.point(10, 60) }); p._frId = id; m.bindPopup(p); markers.set(id, m); }
    else { m.setIcon(icon); m.setLatLng([g.lat, g.lng]); }
    m.setZIndexOffset(n >= 0 ? 500 : st === "red" ? 300 : st === "amber" ? 200 : 0);
    pts.push([g.lat, g.lng]);
  }
  if (S.start) {
    if (!meMarker) meMarker = L.marker([S.start.lat, S.start.lng], { icon: L.divIcon({ className: "", iconSize: [22, 22], html: `<div class="pin me"></div>` }), zIndexOffset: 900 }).addTo(map).bindPopup(tt("Start of the day"));
    else meMarker.setLatLng([S.start.lat, S.start.lng]);
  } else if (meMarker) { meMarker.remove(); meMarker = null; }
  if (fit && pts.length) map.fitBounds(pts, { padding: [30, 30], maxZoom: 13 });
}
function setLine(coords) {
  if (S.line) { S.line.remove(); S.line = null; }
  if (map && coords && coords.length) S.line = L.polyline(coords, { color: "#1f5c3f", weight: 4, opacity: .8 }).addTo(map);
}

/* ---------- placing addresses (slow, one at a time, biased to Quebec) ---------- */
let geoRunning = false, geoStop = false;
const cleanAddr = a => String(a).replace(/,?\s*(suite|local|bureau|unit|app\.?)\s*[\w-]+/ig, "").replace(/#\s*[\w-]+/g, "").replace(/,\s*March[ée] du Faubourg/i, "").replace(/\s+/g, " ").trim();
async function nominatim(q) {
  const u = new URL(C.geocoder);
  u.search = new URLSearchParams({ q, format: "jsonv2", limit: "1", addressdetails: "1", countrycodes: "ca", viewbox: "-80,44.9,-57,53", bounded: "0", "accept-language": "fr" });
  const r = await fetch(u, { headers: { Accept: "application/json" } });
  if (!r.ok) throw new Error("geocoder " + r.status);
  const j = await r.json(); const h = j && j[0]; if (!h) return null;
  const lat = +h.lat, lng = +h.lon;
  if (!(lat > 44 && lat < 63 && lng > -80.5 && lng < -56)) return null;
  return { lat, lng, house: !!(h.address && h.address.house_number) };
}
async function geocodeOne(s) {
  const prov = regionOf(s) === "Nouveau-Brunswick" ? "Nouveau-Brunswick" : "Québec";
  const tries = [];
  if (/\d/.test(s.address)) tries.push([`${cleanAddr(s.address)}, ${s.city}, ${prov}, Canada`, false]);
  if (s.postal) tries.push([`${s.postal}, ${prov}, Canada`, true]);
  if (s.city) tries.push([`${s.city}, ${prov}, Canada`, true]);
  for (let i = 0; i < tries.length; i++) {
    if (i) await sleep(1100);
    const hit = await nominatim(tries[i][0]);
    if (hit) return { lat: hit.lat, lng: hit.lng, approx: tries[i][1] || !hit.house };
  }
  return { fail: Date.now() };
}
async function geocodeAll() {
  if (geoRunning) return;
  const need = () => [...new Set([...curList().stores.map(s => s.id), ...S.route])].map(id => byId.get(id))
    .filter(s => s.address && (!S.geo[s.id] || (S.geo[s.id].fail && Date.now() - S.geo[s.id].fail > 7 * 864e5)));
  let todo = need(); if (!todo.length) return;
  geoRunning = true; geoStop = false;
  const st = $("#geoStatus"); let n = 0, errors = 0; const total = todo.length;
  while (todo.length && !geoStop) {
    const s = todo[0];
    st.hidden = false; st.textContent = T`Placing addresses on the map: ${n + 1} of ${total}. This only happens once.`;
    try { S.geo[s.id] = await geocodeOne(s); errors = 0; }
    catch (e) { errors++; if (errors >= 3) { st.textContent = tt("Could not place addresses right now. They will be tried again when you reopen the app."); await sleep(4000); break; } await sleep(3000); continue; }
    LS.set("geo", S.geo); n++;
    refreshMarkers(); if (n % 10 === 0) renderStores();
    await sleep(1100);
    todo = need();
  }
  st.hidden = true; geoRunning = false; renderStores(); refreshMarkers();
}

/* ---------- driving time: real roads, no straight lines ---------- */
const coordStr = pts => pts.map(p => `${p.lng.toFixed(6)},${p.lat.toFixed(6)}`).join(";");
async function osrm(path) {
  const r = await fetch(C.router + path);
  if (!r.ok) throw new Error("router " + r.status);
  const j = await r.json(); if (j.code !== "Ok") throw new Error("router " + j.code);
  return j;
}
function loopCost(D, t) { let c = 0; for (let i = 0; i < t.length; i++) c += D[t[i]][t[(i + 1) % t.length]]; return c; }
function solveLoop(D) {
  const n = D.length; if (n <= 3) return [...Array(n).keys()];
  let best, bc;
  if (n <= 9) {                       // small day: try every order
    const rest = [...Array(n - 1).keys()].map(i => i + 1); bc = Infinity;
    const perm = (a, k) => {
      if (k === a.length) { const t = [0, ...a], c = loopCost(D, t); if (c < bc) { bc = c; best = t.slice(); } return; }
      for (let i = k; i < a.length; i++) { [a[k], a[i]] = [a[i], a[k]]; perm(a, k + 1); [a[k], a[i]] = [a[i], a[k]]; }
    };
    perm(rest, 0); return best;
  }
  const left = new Set([...Array(n).keys()].slice(1)); best = [0];   // nearest next stop, then improve
  while (left.size) { const cur = best[best.length - 1]; let m = null; for (const j of left) if (m === null || D[cur][j] < D[cur][m]) m = j; best.push(m); left.delete(m); }
  bc = loopCost(D, best);
  for (let improved = true, pass = 0; improved && pass < 60; pass++) {
    improved = false;
    for (let i = 1; i < n; i++) for (let j = i + 1; j < n; j++) {
      const t = best.slice(0, i).concat(best.slice(i, j + 1).reverse(), best.slice(j + 1)); const c = loopCost(D, t);
      if (c < bc - 1e-6) { best = t; bc = c; improved = true; }
    }
    for (let i = 1; i < n; i++) for (let j = 1; j < n; j++) {
      if (i === j) continue;
      const t = best.slice(); const [x] = t.splice(i, 1); t.splice(j, 0, x); const c = loopCost(D, t);
      if (c < bc - 1e-6) { best = t; bc = c; improved = true; }
    }
  }
  return best;
}
const metres = (a, b) => { const R = 6371000, r = Math.PI / 180, dl = (b.lat - a.lat) * r, dn = (b.lng - a.lng) * r;
  const h = Math.sin(dl / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dn / 2) ** 2; return 2 * R * Math.asin(Math.sqrt(h)); };
// Phone map apps drop a destination identical to the start, so the drive home ends about one block north.
async function returnPoint(p) {
  const north = { lat: p.lat + 0.0014, lng: p.lng };
  try {
    const j = await osrm(`/nearest/v1/driving/${coordStr([north])}?number=1`);
    const [lng, lat] = j.waypoints[0].location; const q = { lat, lng };
    if (metres(p, q) > 50 && metres(p, q) < 600) return q;
  } catch (e) { /* keep the plain offset */ }
  return north;
}
const placed = () => S.route.filter(id => S.geo[id] && S.geo[id].lat);
const unplaced = () => S.route.filter(id => !(S.geo[id] && S.geo[id].lat));
function loopPoints() {            // start, stops in order; the loop closes back on the first point
  const stops = placed().map(id => ({ lat: S.geo[id].lat, lng: S.geo[id].lng }));
  return S.start ? [{ lat: S.start.lat, lng: S.start.lng }, ...stops] : stops;
}
async function measure() {
  const pts = loopPoints();
  if (pts.length < 2) { S.info = null; LS.set("routeInfo", null); setLine(null); return; }
  const j = await osrm(`/route/v1/driving/${coordStr([...pts, pts[0]])}?overview=full&geometries=geojson`);
  const r = j.routes[0];
  S.info = { key: routeKey(), km: Math.round(r.distance / 100) / 10, min: Math.round(r.duration / 60), ret: await returnPoint(pts[0]), date: today() };
  LS.set("routeInfo", S.info);
  setLine(r.geometry.coordinates.map(c => [c[1], c[0]]));
}
let busy = false;
async function optimize() {
  if (busy) return;
  if (!S.route.length) return toast(tt("Add stores to the route first."));
  const ids = placed();
  if (ids.length + (S.start ? 1 : 0) < 2) return toast(S.start ? tt("None of these stores has a pin yet, so there is nothing to drive to.") : tt("Tap Start from here, or add a second store, to get a loop."), true);
  busy = true; const b = $("#optimize"); b.disabled = true; b.textContent = tt("Optimizing…");
  try {
    let order = ids.slice();
    if (!S.start) { let w = 0; order.forEach((id, i) => { if (S.geo[id].lng < S.geo[order[w]].lng) w = i; }); order.unshift(order.splice(w, 1)[0]); }   // westernmost first
    const pts = (S.start ? [S.start] : []).concat(order.map(id => S.geo[id]));
    if (pts.length > 2) {
      const j = await osrm(`/table/v1/driving/${coordStr(pts)}?annotations=duration`);
      const D = j.durations.map(row => row.map(v => v == null ? 1e9 : v));
      const tour = solveLoop(D);
      const off = S.start ? 1 : 0;
      order = tour.filter(i => i >= off).map(i => order[i - off]);
    }
    S.route = order.filter(Boolean).concat(unplaced());
    LS.set("route", S.route);
    await measure();
    const miss = unplaced().length;
    toast(miss ? (miss === 1 ? tt("Route optimized. 1 store has no pin and stays at the end.") : T`Route optimized. ${miss} stores have no pin and stay at the end.`) : tt("Route optimized by real driving time."));
  } catch (e) {
    toast(tt("Could not get driving times. Check your signal and tap Optimize again."), true);
  } finally {
    busy = false; b.disabled = false; b.textContent = tt("Optimize");
    renderStores(); refreshMarkers(true); renderRoute();
  }
}
let measureT;
function measureSoon() {
  clearTimeout(measureT);
  measureT = setTimeout(async () => { try { await measure(); } catch (e) { toast(tt("Could not measure this order. Check your signal."), true); } renderRoute(); }, 700);
}

/* ---------- route screen ---------- */
function mapLinks() {
  const ids = placed(); if (!ids.length) return null;
  const startPt = S.start || S.geo[ids[0]];
  const stops = (S.start ? ids : ids.slice(1)).slice(0, C.maxMapStops).map(id => S.geo[id]);
  const ret = (infoOk() && S.info.ret) || { lat: startPt.lat + 0.0014, lng: startPt.lng };
  const ll = p => `${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const g = new URLSearchParams({ api: "1", origin: ll(startPt), destination: ll(ret), travelmode: "driving" });
  if (stops.length) g.set("waypoints", stops.map(ll).join("|"));
  return {
    google: "https://www.google.com/maps/dir/?" + g.toString(),
    apple: `https://maps.apple.com/?saddr=${ll(startPt)}&daddr=${[...stops, ret].map(ll).join("+to:")}&dirflg=d`,
    cut: (S.start ? ids.length : ids.length - 1) > C.maxMapStops, total: ids.length
  };
}
function renderRoute() {
  const n = S.route.length;
  const first = !S.start && placed().length ? byId.get(placed()[0]) : null;
  $("#startText").textContent = S.start ? T`Your location, set at ${S.start.time || tt("today")}` : first ? T`No location. Starts and ends at ${first.name}` : tt("No location set");
  $("#removeLoc").hidden = !S.start;
  $("#routeEmpty").hidden = !!n; $("#routeActions").hidden = !n;
  $("#routeList").innerHTML = S.route.map((id, i) => {
    const s = byId.get(id), g = S.geo[id];
    return `<li><span class="n">${i + 1}</span>
      <button class="t" type="button" data-open="${esc(id)}"><span class="s-name">${esc(s.name)}</span>
      <span class="s-sub">${esc(s.city || "")}${g && g.lat ? (g.approx ? tt(" · approx. pin") : "") : tt(" · no pin, not in the drive")}${S.done.has(id) ? tt(" · done today") : ""}</span></button>
      <button class="mv" type="button" data-mv="-1" data-i="${i}" ${i ? "" : "disabled"} aria-label="${tt("Earlier")}">↑</button>
      <button class="mv" type="button" data-mv="1" data-i="${i}" ${i < n - 1 ? "" : "disabled"} aria-label="${tt("Later")}">↓</button>
      <button class="mv" type="button" data-rm="${esc(id)}" aria-label="${tt("Remove")}">✕</button></li>`;
  }).join("");
  const sum = $("#routeSummary");
  if (n && infoOk()) {
    const h = Math.floor(S.info.min / 60), m = S.info.min % 60;
    sum.hidden = false;
    sum.innerHTML = `<div class="row between"><div><div class="label">${tt("Driving time")}</div><div class="big">${h ? h + " h " : ""}${m} min</div></div>
      <div style="text-align:right"><div class="label">${tt("Round trip")}</div><div class="big">${S.info.km.toFixed(1)} km</div></div></div>
      <p class="hint">${tt("Real roads, back to the start. No live traffic.")}</p>`;
  } else if (n) {
    sum.hidden = false; sum.innerHTML = `<p class="hint">${tt("Tap Optimize to put the stops in driving order and get the time and kilometres.")}</p>`;
  } else sum.hidden = true;
  const links = mapLinks();
  $("#gmaps").toggleAttribute("disabled", !links); $("#amaps").toggleAttribute("disabled", !links);
  if (links) { $("#gmaps").href = links.google; $("#amaps").href = links.apple; } else { $("#gmaps").removeAttribute("href"); $("#amaps").removeAttribute("href"); }
  $("#mapsNote").textContent = !links ? tt("No store on the route has a pin yet.") :
    (links.cut ? T`Long day: the map app gets the first ${C.maxMapStops} stores, then the drive back to the start. The app still knows all ${links.total}. ` : "") +
    tt("Both map apps open this exact order and end about one block from where you started.");
  $("#saveDay").disabled = !(infoOk() && S.info.km > 0);
}
$("#routeList").addEventListener("click", e => {
  const o = e.target.closest("[data-open]"); if (o) return openStore(o.dataset.open);
  const rm = e.target.closest("[data-rm]"); if (rm) return toggleRoute(rm.dataset.rm);
  const mv = e.target.closest("[data-mv]"); if (!mv) return;
  const i = +mv.dataset.i, j = i + +mv.dataset.mv; if (j < 0 || j >= S.route.length) return;
  [S.route[i], S.route[j]] = [S.route[j], S.route[i]];
  routeChanged(); measureSoon();
});
$("#startHere").addEventListener("click", () => {
  if (!navigator.geolocation) return toast(tt("This browser cannot share your location."), true);
  const b = $("#startHere"); b.disabled = true; b.textContent = tt("Finding you…");
  navigator.geolocation.getCurrentPosition(p => {
    S.start = { lat: p.coords.latitude, lng: p.coords.longitude, time: new Intl.DateTimeFormat(LOC, { hour: "numeric", minute: "2-digit", timeZone: C.timeZone }).format(new Date()) };
    LS.set("start", S.start); b.disabled = false; b.textContent = tt("Start from here");
    routeChanged(); toast(tt("Start set to where you are now."));
  }, err => {
    b.disabled = false; b.textContent = tt("Start from here");
    toast(err.code === 1 ? tt("Location is turned off for this site. Allow it in Settings, then tap again.") : tt("Could not find your location. Step outside or check your signal, then tap again."), true);
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
});
$("#removeLoc").addEventListener("click", () => { S.start = null; LS.set("start", null); routeChanged(); toast(tt("Starting point removed.")); });
$("#optimize").addEventListener("click", optimize);
let clearArmed = 0;
$("#clearRoute").addEventListener("click", e => {
  if (Date.now() - clearArmed > 4000) { clearArmed = Date.now(); e.target.textContent = tt("Tap again to clear"); setTimeout(() => { e.target.textContent = tt("Clear"); }, 4000); return; }
  clearArmed = 0; e.target.textContent = tt("Clear"); S.route = []; routeChanged(); toast(tt("Route cleared."));
});
$("#saveDay").addEventListener("click", async () => {
  if (!infoOk() || !(S.info.km > 0)) return toast(tt("Optimize the route first so the day has a real distance."), true);
  const date = today();
  try {
    await put("mileage", { key: S.rep + "|" + date, rep: S.rep, date, km: S.info.km, stores: S.route.map(id => label(byId.get(id))) });
    toast(T`Saved ${niceDate(date)}: ${S.info.km.toFixed(1)} km, ${S.route.length} store${pl(S.route.length)}.`);
  } catch (e) { toast(tt("Could not save the day on this phone. Free some storage and try again."), true); }
});

/* ---------- GoHighLevel sync (through the go-between service) ---------- */
const API = {
  url: () => String(LS.get("apiUrl", (C.api && C.api.url) || "")).trim().replace(/\/+$/, ""),
  key: () => String(LS.get("apiKey", "")).trim()
};
const connected = () => !!(API.url() && API.key());
const G = { running: false, pending: 0, error: "", timer: null, last: 0 };
async function api(method, path, body, ms) {
  const ctl = new AbortController(), t = setTimeout(() => ctl.abort(), ms || 75000);
  try {
    const r = await fetch(API.url() + path + (path.includes("?") ? "&" : "?") + "lang=" + LANG, { method, signal: ctl.signal,
      headers: Object.assign({ "X-App-Key": API.key() }, body ? { "Content-Type": "application/json" } : {}), body: body ? JSON.stringify(body) : undefined });
    let j = {}; try { j = await r.json(); } catch (e) { /* empty */ }
    if (!r.ok) { const e = new Error(j.error || T`The service answered ${r.status}.`); e.status = r.status; throw e; }
    return j;
  } catch (e) {
    if (e.name === "AbortError") { const x = new Error(tt("The service did not answer in time. It may be waking up; try again in a minute.")); x.status = 0; throw x; }
    if (!e.status && e.status !== 0) { const x = new Error(tt("No connection to the service. It will retry when you have signal.")); x.status = 0; throw x; }
    throw e;
  } finally { clearTimeout(t); }
}
const blobToDataUrl = b => new Promise((res, rej) => { const f = new FileReader(); f.onload = () => res(f.result); f.onerror = () => rej(f.error); f.readAsDataURL(b); });
async function contactFor(id, create) {
  const m = LS.get("ghlContacts", {}); if (m[id]) return m[id];
  if (!create) return null;
  const s = byId.get(id); if (!s) throw new Error(tt("This store is no longer in the list."));
  const meta = S.meta[id] || {}, list = lists.find(l => l.id === s.listId);
  const r = await api("POST", "/api/contact", { store: { id, name: label(s), address: s.address, city: s.city, postal: s.postal, phone: s.phone, email: s.email,
    region: regionOf(s), storeNo: meta.storeNo || s.storeNo, list: list ? list.name : "" } });
  m[id] = r.contactId; LS.set("ghlContacts", m); return r.contactId;
}
async function countPending() {
  try { let n = 0; for (const st of ["notes", "orders"]) n += mine(await all(st)).filter(r => r.sync === "pending").length; G.pending = n; } catch (e) { G.pending = 0; }
  paintSync(); return G.pending;
}
function paintSync() {
  const el = $("#ghlStatus"); if (el) {
    el.textContent = !connected() ? tt("Not connected. Notes and orders stay on this phone.") :
      G.running ? tt("Syncing…") : G.error ? T`${G.pending} waiting to sync. ${G.error}` :
      G.pending ? T`${G.pending} waiting to sync.` : T`Connected. Everything is synced to ${CRM}.`;
  }
  renderCount();
}
async function syncNote(r) {
  const contactId = await contactFor(r.storeId, true);
  const urls = r.photoUrls || [];
  const out = await api("POST", "/api/note", { contactId, noteId: r.ghlNoteId || null, text: r.text, date: r.date, rep: r.rep, storeName: r.storeName,
    photoUrls: urls, photos: (r.photos || []).slice(urls.length) });
  Object.assign(r, { ghlNoteId: out.noteId, photoUrls: out.photoUrls, sync: "done", syncedAt: Date.now() });
  await put("notes", r);
}
async function syncOrder(r) {
  const contactId = await contactFor(r.storeId, true);
  const s = byId.get(r.storeId);
  const co = company(r.companyId || "reboot"); await loadCatalog(co);
  const o = { companyId: co.id, storeName: r.storeName, storeNo: r.storeNo, po: r.po, address: r.address, rep: r.repName || r.rep, contact: r.contact, phone: r.phone, email: r.email, qty: r.qty };
  const fileName = r.fileName || (s ? orderFileName(co, s, r.date) : `Bon de commande ${r.date}.xlsx`);
  const xlsx = r.fileUrl ? null : await blobToDataUrl(await buildOrderXlsx(o, co));
  const lines = r.lines || Object.entries(r.qty).map(([k, n]) => { const p = co.byId.get(k); return p ? { code: p.code || "", name: p.name, size: p.size || "", qty: n, price: p.price } : null; }).filter(Boolean);
  const out = await api("POST", "/api/order", { contactId, noteId: r.ghlNoteId || null, opportunityId: r.opportunityId || null, fileUrl: r.fileUrl || null,
    xlsx, fileName, date: r.date, rep: o.rep, po: r.po, contact: r.contact, storeName: `${co.name} · ${s ? label(s) : r.storeName}`, company: co.name, productFields: co.productFields !== false, lines, total: r.total, minimum: co.minimum || 0 });
  Object.assign(r, { ghlNoteId: out.noteId, opportunityId: out.opportunityId || null, fileUrl: out.fileUrl || r.fileUrl, sync: "done", syncedAt: Date.now() });
  await put("orders", r);
  if (out.warning) toast(out.warning, true);
}
async function syncAll(manual) {
  if (G.running || !connected()) { if (manual && !connected()) toast(tt("Add the service address and app password first."), true); return; }
  G.running = true; G.error = ""; paintSync();
  let done = 0;
  try {
    const work = [];
    for (const st of ["notes", "orders"]) for (const r of mine(await all(st))) if (r.sync === "pending") work.push([st, r]);
    work.sort((a, b) => a[1].ts - b[1].ts);
    for (const [st, r] of work) {
      try { if (st === "notes") await syncNote(r); else await syncOrder(r); done++; }
      catch (e) {
        G.error = e.message;
        if (e.status === 401 || e.status === 0 || e.status >= 500) break;   // wrong password, no signal or service down: stop, retry later
        r.syncError = e.message; await put(st, r);                          // this one item failed: keep going with the others
      }
    }
  } catch (e) { G.error = tt("Saved data could not be read."); }
  G.running = false; G.last = Date.now();
  await countPending();
  if (manual) toast(G.error ? G.error : done ? T`${done} item${pl(done)} sent to ${CRM}.` : tt("Nothing waiting. Everything is synced."), !!G.error);
  clearTimeout(G.timer);
  if (G.pending && connected()) G.timer = setTimeout(() => syncAll(), G.error ? 120000 : 5000);
}
const syncSoon = () => { if (!connected()) return countPending(); clearTimeout(G.timer); G.timer = setTimeout(() => syncAll(), 800); };
window.addEventListener("online", () => syncSoon());
document.addEventListener("visibilitychange", () => { if (document.visibilityState === "visible" && G.pending) syncSoon(); });
// Last visit as written in GoHighLevel (from this phone, a laptop or a teammate).
function parseRemote(n) {
  const lines = String(n.body || "").split("\n");
  if (/^Commande /.test(lines[0])) return null;
  let date = (n.date || "").slice(0, 10), rep = "";
  const h = /^Visite (\d{4}-\d{2}-\d{2})(?:\s*·\s*(.*))?$/.exec(lines[0] || "");
  if (h) { date = h[1]; rep = h[2] || ""; lines.shift(); if (lines[0] === "") lines.shift(); }
  const pi = lines.lastIndexOf("Photos :");
  const photos = pi >= 0 ? lines.slice(pi + 1).filter(l => /^https?:\/\//.test(l)) : [];
  const text = (pi >= 0 ? lines.slice(0, pi) : lines).join("\n").trim();
  return { remote: true, ghlNoteId: n.id, date, rep, text, photos, photoUrls: photos, ts: Date.parse(n.date) || 0 };
}
async function lastRemoteNote(id) {
  if (!connected() || !navigator.onLine) return null;
  try {
    const cid = await contactFor(id, false); if (!cid) return null;
    const r = await api("GET", "/api/notes?contactId=" + encodeURIComponent(cid), null, 9000);
    for (const n of r.notes || []) { const p = parseRemote(n); if (p) return p; }
  } catch (e) { /* offline or asleep: the phone's own note is shown */ }
  return null;
}
async function lastNoteFor(id) {
  const [local, remote] = await Promise.all([storeNotes(id).catch(() => []), lastRemoteNote(id)]);
  const l = local[0] || null;
  if (!remote) return l;
  if (l && (l.ghlNoteId === remote.ghlNoteId || l.sync === "pending" || l.ts >= remote.ts)) return l;
  return remote;
}

/* ---------- store record ---------- */
const mine = rows => rows.filter(r => r.rep === S.rep);
async function storeNotes(id) { return mine(await tx("notes", "readonly", s => s.index("storeId").getAll(id))).sort((a, b) => b.ts - a.ts); }
async function storeOrders(id) { return mine(await tx("orders", "readonly", s => s.index("storeId").getAll(id))).sort((a, b) => b.ts - a.ts); }
async function refreshDone() {
  const d = today(); S.done = new Set(); S.lastLocal = {};
  try {
    for (const st of ["notes", "orders"]) for (const r of mine(await all(st))) {
      if (r.date === d) S.done.add(r.storeId);
      const k = st === "notes" ? "visit" : "order", x = S.lastLocal[r.storeId] = S.lastLocal[r.storeId] || {};
      if (!x[k] || r.date > x[k]) x[k] = r.date;
    }
  } catch (e) { /* no storage */ }
}

/* ---------- store brief: the store's history from the CRM, kept on the phone for no-signal stops ---------- */
const BR = { cache: LS.get("briefs", {}), inflight: new Map() };
function saveBriefs() {
  const keys = Object.keys(BR.cache);
  if (keys.length > 300) keys.sort((a, b) => BR.cache[a].at - BR.cache[b].at).slice(0, keys.length - 300).forEach(k => delete BR.cache[k]);
  LS.set("briefs", BR.cache);
}
function fetchBrief(id, ms) {
  if (!connected() || !navigator.onLine) return Promise.resolve(null);
  if (BR.inflight.has(id)) return BR.inflight.get(id);
  const p = (async () => {
    const cid = await contactFor(id, false);
    const r = await api("GET", `/api/store?storeId=${encodeURIComponent(id)}${cid ? "&contactId=" + encodeURIComponent(cid) : ""}`, null, ms || 20000);
    if (r.found && r.contactId && r.contactId !== cid) { const m = LS.get("ghlContacts", {}); m[id] = r.contactId; LS.set("ghlContacts", m); }   // made by a teammate or a laptop
    BR.cache[id] = Object.assign(r, { at: Date.now() }); saveBriefs();
    return BR.cache[id];
  })();
  BR.inflight.set(id, p); p.then(() => BR.inflight.delete(id), () => BR.inflight.delete(id));
  return p;
}
// Stores on today's route are fetched ahead, so the brief is there even where there is no signal.
let prefT;
function prefetchRoute(delay) {
  clearTimeout(prefT);
  prefT = setTimeout(async () => {
    if (!connected() || !navigator.onLine) return;
    let got = 0;
    for (const id of S.route.slice()) {
      const b = BR.cache[id]; if (b && Date.now() - b.at < 6 * 3600e3) continue;
      try { await fetchBrief(id, 60000); got++; } catch (e) { if (e.status === 401 || e.status === 0) break; }
      await sleep(300);
    }
    if (got) renderStores();
  }, delay == null ? 4000 : delay);
}
const companyNamed = name => { const n = normTxt(name); return n ? COMPANIES.find(c => normTxt(c.name) === n) || null : company("reboot"); };
// An order line read back from the CRM ("CODE name" for catalogs, "name size" for short forms) matched to a product.
function remoteItem(co, label) {
  if (co && co.kind === "catalog") { const sp = label.indexOf(" "); return sp > 0 ? { key: label.slice(0, sp), name: label.slice(sp + 1) } : { key: label, name: label }; }
  const L = normTxt(label); let best = null;
  for (const p of co ? co.products : []) { const n = normTxt(p.name); if ((L === n || L.startsWith(n + " ")) && (!best || n.length > normTxt(best.name).length)) best = p; }
  return best ? { key: best.id, name: best.name } : { key: label, name: label };
}
function datesFor(id) {
  const b = BR.cache[id], l = S.lastLocal[id] || {}, dl = S.due || {}, d = (dl.stores && dl.stores[id]) || {};
  const pick = k => b && b[k] != null ? b[k] : dl[k] != null ? dl[k] : null;
  return {
    visit: maxDate([l.visit, d.lastVisit, b && b.lastVisit, ...((b && b.visits) || []).map(v => v.date)]),
    order: maxDate([l.order, d.lastOrder, b && b.lastOrder, ...((b && b.orders) || []).map(o => o.date)]),
    reorderDays: pick("reorderDays") != null ? pick("reorderDays") : 35, followupDays: pick("followupDays") != null ? pick("followupDays") : 21
  };
}
// Last visit and last order for every store in the CRM, so the map and list show who is due, not only stores opened on this phone.
let dueBusy = null;
function fetchDue(force) {
  if (!connected() || !navigator.onLine) return Promise.resolve(null);
  if (!force && S.due && Date.now() - S.due.at < 10 * 60e3) return Promise.resolve(S.due);
  if (dueBusy) return dueBusy;
  dueBusy = api("GET", "/api/due" + (force ? "?fresh=1" : ""), null, 60000)
    .then(r => { S.due = Object.assign(r, { at: Date.now() }); LS.set("due", S.due); renderStores(); refreshMarkers(); return S.due; })
    .finally(() => { dueBusy = null; });
  return dueBusy;
}
// Fill today's route with the most urgent due stores: in the region shown, or nearest the start when no region is picked.
const kmBetween = (a, b) => { const r = Math.PI / 180, x = (b.lng - a.lng) * r * Math.cos((a.lat + b.lat) * r / 2), y = (b.lat - a.lat) * r; return 6371 * Math.hypot(x, y); };
function planDueRun() {
  const size = C.dueRunSize || 8;
  const urgency = id => { const d = datesFor(id), t = today(), st = statusFor(id);
    return st.cls === "red" ? 10000 + daysBetween(d.order, t) - d.reorderDays : daysBetween(maxDate([d.visit, d.order]), t) - d.followupDays; };
  let cand = shownStores(true).filter(s => !S.route.includes(s.id) && !S.done.has(s.id) && S.geo[s.id] && S.geo[s.id].lat && ["red", "amber"].includes(statusFor(s.id).cls));
  if (S.dueFilter === "reorder") cand = cand.filter(s => statusFor(s.id).cls === "red");
  const regions = new Set(cand.map(regionOf));
  if (!cand.length) return toast(S.route.length ? tt("Every due store shown is already on the route.") : tt("No due store with a pin in what is shown. Try another region."));
  let how;
  if (S.region || regions.size === 1) { cand.sort((a, b) => urgency(b.id) - urgency(a.id)); how = T`most overdue in ${S.region || [...regions][0]}`; }
  else if (S.start) {
    const R = C.dueRadiusKm || 120;
    cand = cand.filter(s => kmBetween(S.start, S.geo[s.id]) <= R).sort((a, b) => kmBetween(S.start, S.geo[a.id]) - kmBetween(S.start, S.geo[b.id]));
    if (!cand.length) return toast(T`No due store within ${R} km of your start. Pick a region instead.`);
    how = T`closest to your start, within ${R} km`;
  }
  else return toast(tt("Pick a region first, or set your start on the Route tab, so the run stays in one area."));
  const room = Math.max(0, size - S.route.length);
  if (!room) return toast(T`Today's route already has ${S.route.length} stores. Remove some first.`);
  const add = cand.slice(0, room);
  add.forEach(s => S.route.push(s.id)); routeChanged();
  setTab("route");
  toast(T`${add.length} due store${pl(add.length)} added (${how}). Tap Optimize to order the run.`);
}
function statusFor(id) {
  const d = datesFor(id), t = today(), touch = maxDate([d.visit, d.order]);
  if (!touch) return { cls: "new", text: tt("No history yet") };
  const so = d.order ? daysBetween(d.order, t) : null, st = daysBetween(touch, t);
  if (so != null && d.reorderDays > 0 && so >= d.reorderDays) return { cls: "red", text: T`Reorder due · ${so} days since the last order` };
  if (d.followupDays > 0 && st >= d.followupDays) return { cls: "amber", text: T`Visit due · ${st} days since the last visit` };
  return { cls: "ok", text: tt("Up to date") };
}
// One history per store: this phone's notes and orders (even unsynced) plus the CRM's (laptop, teammates).
function storeHistory(id, notes, localOrders) {
  const b = BR.cache[id], seen = new Set(), orders = [];
  for (const o of localOrders) {
    if (o.ghlNoteId) seen.add(o.ghlNoteId);
    const co = company(o.companyId || "reboot");
    const ls = o.lines || Object.entries(o.qty || {}).map(([k, n]) => ({ id: k, name: (co.byId.get(k) || {}).name || k, qty: n }));
    orders.push({ coId: co.id, coName: co.name, date: o.date, ts: o.ts || 0, total: o.total, po: o.po, rep: o.repName || o.rep, pending: o.sync === "pending",
      items: ls.map(l => ({ key: l.id || l.code || l.name, name: l.name, qty: l.qty })) });
  }
  for (const o of (b && b.orders) || []) {
    if (seen.has(o.id)) continue;
    const co = companyNamed(o.company);
    orders.push({ coId: co ? co.id : "", coName: co ? co.name : o.company, date: o.date, ts: o.ts || 0, total: o.total, po: o.po, rep: o.rep, remote: true, noteId: o.id,
      items: (o.lines || []).map(l => Object.assign(remoteItem(co, l.label), { qty: l.qty })) });
  }
  orders.sort((a, c) => c.date.localeCompare(a.date) || c.ts - a.ts);
  const noteIds = new Set(notes.map(n => n.ghlNoteId).filter(Boolean));
  const visits = notes.map(n => n).concat(((b && b.visits) || []).filter(v => !noteIds.has(v.id))
    .map(v => ({ remote: true, ghlNoteId: v.id, date: v.date, rep: v.rep, text: v.text, photos: v.photos || [], photoUrls: v.photos || [], ts: v.ts || 0 })));
  visits.sort((a, c) => c.date.localeCompare(a.date) || (c.sync === "pending") - (a.sync === "pending") || c.ts - a.ts);
  return { orders, visits, tasks: (b && b.tasks) || [], b };
}
function briefHtml(s, h, state) {
  const d = datesFor(s.id), st = statusFor(s.id), b = h.b;
  const groups = []; for (const o of h.orders) { let g = groups.find(x => x.name === o.coName); if (!g) groups.push(g = { name: o.coName, list: [] }); g.list.push(o); }
  const coHtml = groups.map(g => {
    const last = g.list[0], n90 = g.list.filter(o => daysBetween(o.date, today()) <= 90).length, avg = g.list.reduce((t, o) => t + o.total, 0) / g.list.length;
    const freq = new Map();
    g.list.slice(0, 3).forEach((o, i) => o.items.forEach(it => { const f = freq.get(it.key) || { name: it.name, n: 0, qty: it.qty, first: i }; f.n++; if (i < f.first) { f.first = i; f.qty = it.qty; } freq.set(it.key, f); }));
    const usual = [...freq.values()].sort((a, c) => c.n - a.n || c.qty - a.qty).slice(0, 6);
    return `<div class="co-brief"><div class="row between"><b>${esc(g.name)}</b><span class="amt">${money(last.total)} · ${esc(shortDate(last.date))}</span></div>
      <div class="hint">${T`${n90} order${pl(n90)} in 90 days · average ${money(cents(avg))}`}${last.rep && last.rep !== S.rep ? T` · last by ${esc(last.rep)}` : ""}</div>
      ${usual.length ? `<div class="usual"><span class="u-l">${tt("Usually")}</span>${usual.map(u => `<span>${esc(u.name)} ×${u.qty}</span>`).join("")}</div>` : ""}</div>`;
  }).join("");
  const tasks = h.tasks.map(t => {
    const late = t.due && t.due < today(), title = t.title.replace(" · " + label(s), "").replace(" · " + s.name, "");
    return `<div class="task${late ? " late" : ""}">${esc(title)}${t.due ? " · " + (late ? (n => T`${n} day${pl(n)} late`)(daysBetween(t.due, today())) : T`due ${esc(shortDate(t.due))}`) : ""}</div>`;
  }).join("");
  const when = b && b.at ? new Intl.DateTimeFormat(LOC, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: C.timeZone }).format(new Date(b.at)).replace(/\.$/, "") : "";
  const foot = !connected() ? T`This phone's history only. Connect ${esc(CRM)} in Reports to see orders from the team and the laptop.`
    : state === "loading" ? (b ? T`Saved copy from ${when}. Checking ${esc(CRM)}…` : T`Checking ${esc(CRM)}…`)
    : state === "failed" ? (b ? T`Saved copy from ${when}. Could not reach ${esc(CRM)}.` : T`Could not reach ${esc(CRM)}. Showing this phone's history.`)
    : state === "offline" ? (b ? T`Saved copy from ${when}. No signal right now.` : tt("No signal. Showing this phone's history."))
    : b ? (b.found ? T`Up to date with ${esc(CRM)}.` : T`Not in ${esc(CRM)} yet. It is added with the first note or order.`) : "";
  return `<div class="card brief"><h2>${tt("Before you go in")}</h2>
    <div class="due ${st.cls}">${esc(st.text)}</div>
    <div class="stats"><div class="stat"><b>${d.visit ? esc(ago(d.visit)) : tt("Never")}</b><span>${tt("last visit")}${d.visit ? " · " + esc(shortDate(d.visit)) : ""}</span></div>
      <div class="stat"><b>${d.order ? esc(ago(d.order)) : tt("Never")}</b><span>${tt("last order")}${d.order ? " · " + esc(shortDate(d.order)) : ""}</span></div></div>
    ${coHtml}${tasks ? `<div class="label">${tt("Open follow-ups")}</div>${tasks}` : ""}
    ${foot ? `<p class="hint">${foot}</p>` : ""}</div>`;
}
const mapsHref = s => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent([s.name, s.address, s.city, s.postal].filter(Boolean).join(", "));
async function openStore(id) {
  const s = byId.get(id), m = S.meta[id] || {}, g = S.geo[id];
  const [notes, orders] = await Promise.all([storeNotes(id).catch(() => []), storeOrders(id).catch(() => [])]);
  const inR = S.route.includes(id);
  openSheet(s.name, `
    <div class="card"><div class="addr">${esc(s.address || tt("No street address"))}<br>${esc([s.city, s.postal].filter(Boolean).join(" "))}
      ${s.address ? `<br><a href="${esc(mapsHref(s))}" target="_blank" rel="noopener">${tt("Open in maps")}</a>` : ""}</div>
      <div class="hint">${[regionOf(s), (m.storeNo || s.storeNo) ? tt("Store #") + esc(m.storeNo || s.storeNo) : "", (m.contact || s.contact) ? tt("Contact: ") + esc(m.contact || s.contact) : "",
        !s.address ? tt("Not on the map") : g && g.lat ? (g.approx ? tt("Approximate pin") : tt("Exact pin")) : tt("Pin not placed yet")].filter(Boolean).join(" · ")}</div>
      ${s.phone ? `<a class="btn" href="tel:${esc(s.phone.replace(/[^\d+]/g, ""))}">${T`Call ${esc(s.phone)}`}</a>` : ""}
      ${s.email ? `<div class="hint">${esc(s.email)}</div>` : ""}</div>
    <div class="grid2"><button class="btn primary" data-go="order">${tt("Order")}</button><button class="btn primary" data-go="note">${tt("Note")}</button></div>
    <div id="sbBrief"></div>
    <button class="btn" data-go="route">${inR ? tt("Remove from route") : tt("Add to route")}</button>
    <div id="sbHist"></div>`);
  const seq = sheetSeq;
  const paint = state => {
    if (seq !== sheetSeq || $("#sheet").hidden) return;              // the rep moved on
    const h = storeHistory(id, notes, orders), lastN = h.visits[0] || null, earlier = h.visits.slice(1, 8);
    const by = x => x.rep && x.rep !== S.rep ? ", " + esc(x.rep) : "";
    $("#sbBrief").innerHTML = briefHtml(s, h, state);
    $("#sbHist").innerHTML = `
      <div class="card"><h2>${tt("Last visit")}</h2>${lastN ? `<div class="hint">${niceDate(lastN.date)}${lastN.remote ? T` · from ${esc(CRM)}` : ""}${by(lastN)}</div><div class="note-last">${esc(lastN.text)}</div>${photosHtml(lastN.photos)}` : `<p class="hint">${tt("No earlier note.")}</p>`}</div>
      <div class="card"><h2>${tt("Orders")}</h2>${h.orders.length ? `<div class="hist">${h.orders.slice(0, 8).map(o => { const co = o.coId ? company(o.coId) : null; return `<div class="h"><b>${esc(o.coName)} · ${money(o.total)}</b>${co && co.minimum && o.total < co.minimum ? tt(" · under minimum") : ""}<small>${niceDate(o.date)}${o.po ? " · PO " + esc(o.po) : ""}${o.remote ? T` · from ${esc(CRM)}` : ""}${by(o)}${o.pending ? tt(" · waiting to sync") : ""}</small></div>`; }).join("")}</div>` : `<p class="hint">${tt("No order for this store yet.")}</p>`}</div>
      ${earlier.length ? `<div class="card"><h2>${tt("Earlier notes")}</h2><div class="hist">${earlier.map(n => `<div class="h"><small>${niceDate(n.date)}${by(n)}</small><div class="note-last">${esc(n.text)}</div></div>`).join("")}</div></div>` : ""}`;
  };
  paint(!connected() ? "" : navigator.onLine ? "loading" : "offline");
  $("#sheetContent").onclick = e => {
    const b = e.target.closest("[data-go]"); if (!b) return;
    if (b.dataset.go === "order") openOrder(id); else if (b.dataset.go === "note") openNote(id);
    else { toggleRoute(id); openStore(id); }
  };
  if (connected() && navigator.onLine) {
    try { await fetchBrief(id); paint(""); renderStores(); }
    catch (e) { paint("failed"); }
  }
}
const photosHtml = (ph, rm) => ph && ph.length ? `<div class="photos">${ph.map((p, i) => `<div class="ph"><img src="${p}" alt="${T`Visit photo ${i + 1}`}">${rm ? `<button class="rm" type="button" data-rmph="${i}" aria-label="${tt("Remove photo")}">✕</button>` : ""}</div>`).join("")}</div>` : "";

/* ---------- visit notes ---------- */
function shrink(file) {
  return new Promise((res, rej) => {
    const img = new Image(), url = URL.createObjectURL(file);
    img.onload = () => {
      const k = Math.min(1, 1400 / Math.max(img.width, img.height)), c = document.createElement("canvas");
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext("2d").drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL("image/jpeg", 0.78));
    };
    img.onerror = () => { URL.revokeObjectURL(url); rej(new Error("image")); };
    img.src = url;
  });
}
async function openNote(id) {
  const s = byId.get(id);
  const last = await lastNoteFor(id).catch(() => null); let editing = null, photos = [], text = "";
  const draw = () => {
    openSheet(tt("Note") + " · " + s.name, `
      <div class="card"><h2>${tt("Last visit")}</h2>${last ? `<div class="hint">${niceDate(last.date)}${last.remote ? T` · from ${esc(CRM)}` : ""}</div><div class="note-last">${esc(last.text)}</div>${photosHtml(last.photos)}
        ${editing ? "" : `<button class="btn small" type="button" id="nEdit">${tt("Edit")}</button>`}` : `<p class="hint">${tt("No earlier note.")}</p>`}</div>
      <div class="card"><h2>${editing ? tt("Edit the last note") : tt("What happened")}</h2>
        <textarea id="nText" maxlength="4000" placeholder="${tt("Type, or tap the microphone on the keyboard to dictate.")}">${esc(text)}</textarea>
        <div class="counter" id="nCount"></div>
        ${photosHtml(photos, true)}
        <label class="btn" for="nPhoto" ${photos.length >= 4 ? "hidden" : ""}>${T`Add photo (${photos.length} of 4)`}</label>
        <input id="nPhoto" type="file" accept="image/*" multiple hidden></div>`,
      editing ? `<div class="row gap"><button class="btn" id="nCancel" type="button">${tt("Cancel")}</button><button class="btn primary" id="nSave" type="button">${tt("Update the note")}</button></div>`
              : `<button class="btn primary" id="nSave" type="button">${tt("Save note")}</button>`);
    const ta = $("#nText"), cnt = () => { $("#nCount").textContent = `${ta.value.length} / ${(4000).toLocaleString(LOC)}`; };
    ta.oninput = () => { text = ta.value; cnt(); }; cnt();
    $("#nPhoto").onchange = async e => {
      for (const f of [...e.target.files].slice(0, 4 - photos.length)) { try { photos.push(await shrink(f)); } catch (x) { toast(tt("That photo could not be read. Try another one."), true); } }
      draw();
    };
    $("#sheetContent").onclick = e => {
      const r = e.target.closest("[data-rmph]"); if (r) { photos.splice(+r.dataset.rmph, 1); return draw(); }
      if (e.target.id === "nEdit") { editing = last; text = last.text; photos = []; draw(); $("#nText").focus(); }
    };
    $("#sheetFoot").onclick = async e => {
      if (e.target.id === "nCancel") { editing = null; text = ""; photos = []; return draw(); }
      if (e.target.id !== "nSave") return;
      const t = text.trim();
      if (!t && !photos.length) return toast(tt("Write a few words or add a photo first."), true);
      try {
        if (editing && editing.remote) await put("notes", { storeId: id, storeName: s.name, rep: S.rep, date: editing.date, ts: Date.now(), text: t,
          photos: (editing.photos || []).concat(photos), photoUrls: editing.photoUrls || [], ghlNoteId: editing.ghlNoteId, edited: Date.now(), sync: "pending" });
        else if (editing) await put("notes", { ...editing, text: t, photos: (editing.photos || []).concat(photos), edited: Date.now(), sync: "pending" });
        else await put("notes", { storeId: id, storeName: s.name, rep: S.rep, date: today(), ts: Date.now(), text: t, photos, sync: "pending" });
        await refreshDone(); syncSoon(); toast(editing ? tt("Note updated.") : tt("Note saved on this store.")); closeSheet();
      } catch (x) { toast(tt("The note could not be saved on this phone. Free some storage and try again."), true); }
    };
  };
  draw();
}

/* ---------- order ---------- */
function b64buf(b64) { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
const safeName = s => String(s).replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
/* ---------- companies and catalogs ---------- */
const COMPANIES = C.companies.map(co => Object.assign({}, co, { products: co.products || [], byId: new Map((co.products || []).map(p => [p.id, p])) }));
const company = id => COMPANIES.find(c => c.id === id) || COMPANIES[0];
const catalogs = {};
// A catalog company's products are read from its own Excel order form: one row per product.
function loadCatalog(co) {
  if (co.kind !== "catalog") return Promise.resolve(co);
  if (catalogs[co.id]) return catalogs[co.id];
  catalogs[co.id] = (async () => {
    const r = await fetch(co.formFile); if (!r.ok) throw new Error("form " + r.status);
    const buf = await r.arrayBuffer(), zip = await JSZip.loadAsync(buf);
    const dom = x => new DOMParser().parseFromString(x, "application/xml");
    const sst = zip.file("xl/sharedStrings.xml") ? [...dom(await zip.file("xl/sharedStrings.xml").async("string")).getElementsByTagNameNS(NS, "si")]
      .map(si => [...si.getElementsByTagNameNS(NS, "t")].map(t => t.textContent).join("")) : [];
    const sheet = dom(await zip.file("xl/worksheets/sheet1.xml").async("string"));
    const col = co.columns, products = [];
    for (const row of sheet.getElementsByTagNameNS(NS, "row")) {
      const rn = +row.getAttribute("r"); if (rn < co.firstRow) continue;
      const v = {};
      for (const c of row.getElementsByTagNameNS(NS, "c")) {
        const letters = c.getAttribute("r").replace(/\d+/g, ""), t = c.getAttribute("t");
        const ve = c.getElementsByTagNameNS(NS, "v")[0], ie = c.getElementsByTagNameNS(NS, "t")[0];
        v[letters] = t === "s" ? sst[+(ve && ve.textContent)] : t === "inlineStr" ? (ie && ie.textContent) : ve ? ve.textContent : "";
      }
      const code = String(v[col.code] || "").trim(), price = Number(v[col.price]) || 0;
      if (!code || !(price > 0)) continue;                      // brand headers and unpriced items are not orderable
      products.push({ id: code, code, group: String(v[col.brand] || "").trim(), name: String(v[col.name] || "").trim(), upc: String(v[col.upc] || "").trim(),
        price, srp: Number(v[col.srp]) || 0, map: Number(v[col.map]) || 0, row: rn, by: "unit", size: "" });
    }
    co.products = products; co.byId = new Map(products.map(p => [p.id, p])); co.formBuf = buf;
    return co;
  })().catch(e => { delete catalogs[co.id]; throw e; });
  return catalogs[co.id];
}
const orderTotal = (q, co) => cents(Object.entries(q).reduce((t, [id, n]) => { const p = co.byId.get(id); return t + (p ? n * p.price : 0); }, 0));
const orderFileName = (co, s, date) => co.id === "reboot" ? `Bon de commande ${safeName(label(s).replace("#", ""))} ${date}.xlsx`
  : `Bon de commande ${co.name} ${safeName(label(s).replace("#", ""))} ${date}.xlsx`;
// The brand's own form is patched in place (cells only), so the logo, fonts and layout stay exactly as head office made them.
const NS = "http://schemas.openxmlformats.org/spreadsheetml/2006/main";
const colNum = ref => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n; };
function sheetEditor(doc) {
  const data = doc.getElementsByTagNameNS(NS, "sheetData")[0];
  const rowOf = r => {
    const rows = [...data.getElementsByTagNameNS(NS, "row")];
    let row = rows.find(x => +x.getAttribute("r") === r); if (row) return row;
    row = doc.createElementNS(NS, "row"); row.setAttribute("r", r);
    data.insertBefore(row, rows.find(x => +x.getAttribute("r") > r) || null); return row;
  };
  const cellOf = ref => {
    const row = rowOf(+ref.replace(/\D+/g, "")), cells = [...row.getElementsByTagNameNS(NS, "c")];
    let c = cells.find(x => x.getAttribute("r") === ref); if (c) return c;
    c = doc.createElementNS(NS, "c"); c.setAttribute("r", ref);
    row.insertBefore(c, cells.find(x => colNum(x.getAttribute("r")) > colNum(ref)) || null); return c;
  };
  const set = (ref, v, style) => {
    const c = cellOf(ref); while (c.firstChild) c.removeChild(c.firstChild); c.removeAttribute("t");
    if (style != null) c.setAttribute("s", style);
    if (v === "" || v == null) return c;
    if (typeof v === "number") { const e = doc.createElementNS(NS, "v"); e.textContent = String(v); c.appendChild(e); }
    else { c.setAttribute("t", "inlineStr"); const is = doc.createElementNS(NS, "is"), t = doc.createElementNS(NS, "t"); t.setAttribute("xml:space", "preserve"); t.textContent = String(v); is.appendChild(t); c.appendChild(is); }
    return c;
  };
  return { rowOf, cellOf, set };
}
// Catalog forms: keep the header rows, then only the ordered products (under their brand line), then the total.
async function compactSheet(doc, zip, co, o) {
  const data = doc.getElementsByTagNameNS(NS, "sheetData")[0];
  const rows = [...data.getElementsByTagNameNS(NS, "row")];
  const rn = r => +r.getAttribute("r");
  const cell = (row, col) => [...row.getElementsByTagNameNS(NS, "c")].find(c => c.getAttribute("r").replace(/\d+/g, "") === col);
  const hasVal = c => !!(c && (c.getElementsByTagNameNS(NS, "v")[0] || c.getElementsByTagNameNS(NS, "is")[0] || c.getElementsByTagNameNS(NS, "f")[0]) && c.textContent.trim() !== "");
  const qtyCol = co.orderForm.qtyColumn, codeCol = co.columns.code, priceCol = co.columns.price, totalCol = String.fromCharCode(qtyCol.charCodeAt(0) + 1);
  const orderedRows = new Set(Object.entries(o.qty).filter(([, n]) => n > 0).map(([id]) => co.byId.get(id)).filter(p => p && p.row).map(p => p.row));
  const totalRow = rows.find(r => rn(r) > co.firstRow && [...r.getElementsByTagNameNS(NS, "f")].some(f => /^SUM\(/i.test(f.textContent)));
  const keep = [], used = new Set(); let header = null;
  for (const r of rows) {
    const n = rn(r);
    if (n < co.firstRow) { keep.push(r); continue; }
    if (r === totalRow) break;
    const isHeader = !hasVal(cell(r, codeCol)) && hasVal(cell(r, "A"));
    if (isHeader) { header = r; continue; }
    if (orderedRows.has(n)) { if (header && !used.has(header)) { keep.push(header); used.add(header); } keep.push(r); }
  }
  const firstProduct = co.firstRow; let next = 1, lastLine = co.firstRow, grand = 0;
  for (const r of rows) if (!keep.includes(r) && r !== totalRow) data.removeChild(r);
  const renumber = (r, n) => { r.setAttribute("r", n); for (const c of r.getElementsByTagNameNS(NS, "c")) c.setAttribute("r", c.getAttribute("r").replace(/\d+/g, "") + n); };
  const setFormula = (c, f, v) => { while (c.firstChild) c.removeChild(c.firstChild); c.removeAttribute("t"); const fe = doc.createElementNS(NS, "f"); fe.textContent = f; const ve = doc.createElementNS(NS, "v"); ve.textContent = String(v); c.appendChild(fe); c.appendChild(ve); };
  for (const r of keep) {
    const old = rn(r), n = old < co.firstRow ? old : Math.max(next, co.firstRow);
    renumber(r, n); next = n + 1;
    if (orderedRows.has(old)) {
      const price = Number((cell(r, priceCol) || {}).textContent) || 0, q = Number((cell(r, qtyCol) || {}).textContent) || 0, line = cents(price * q);
      const tc = cell(r, totalCol); if (tc) setFormula(tc, `${priceCol}${n}*${qtyCol}${n}`, line);
      grand += line; lastLine = n;
    }
  }
  if (totalRow) {
    renumber(totalRow, next);
    const tc = [...totalRow.getElementsByTagNameNS(NS, "c")].find(c => c.getElementsByTagNameNS(NS, "f")[0]);
    if (tc) setFormula(tc, `SUM(${totalCol}${firstProduct}:${totalCol}${lastLine})`, cents(grand));
    while (totalRow.nextSibling) data.removeChild(totalRow.nextSibling);
  }
  const last = next;
  const setAttr = (tag, attr, val) => { const e = doc.getElementsByTagNameNS(NS, tag)[0]; if (e) e.setAttribute(attr, val); };
  const dim = doc.getElementsByTagNameNS(NS, "dimension")[0]; if (dim) dim.setAttribute("ref", dim.getAttribute("ref").replace(/\d+$/, last));
  const af = doc.getElementsByTagNameNS(NS, "autoFilter")[0]; if (af) af.setAttribute("ref", af.getAttribute("ref").replace(/\d+$/, last));
  setAttr("pane", "topLeftCell", "A" + co.firstRow);
  const sel = doc.getElementsByTagNameNS(NS, "selection")[0]; if (sel) { sel.setAttribute("activeCell", qtyCol + co.firstRow); sel.setAttribute("sqref", qtyCol + co.firstRow); }
  // Cell positions changed: drop Excel's calculation cache so it rebuilds it.
  if (zip.file("xl/calcChain.xml")) {
    zip.remove("xl/calcChain.xml");
    const rel = "xl/_rels/workbook.xml.rels", ct = "[Content_Types].xml";
    if (zip.file(rel)) zip.file(rel, (await zip.file(rel).async("string")).replace(/<Relationship [^>]*calcChain[^>]*\/>/, ""));
    if (zip.file(ct)) zip.file(ct, (await zip.file(ct).async("string")).replace(/<Override [^>]*calcChain[^>]*\/>/, ""));
  }
}
async function buildOrderXlsx(o, co) {
  co = co || company(o.companyId);
  const zip = await JSZip.loadAsync(co.kind === "catalog" ? co.formBuf : b64buf(window[co.template])), path = "xl/worksheets/sheet1.xml";
  const doc = new DOMParser().parseFromString(await zip.file(path).async("string"), "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("template");
  const ed = sheetEditor(doc), f = co.orderForm, put1 = (ref, v) => { if (ref && v !== "" && v != null) ed.set(ref, v); };
  put1(f.storeName, o.storeName); put1(f.storeNumber, /^\d{1,9}$/.test(o.storeNo || "") ? Number(o.storeNo) : o.storeNo);
  put1(f.po, o.po); put1(f.address, o.address); put1(f.rep, o.rep); put1(f.contact, o.contact); put1(f.phone, o.phone); put1(f.email, o.email);
  let extra = f.extraRow;
  for (const [pid, q] of Object.entries(o.qty)) {
    const p = co.byId.get(pid); if (!p || !(q > 0)) continue;   // zero stays blank
    if (p.row) { ed.set(f.qtyColumn + p.row, q); continue; }
    const r = extra++, src = ed.rowOf(r - 1), row = ed.rowOf(r);            // product not printed on the form: add its line, codes blank
    if (src.getAttribute("ht")) { row.setAttribute("ht", src.getAttribute("ht")); row.setAttribute("customHeight", "1"); }
    const st = c => { const x = [...src.getElementsByTagNameNS(NS, "c")].find(y => y.getAttribute("r") === c + (r - 1)); return x ? x.getAttribute("s") : null; };
    const fv = [...src.getElementsByTagNameNS(NS, "c")].find(x => x.getAttribute("r") === "F" + (r - 1));
    "ABCDE".split("").forEach(c => ed.set(c + r, "", st(c)));
    ed.set("F" + r, fv && fv.textContent ? Number(fv.textContent) : "", st("F"));
    ed.set("G" + r, p.formLine.description, st("G")); ed.set("H" + r, p.formLine.caseQty, st("H")); ed.set("I" + r, p.formLine.format, st("I"));
    ed.set("J" + r, p.price, st("J")); ed.set("K" + r, q, st("K"));
  }
  if (co.compact) await compactSheet(doc, zip, co, o);
  let xml = new XMLSerializer().serializeToString(doc);
  if (!xml.startsWith("<?xml")) xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + xml;
  zip.file(path, xml);
  // Line totals are formulas in the form: ask Excel to recalculate them when the file opens.
  const wbx = zip.file("xl/workbook.xml");
  if (wbx) { let w = await wbx.async("string"); w = /<calcPr\b/.test(w) ? w.replace(/<calcPr\b(?![^>]*fullCalcOnLoad)/, '<calcPr fullCalcOnLoad="1"') : w.replace("</workbook>", '<calcPr fullCalcOnLoad="1"/></workbook>'); zip.file("xl/workbook.xml", w); }
  return zip.generateAsync({ type: "blob", mimeType: XLSX_TYPE, compression: "DEFLATE" });
}
const isTouch = () => /iPhone|iPad|iPod|Android/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
const standalone = () => navigator.standalone === true || matchMedia("(display-mode: standalone)").matches;
function download(blob, name) {
  const a = document.createElement("a"), url = URL.createObjectURL(blob);
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 30000);
}
// iPhone: share sheet (choose Mail). Laptop: real file download.
async function deliver(blob, name) {
  const file = new File([blob], name, { type: blob.type });
  if (isTouch() && navigator.canShare && navigator.canShare({ files: [file] })) {
    try { await navigator.share({ files: [file], title: name.replace(/\.\w+$/, "") }); return "shared"; }
    catch (e) {
      if (e.name === "AbortError") return "cancelled";
      if (e.name === "NotAllowedError") return "again";
    }
  }
  if (isTouch() && standalone()) { toast(tt("Mail will not open from the Home Screen icon. Open this site in Safari and send again."), true); return "blocked"; }
  download(blob, name); return "downloaded";
}
function pickCompany(id) {
  const s = byId.get(id), last = (LS.get("lastCompany", {}))[id];
  openSheet(tt("Order") + " · " + s.name, `<div class="addr"><b>${esc(s.name)}</b><br>${esc([s.address, s.city].filter(Boolean).join(", ") || tt("No street address"))}</div>
    <p class="hint">${tt("Which company is this order for?")}</p>
    ${COMPANIES.map(co => `<button class="btn ${co.id === last ? "primary" : ""} big-pick" type="button" data-co="${esc(co.id)}">${esc(co.name)}</button>`).join("")}`);
  $("#sheetContent").onclick = e => { const b = e.target.closest("[data-co]"); if (b) openOrder(id, b.dataset.co); };
}
/* ---------- barcode scanner: camera on the order screen, matched to the catalog's UPC column ---------- */
const upcKey = d => String(d || "").replace(/\D/g, "").replace(/^0+/, "");
function upcE2A(e) {   // UPC-E (8 digits) to UPC-A (12 digits)
  const ns = e[0], d = e.slice(1, 7), c = e[7], l = d[5];
  const m = l <= "2" ? d.slice(0, 2) + l + "0000" + d.slice(2, 5) : l === "3" ? d.slice(0, 3) + "00000" + d.slice(3, 5) : l === "4" ? d.slice(0, 4) + "00000" + d[4] : d.slice(0, 5) + "0000" + l;
  return ns + m + c;
}
function upcIndex(co) {
  if (co._upc) return co._upc;
  const exact = new Map(), body = new Map(), add = (m, k, p) => { if (!m.has(k)) m.set(k, []); m.get(k).push(p); };
  for (const p of co.products) for (const [code, isCase] of [[p.upc, false], [p.upcCase, true]]) {
    const k = upcKey(code); if (k.length < 6) continue;
    const e = { p, isCase };
    add(exact, k, e);
    if (k.length >= 11) add(body, k.length === 11 ? k : k.slice(0, -1), e);   // without the check digit: catches typos and missing digits in the catalog
  }
  return (co._upc = { exact, body });
}
function findByBarcode(co, raw, fmt) {
  let d = String(raw || "").replace(/\D/g, "");
  if (d.length === 8 && /upc_?e/i.test(String(fmt || ""))) d = upcE2A(d);
  const { exact, body } = upcIndex(co), k = upcKey(d);
  let hit = exact.get(k), viaCase = false;
  if (!hit && k.length >= 12) hit = body.get(k.slice(0, -1));
  if (!hit && d.length === 14) { hit = body.get(upcKey(d.slice(1, 13))) || exact.get(upcKey(d.slice(1, 13))); viaCase = !!hit; }   // case code (GTIN-14): the item inside
  const seen = new Set(), list = (hit || []).filter(e => !seen.has(e.p.id) && seen.add(e.p.id));
  return { list: list.map(e => e.p), viaCase: viaCase || (list.length === 1 && list[0].isCase), digits: d };
}
const SC = { stream: null, timer: null, last: "", lastAt: 0, audio: null, decode: null, busy: false };
function loadZXing() {
  if (window.ZXingLite) return Promise.resolve();
  return new Promise((res, rej) => { const el = document.createElement("script"); el.src = "zxing.min.js?v=16"; el.onload = res; el.onerror = () => rej(new Error("load")); document.head.appendChild(el); });
}
function beep(ok) {
  try {
    const a = SC.audio; if (!a) return;
    const o = a.createOscillator(), g = a.createGain(); o.frequency.value = ok ? 1250 : 330; g.gain.value = 0.12;
    o.connect(g); g.connect(a.destination); o.start(); o.stop(a.currentTime + (ok ? 0.09 : 0.25));
  } catch (e) { /* no sound */ }
  if (navigator.vibrate) navigator.vibrate(ok ? 40 : [60, 50, 60]);
}
function makeDecoder() {
  const cv = document.createElement("canvas"), cx = cv.getContext("2d", { willReadFrequently: true });
  let native = null;
  if ("BarcodeDetector" in window) { try { native = new BarcodeDetector({ formats: ["upc_a", "upc_e", "ean_13", "ean_8", "itf", "code_128"] }); } catch (e) { native = null; } }
  return async video => {
    const vw = video.videoWidth, vh = video.videoHeight; if (!vw || !vh) return null;
    const sy = Math.round(vh * 0.3), sh = Math.round(vh * 0.4), w = Math.min(vw, 1000), h = Math.round(sh * w / vw);   // the middle band, where the frame is drawn
    cv.width = w; cv.height = h; cx.drawImage(video, 0, sy, vw, sh, 0, 0, w, h);
    if (native) { try { const r = await native.detect(cv); if (r[0]) return { text: r[0].rawValue, fmt: r[0].format }; return null; } catch (e) { native = null; } }
    const Z = window.ZXingLite, px = cx.getImageData(0, 0, w, h).data, lum = new Uint8ClampedArray(w * h);
    for (let i = 0, j = 0; i < lum.length; i++, j += 4) lum[i] = (px[j] * 77 + px[j + 1] * 150 + px[j + 2] * 29) >> 8;
    const hints = new Map([[Z.DecodeHintType.TRY_HARDER, true]]), bmp = new Z.BinaryBitmap(new Z.HybridBinarizer(new Z.RGBLuminanceSource(lum, w, h)));
    for (const R of [Z.UPCEANReader, Z.ITFReader, Z.Code128Reader]) {
      try { const r = new R(hints).decode(bmp, hints); const f = r.getBarcodeFormat(); return { text: r.getText(), fmt: Object.keys(Z.BarcodeFormat).find(k => Z.BarcodeFormat[k] === f) || "" }; } catch (e) { /* not this kind */ }
    }
    return null;
  };
}
function stopScanner() {
  clearTimeout(SC.timer); SC.timer = null;
  if (SC.stream) { SC.stream.getTracks().forEach(t => t.stop()); SC.stream = null; }
  const v = $("#scanVideo"); if (v) v.srcObject = null;
  $("#scanner").hidden = true; document.body.classList.remove("scanning");
}
// onCode(text, format) returns { ok, html } for the card at the bottom; onCard handles taps in that card.
async function openScanner(title, onCode, onCard, onClose) {
  try { SC.audio = SC.audio || new (window.AudioContext || window.webkitAudioContext)(); SC.audio.resume(); } catch (e) { SC.audio = null; }
  const box = $("#scanner"), card = $("#scanCard"), band = $("#scanBand");
  $("#scanTitle").textContent = title; card.innerHTML = `<p class="hint">${tt("Starting the camera…")}</p>`;
  box.hidden = false; document.body.classList.add("scanning");
  let count = 0;
  const done = () => { stopScanner(); onClose(count); };
  $("#scanDone").onclick = done;
  card.onclick = e => { const r = onCard(e); if (r) { card.innerHTML = r.html; if (r.added) { count++; $("#scanCount").textContent = T`${count} added`; } } };
  if (!window.isSecureContext || !navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    card.innerHTML = `<b>${tt("The camera is not available here.")}</b><p class="hint">${tt("Open La Run from its usual https address, or type the barcode digits in the search box.")}</p>`; return;
  }
  try {
    await loadZXing();
    SC.stream = await navigator.mediaDevices.getUserMedia({ audio: false, video: { facingMode: { ideal: "environment" }, width: { ideal: 1280 }, height: { ideal: 720 } } });
  } catch (e) {
    const why = e && e.name === "NotAllowedError" ? tt("Camera access is blocked for La Run. On iPhone: Settings > Safari > Camera > Allow, then reopen the app.")
      : e && e.name === "NotFoundError" ? tt("No camera was found on this device.") : e && e.message === "load" ? tt("The scanner could not load. Reopen the app once with signal so it is saved for offline use.") : tt("The camera could not start.");
    card.innerHTML = `<b>${esc(why)}</b><p class="hint">${tt("You can type the barcode digits in the search box instead.")}</p>`; return;
  }
  if (box.hidden) return stopScanner();   // closed while the camera was starting
  const v = $("#scanVideo"); v.srcObject = SC.stream; v.setAttribute("playsinline", ""); v.muted = true;
  try { await v.play(); } catch (e) { /* iOS starts it on its own */ }
  const track = SC.stream.getVideoTracks()[0], caps = track && track.getCapabilities ? track.getCapabilities() : {};
  const tb = $("#scanTorch"); tb.hidden = !caps.torch; let torch = false;
  tb.onclick = () => { torch = !torch; track.applyConstraints({ advanced: [{ torch }] }).catch(() => {}); tb.classList.toggle("on", torch); };
  $("#scanCount").textContent = "";
  card.innerHTML = `<p class="hint">${tt("Hold the barcode inside the frame. Each scan adds one; use + and − to adjust.")}</p>`;
  SC.decode = makeDecoder();
  const tick = async () => {
    if (!SC.stream || SC.busy) return;
    SC.busy = true; let r = null;
    try { r = await SC.decode(v); } catch (e) { r = null; }
    SC.busy = false;
    if (!SC.stream) return;
    if (r && r.text) {
      const now = Date.now();
      if (r.text !== SC.last || now - SC.lastAt > 2500) {    // the same barcode held in view counts once
        SC.last = r.text; SC.lastAt = now;
        const out = onCode(r.text, r.fmt); card.innerHTML = out.html; beep(out.ok);
        if (out.added) { count++; $("#scanCount").textContent = T`${count} added`; }
        band.className = "scan-band " + (out.ok ? "hit" : "miss"); setTimeout(() => { band.className = "scan-band"; }, 600);
      } else SC.lastAt = now;
    }
    SC.timer = setTimeout(tick, 120);
  };
  tick();
}
document.addEventListener("visibilitychange", () => { if (document.hidden && SC.stream) $("#scanDone").click(); });

async function openOrder(id, coId) {
  if (!coId) { if (COMPANIES.length > 1) return pickCompany(id); coId = COMPANIES[0].id; }
  const co = company(coId), s = byId.get(id), m = S.meta[id] || {};
  if (co.kind === "catalog" && !co.byId.size) {
    openSheet(`${co.name} · ${s.name}`, `<p class="hint">${T`Loading the ${esc(co.name)} catalog…`}</p>`);
    try { await loadCatalog(co); } catch (e) { return toast(T`The ${co.name} catalog could not load. Check your signal and try again.`, true); }
  }
  const lc = LS.get("lastCompany", {}); lc[id] = co.id; LS.set("lastCompany", lc);
  if (!BR.cache[id] || Date.now() - BR.cache[id].at > 15 * 60e3) fetchBrief(id).catch(() => {});   // fresh history for "Last order"
  const dkey = co.id + "|" + id, catalog = co.kind === "catalog", f = co.orderForm;
  const qty = Object.assign({}, S.drafts[dkey] || (co.id === "reboot" ? S.drafts[id] : null) || {});
  for (const k of Object.keys(qty)) if (!co.byId.has(k)) delete qty[k];
  const head = { address: m.address != null ? m.address : [s.address, s.city, s.postal].filter(Boolean).join(", "), storeNo: m.storeNo != null ? m.storeNo : (s.storeNo || ""), po: "",
    contact: m.contact != null ? m.contact : (s.contact || ""), rep: S.rep, phone: s.phone || "", email: s.email || "" };
  let savedId = null, ready = null, buildT = null, sent = false, view = Object.keys(qty).length ? "order" : "browse", q = "", brand = "";
  const field = (key, idv, lbl, val, extra) => key ? `<div class="field"><label for="${idv}">${lbl}</label><input id="${idv}" type="text" value="${esc(val)}" ${extra || ""}></div>` : "";
  const prodRow = p => {
    const margin = p.srp > 0 ? Math.round((p.srp - p.price) / p.srp * 100) : null;
    const sub = catalog ? `${esc(p.group)} · ${esc(p.code)} · ${money(p.price)}${p.srp ? ` · PDSF ${money(p.srp)}` : ""}${margin != null ? ` · marge ${margin}%` : ""}`
      : `${esc(p.size)} · ${money(p.price)} ${p.by === "case" ? tt("a case") : tt("each")}`;
    return `<div class="prod" data-p="${esc(p.id)}"><div class="pt"><div class="pn">${esc(p.name)}</div><div class="pp">${sub}</div></div>
      <div class="step"><button type="button" data-d="-1" aria-label="${T`One less ${esc(p.name)}`}">−</button>
      <input type="number" inputmode="numeric" min="0" max="999" step="1" value="${qty[p.id] || 0}" aria-label="${T`Quantity ${esc(p.name)}`}">
      <button type="button" data-d="1" aria-label="${T`One more ${esc(p.name)}`}">+</button></div></div>`;
  };
  const hasUpc = co.products.some(p => upcKey(p.upc).length >= 8 || upcKey(p.upcCase).length >= 8);
  const scanBtn = hasUpc ? `<button class="btn small scan-btn" id="cScan" type="button" aria-label="${tt("Scan a barcode")}">${tt("Scan")}</button>` : "";
  const brands = catalog ? [...new Set(co.products.map(p => p.group))].sort((a, b) => a.localeCompare(b, "fr")) : [];
  const fixedList = () => [...new Set(co.products.map(p => p.group))].map(g => `<div class="grp">${co.products.find(p => p.group === g).by === "case" ? T`${esc(g)}, by the case` : T`${esc(g)}, by the unit`}</div>` + co.products.filter(p => p.group === g).map(prodRow).join("")).join("");
  openSheet(`${co.name} · ${s.name}`, `
    <div class="addr"><b>${esc(s.name)}</b><br>${esc([s.address, s.city].filter(Boolean).join(", ") || tt("No street address"))}</div>
    <details class="fold"><summary>${tt("Order sheet details")}</summary><div class="in">
      ${field(f.address, "oAddr", tt("Address printed on the sheet"), head.address)}
      <div class="grid2">${field(f.storeNumber, "oNo", tt("Store number"), head.storeNo, 'inputmode="numeric"')}${field(f.po, "oPo", "PO", "")}</div>
      ${field(f.contact, "oContact", tt("Contact at the store"), head.contact)}
      ${field(f.phone, "oPhone", tt("Store phone"), head.phone, 'inputmode="tel"')}${field(f.email, "oEmail", tt("Store email"), head.email, 'inputmode="email"')}
      ${field(f.rep, "oRep", tt("Rep"), head.rep)}</div></details>
    ${catalog ? `<div class="cat-tools">
      <div class="row"><input id="cSearch" type="search" placeholder="${tt("Product, code, brand or barcode")}" autocomplete="off" aria-label="${tt("Search the catalog")}">
      ${scanBtn}</div>
      <select id="cBrand" aria-label="${tt("Brand")}"><option value="">${tt("All brands")}</option>${brands.map(b => `<option value="${esc(b)}">${esc(b)}</option>`).join("")}</select>
      <div class="row gap"><button class="btn small" id="cMine" type="button"></button><button class="btn small" id="cLast" type="button">${tt("Last order")}</button></div></div>
      <div id="cList"></div>` : `<div class="row gap"><button class="btn small" id="cLast" type="button">${tt("Last order")}</button>${scanBtn}</div>` + fixedList()}`,
    `<div class="total-row"><div><div class="label">${tt("Total")}</div><div class="min-msg" id="oMin"></div></div><div class="big" id="oTotal"></div></div>
     <div class="row gap"><button class="btn" id="oXlsx" type="button">${tt("Preview")}</button><button class="btn primary" id="oSend" type="button" style="flex:2">${tt("Send order")}</button></div>
     <div class="hint">${T`Send to ${esc(co.orderEmail)}`}</div>`,
    () => { clearTimeout(buildT); if (sent) { delete S.drafts[dkey]; delete S.drafts[id]; LS.set("drafts", S.drafts); } });

  const norm = x => String(x || "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const renderCat = () => {
    if (!catalog) return;
    const n = Object.keys(qty).length;
    $("#cMine").textContent = T`In this order (${n})`; $("#cMine").className = "btn small" + (view === "order" ? " primary" : "");
    let list, note = "";
    if (view === "order") { list = co.products.filter(p => qty[p.id] > 0); if (!list.length) note = tt("Nothing in this order yet. Search a product or pick a brand."); }
    else {
      const words = norm(q).split(/\s+/).filter(Boolean), digits = q.replace(/\D/g, "");
      if (!words.length && !brand) { list = []; note = T`Search the ${co.products.length.toLocaleString(LOC)} products, or pick a brand.`; }
      else list = co.products.filter(p => (!brand || p.group === brand) && (!words.length || words.every(w => norm(`${p.name} ${p.group} ${p.code}`).includes(w)) || (digits.length >= 4 && p.upc.replace(/\D/g, "").includes(digits))));
    }
    const cap = 80, more = list.length - cap;
    $("#cList").innerHTML = (list.length ? list.slice(0, cap).map(prodRow).join("") : "") + (note ? `<p class="hint">${note}</p>` : "") + (more > 0 ? `<p class="hint">${T`${more} more. Narrow the search.`}</p>` : "") + (view === "browse" && list.length === 0 && !note ? `<p class="hint">${tt("No product matches.")}</p>` : "");
  };
  const v = idv => { const el = $("#" + idv); return el ? el.value.trim() : ""; };
  const readHead = () => { head.address = v("oAddr"); head.storeNo = v("oNo"); head.po = v("oPo"); head.contact = v("oContact"); head.rep = v("oRep"); head.phone = v("oPhone"); head.email = v("oEmail"); };
  const snapshot = () => { readHead(); const total = orderTotal(qty, co); const date = today();
    return { storeId: id, companyId: co.id, storeName: s.name, date, qty: Object.assign({}, qty), total, ...head, fileName: orderFileName(co, s, date) }; };
  const sig = o => JSON.stringify([o.qty, o.address, o.storeNo, o.po, o.contact, o.rep, o.phone, o.email, o.date]);
  const prebuild = () => { clearTimeout(buildT); buildT = setTimeout(async () => { const o = snapshot(); if (o.total <= 0) return; try { ready = { sig: sig(o), blob: await buildOrderXlsx(o, co) }; } catch (e) { ready = null; } }, 400); };
  const paint = () => {
    const total = orderTotal(qty, co), min = co.minimum || 0;
    $("#oTotal").textContent = money(total);
    const mm = $("#oMin"), send = $("#oSend"), n = Object.values(qty).reduce((a, b) => a + b, 0);
    document.querySelectorAll("#sheetContent .prod").forEach(el => { const k = qty[el.dataset.p] || 0; el.classList.toggle("has", k > 0); const inp = el.querySelector("input"); if (document.activeElement !== inp) inp.value = k; });
    if (catalog) {
      $("#cMine").textContent = T`In this order (${Object.keys(qty).length})`;
      const per = {}; for (const [k, n] of Object.entries(qty)) { const p = co.byId.get(k); if (p) per[p.group] = (per[p.group] || 0) + n; }
      for (const o of $("#cBrand").options) if (o.value) o.textContent = o.value + (per[o.value] ? T` (${per[o.value]} in order)` : "");
    }
    if (total <= 0) { mm.className = "min-msg"; mm.textContent = tt("Add a product to send."); send.textContent = tt("Send order"); send.className = "btn primary"; send.disabled = true; $("#oXlsx").disabled = true; }
    else if (min > 0 && total < min) { mm.className = "min-msg under"; mm.textContent = T`${money(cents(min - total))} missing to reach ${money(min)}`; send.textContent = tt("Send anyway"); send.className = "btn warn"; send.disabled = false; $("#oXlsx").disabled = false; }
    else { mm.className = "min-msg ok"; mm.textContent = min > 0 ? T`Minimum of ${money(min)} reached` : T`${n} unit${pl(n)}, ${Object.keys(qty).length} product${pl(Object.keys(qty).length)}`; send.textContent = tt("Send order"); send.className = "btn primary"; send.disabled = false; $("#oXlsx").disabled = false; }
  };
  const setQty = (pid, val) => { val = Math.max(0, Math.min(999, Math.floor(Number(val) || 0))); if (val) qty[pid] = val; else delete qty[pid]; S.drafts[dkey] = qty; LS.set("drafts", S.drafts); paint(); prebuild(); };
  $("#sheetContent").onclick = async e => {
    const b = e.target.closest("[data-d]");
    if (b) { const pid = b.closest(".prod").dataset.p; return setQty(pid, (qty[pid] || 0) + +b.dataset.d); }
    if (e.target.id === "cMine") { view = view === "order" ? "browse" : "order"; return renderCat(); }
    if (e.target.id === "cScan") return scan();
    if (e.target.id === "cLast") {
      // Newest order for this company, from this phone or from the CRM (laptop, teammates).
      const local = await storeOrders(id).catch(() => []);
      const prev = storeHistory(id, [], local).orders.find(o => o.coId === co.id);
      if (!prev) return toast(T`No earlier ${co.name} order for this store.`);
      let added = 0, missing = 0;
      for (const it of prev.items) { if (co.byId.has(it.key) && it.qty > 0) { qty[it.key] = it.qty; added++; } else missing++; }
      S.drafts[dkey] = qty; LS.set("drafts", S.drafts); view = "order"; renderCat(); paint(); prebuild();
      toast((prev.rep && prev.rep !== S.rep ? T`${added} product${pl(added)} from the ${niceDate(prev.date)} order by ${prev.rep}.` : T`${added} product${pl(added)} from the ${niceDate(prev.date)} order.`) +
        (missing ? T` ${missing} no longer in the catalog.` : "") + tt(" Adjust the quantities."));
    }
  };
  $("#sheetContent").oninput = e => {
    if (e.target.id === "cSearch") { q = e.target.value; if (q.trim() && brand) { brand = ""; $("#cBrand").value = ""; } view = "browse"; return renderCat(); }
    const pr = e.target.closest(".prod"); if (pr) return setQty(pr.dataset.p, e.target.value);
    if (e.target.closest(".fold")) prebuild();
  };
  $("#sheetContent").onchange = e => { if (e.target.id === "cBrand") { brand = e.target.value; q = ""; $("#cSearch").value = ""; view = "browse"; renderCat(); } };
  $("#sheetContent").addEventListener("focusout", e => { if (e.target.closest(".prod")) paint(); });
  $("#sheetContent").addEventListener("focusin", e => { if (e.target.matches(".prod input")) setTimeout(() => { try { e.target.select(); } catch (x) {} }, 0); });
  $("#sheetFoot").onclick = async e => {
    if (e.target.id !== "oSend" && e.target.id !== "oXlsx") return;
    const o = snapshot();
    if (o.total <= 0) return toast(tt("An empty order cannot be sent. Add at least one product."), true);
    const btn = e.target; btn.disabled = true;
    try {
      // The file is normally ready before the tap, so the share sheet opens inside the tap itself (Safari requires that).
      const blob = ready && ready.sig === sig(o) ? ready.blob : await buildOrderXlsx(o, co);
      ready = { sig: sig(o), blob };
      const how = await deliver(blob, o.fileName);
      if (how === "again") { toast(tt("The file is ready. Tap the button once more.")); return; }
      if (how === "cancelled" || how === "blocked") return;
      if (btn.id === "oXlsx") { toast(T`Preview only. Nothing was saved or sent to ${CRM}. Tap Send order when it is right.`); return; }
      const rec = { storeId: id, companyId: co.id, storeName: s.name, rep: S.rep, repName: o.rep, date: o.date, ts: Date.now(), qty: o.qty, total: o.total, storeNo: o.storeNo, po: o.po,
        contact: o.contact, address: o.address, phone: o.phone, email: o.email,
        lines: Object.entries(o.qty).map(([k, n]) => { const p = co.byId.get(k); return { id: k, code: p.code || "", name: p.name, size: p.size || "", qty: n, price: p.price }; }) };
      rec.fileName = o.fileName; rec.sync = "pending";
      if (savedId != null) rec.id = savedId;
      savedId = await put("orders", rec); sent = true; syncSoon();
      // Sent: start the next order for this store from zero ("Last order" can reload it).
      for (const k of Object.keys(qty)) delete qty[k];
      delete S.drafts[dkey]; delete S.drafts[id]; LS.set("drafts", S.drafts);
      savedId = null; sent = false; ready = null; view = "browse"; renderCat();
      S.meta[id] = Object.assign({}, S.meta[id], co.id === "reboot" ? { storeNo: o.storeNo, contact: o.contact, address: o.address } : { contact: o.contact }); LS.set("storeMeta", S.meta);
      await refreshDone();
      toast(how === "shared" ? T`Order saved on the store. In Mail, send it to ${co.orderEmail}.` : T`Excel downloaded and order saved. Email it to ${co.orderEmail}.`);
    } catch (x) {
      toast(tt("The Excel order could not be created. Close the order, reopen it and try again."), true);
    } finally { btn.disabled = false; paint(); }
  };
  // Scanning: each barcode adds one of that product; the card lets the rep set the quantity without leaving the camera.
  const scanCard = (p, note) => {
    const sub = catalog ? `${esc(p.group)} · ${esc(p.code)} · ${money(p.price)}${p.srp ? ` · PDSF ${money(p.srp)}` : ""}`
      : `${esc(p.size)} · ${money(p.price)} ${p.by === "case" ? tt("a case") : tt("each")}`;
    return `${note ? `<div class="scan-note">${note}</div>` : ""}<div class="scan-prod"><div class="pt"><div class="pn">${esc(p.name)}</div><div class="pp">${sub}</div></div>
      <div class="step" data-sp="${esc(p.id)}"><button type="button" data-sd="-1" aria-label="${tt("One less")}">−</button><span class="sq">${qty[p.id] || 0}</span><button type="button" data-sd="1" aria-label="${tt("One more")}">+</button></div></div>
      <div class="hint">${T`${money(orderTotal(qty, co))} in this order`}</div>`;
  };
  const scan = () => openScanner(tt("Scan") + " · " + co.name, (text, fmt) => {
    const m = findByBarcode(co, text, fmt);
    if (!m.list.length) return { ok: false, html: `<b>${T`Not in the ${esc(co.name)} catalog`}</b><p class="hint">${T`Barcode ${esc(m.digits || text)}. Try searching it by name.`}</p>` };
    if (m.list.length > 1) return { ok: true, html: `<b>${T`This barcode is on ${m.list.length} products. Pick one:`}</b>` + m.list.map(p => `<button class="btn small pick-p" type="button" data-pick="${esc(p.id)}">${esc(p.name)}${p.code ? " · " + esc(p.code) : p.size ? " · " + esc(p.size) : ""}</button>`).join("") };
    const p = m.list[0]; setQty(p.id, (qty[p.id] || 0) + 1);
    const note = p.by === "case" ? tt("Ordered by the case: one case added.") : m.viaCase ? tt("Case barcode: one unit added. Adjust below.") : "";
    return { ok: true, added: true, html: scanCard(p, note) };
  }, e => {
    const pk = e.target.closest("[data-pick]");
    if (pk) { const p = co.byId.get(pk.dataset.pick); setQty(p.id, (qty[p.id] || 0) + 1); beep(true); return { added: true, html: scanCard(p) }; }
    const b = e.target.closest("[data-sd]"); if (!b) return null;
    const p = co.byId.get(b.closest("[data-sp]").dataset.sp); setQty(p.id, (qty[p.id] || 0) + Number(b.dataset.sd));
    return { html: scanCard(p) };
  }, count => { view = "order"; renderCat(); paint(); prebuild(); if (count) toast(T`${count} product${pl(count)} added by scanning.`); });
  renderCat(); paint(); prebuild();
}

/* ---------- reports ---------- */
async function sheetBlob(name, cols, rows, extra) {
  const wb = new ExcelJS.Workbook(), ws = wb.addWorksheet(name);
  ws.columns = cols.map(c => ({ header: c.h, key: c.k, width: c.w || 14, style: c.fmt ? { numFmt: c.fmt } : {} }));
  ws.getRow(1).font = { bold: true }; ws.views = [{ state: "frozen", ySplit: 1 }];
  rows.forEach(r => ws.addRow(r));
  (extra || []).forEach(r => { const row = ws.addRow(r.values); if (r.bold) row.font = { bold: true }; });
  return new Blob([await wb.xlsx.writeBuffer()], { type: XLSX_TYPE });
}
async function monthData(ym) {
  const rows = mine(await all("orders")).filter(o => o.date.slice(0, 7) === ym).sort((a, b) => a.ts - b.ts);
  const under = o => { const co = company(o.companyId || "reboot"); return co.minimum > 0 && o.total < co.minimum; };
  const byCo = COMPANIES.map(co => { const r = rows.filter(o => (o.companyId || "reboot") === co.id); return { name: co.name, count: r.length, total: cents(r.reduce((t, o) => t + o.total, 0)) }; }).filter(x => x.count);
  return { rows, under, byCo, count: rows.length, stores: new Set(rows.map(o => o.storeId)).size, total: cents(rows.reduce((t, o) => t + o.total, 0)), underCount: rows.filter(under).length };
}
async function weekData(day) {
  const mon = mondayOf(day), days = [...Array(7).keys()].map(i => addDays(mon, i));
  const saved = new Map(mine(await all("mileage")).map(m => [m.date, m]));
  const rows = days.filter(d => saved.has(d)).map(d => saved.get(d));
  return { mon, sun: days[6], rows, total: Math.round(rows.reduce((t, r) => t + r.km, 0) * 10) / 10 };
}
async function renderReports() {
  if (!$("#monthPick").value) $("#monthPick").value = today().slice(0, 7);
  if (!$("#weekPick").value) $("#weekPick").value = today();
  try {
    const m = await monthData($("#monthPick").value);
    $("#monthStats").innerHTML = `<div class="stat"><b>${m.count}</b><span>${tt("orders")}</span></div><div class="stat"><b>${m.stores}</b><span>${tt("stores")}</span></div>
      <div class="stat"><b>${money(m.total)}</b><span>${tt("total")}</span></div><div class="stat"><b>${m.underCount}</b><span>${tt("under the minimum")}</span></div>` + (m.byCo.length > 1 ? `<div class="stat" style="grid-column:1/-1"><span>${m.byCo.map(x => T`${esc(x.name)}: ${x.count} order${pl(x.count)}, ${money(x.total)}`).join(" · ")}</span></div>` : "");
    $("#monthXlsx").disabled = !m.count;
    const w = await weekData($("#weekPick").value);
    $("#weekTable").innerHTML = w.rows.length ? `<table class="tbl"><thead><tr><th>${tt("Day")}</th><th class="num">km</th><th>${tt("Stores")}</th></tr></thead><tbody>
      ${w.rows.map(r => `<tr><td>${esc(weekday(r.date).slice(0, 3))} ${esc(r.date.slice(5))}</td><td class="num">${r.km.toFixed(1)}</td><td>${esc(r.stores.join(", "))}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td>${tt("Total")}</td><td class="num">${w.total.toFixed(1)}</td><td>${T`km, week of ${esc(w.mon)}`}</td></tr></tfoot></table>`
      : `<p class="hint">${T`No day saved in the week of ${esc(w.mon)}. Use Save this day on the Route screen.`}</p>`;
    $("#weekXlsx").disabled = !w.rows.length;
  } catch (e) { $("#monthStats").innerHTML = `<p class="hint">${tt("Saved data cannot be read in this browser. Private browsing blocks it.")}</p>`; }
}
$("#monthPick").addEventListener("change", renderReports);
$("#weekPick").addEventListener("change", renderReports);
$("#monthXlsx").addEventListener("click", async () => {
  try {
    const ym = $("#monthPick").value, m = await monthData(ym);
    if (!m.count) return toast(tt("No order saved in that month."));
    for (const co of COMPANIES) if (m.rows.some(o => (o.companyId || "reboot") === co.id)) await loadCatalog(co).catch(() => {});
    const wb = new ExcelJS.Workbook(), money2 = '#,##0.00 "$"';
    const sheet = (name, cols) => { const ws = wb.addWorksheet(name); ws.columns = cols.map(c => ({ header: c[0], key: c[1], width: c[2], style: c[3] ? { numFmt: c[3] } : {} })); ws.getRow(1).font = { bold: true }; ws.views = [{ state: "frozen", ySplit: 1 }]; return ws; };
    const orders = sheet(tt("Orders"), [[tt("Date"), "date", 12], [tt("Company"), "co", 12], [tt("Store"), "store", 36], [tt("Store #"), "no", 10], ["PO", "po", 14], [tt("Contact"), "contact", 22], [tt("Lines"), "lines", 8], [tt("Total"), "total", 12, money2], [tt("Under minimum"), "under", 14]]);
    const lines = sheet(tt("Lines"), [[tt("Date"), "date", 12], [tt("Company"), "co", 12], [tt("Store"), "store", 36], ["Code", "code", 16], [tt("Product"), "name", 44], [tt("Qty"), "qty", 8], [tt("Price"), "price", 11, money2], [tt("Line total"), "lt", 12, money2]]);
    for (const o of m.rows) {
      const co = company(o.companyId || "reboot");
      const ls = o.lines || Object.entries(o.qty).map(([k, n]) => { const p = co.byId.get(k); return p ? { code: p.code || "", name: p.name + (p.size ? " " + p.size : ""), qty: n, price: p.price } : null; }).filter(Boolean);
      orders.addRow({ date: o.date, co: co.name, store: o.storeName, no: /^\d+$/.test(o.storeNo || "") ? Number(o.storeNo) : o.storeNo, po: o.po, contact: o.contact, lines: ls.length, total: o.total, under: m.under(o) ? tt("Yes") : tt("No") });
      for (const l of ls) lines.addRow({ date: o.date, co: co.name, store: o.storeName, code: l.code || "", name: l.name + (l.size && !String(l.name).includes(l.size) ? " " + l.size : ""), qty: l.qty, price: l.price, lt: cents(l.qty * l.price) });
    }
    orders.addRow({}); const tr = orders.addRow({ store: T`${m.count} orders, ${m.stores} stores. Rep: ${S.rep}`, total: m.total, under: T`${m.underCount} under` }); tr.font = { bold: true };
    for (const x of m.byCo) orders.addRow({ co: x.name, store: `${x.count} order${x.count === 1 ? "" : "s"}`, total: x.total });
    const how = await deliver(new Blob([await wb.xlsx.writeBuffer()], { type: XLSX_TYPE }), T`Monthly orders ${ym}.xlsx`); if (how === "again") toast(tt("The file is ready. Tap the button once more."));
  } catch (e) { toast(tt("The monthly Excel could not be created. Try again."), true); }
});
$("#weekXlsx").addEventListener("click", async () => {
  try {
    const w = await weekData($("#weekPick").value);
    if (!w.rows.length) return toast(tt("No day saved in that week."));
    const blob = await sheetBlob(tt("Mileage"), [{ h: tt("Date"), k: "date", w: 12 }, { h: tt("Weekday"), k: "wd", w: 12 }, { h: tt("Kilometres"), k: "km", w: 12, fmt: "0.0" }, { h: tt("Stores"), k: "stores", w: 90 }],
      w.rows.map(r => ({ date: r.date, wd: weekday(r.date), km: r.km, stores: r.stores.join(", ") })), [{ values: { date: tt("Total"), km: w.total }, bold: true }]);
    const how = await deliver(blob, T`Mileage ${w.mon}.xlsx`); if (how === "again") toast(tt("The file is ready. Tap the button once more."));
  } catch (e) { toast(tt("The mileage Excel could not be created. Try again."), true); }
});

/* ---------- backup, rep, new store ---------- */
$("#backupBtn").addEventListener("click", async () => {
  try {
    const ls = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith("fr.")) ls[k] = localStorage.getItem(k); }
    const data = { app: "field-routes", made: new Date().toISOString(), ls, notes: await all("notes"), orders: await all("orders"), mileage: await all("mileage") };
    const how = await deliver(new Blob([JSON.stringify(data)], { type: "application/json" }), T`La Run backup ${today()}.json`);
    if (how === "again") toast(tt("The file is ready. Tap the button once more."));
  } catch (e) { toast(tt("The backup could not be created."), true); }
});
$("#restoreFile").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const d = JSON.parse(await f.text()); if (d.app !== "field-routes") throw new Error("not a backup");
    for (const st of ["notes", "orders", "mileage"]) { await tx(st, "readwrite", s => s.clear()); for (const r of d[st] || []) await put(st, r); }
    Object.entries(d.ls || {}).forEach(([k, v]) => localStorage.setItem(k, v));
    toast(tt("Backup restored. Reloading…")); setTimeout(() => location.reload(), 900);
  } catch (x) { toast(tt("That file is not a La Run backup."), true); }
});
$("#replaceBtn").addEventListener("click", () => { geoStop = true; setTimeout(() => { S.geo = {}; LS.set("geo", S.geo); geoRunning = false; refreshMarkers(); renderStores(); geocodeAll(); toast(tt("Placing every address again. Keep the app open.")); }, 1300); });
function paintRep() { $("#repBtn").textContent = S.rep || tt("Set rep name"); }
$("#repBtn").addEventListener("click", () => {
  openSheet(tt("Rep"), `<div class="card"><div class="field"><label for="rName">${tt("Your name, as printed on orders")}</label><input id="rName" type="text" value="${esc(S.rep)}"></div>
    <p class="hint">${tt("Notes, orders and kilometres are filed under this name. Another name on this phone sees its own.")}</p></div>`,
    `<button class="btn primary" id="rSave" type="button">${tt("Save")}</button>`);
  $("#sheetFoot").onclick = async e => {
    if (e.target.id !== "rSave") return; const v = $("#rName").value.trim(); if (!v) return toast(tt("Type a name first."), true);
    S.rep = v; LS.set("rep", v); paintRep(); await refreshDone(); closeSheet(); if (S.tab === "more") renderReports();
  };
});
$("#addStoreBtn").addEventListener("click", () => {
  const regs = [...new Set([...byId.values()].map(regionOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  const fld = (id, label, extra) => `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="text" ${extra || ""}></div>`;
  openSheet(tt("New store"), `<div class="card">${fld("aName", tt("Store name"))}${fld("aAddr", tt("Street address"))}<div class="grid2">${fld("aCity", tt("City"))}${fld("aPostal", tt("Postal code"))}</div>
    <div class="grid2">${fld("aPhone", tt("Phone"), 'inputmode="tel"')}${fld("aNo", tt("Store number"), 'inputmode="numeric"')}</div>
    <div class="field"><label for="aReg">${tt("Region")}</label><select id="aReg"><option value="">${tt("Choose")}</option>${regs.map(r => `<option>${esc(r)}</option>`).join("")}</select></div>
    <p class="hint">${T`Added to the list "${esc(curList().name)}" on this phone.`}</p></div>`, `<button class="btn primary" id="aSave" type="button">${tt("Add store")}</button>`);
  $("#sheetFoot").onclick = e => {
    if (e.target.id !== "aSave") return; const v = k => $("#" + k).value.trim();
    if (!v("aName")) return toast(tt("The store needs a name."), true);
    const s = { id: "new-" + Date.now(), listId: S.listId, name: v("aName"), address: v("aAddr"), city: v("aCity"), postal: v("aPostal"), phone: v("aPhone"), region: v("aReg"), storeNo: v("aNo"), contact: "", email: "" };
    LS.set("custom", LS.get("custom", []).concat(s)); curList().stores.push(s); byId.set(s.id, s);
    closeSheet(); renderFilters(); renderStores(); geocodeAll(); toast(tt("Store added."));
  };
});

/* ---------- GoHighLevel settings ---------- */
function paintApi() { $("#appVersion").textContent = "La Run version 16"; $("#crmTitle").textContent = CRM; $("#apiUrl").value = API.url(); $("#apiKey").value = API.key(); paintSync(); }
$("#ghlConnect").addEventListener("click", async e => {
  const url = $("#apiUrl").value.trim().replace(/\/+$/, ""), key = $("#apiKey").value.trim();
  if (!/^https:\/\//.test(url)) return toast(tt("The service address must start with https://"), true);
  if (!key) return toast(tt("Type the app password you set in Render."), true);
  LS.set("apiUrl", url); LS.set("apiKey", key);
  const b = e.target; b.disabled = true; b.textContent = tt("Testing… (can take a minute)");
  try {
    const r = await api("GET", "/api/check");
    const probs = Object.entries(r).filter(([k, v]) => !/^(ok|set)/.test(String(v)));
    if (probs.length) toast(probs.map(([k, v]) => `${k}: ${v}`).join(" · "), true);
    else { toast(T`Connected to ${CRM}.`); syncSoon(); }
  } catch (x) { toast(x.message, true); }
  finally { b.disabled = false; b.textContent = tt("Connect and test"); paintSync(); }
});
$("#ghlSync").addEventListener("click", () => syncAll(true));
document.querySelectorAll("#langSeg [data-lang]").forEach(b => {
  b.classList.toggle("on", b.dataset.lang === LANG); b.setAttribute("aria-pressed", b.dataset.lang === LANG);
  b.addEventListener("click", () => { if (b.dataset.lang === LANG) return; LS.set("lang", b.dataset.lang); location.reload(); });
});

/* ---------- start ---------- */
document.querySelector(".tabs").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (b) setTab(b.dataset.tab); });
window.addEventListener("resize", () => map && map.invalidateSize());
(async function start() {
  translatePage(); paintRep(); renderFilters(); initMap(); setTab("stores");
  try { await db(); await refreshDone(); }
  catch (e) { const b = $("#banner"); b.hidden = false; b.textContent = tt("This browser is blocking saved data (private browsing?). Notes, orders and kilometres will not be kept."); }
  renderStores(); refreshMarkers(true);
  if (infoOk()) measureSoon();
  geocodeAll();
  paintApi(); await countPending();
  if (connected()) { fetch(API.url() + "/health").catch(() => {}); syncSoon(); prefetchRoute(6000); setTimeout(() => fetchDue().catch(() => {}), 2500); }
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
window.__fr = { S, solveLoop, syncAll, G, missingFr, LANG };   // for support and testing
})();
