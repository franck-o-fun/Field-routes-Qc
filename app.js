/* Field routes. Everything is saved on this device (localStorage + IndexedDB). */
(() => {
"use strict";

const C = window.FR_CONFIG;
const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const $ = s => document.querySelector(s);
const esc = s => String(s == null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const sleep = ms => new Promise(r => setTimeout(r, ms));
const money = n => new Intl.NumberFormat("en-CA", { style: "currency", currency: "CAD" }).format(n);
const cents = n => Math.round(n * 100) / 100;

const LS = {
  get(k, d) { try { const v = localStorage.getItem("fr." + k); return v == null ? d : JSON.parse(v); } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem("fr." + k, JSON.stringify(v)); } catch (e) { /* storage full or blocked */ } }
};

/* ---------- dates, always in the territory's time zone ---------- */
const dayFmt = new Intl.DateTimeFormat("en-CA", { timeZone: C.timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
const today = () => dayFmt.format(new Date());
const fromYmd = s => { const [y, m, d] = s.split("-").map(Number); return new Date(Date.UTC(y, m - 1, d, 12)); };
const toYmd = d => d.toISOString().slice(0, 10);
const addDays = (s, n) => { const d = fromYmd(s); d.setUTCDate(d.getUTCDate() + n); return toYmd(d); };
const weekday = s => new Intl.DateTimeFormat("en-CA", { weekday: "long", timeZone: "UTC" }).format(fromYmd(s));
const niceDate = s => new Intl.DateTimeFormat("en-CA", { weekday: "short", month: "short", day: "numeric", year: "numeric", timeZone: "UTC" }).format(fromYmd(s));
const mondayOf = s => addDays(s, -((fromYmd(s).getUTCDay() + 6) % 7));

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
  if (tab === "more") renderReports();
  setTimeout(() => map && map.invalidateSize(), 60);
}
let sheetClose = null;
function openSheet(title, html, foot, onClose) {
  closeSheet(true);
  $("#sheetTitle").textContent = title;
  $("#sheetContent").innerHTML = html; $("#sheetContent").scrollTop = 0;
  const f = $("#sheetFoot"); f.hidden = !foot; f.innerHTML = foot || "";
  $("#sheet").hidden = false; sheetClose = onClose || null;
}
function closeSheet(silent) {
  if ($("#sheet").hidden) return;
  $("#sheet").hidden = true;
  const fn = sheetClose; sheetClose = null; if (fn) fn();
  if (!silent) { renderStores(); refreshMarkers(); }
}
$("#sheet").addEventListener("click", e => { if (e.target.closest("[data-close]")) closeSheet(); });

/* ---------- stores list ---------- */
function shownStores() {
  const q = S.q.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  return curList().stores.filter(s => {
    if (S.region && regionOf(s) !== S.region) return false;
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
  $("#regionSel").innerHTML = `<option value="">All regions</option>` + regs.map(r => `<option>${esc(r)}</option>`).join("");
  $("#regionSel").value = S.region;
  $("#hideDone").checked = S.hideDone;
}
function renderStores() {
  const shown = shownStores();
  $("#count").textContent = `${shown.length} store${shown.length === 1 ? "" : "s"} shown · ${S.route.length} on today's route`;
  $("#storeList").innerHTML = shown.length ? shown.map(s => {
    const inR = S.route.includes(s.id), g = S.geo[s.id];
    const tags = (S.done.has(s.id) ? `<span class="tag done">Done today</span>` : "") +
      (!s.address ? `<span class="tag nomap">No address</span>` : g && g.approx ? `<span class="tag">Approx. pin</span>` : "");
    return `<li class="${inR ? "in" : ""}">
      <button class="pick" type="button" data-id="${esc(s.id)}" aria-pressed="${inR}">
        <span class="tick">${inR ? "✓" : ""}</span>
        <span style="min-width:0"><span class="s-name">${esc(s.name)}${s.storeNo ? ` <span class="tag">#${esc(s.storeNo)}</span>` : ""}</span>
        <span class="s-sub">${esc([s.address, s.city].filter(Boolean).join(", ") || "No address")}${tags}</span></span>
      </button>
      <button class="open" type="button" data-open="${esc(s.id)}" aria-label="Open ${esc(s.name)}">›</button></li>`;
  }).join("") : `<li class="empty" style="display:block">No store matches. Clear the search or pick another region.</li>`;
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
$("#addShown").addEventListener("click", () => {
  const add = shownStores().filter(s => !S.route.includes(s.id));
  if (!add.length) return toast("Every store on screen is already on the route.");
  add.forEach(s => S.route.push(s.id)); routeChanged(); toast(`${add.length} store${add.length === 1 ? "" : "s"} added to today's route.`);
});

/* ---------- route basics ---------- */
function routeChanged(keepInfo) {
  LS.set("route", S.route);
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
  if (!window.L) { $("#map").innerHTML = `<p class="empty">The map could not load. Check your connection and reopen the app.</p>`; return; }
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
    ${s.phone ? `<small>${esc(s.phone)}</small>` : ""}${g && g.approx ? `<small>Approximate pin: the address did not match a building.</small>` : ""}
    <div class="acts"><button class="primary" data-act="order" data-id="${esc(id)}">Order</button>
    <button data-act="route" data-id="${esc(id)}">${inR ? "Remove from route" : "Add to route"}</button>
    <button data-act="note" data-id="${esc(id)}">Add a note</button>
    <button data-act="record" data-id="${esc(id)}">Store record</button></div></div>`;
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
    const g = S.geo[id], n = S.route.indexOf(id);
    const icon = L.divIcon({ className: "", iconSize: n >= 0 ? [30, 30] : [22, 22],
      html: `<div class="pin${n >= 0 ? " route" : ""}${g.approx ? " approx" : ""}">${n >= 0 ? n + 1 : ""}</div>` });
    let m = markers.get(id);
    if (!m) { m = L.marker([g.lat, g.lng], { icon }).addTo(map); const p = L.popup({ maxWidth: 300 }); p._frId = id; m.bindPopup(p); markers.set(id, m); }
    else { m.setIcon(icon); m.setLatLng([g.lat, g.lng]); }
    m.setZIndexOffset(n >= 0 ? 500 : 0);
    pts.push([g.lat, g.lng]);
  }
  if (S.start) {
    if (!meMarker) meMarker = L.marker([S.start.lat, S.start.lng], { icon: L.divIcon({ className: "", iconSize: [22, 22], html: `<div class="pin me"></div>` }), zIndexOffset: 900 }).addTo(map).bindPopup("Start of the day");
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
    st.hidden = false; st.textContent = `Placing addresses on the map: ${n + 1} of ${total}. This only happens once.`;
    try { S.geo[s.id] = await geocodeOne(s); errors = 0; }
    catch (e) { errors++; if (errors >= 3) { st.textContent = "Could not place addresses right now. They will be tried again when you reopen the app."; await sleep(4000); break; } await sleep(3000); continue; }
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
  if (!S.route.length) return toast("Add stores to the route first.");
  const ids = placed();
  if (ids.length + (S.start ? 1 : 0) < 2) return toast(S.start ? "None of these stores has a pin yet, so there is nothing to drive to." : "Tap Start from here, or add a second store, to get a loop.", true);
  busy = true; const b = $("#optimize"); b.disabled = true; b.textContent = "Optimizing…";
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
    toast(miss ? `Route optimized. ${miss} store${miss === 1 ? " has" : "s have"} no pin and stay${miss === 1 ? "s" : ""} at the end.` : "Route optimized by real driving time.");
  } catch (e) {
    toast("Could not get driving times. Check your signal and tap Optimize again.", true);
  } finally {
    busy = false; b.disabled = false; b.textContent = "Optimize";
    renderStores(); refreshMarkers(true); renderRoute();
  }
}
let measureT;
function measureSoon() {
  clearTimeout(measureT);
  measureT = setTimeout(async () => { try { await measure(); } catch (e) { toast("Could not measure this order. Check your signal.", true); } renderRoute(); }, 700);
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
  $("#startText").textContent = S.start ? `Your location, set at ${S.start.time || "today"}` : first ? `No location. Starts and ends at ${first.name}` : "No location set";
  $("#removeLoc").hidden = !S.start;
  $("#routeEmpty").hidden = !!n; $("#routeActions").hidden = !n;
  $("#routeList").innerHTML = S.route.map((id, i) => {
    const s = byId.get(id), g = S.geo[id];
    return `<li><span class="n">${i + 1}</span>
      <button class="t" type="button" data-open="${esc(id)}"><span class="s-name">${esc(s.name)}</span>
      <span class="s-sub">${esc(s.city || "")}${g && g.lat ? (g.approx ? " · approx. pin" : "") : " · no pin, not in the drive"}${S.done.has(id) ? " · done today" : ""}</span></button>
      <button class="mv" type="button" data-mv="-1" data-i="${i}" ${i ? "" : "disabled"} aria-label="Earlier">↑</button>
      <button class="mv" type="button" data-mv="1" data-i="${i}" ${i < n - 1 ? "" : "disabled"} aria-label="Later">↓</button>
      <button class="mv" type="button" data-rm="${esc(id)}" aria-label="Remove">✕</button></li>`;
  }).join("");
  const sum = $("#routeSummary");
  if (n && infoOk()) {
    const h = Math.floor(S.info.min / 60), m = S.info.min % 60;
    sum.hidden = false;
    sum.innerHTML = `<div class="row between"><div><div class="label">Driving time</div><div class="big">${h ? h + " h " : ""}${m} min</div></div>
      <div style="text-align:right"><div class="label">Round trip</div><div class="big">${S.info.km.toFixed(1)} km</div></div></div>
      <p class="hint">Real roads, back to the start. No live traffic.</p>`;
  } else if (n) {
    sum.hidden = false; sum.innerHTML = `<p class="hint">Tap Optimize to put the stops in driving order and get the time and kilometres.</p>`;
  } else sum.hidden = true;
  const links = mapLinks();
  $("#gmaps").toggleAttribute("disabled", !links); $("#amaps").toggleAttribute("disabled", !links);
  if (links) { $("#gmaps").href = links.google; $("#amaps").href = links.apple; } else { $("#gmaps").removeAttribute("href"); $("#amaps").removeAttribute("href"); }
  $("#mapsNote").textContent = !links ? "No store on the route has a pin yet." :
    (links.cut ? `Long day: the map app gets the first ${C.maxMapStops} stores, then the drive back to the start. The app still knows all ${links.total}. ` : "") +
    "Both map apps open this exact order and end about one block from where you started.";
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
  if (!navigator.geolocation) return toast("This browser cannot share your location.", true);
  const b = $("#startHere"); b.disabled = true; b.textContent = "Finding you…";
  navigator.geolocation.getCurrentPosition(p => {
    S.start = { lat: p.coords.latitude, lng: p.coords.longitude, time: new Intl.DateTimeFormat("en-CA", { hour: "numeric", minute: "2-digit", timeZone: C.timeZone }).format(new Date()) };
    LS.set("start", S.start); b.disabled = false; b.textContent = "Start from here";
    routeChanged(); toast("Start set to where you are now.");
  }, err => {
    b.disabled = false; b.textContent = "Start from here";
    toast(err.code === 1 ? "Location is turned off for this site. Allow it in Settings, then tap again." : "Could not find your location. Step outside or check your signal, then tap again.", true);
  }, { enableHighAccuracy: true, timeout: 15000, maximumAge: 60000 });
});
$("#removeLoc").addEventListener("click", () => { S.start = null; LS.set("start", null); routeChanged(); toast("Starting point removed."); });
$("#optimize").addEventListener("click", optimize);
let clearArmed = 0;
$("#clearRoute").addEventListener("click", e => {
  if (Date.now() - clearArmed > 4000) { clearArmed = Date.now(); e.target.textContent = "Tap again to clear"; setTimeout(() => { e.target.textContent = "Clear"; }, 4000); return; }
  clearArmed = 0; e.target.textContent = "Clear"; S.route = []; routeChanged(); toast("Route cleared.");
});
$("#saveDay").addEventListener("click", async () => {
  if (!infoOk() || !(S.info.km > 0)) return toast("Optimize the route first so the day has a real distance.", true);
  const date = today();
  try {
    await put("mileage", { key: S.rep + "|" + date, rep: S.rep, date, km: S.info.km, stores: S.route.map(id => label(byId.get(id))) });
    toast(`Saved ${niceDate(date)}: ${S.info.km.toFixed(1)} km, ${S.route.length} store${S.route.length === 1 ? "" : "s"}.`);
  } catch (e) { toast("Could not save the day on this phone. Free some storage and try again.", true); }
});

/* ---------- store record ---------- */
const mine = rows => rows.filter(r => r.rep === S.rep);
async function storeNotes(id) { return mine(await tx("notes", "readonly", s => s.index("storeId").getAll(id))).sort((a, b) => b.ts - a.ts); }
async function storeOrders(id) { return mine(await tx("orders", "readonly", s => s.index("storeId").getAll(id))).sort((a, b) => b.ts - a.ts); }
async function refreshDone() {
  const d = today(); S.done = new Set();
  try { for (const st of ["notes", "orders"]) for (const r of mine(await all(st))) if (r.date === d) S.done.add(r.storeId); } catch (e) { /* no storage */ }
}
const mapsHref = s => "https://www.google.com/maps/search/?api=1&query=" + encodeURIComponent([s.name, s.address, s.city, s.postal].filter(Boolean).join(", "));
async function openStore(id) {
  const s = byId.get(id), m = S.meta[id] || {}, g = S.geo[id];
  const [notes, orders] = await Promise.all([storeNotes(id).catch(() => []), storeOrders(id).catch(() => [])]);
  const inR = S.route.includes(id);
  openSheet(s.name, `
    <div class="card"><div class="addr">${esc(s.address || "No street address")}<br>${esc([s.city, s.postal].filter(Boolean).join(" "))}
      ${s.address ? `<br><a href="${esc(mapsHref(s))}" target="_blank" rel="noopener">Open in maps</a>` : ""}</div>
      <div class="hint">${[regionOf(s), (m.storeNo || s.storeNo) ? "Store #" + esc(m.storeNo || s.storeNo) : "", (m.contact || s.contact) ? "Contact: " + esc(m.contact || s.contact) : "",
        !s.address ? "Not on the map" : g && g.lat ? (g.approx ? "Approximate pin" : "Exact pin") : "Pin not placed yet"].filter(Boolean).join(" · ")}</div>
      ${s.phone ? `<a class="btn" href="tel:${esc(s.phone.replace(/[^\d+]/g, ""))}">Call ${esc(s.phone)}</a>` : ""}
      ${s.email ? `<div class="hint">${esc(s.email)}</div>` : ""}</div>
    <div class="grid2"><button class="btn primary" data-go="order">Order</button><button class="btn primary" data-go="note">Note</button></div>
    <button class="btn" data-go="route">${inR ? "Remove from route" : "Add to route"}</button>
    <div class="card"><h2>Last visit</h2>${notes[0] ? `<div class="hint">${niceDate(notes[0].date)}</div><div class="note-last">${esc(notes[0].text)}</div>${photosHtml(notes[0].photos)}` : `<p class="hint">No earlier note.</p>`}</div>
    <div class="card"><h2>Orders</h2>${orders.length ? `<div class="hist">${orders.slice(0, 8).map(o => `<div class="h"><b>${money(o.total)}</b>${o.total < C.minimumOrder ? " · under minimum" : ""}<small>${niceDate(o.date)}${o.po ? " · PO " + esc(o.po) : ""}</small></div>`).join("")}</div>` : `<p class="hint">No order saved for this store yet.</p>`}</div>
    ${notes.length > 1 ? `<div class="card"><h2>Earlier notes</h2><div class="hist">${notes.slice(1, 8).map(n => `<div class="h"><small>${niceDate(n.date)}</small><div class="note-last">${esc(n.text)}</div></div>`).join("")}</div></div>` : ""}`);
  $("#sheetContent").onclick = e => {
    const b = e.target.closest("[data-go]"); if (!b) return;
    if (b.dataset.go === "order") openOrder(id); else if (b.dataset.go === "note") openNote(id);
    else { toggleRoute(id); openStore(id); }
  };
}
const photosHtml = (ph, rm) => ph && ph.length ? `<div class="photos">${ph.map((p, i) => `<div class="ph"><img src="${p}" alt="Visit photo ${i + 1}">${rm ? `<button class="rm" type="button" data-rmph="${i}" aria-label="Remove photo">✕</button>` : ""}</div>`).join("")}</div>` : "";

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
  const s = byId.get(id); let notes = [];
  try { notes = await storeNotes(id); } catch (e) { /* shown below */ }
  const last = notes[0]; let editing = null, photos = [], text = "";
  const draw = () => {
    openSheet("Note · " + s.name, `
      <div class="card"><h2>Last visit</h2>${last ? `<div class="hint">${niceDate(last.date)}</div><div class="note-last">${esc(last.text)}</div>${photosHtml(last.photos)}
        ${editing ? "" : `<button class="btn small" type="button" id="nEdit">Edit</button>`}` : `<p class="hint">No earlier note.</p>`}</div>
      <div class="card"><h2>${editing ? "Edit the last note" : "What happened"}</h2>
        <textarea id="nText" maxlength="4000" placeholder="Type, or tap the microphone on the keyboard to dictate.">${esc(text)}</textarea>
        <div class="counter" id="nCount"></div>
        ${photosHtml(photos, true)}
        <label class="btn" for="nPhoto" ${photos.length >= 4 ? "hidden" : ""}>Add photo (${photos.length} of 4)</label>
        <input id="nPhoto" type="file" accept="image/*" multiple hidden></div>`,
      editing ? `<div class="row gap"><button class="btn" id="nCancel" type="button">Cancel</button><button class="btn primary" id="nSave" type="button">Update the note</button></div>`
              : `<button class="btn primary" id="nSave" type="button">Save note</button>`);
    const ta = $("#nText"), cnt = () => { $("#nCount").textContent = `${ta.value.length} / 4,000`; };
    ta.oninput = () => { text = ta.value; cnt(); }; cnt();
    $("#nPhoto").onchange = async e => {
      for (const f of [...e.target.files].slice(0, 4 - photos.length)) { try { photos.push(await shrink(f)); } catch (x) { toast("That photo could not be read. Try another one.", true); } }
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
      if (!t && !photos.length) return toast("Write a few words or add a photo first.", true);
      try {
        if (editing) await put("notes", { ...editing, text: t, photos: (editing.photos || []).concat(photos), edited: Date.now() });
        else await put("notes", { storeId: id, storeName: s.name, rep: S.rep, date: today(), ts: Date.now(), text: t, photos });
        await refreshDone(); toast(editing ? "Note updated." : "Note saved on this store."); closeSheet();
      } catch (x) { toast("The note could not be saved on this phone. Free some storage and try again.", true); }
    };
  };
  draw();
}

/* ---------- order ---------- */
function b64buf(b64) { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
const safeName = s => String(s).replace(/[\\/:*?"<>|]+/g, " ").replace(/\s+/g, " ").trim();
const orderTotal = q => cents(C.products.reduce((t, p) => t + (q[p.id] || 0) * p.price, 0));
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
async function buildOrderXlsx(o) {
  const zip = await JSZip.loadAsync(b64buf(window.ORDER_TEMPLATE_B64)), path = "xl/worksheets/sheet1.xml";
  const doc = new DOMParser().parseFromString(await zip.file(path).async("string"), "application/xml");
  if (doc.getElementsByTagName("parsererror").length) throw new Error("template");
  const ed = sheetEditor(doc), f = C.orderForm, put1 = (ref, v) => { if (v !== "" && v != null) ed.set(ref, v); };
  put1(f.storeName, o.storeName); put1(f.storeNumber, /^\d{1,9}$/.test(o.storeNo) ? Number(o.storeNo) : o.storeNo);
  put1(f.po, o.po); put1(f.address, o.address); put1(f.rep, o.rep); put1(f.contact, o.contact);
  let extra = f.extraRow;
  for (const p of C.products) {
    const q = o.qty[p.id] || 0; if (q <= 0) continue;                       // zero stays blank
    if (p.row) { ed.set(f.qtyColumn + p.row, q); continue; }
    const r = extra++, src = ed.rowOf(r - 1), row = ed.rowOf(r);            // product not printed on the form: add its line, codes blank
    if (src.getAttribute("ht")) { row.setAttribute("ht", src.getAttribute("ht")); row.setAttribute("customHeight", "1"); }
    const st = col => { const c = [...src.getElementsByTagNameNS(NS, "c")].find(x => x.getAttribute("r") === col + (r - 1)); return c ? c.getAttribute("s") : null; };
    const fv = [...src.getElementsByTagNameNS(NS, "c")].find(x => x.getAttribute("r") === "F" + (r - 1));
    "ABCDE".split("").forEach(col => ed.set(col + r, "", st(col)));
    ed.set("F" + r, fv && fv.textContent ? Number(fv.textContent) : "", st("F"));
    ed.set("G" + r, p.formLine.description, st("G")); ed.set("H" + r, p.formLine.caseQty, st("H")); ed.set("I" + r, p.formLine.format, st("I"));
    ed.set("J" + r, p.price, st("J")); ed.set("K" + r, q, st("K"));
  }
  let xml = new XMLSerializer().serializeToString(doc);
  if (!xml.startsWith("<?xml")) xml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + xml;
  zip.file(path, xml);
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
  if (isTouch() && standalone()) { toast("Mail will not open from the Home Screen icon. Open this site in Safari and send again.", true); return "blocked"; }
  download(blob, name); return "downloaded";
}
async function openOrder(id) {
  const s = byId.get(id), m = S.meta[id] || {};
  const qty = Object.assign({}, S.drafts[id] || {});
  const head = { address: m.address != null ? m.address : [s.address, s.city, s.postal].filter(Boolean).join(", "), storeNo: m.storeNo != null ? m.storeNo : (s.storeNo || ""), po: "", contact: m.contact != null ? m.contact : (s.contact || ""), rep: S.rep };
  let savedId = null, ready = null, buildT = null, sent = false;
  const groups = [...new Set(C.products.map(p => p.group))];
  openSheet("Order · " + s.name, `
    <div class="addr"><b>${esc(s.name)}</b><br>${esc([s.address, s.city].filter(Boolean).join(", ") || "No street address")}</div>
    <details class="fold"><summary>Order sheet details</summary><div class="in">
      <div class="field"><label for="oAddr">Address printed on the sheet</label><input id="oAddr" type="text" value="${esc(head.address)}"></div>
      <div class="grid2"><div class="field"><label for="oNo">Store number</label><input id="oNo" type="text" inputmode="numeric" value="${esc(head.storeNo)}"></div>
      <div class="field"><label for="oPo">PO</label><input id="oPo" type="text" value=""></div></div>
      <div class="field"><label for="oContact">Contact at the store</label><input id="oContact" type="text" value="${esc(head.contact)}"></div>
      <div class="field"><label for="oRep">Rep</label><input id="oRep" type="text" value="${esc(head.rep)}"></div></div></details>
    ${groups.map(g => `<div class="grp">${esc(g)}, by the ${C.products.find(p => p.group === g).by}</div>` + C.products.filter(p => p.group === g).map(p => `
      <div class="prod" data-p="${esc(p.id)}"><div class="pt"><div class="pn">${esc(p.name)}</div><div class="pp">${esc(p.size)} · ${money(p.price)} ${p.by === "case" ? "a case" : "each"}</div></div>
      <div class="step"><button type="button" data-d="-1" aria-label="One less ${esc(p.name)}">−</button>
      <input type="number" inputmode="numeric" min="0" max="999" step="1" value="${qty[p.id] || 0}" aria-label="Quantity ${esc(p.name)}">
      <button type="button" data-d="1" aria-label="One more ${esc(p.name)}">+</button></div></div>`).join("")).join("")}`,
    `<div class="total-row"><div><div class="label">Total</div><div class="min-msg" id="oMin"></div></div><div class="big" id="oTotal"></div></div>
     <div class="row gap"><button class="btn" id="oXlsx" type="button">Excel</button><button class="btn primary" id="oSend" type="button" style="flex:2">Send order</button></div>
     <div class="hint">Send to ${esc(C.orderEmail)}</div>`,
    () => { clearTimeout(buildT); if (sent) { delete S.drafts[id]; LS.set("drafts", S.drafts); } });

  const readHead = () => { head.address = $("#oAddr").value.trim(); head.storeNo = $("#oNo").value.trim(); head.po = $("#oPo").value.trim(); head.contact = $("#oContact").value.trim(); head.rep = $("#oRep").value.trim(); };
  const snapshot = () => { readHead(); const total = orderTotal(qty); const date = today();
    return { storeId: id, storeName: s.name, date, qty: Object.assign({}, qty), total, ...head, fileName: `Bon de commande ${safeName(label(s).replace("#", ""))} ${date}.xlsx` }; };
  const sig = o => JSON.stringify([o.qty, o.address, o.storeNo, o.po, o.contact, o.rep, o.date]);
  const prebuild = () => { clearTimeout(buildT); buildT = setTimeout(async () => { const o = snapshot(); if (o.total <= 0) return; try { ready = { sig: sig(o), blob: await buildOrderXlsx(o) }; } catch (e) { ready = null; } }, 350); };
  const paint = () => {
    const total = orderTotal(qty), min = C.minimumOrder;
    $("#oTotal").textContent = money(total);
    const mm = $("#oMin"), send = $("#oSend");
    document.querySelectorAll("#sheetContent .prod").forEach(el => { const q = qty[el.dataset.p] || 0; el.classList.toggle("has", q > 0); const inp = el.querySelector("input"); if (document.activeElement !== inp) inp.value = q; });
    if (total <= 0) { mm.className = "min-msg"; mm.textContent = "Add a product to send."; send.textContent = "Send order"; send.className = "btn primary"; send.disabled = true; $("#oXlsx").disabled = true; }
    else if (total < min) { mm.className = "min-msg under"; mm.textContent = `${money(cents(min - total))} missing to reach ${money(min)}`; send.textContent = "Send anyway"; send.className = "btn warn"; send.disabled = false; $("#oXlsx").disabled = false; }
    else { mm.className = "min-msg ok"; mm.textContent = `Minimum of ${money(min)} reached`; send.textContent = "Send order"; send.className = "btn primary"; send.disabled = false; $("#oXlsx").disabled = false; }
  };
  const setQty = (pid, v) => { v = Math.max(0, Math.min(999, Math.floor(Number(v) || 0))); if (v) qty[pid] = v; else delete qty[pid]; S.drafts[id] = qty; LS.set("drafts", S.drafts); paint(); prebuild(); };
  $("#sheetContent").onclick = e => { const b = e.target.closest("[data-d]"); if (!b) return; const pid = b.closest(".prod").dataset.p; setQty(pid, (qty[pid] || 0) + +b.dataset.d); };
  $("#sheetContent").oninput = e => {
    const pr = e.target.closest(".prod"); if (pr) return setQty(pr.dataset.p, e.target.value);
    if (e.target.closest(".fold")) prebuild();
  };
  $("#sheetContent").addEventListener("focusout", e => { if (e.target.closest(".prod")) paint(); });
  $("#sheetFoot").onclick = async e => {
    if (e.target.id !== "oSend" && e.target.id !== "oXlsx") return;
    const o = snapshot();
    if (o.total <= 0) return toast("An empty order cannot be sent. Add at least one product.", true);
    const btn = e.target; btn.disabled = true;
    try {
      // The file is normally ready before the tap, so the share sheet opens inside the tap itself (Safari requires that).
      const blob = ready && ready.sig === sig(o) ? ready.blob : await buildOrderXlsx(o);
      ready = { sig: sig(o), blob };
      const how = await deliver(blob, o.fileName);
      if (how === "again") { toast("The file is ready. Tap the button once more."); return; }
      if (how === "cancelled" || how === "blocked") return;
      const rec = { storeId: id, storeName: s.name, rep: S.rep, repName: o.rep, date: o.date, ts: Date.now(), qty: o.qty, total: o.total, storeNo: o.storeNo, po: o.po, contact: o.contact, address: o.address };
      if (savedId != null) rec.id = savedId;
      savedId = await put("orders", rec); sent = true;
      S.meta[id] = Object.assign({}, S.meta[id], { storeNo: o.storeNo, contact: o.contact, address: o.address }); LS.set("storeMeta", S.meta);
      if (o.rep && o.rep !== S.rep) { /* rep name on the sheet only; the profile stays the same */ }
      await refreshDone();
      toast(how === "shared" ? `Order saved on the store. In Mail, send it to ${C.orderEmail}.` : `Excel downloaded and order saved. Email it to ${C.orderEmail}.`);
    } catch (x) {
      toast("The Excel order could not be created. Close the order, reopen it and try again.", true);
    } finally { btn.disabled = false; paint(); }
  };
  paint(); prebuild();
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
  return { rows, count: rows.length, stores: new Set(rows.map(o => o.storeId)).size, total: cents(rows.reduce((t, o) => t + o.total, 0)), under: rows.filter(o => o.total < C.minimumOrder).length };
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
    $("#monthStats").innerHTML = `<div class="stat"><b>${m.count}</b><span>orders</span></div><div class="stat"><b>${m.stores}</b><span>stores</span></div>
      <div class="stat"><b>${money(m.total)}</b><span>total</span></div><div class="stat"><b>${m.under}</b><span>under ${money(C.minimumOrder)}</span></div>`;
    $("#monthXlsx").disabled = !m.count;
    const w = await weekData($("#weekPick").value);
    $("#weekTable").innerHTML = w.rows.length ? `<table class="tbl"><thead><tr><th>Day</th><th class="num">km</th><th>Stores</th></tr></thead><tbody>
      ${w.rows.map(r => `<tr><td>${esc(weekday(r.date).slice(0, 3))} ${esc(r.date.slice(5))}</td><td class="num">${r.km.toFixed(1)}</td><td>${esc(r.stores.join(", "))}</td></tr>`).join("")}</tbody>
      <tfoot><tr><td>Total</td><td class="num">${w.total.toFixed(1)}</td><td>km, week of ${esc(w.mon)}</td></tr></tfoot></table>`
      : `<p class="hint">No day saved in the week of ${esc(w.mon)}. Use Save this day on the Route screen.</p>`;
    $("#weekXlsx").disabled = !w.rows.length;
  } catch (e) { $("#monthStats").innerHTML = `<p class="hint">Saved data cannot be read in this browser. Private browsing blocks it.</p>`; }
}
$("#monthPick").addEventListener("change", renderReports);
$("#weekPick").addEventListener("change", renderReports);
$("#monthXlsx").addEventListener("click", async () => {
  try {
    const ym = $("#monthPick").value, m = await monthData(ym);
    if (!m.count) return toast("No order saved in that month.");
    const cols = [{ h: "Date", k: "date", w: 12 }, { h: "Store", k: "store", w: 38 }, { h: "Store #", k: "no", w: 10 }, { h: "PO", k: "po", w: 14 }, { h: "Contact", k: "contact", w: 22 },
      ...C.products.map(p => ({ h: p.name, k: p.id, w: 14 })), { h: "Total", k: "total", w: 12, fmt: '#,##0.00 "$"' }, { h: "Under $" + C.minimumOrder, k: "under", w: 12 }];
    const rows = m.rows.map(o => Object.assign({ date: o.date, store: o.storeName, no: /^\d+$/.test(o.storeNo) ? Number(o.storeNo) : o.storeNo, po: o.po, contact: o.contact, total: o.total, under: o.total < C.minimumOrder ? "Yes" : "No" },
      Object.fromEntries(C.products.map(p => [p.id, o.qty[p.id] || null]))));
    const price = g => [...new Set(C.products.filter(p => p.group === g).map(p => p.price.toFixed(2) + " $"))].join(" / ");
    const blob = await sheetBlob("Orders " + ym, cols, rows, [
      { values: { store: `${m.count} orders, ${m.stores} stores`, total: m.total, under: m.under + " under" }, bold: true }, { values: {} },
      { values: { store: `Tout-en-un: ${price("Tout-en-un")} per unit. Bars: ${price("Bars")} per case. Rep: ${S.rep}.` } }]);
    const how = await deliver(blob, `Monthly orders ${ym}.xlsx`); if (how === "again") toast("The file is ready. Tap the button once more.");
  } catch (e) { toast("The monthly Excel could not be created. Try again.", true); }
});
$("#weekXlsx").addEventListener("click", async () => {
  try {
    const w = await weekData($("#weekPick").value);
    if (!w.rows.length) return toast("No day saved in that week.");
    const blob = await sheetBlob("Mileage", [{ h: "Date", k: "date", w: 12 }, { h: "Weekday", k: "wd", w: 12 }, { h: "Kilometres", k: "km", w: 12, fmt: "0.0" }, { h: "Stores", k: "stores", w: 90 }],
      w.rows.map(r => ({ date: r.date, wd: weekday(r.date), km: r.km, stores: r.stores.join(", ") })), [{ values: { date: "Total", km: w.total }, bold: true }]);
    const how = await deliver(blob, `Mileage ${w.mon}.xlsx`); if (how === "again") toast("The file is ready. Tap the button once more.");
  } catch (e) { toast("The mileage Excel could not be created. Try again.", true); }
});

/* ---------- backup, rep, new store ---------- */
$("#backupBtn").addEventListener("click", async () => {
  try {
    const ls = {}; for (let i = 0; i < localStorage.length; i++) { const k = localStorage.key(i); if (k.startsWith("fr.")) ls[k] = localStorage.getItem(k); }
    const data = { app: "field-routes", made: new Date().toISOString(), ls, notes: await all("notes"), orders: await all("orders"), mileage: await all("mileage") };
    const how = await deliver(new Blob([JSON.stringify(data)], { type: "application/json" }), `Field routes backup ${today()}.json`);
    if (how === "again") toast("The file is ready. Tap the button once more.");
  } catch (e) { toast("The backup could not be created.", true); }
});
$("#restoreFile").addEventListener("change", async e => {
  const f = e.target.files[0]; e.target.value = ""; if (!f) return;
  try {
    const d = JSON.parse(await f.text()); if (d.app !== "field-routes") throw new Error("not a backup");
    for (const st of ["notes", "orders", "mileage"]) { await tx(st, "readwrite", s => s.clear()); for (const r of d[st] || []) await put(st, r); }
    Object.entries(d.ls || {}).forEach(([k, v]) => localStorage.setItem(k, v));
    toast("Backup restored. Reloading…"); setTimeout(() => location.reload(), 900);
  } catch (x) { toast("That file is not a Field routes backup.", true); }
});
$("#replaceBtn").addEventListener("click", () => { geoStop = true; setTimeout(() => { S.geo = {}; LS.set("geo", S.geo); geoRunning = false; refreshMarkers(); renderStores(); geocodeAll(); toast("Placing every address again. Keep the app open."); }, 1300); });
function paintRep() { $("#repBtn").textContent = S.rep || "Set rep name"; }
$("#repBtn").addEventListener("click", () => {
  openSheet("Rep", `<div class="card"><div class="field"><label for="rName">Your name, as printed on orders</label><input id="rName" type="text" value="${esc(S.rep)}"></div>
    <p class="hint">Notes, orders and kilometres are filed under this name. Another name on this phone sees its own.</p></div>`,
    `<button class="btn primary" id="rSave" type="button">Save</button>`);
  $("#sheetFoot").onclick = async e => {
    if (e.target.id !== "rSave") return; const v = $("#rName").value.trim(); if (!v) return toast("Type a name first.", true);
    S.rep = v; LS.set("rep", v); paintRep(); await refreshDone(); closeSheet(); if (S.tab === "more") renderReports();
  };
});
$("#addStoreBtn").addEventListener("click", () => {
  const regs = [...new Set([...byId.values()].map(regionOf).filter(Boolean))].sort((a, b) => a.localeCompare(b, "fr"));
  const fld = (id, label, extra) => `<div class="field"><label for="${id}">${label}</label><input id="${id}" type="text" ${extra || ""}></div>`;
  openSheet("New store", `<div class="card">${fld("aName", "Store name")}${fld("aAddr", "Street address")}<div class="grid2">${fld("aCity", "City")}${fld("aPostal", "Postal code")}</div>
    <div class="grid2">${fld("aPhone", "Phone", 'inputmode="tel"')}${fld("aNo", "Store number", 'inputmode="numeric"')}</div>
    <div class="field"><label for="aReg">Region</label><select id="aReg"><option value="">Choose</option>${regs.map(r => `<option>${esc(r)}</option>`).join("")}</select></div>
    <p class="hint">Added to the list "${esc(curList().name)}" on this phone.</p></div>`, `<button class="btn primary" id="aSave" type="button">Add store</button>`);
  $("#sheetFoot").onclick = e => {
    if (e.target.id !== "aSave") return; const v = k => $("#" + k).value.trim();
    if (!v("aName")) return toast("The store needs a name.", true);
    const s = { id: "new-" + Date.now(), listId: S.listId, name: v("aName"), address: v("aAddr"), city: v("aCity"), postal: v("aPostal"), phone: v("aPhone"), region: v("aReg"), storeNo: v("aNo"), contact: "", email: "" };
    LS.set("custom", LS.get("custom", []).concat(s)); curList().stores.push(s); byId.set(s.id, s);
    closeSheet(); renderFilters(); renderStores(); geocodeAll(); toast("Store added.");
  };
});

/* ---------- start ---------- */
document.querySelector(".tabs").addEventListener("click", e => { const b = e.target.closest("[data-tab]"); if (b) setTab(b.dataset.tab); });
window.addEventListener("resize", () => map && map.invalidateSize());
(async function start() {
  paintRep(); renderFilters(); initMap(); setTab("stores");
  try { await db(); await refreshDone(); }
  catch (e) { const b = $("#banner"); b.hidden = false; b.textContent = "This browser is blocking saved data (private browsing?). Notes, orders and kilometres will not be kept."; }
  renderStores(); refreshMarkers(true);
  if (infoOk()) measureSoon();
  geocodeAll();
  if ("serviceWorker" in navigator && location.protocol === "https:") navigator.serviceWorker.register("sw.js").catch(() => {});
})();
window.__fr = { S, solveLoop };   // for support and testing
})();
