/* Nigeria Population Explorer — Populace · WorldPop · GRID3 displacement */
"use strict";

// ------------------------------------------------------------------ palette & formatting
// Each mode has its own steps from the same ramps (dark is selected, not inverted).
const THEMES = {
  light: {
    C: {
      populace: "#2a78d6", worldpop: "#eb6834", idps_dest: "#1baf7a", idps_orig: "#c98500",
      rets_dest: "#4a3aa7", rets_orig: "#e87ba4", ink: "#0b0b0b", ink2: "#52514e", muted: "#898781",
      grid: "#e1e0d9", axis: "#c3c2b7", nodata: "#e7e6e1", surface: "#fcfcfb", surface2: "#ffffff",
    },
    // sequential: near-surface light → dark; diverging: red (−) … neutral gray … blue (+)
    SEQ: ["#e4eefb", "#b7d3f6", "#86b6ef", "#5598e7", "#2a78d6", "#1c5cab", "#104281", "#0d366b"],
    DIV: ["#9e2a2b", "#e34948", "#f3b1b0", "#f0efec", "#9ec5f4", "#3987e5", "#104281"],
    basemap: "World_Light_Gray",
  },
  dark: {
    C: {
      populace: "#3987e5", worldpop: "#d95926", idps_dest: "#199e70", idps_orig: "#c98500",
      rets_dest: "#9085e9", rets_orig: "#d55181", ink: "#ffffff", ink2: "#c3c2b7", muted: "#898781",
      grid: "#2c2c2a", axis: "#383835", nodata: "#2c2c2a", surface: "#1a1a19", surface2: "#222220",
    },
    // sequential: near-surface dark → bright; diverging extremes brighten away from a dark-gray midpoint
    SEQ: ["#16263b", "#184f95", "#1c5cab", "#2a78d6", "#5598e7", "#86b6ef", "#b7d3f6", "#e4eefb"],
    DIV: ["#f3b1b0", "#e66767", "#9e2a2b", "#383835", "#1c5cab", "#5598e7", "#b7d3f6"],
    basemap: "World_Dark_Gray",
  },
};
const C = {};
let SEQ, DIV, DARK = false;
function setThemeColors(dark) {
  DARK = dark;
  const t = THEMES[dark ? "dark" : "light"];
  Object.assign(C, t.C); SEQ = t.SEQ; DIV = t.DIV;
}
const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");
function themePref() { try { return localStorage.getItem("nga-theme") || "auto"; } catch (e) { return "auto"; } }
function isDark(pref) { return pref === "dark" || (pref === "auto" && darkQuery.matches); }
setThemeColors(isDark(themePref()));
const VAR_LABEL = {
  idps_dest: "IDPs present (destination)", idps_orig: "IDPs by area of origin",
  rets_dest: "Returnees present (destination)", rets_orig: "Returnees by area of origin",
};

const nf0 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat("en-US", { maximumFractionDigits: 1 });
function fmt(v) { return v == null || !isFinite(v) ? "–" : nf0.format(v); }
function fmtc(v) {
  if (v == null || !isFinite(v)) return "–";
  const a = Math.abs(v);
  if (a >= 1e6) return nf1.format(v / 1e6) + "M";
  if (a >= 1e4) return nf0.format(v / 1e3) + "k";
  if (a >= 1e3) return nf1.format(v / 1e3) + "k";
  return nf0.format(v);
}
function fmts(v, f = fmtc) { return v == null || !isFinite(v) ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + f(Math.abs(v)); }
function pct(v, d = 1) { return v == null || !isFinite(v) ? "–" : (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(d) + "%"; }
function qLabel(q) { return q.slice(0, 4) + " Q" + q.slice(-1); }
function tToDate(t) {
  const y = Math.floor(t), frac = t - y;
  const d = new Date(Date.UTC(y, 0, 1) + frac * 365.25 * 86400000);
  return d.toISOString().slice(0, 10);
}
const $ = (id) => document.getElementById(id);

// ------------------------------------------------------------------ stats helpers
function quantile(arr, q) {
  const a = arr.filter((v) => isFinite(v)).sort((x, y) => x - y);
  if (!a.length) return NaN;
  const pos = (a.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
  return a[lo] + (a[hi] - a[lo]) * (pos - lo);
}
function pearson(x, y) {
  const n = x.length; if (n < 3) return NaN;
  const mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0, syy = 0;
  for (let i = 0; i < n; i++) { const dx = x[i] - mx, dy = y[i] - my; sxy += dx * dy; sxx += dx * dx; syy += dy * dy; }
  return sxy / Math.sqrt(sxx * syy);
}
function ranks(a) {
  const idx = a.map((v, i) => [v, i]).sort((p, q) => p[0] - q[0]);
  const r = new Array(a.length);
  for (let i = 0; i < idx.length;) {
    let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1; for (let k = i; k <= j; k++) r[idx[k][1]] = avg; i = j + 1;
  }
  return r;
}
function spearman(x, y) { return pearson(ranks(x), ranks(y)); }
function ols(x, y) {
  const n = x.length; if (n < 3) return { slope: NaN, intercept: NaN };
  const mx = x.reduce((s, v) => s + v, 0) / n, my = y.reduce((s, v) => s + v, 0) / n;
  let sxy = 0, sxx = 0;
  for (let i = 0; i < n; i++) { sxy += (x[i] - mx) * (y[i] - my); sxx += (x[i] - mx) ** 2; }
  const slope = sxy / sxx; return { slope, intercept: my - slope * mx };
}
function theilSen(x, y) {
  const n = x.length; if (n < 3) return { slope: NaN, intercept: NaN };
  let s = [];
  const step = n > 1500 ? Math.ceil(n / 1500) : 1; // cap work for very large n
  for (let i = 0; i < n; i += step) for (let j = i + 1; j < n; j += step) if (x[j] !== x[i]) s.push((y[j] - y[i]) / (x[j] - x[i]));
  const slope = quantile(s, 0.5);
  const intercept = quantile(y.map((v, i) => v - slope * x[i]), 0.5);
  return { slope, intercept };
}

// ------------------------------------------------------------------ colour scales
function hexToRgb(h) { return [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16)); }
function interpStops(stops, t) {
  t = Math.max(0, Math.min(1, t)) * (stops.length - 1);
  const i = Math.min(Math.floor(t), stops.length - 2), f = t - i;
  const a = hexToRgb(stops[i]), b = hexToRgb(stops[i + 1]);
  return `rgb(${a.map((v, k) => Math.round(v + (b[k] - v) * f)).join(",")})`;
}
function seqScale(values, logScale) {
  const v = values.filter((x) => isFinite(x) && (!logScale || x > 0));
  let lo = quantile(v, 0.02), hi = quantile(v, 0.98);
  if (logScale) { lo = Math.max(lo, 1e-6); }
  if (!(hi > lo)) hi = lo + 1;
  const f = logScale ? Math.log10 : (x) => x;
  return {
    color: (x) => (!isFinite(x) || (logScale && x <= 0) ? C.nodata : interpStops(SEQ, (f(x) - f(lo)) / (f(hi) - f(lo)))),
    lo, hi, stops: SEQ, log: logScale,
  };
}
function divScale(values) {
  const v = values.filter((x) => isFinite(x)).map(Math.abs);
  let lim = quantile(v, 0.95); if (!(lim > 0)) lim = 1;
  return { color: (x) => (!isFinite(x) ? C.nodata : interpStops(DIV, (x + lim) / (2 * lim))), lo: -lim, hi: lim, stops: DIV, div: true };
}

// ------------------------------------------------------------------ data
const D = { pop: {}, geo: {} };
async function getJSON(p) {
  // data/bundle.js inlines everything so the page works when opened directly from disk (file://)
  const name = p.replace(/^data\//, "");
  if (window.NGA_DATA && window.NGA_DATA[name]) return window.NGA_DATA[name];
  const r = await fetch(p); if (!r.ok) throw new Error(p + " " + r.status); return r.json();
}
async function geo(level) { if (!D.geo[level]) D.geo[level] = await getJSON(`data/${level}.geojson`); return D.geo[level]; }
function popAt(row, t) {
  const T = D.meta.quarter_t, P = row.populace;
  if (t <= T[0]) return P[0];
  for (let i = 1; i < T.length; i++) if (t <= T[i]) { const f = (t - T[i - 1]) / (T[i] - T[i - 1]); return P[i - 1] + (P[i] - P[i - 1]) * f; }
  return P[P.length - 1];
}

// ------------------------------------------------------------------ map helpers
function makeMap(id) {
  const m = L.map(id, { zoomSnap: 0.25, preferCanvas: false }).setView([9.1, 8.2], 6);
  const base = L.tileLayer(basemapUrl("Base"), {
    attribution: "Basemap &copy; Esri, HERE, Garmin, &copy; OpenStreetMap contributors", maxZoom: 16,
  }).addTo(m);
  m.createPane("labels"); m.getPane("labels").style.zIndex = 650; m.getPane("labels").style.pointerEvents = "none";
  const labels = L.tileLayer(basemapUrl("Reference"), { pane: "labels", maxZoom: 16 }).addTo(m);
  m.createPane("overlay"); m.getPane("overlay").style.zIndex = 350;
  const legend = L.control({ position: "bottomright" });
  legend.onAdd = () => { const d = L.DomUtil.create("div", "legend"); return d; };
  legend.addTo(m);
  new ResizeObserver(() => m.invalidateSize()).observe(document.getElementById(id));
  return { map: m, legend: legend.getContainer(), layer: null, overlay: null, selected: null, base, labels };
}
function basemapUrl(kind) {
  const name = THEMES[DARK ? "dark" : "light"].basemap;
  return `https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/${name}_${kind}/MapServer/tile/{z}/{y}/{x}`;
}
function setLegend(M, title, sc, fmtFn) {
  let bar = `linear-gradient(to right, ${sc.stops.join(",")})`;
  const lo = sc.lo, hi = sc.hi;
  M.legend.innerHTML = `<div><b>${title}</b></div><div class="bar" style="background:${bar}"></div>
    <div class="ends"><span>${sc.div ? "≤ " : sc.log || sc.clipLo ? "≤ " : ""}${fmtFn(lo)}</span>${sc.div ? "<span>0</span>" : ""}<span>≥ ${fmtFn(hi)}</span></div>
    <div class="nodata"><i></i>No data</div>`;
}
function drawChoropleth(M, gj, valueOf, colorOf, tipOf, onClick, filterKeys) {
  if (M.layer) M.map.removeLayer(M.layer);
  const outlineOnly = !!M.overlay;
  M.layer = L.geoJSON(gj, {
    filter: (f) => !filterKeys || filterKeys.has(f.properties.key),
    style: (f) => {
      const v = valueOf(f.properties.key);
      const sel = M.selected === f.properties.key;
      return {
        color: sel ? C.ink : C.surface, weight: sel ? 2.5 : 0.5, opacity: sel ? 1 : outlineOnly ? 0.7 : 0.9,
        fillColor: colorOf(v), fillOpacity: outlineOnly ? 0 : 0.85,
        ...(outlineOnly && !sel ? { color: C.ink2, weight: 0.4 } : {}),
      };
    },
    onEachFeature: (f, lyr) => {
      lyr.bindTooltip(() => tipOf(f.properties.key), { sticky: true, className: "unit-tip" });
      lyr.on("mouseover", () => { if (M.selected !== f.properties.key) lyr.setStyle({ weight: 1.5, color: C.ink }); });
      lyr.on("mouseout", () => M.layer.resetStyle(lyr));
      lyr.on("click", () => onClick(f.properties.key));
    },
  }).addTo(M.map);
  M.layer.eachLayer((l) => { if (l.feature.properties.key === M.selected) l.bringToFront(); });
}
function restyleSelection(M) {
  if (!M.layer) return;
  M.layer.eachLayer((l) => { M.layer.resetStyle(l); if (l.feature.properties.key === M.selected) l.bringToFront(); });
}
function setOverlay(M, id, opacity) {
  if (M.overlay) { M.map.removeLayer(M.overlay); M.overlay = null; }
  if (!id) return null;
  const o = D.meta.overlays.find((x) => x.id === id);
  M.overlay = L.imageOverlay(`data/rasters/${id}${DARK ? "_dark" : ""}.png`, o.bounds, { opacity: opacity ?? 0.8, pane: "overlay", interactive: false }).addTo(M.map);
  return o;
}
function overlayLegendHTML(o) {
  const lg = o.legend;
  const f = (v) => (lg.type === "log" ? fmtc(v) : (v > 0 ? "+" : "") + fmtc(v));
  return `<div><b>Overlay:</b> ${o.label}
    <div class="bar" style="background:linear-gradient(to right, ${(DARK && lg.colors_dark ? lg.colors_dark : lg.colors).join(",")})"></div>
    <div class="ends"><span>≤ ${f(lg.min)}</span>${lg.type === "linear" ? "<span>0</span>" : ""}<span>≥ ${f(lg.max)}</span></div></div>`;
}

// ------------------------------------------------------------------ plotly defaults
const PCONF = { displaylogo: false, responsive: true, modeBarButtonsToRemove: ["lasso2d", "select2d", "autoScale2d"] };
function baseLayout(extra = {}) {
  const ax = { gridcolor: C.grid, linecolor: C.axis, zerolinecolor: C.axis, tickfont: { color: C.ink2, size: 11 }, titlefont: { color: C.ink2, size: 12 }, automargin: true };
  return Object.assign({
    paper_bgcolor: C.surface, plot_bgcolor: C.surface, font: { family: 'system-ui, -apple-system, "Segoe UI", sans-serif', size: 12, color: C.ink },
    margin: { l: 56, r: 14, t: 10, b: 40 }, hovermode: "closest", showlegend: false,
    hoverlabel: { bgcolor: C.surface2, bordercolor: C.axis, font: { color: C.ink, size: 12 } },
    xaxis: { ...ax }, yaxis: { ...ax },
  }, extra, {
    xaxis: Object.assign({ ...ax }, extra.xaxis || {}),
    yaxis: Object.assign({ ...ax }, extra.yaxis || {}),
  });
}
const legendTop = { showlegend: true, legend: { orientation: "h", x: 0, y: 1.12, font: { size: 11.5, color: C.ink2 } } };

function tiles(el, items) {
  el.innerHTML = items.map((t) => `<div class="tile"><div class="k">${t.k}</div><div class="v">${t.v}</div>${t.d ? `<div class="d">${t.d}</div>` : ""}</div>`).join("");
}
function renderTable(el, cols, rows, onClick, state) {
  state = state || el._state || { key: cols[cols.length - 1].key, dir: -1 };
  el._state = state;
  const sorted = rows.slice().sort((a, b) => {
    const va = a[state.key], vb = b[state.key];
    if (typeof va === "string") return state.dir * va.localeCompare(vb);
    return state.dir * ((isFinite(va) ? va : -Infinity) - (isFinite(vb) ? vb : -Infinity));
  });
  el.innerHTML = `<thead><tr>${cols.map((c) => `<th data-k="${c.key}">${c.label}${state.key === c.key ? (state.dir > 0 ? " ▲" : " ▼") : ""}</th>`).join("")}</tr></thead>
    <tbody>${sorted.slice(0, 200).map((r) => `<tr data-key="${r.key}">${cols.map((c) => `<td>${c.f ? c.f(r[c.key]) : r[c.key] ?? ""}</td>`).join("")}</tr>`).join("")}</tbody>`;
  el.querySelectorAll("th").forEach((th) => th.onclick = () => {
    const k = th.dataset.k; renderTable(el, cols, rows, onClick, { key: k, dir: state.key === k ? -state.dir : -1 });
  });
  el.querySelectorAll("tbody tr").forEach((tr) => tr.onclick = () => onClick(tr.dataset.key));
}

// ================================================================== EXPLORER TAB
const EX = { level: "ocha_adm2", metric: "chg_pct", q: null, from: null, to: null, overlay: "", sel: null };
let exM;
function exMetric(row) {
  const Q = D.meta.quarters, P = row.populace;
  const i = Q.indexOf(EX.q), a = Q.indexOf(EX.from), b = Q.indexOf(EX.to);
  const yrs = D.meta.quarter_t[b] - D.meta.quarter_t[a];
  switch (EX.metric) {
    case "pop": return P[i];
    case "dens": return row.area_km2 > 0 ? P[i] / row.area_km2 : NaN;
    case "chg_abs": return P[b] - P[a];
    case "chg_pct": return P[a] > 0 ? (P[b] / P[a] - 1) * 100 : NaN;
    case "cagr": return P[a] > 0 && yrs > 0 ? (Math.pow(P[b] / P[a], 1 / yrs) - 1) * 100 : NaN;
  }
}
const EX_METRIC_LABEL = { pop: "Population", dens: "People per km²", chg_abs: "Change (people)", chg_pct: "Change (%)", cagr: "Annualised growth (%/yr)" };
function exFmt(v) {
  if (EX.metric === "chg_pct" || EX.metric === "cagr") return pct(v, EX.metric === "cagr" ? 2 : 1);
  if (EX.metric === "chg_abs") return fmts(v);
  return fmtc(v);
}
async function exRender() {
  const isChg = EX.metric.startsWith("chg") || EX.metric === "cagr";
  $("ex-q-wrap").style.display = isChg ? "none" : "";
  $("ex-from-wrap").style.display = $("ex-to-wrap").style.display = isChg ? "" : "none";
  const rows = D.pop[EX.level], gj = await geo(EX.level);
  const vals = {}; for (const k in rows) vals[k] = exMetric(rows[k]);
  const arr = Object.values(vals);
  const sc = isChg ? divScale(arr) : seqScale(arr, true);
  exM.selected = EX.sel;
  const o = setOverlay(exM, EX.overlay, +$("ex-opacity").value);
  drawChoropleth(exM, gj, (k) => vals[k], sc.color, (k) => {
    const r = rows[k]; if (!r) return k;
    return `<b>${r.name}</b>${r.lga ? ", " + r.lga : ""}${r.state && EX.level !== "ocha_adm1" ? ", " + r.state : ""}<br>${EX_METRIC_LABEL[EX.metric]}: <b>${exFmt(vals[k])}</b><br>Populace ${qLabel(D.meta.quarters.at(-1))}: ${fmt(r.populace.at(-1))}`;
  }, (k) => { EX.sel = k; exM.selected = k; restyleSelection(exM); exDetail(); });
  const legendTitle = EX_METRIC_LABEL[EX.metric] + (isChg ? ` · ${qLabel(EX.from)}→${qLabel(EX.to)}` : ` · ${qLabel(EX.q)}`);
  setLegend(exM, legendTitle, sc, exFmt);
  if (o) exM.legend.innerHTML = overlayLegendHTML(o); // polygons are outline-only under an overlay
  exDetail(); exRank();
}
function tsTraces(row, name) {
  const Q = D.meta.quarters;
  const tr = [{
    x: D.meta.quarter_t.map(tToDate), y: row.populace, type: "scatter", mode: "lines+markers", name: "Populace (quarterly)",
    line: { color: C.populace, width: 2 }, marker: { size: 5, color: C.populace },
    customdata: Q.map(qLabel), hovertemplate: "%{customdata}<br>Populace: %{y:,.0f}<extra></extra>",
  }];
  if (row.worldpop) tr.push({
    x: D.meta.wp_t.map(tToDate), y: row.worldpop, type: "scatter", mode: "lines+markers", name: "WorldPop R2025A (annual)",
    line: { color: C.worldpop, width: 2, dash: "dot" }, marker: { size: 8, color: C.worldpop, line: { color: C.surface, width: 2 } },
    customdata: D.meta.wp_years, hovertemplate: "%{customdata}<br>WorldPop: %{y:,.0f}<extra></extra>",
  });
  return tr;
}
function exDetail() {
  const Q = D.meta.quarters, last = Q.length - 1;
  let row, title, sub;
  if (EX.sel && D.pop[EX.level][EX.sel]) {
    row = D.pop[EX.level][EX.sel]; title = row.name;
    sub = [row.lga, row.state].filter(Boolean).join(", ") + (row.area_km2 ? ` · ${fmt(row.area_km2)} km²` : "");
  } else {
    // national = sum of state rows
    const rs = Object.values(D.pop.ocha_adm1);
    row = { populace: Q.map((_, i) => rs.reduce((s, r) => s + r.populace[i], 0)), worldpop: D.meta.wp_years.map((_, i) => rs.reduce((s, r) => s + (r.worldpop ? r.worldpop[i] : 0), 0)), area_km2: rs.reduce((s, r) => s + r.area_km2, 0) };
    title = "Nigeria"; sub = "Sum of all states · click a unit to drill in";
  }
  $("ex-sel-title").textContent = title; $("ex-sel-sub").textContent = sub;
  const P = row.populace, a = Q.indexOf(EX.from), b = Q.indexOf(EX.to);
  const yrs = D.meta.quarter_t[b] - D.meta.quarter_t[a];
  const wpLast = row.worldpop ? row.worldpop.at(-1) : null;
  tiles($("ex-tiles"), [
    { k: `Populace ${qLabel(Q[last])}`, v: fmtc(P[last]), d: row.area_km2 ? `${fmt(P[last] / row.area_km2)} /km²` : "" },
    { k: `Change ${qLabel(EX.from)}→${qLabel(EX.to)}`, v: pct((P[b] / P[a] - 1) * 100), d: fmts(P[b] - P[a]) + " people" },
    { k: "Annualised", v: pct((Math.pow(P[b] / P[a], 1 / yrs) - 1) * 100, 2), d: "per year" },
    { k: "WorldPop 2025", v: fmtc(wpLast), d: wpLast ? `Populace Q2 is ${pct((P[last] / wpLast - 1) * 100)} vs WP` : "" },
  ]);
  Plotly.react("ex-ts", tsTraces(row), baseLayout({ ...legendTop, hovermode: "x unified", margin: { l: 60, r: 14, t: 28, b: 36 }, yaxis: { title: "People", rangemode: "tozero" } }), PCONF);
}
function exRank() {
  const Q = D.meta.quarters, a = Q.indexOf(EX.from), b = Q.indexOf(EX.to), rows = D.pop[EX.level];
  const yrs = D.meta.quarter_t[b] - D.meta.quarter_t[a];
  const data = Object.entries(rows).map(([k, r]) => ({
    key: k, name: r.name, state: EX.level === "ocha_adm1" ? "" : (r.lga ? r.lga + ", " : "") + (r.state || ""),
    pa: r.populace[a], pb: r.populace[b], d: r.populace[b] - r.populace[a],
    p: r.populace[a] > 0 ? (r.populace[b] / r.populace[a] - 1) * 100 : NaN,
    g: r.populace[a] > 0 ? (Math.pow(r.populace[b] / r.populace[a], 1 / yrs) - 1) * 100 : NaN,
  }));
  $("ex-rank-title").textContent = `Change ${qLabel(EX.from)}→${qLabel(EX.to)} by unit (click a header to sort)`;
  renderTable($("ex-rank"), [
    { key: "name", label: "Unit" }, { key: "state", label: "Within" },
    { key: "pa", label: qLabel(EX.from), f: fmt }, { key: "pb", label: qLabel(EX.to), f: fmt },
    { key: "d", label: "Δ people", f: (v) => fmts(v, fmt) }, { key: "g", label: "%/yr", f: (v) => pct(v, 2) },
    { key: "p", label: "Δ %", f: (v) => pct(v) },
  ], data, (k) => { EX.sel = k; exM.selected = k; restyleSelection(exM); exDetail(); zoomTo(exM, k); }, $("ex-rank")._state && $("ex-rank")._level === EX.level ? $("ex-rank")._state : { key: "p", dir: -1 });
  $("ex-rank")._level = EX.level;
}
function zoomTo(M, key) {
  if (!M.layer) return;
  M.layer.eachLayer((l) => { if (l.feature.properties.key === key) M.map.fitBounds(l.getBounds(), { maxZoom: 10, padding: [40, 40] }); });
}
function exNational() {
  const n = D.meta.national, Q = D.meta.quarters;
  const tr = [
    { x: D.meta.quarter_t.map(tToDate), y: n.populace_raster_total, name: "Populace (raster total)", type: "scatter", mode: "lines+markers", line: { color: C.populace, width: 2 }, marker: { size: 5 }, customdata: Q.map(qLabel), hovertemplate: "%{customdata}: %{y:,.0f}<extra>Populace</extra>" },
  ];
  if (n.worldpop_raster_total) tr.push({ x: D.meta.wp_t.map(tToDate), y: n.worldpop_raster_total, name: "WorldPop R2025A constrained", type: "scatter", mode: "lines+markers", line: { color: C.worldpop, width: 2, dash: "dot" }, marker: { size: 8, line: { color: C.surface, width: 2 } }, customdata: D.meta.wp_years, hovertemplate: "%{customdata}: %{y:,.0f}<extra>WorldPop</extra>" });
  Plotly.react("ex-nat", tr, baseLayout({ ...legendTop, hovermode: "x unified", margin: { l: 60, r: 14, t: 28, b: 36 }, yaxis: { title: "People" } }), PCONF);
  const p0 = n.populace_raster_total[0], p1 = n.populace_raster_total.at(-1);
  const yrs = D.meta.quarter_t.at(-1) - D.meta.quarter_t[0];
  $("ex-nat-note").textContent = `Populace national total grows from ${fmtc(p0)} (${qLabel(Q[0])}) to ${fmtc(p1)} (${qLabel(Q.at(-1))}), ${pct((Math.pow(p1 / p0, 1 / yrs) - 1) * 100, 2)}/yr.` +
    (n.worldpop_raster_total ? ` WorldPop: ${fmtc(n.worldpop_raster_total[0])} (2020) → ${fmtc(n.worldpop_raster_total.at(-1))} (2025).` : "") +
    ` Populace inside OCHA LGA polygons = ${(100 * n.populace_in_adm2.at(-1) / p1).toFixed(2)}% of raster total.`;
}
function initExplorer() {
  const Q = D.meta.quarters;
  const opts = Q.map((q) => `<option value="${q}">${qLabel(q)}</option>`).join("");
  $("ex-q").innerHTML = $("ex-from").innerHTML = $("ex-to").innerHTML = opts;
  EX.q = Q.at(-1); EX.from = Q[0]; EX.to = Q.at(-1);
  $("ex-q").value = EX.q; $("ex-from").value = EX.from; $("ex-to").value = EX.to;
  D.meta.overlays.forEach((o) => { for (const id of ["ex-overlay", "cp-overlay"]) $(id).insertAdjacentHTML("beforeend", `<option value="${o.id}">${o.label}</option>`); });
  exM = makeMap("ex-map");
  $("ex-level").onchange = (e) => { EX.level = e.target.value; EX.sel = null; exRender(); };
  $("ex-metric").onchange = (e) => { EX.metric = e.target.value; exRender(); };
  $("ex-q").onchange = (e) => { EX.q = e.target.value; exRender(); };
  $("ex-from").onchange = (e) => { EX.from = e.target.value; exRender(); };
  $("ex-to").onchange = (e) => { EX.to = e.target.value; exRender(); };
  $("ex-overlay").onchange = (e) => { EX.overlay = e.target.value; exRender(); };
  $("ex-opacity").oninput = (e) => { if (exM.overlay) exM.overlay.setOpacity(+e.target.value); };
  exNational();
  return exRender();
}

// ================================================================== COMPARE TAB
const CP = { level: "ocha_adm2", year: 2025, metric: "pct", overlay: "", sel: null };
let cpM;
function cpRow(r) {
  const Q = D.meta.quarters, yi = D.meta.wp_years.indexOf(CP.year), qi = Q.indexOf(`${CP.year}q2`), q0 = Q.indexOf("2020q2");
  const P = r.populace[qi], W = r.worldpop ? r.worldpop[yi] : NaN;
  const yrs = CP.year - 2020;
  const gP = yrs > 0 && r.populace[q0] > 0 ? (Math.pow(P / r.populace[q0], 1 / yrs) - 1) * 100 : NaN;
  const gW = yrs > 0 && r.worldpop && r.worldpop[0] > 0 ? (Math.pow(W / r.worldpop[0], 1 / yrs) - 1) * 100 : NaN;
  return { P, W, pct: W > 0 ? (P / W - 1) * 100 : NaN, abs: P - W, gP, gW, growth: gP - gW };
}
async function cpRender() {
  const rows = D.pop[CP.level], gj = await geo(CP.level);
  const calc = {}; for (const k in rows) calc[k] = cpRow(rows[k]);
  // % difference is asymmetric (floor −100%), so colour it on log2(Populace / WorldPop)
  const valOf = (k) => !calc[k] ? NaN : CP.metric === "pct" ? (calc[k].P > 0 && calc[k].W > 0 ? Math.log2(calc[k].P / calc[k].W) : NaN) : calc[k][CP.metric];
  const sc = divScale(Object.keys(calc).map(valOf));
  const f = CP.metric === "pct" ? (v) => pct((Math.pow(2, v) - 1) * 100, 0) : CP.metric === "abs" ? (v) => fmts(v) : (v) => (v > 0 ? "+" : "") + (isFinite(v) ? v.toFixed(2) : "–") + " pp";
  cpM.selected = CP.sel;
  const o = setOverlay(cpM, CP.overlay, 0.85);
  drawChoropleth(cpM, gj, valOf, sc.color, (k) => {
    const r = rows[k], c = calc[k]; if (!r) return k;
    return `<b>${r.name}</b>${r.state && CP.level !== "ocha_adm1" ? ", " + r.state : ""}<br>Populace ${CP.year} Q2: ${fmt(c.P)}<br>WorldPop ${CP.year}: ${fmt(c.W)}<br>Difference: <b>${pct(c.pct)}</b> (${fmts(c.abs)})` +
      (CP.year > 2020 ? `<br>Growth since 2020: Populace ${pct(c.gP, 2)}/yr · WorldPop ${pct(c.gW, 2)}/yr` : "");
  }, (k) => { CP.sel = k; cpM.selected = k; restyleSelection(cpM); cpCharts(calc, rows); });
  const titles = { pct: `Populace vs WorldPop, ${CP.year} (%)`, abs: `Populace − WorldPop, ${CP.year} (people)`, growth: `Growth difference 2020→${CP.year} (Populace − WorldPop, pp/yr)` };
  setLegend(cpM, titles[CP.metric] + (sc.div ? "<br><span style='font-weight:400'>blue = Populace higher · red = WorldPop higher</span>" : ""), sc, f);
  if (o) cpM.legend.innerHTML = overlayLegendHTML(o);
  cpCharts(calc, rows);
}
function cpCharts(calc, rows) {
  const keys = Object.keys(calc).filter((k) => calc[k].P > 0 && calc[k].W > 0);
  const x = keys.map((k) => calc[k].W), y = keys.map((k) => calc[k].P);
  const lx = x.map(Math.log10), ly = y.map(Math.log10);
  const r = pearson(lx, ly);
  const totP = keys.reduce((s, k) => s + calc[k].P, 0), totW = keys.reduce((s, k) => s + calc[k].W, 0);
  const mad = quantile(keys.map((k) => Math.abs(calc[k].pct)), 0.5);
  const within10 = keys.filter((k) => Math.abs(calc[k].pct) <= 10).length / keys.length * 100;
  tiles($("cp-tiles"), [
    { k: `Populace ${CP.year} Q2 (sum)`, v: fmtc(totP) }, { k: `WorldPop ${CP.year} (sum)`, v: fmtc(totW), d: `Populace ${pct((totP / totW - 1) * 100)}` },
    { k: "Median |% diff|", v: isFinite(mad) ? mad.toFixed(1) + "%" : "–", d: `${within10.toFixed(0)}% of units within ±10%` },
    { k: "r (log–log)", v: isFinite(r) ? r.toFixed(3) : "–", d: `${keys.length} units` },
  ]);
  const names = keys.map((k) => rows[k].name + (rows[k].state && CP.level !== "ocha_adm1" ? ", " + rows[k].state : ""));
  const lo = Math.min(...x, ...y) * 0.8, hi = Math.max(...x, ...y) * 1.2;
  const selIdx = keys.indexOf(CP.sel);
  const traces = [
    { x: [lo, hi], y: [lo, hi], mode: "lines", line: { color: C.muted, width: 1, dash: "dash" }, hoverinfo: "skip", name: "1:1" },
    { x, y, mode: "markers", type: "scatter", customdata: keys, text: names, name: "Units",
      marker: { size: 7, color: C.populace, opacity: 0.6, line: { color: C.surface, width: 1 } },
      hovertemplate: "<b>%{text}</b><br>WorldPop: %{x:,.0f}<br>Populace: %{y:,.0f}<extra></extra>" },
  ];
  if (selIdx >= 0) traces.push({ x: [x[selIdx]], y: [y[selIdx]], mode: "markers", marker: { size: 13, color: "rgba(0,0,0,0)", line: { color: C.ink, width: 2 } }, hoverinfo: "skip" });
  Plotly.react("cp-scatter", traces, baseLayout({
    xaxis: { type: "log", title: `WorldPop ${CP.year}` }, yaxis: { type: "log", title: `Populace ${CP.year} Q2` },
  }), PCONF);
  $("cp-scatter").removeAllListeners?.("plotly_click");
  $("cp-scatter").on("plotly_click", (ev) => { const k = ev.points[0].customdata; if (k) { CP.sel = k; cpM.selected = k; restyleSelection(cpM); cpCharts(calc, rows); zoomTo(cpM, k); } });

  // growth scatter
  if (CP.year > 2020) {
    const gk = keys.filter((k) => isFinite(calc[k].gP) && isFinite(calc[k].gW));
    const gx = gk.map((k) => calc[k].gW), gy = gk.map((k) => calc[k].gP);
    const xl = [quantile(gx, 0.005), quantile(gx, 0.995)], yl = [quantile(gy, 0.005), quantile(gy, 0.995)];
    const lim = [Math.min(xl[0], yl[0]), Math.max(xl[1], yl[1])];
    const gr = pearson(gx, gy);
    const sdx = Math.sqrt(gx.reduce((s, v) => s + (v - gx.reduce((a, b) => a + b, 0) / gx.length) ** 2, 0) / gx.length);
    const sdy = Math.sqrt(gy.reduce((s, v) => s + (v - gy.reduce((a, b) => a + b, 0) / gy.length) ** 2, 0) / gy.length);
    Plotly.react("cp-growth", [
      { x: lim, y: lim, mode: "lines", line: { color: C.muted, width: 1, dash: "dash" }, hoverinfo: "skip" },
      { x: gx, y: gy, mode: "markers", customdata: gk, text: gk.map((k) => rows[k].name), marker: { size: 7, color: C.populace, opacity: 0.6, line: { color: C.surface, width: 1 } },
        hovertemplate: "<b>%{text}</b><br>WorldPop: %{x:.2f}%/yr<br>Populace: %{y:.2f}%/yr<extra></extra>" },
    ], baseLayout({
      xaxis: { title: `WorldPop growth 2020→${CP.year} (%/yr)`, range: [xl[0] - 0.3, xl[1] + 0.3] },
      yaxis: { title: `Populace growth 2020Q2→${CP.year}Q2 (%/yr)`, range: [yl[0] - 0.3, yl[1] + 0.3] },
      annotations: [{ xref: "paper", yref: "paper", x: 0.01, y: 0.99, xanchor: "left", showarrow: false, text: `r = ${gr.toFixed(2)} · n = ${gk.length} · spread (SD) across units: WorldPop ${sdx.toFixed(2)} pp, Populace ${sdy.toFixed(2)} pp`, font: { color: C.ink2, size: 12 } }],
    }), PCONF);
  } else {
    Plotly.react("cp-growth", [], baseLayout({ annotations: [{ text: "Choose a year after 2020 to compare growth rates", showarrow: false, xref: "paper", yref: "paper", x: 0.5, y: 0.5, font: { color: C.muted } }], xaxis: { visible: false }, yaxis: { visible: false } }), PCONF);
  }

  const data = keys.map((k) => ({ key: k, name: rows[k].name, state: CP.level === "ocha_adm1" ? "" : rows[k].state || "", P: calc[k].P, W: calc[k].W, abs: calc[k].abs, pct: calc[k].pct, apct: Math.abs(calc[k].pct) }));
  renderTable($("cp-table"), [
    { key: "name", label: "Unit" }, { key: "state", label: "State" }, { key: "P", label: `Populace ${CP.year}Q2`, f: fmt }, { key: "W", label: `WorldPop ${CP.year}`, f: fmt },
    { key: "abs", label: "Δ people", f: (v) => fmts(v, fmt) }, { key: "pct", label: "Δ %", f: (v) => pct(v) }, { key: "apct", label: "|Δ %|", f: (v) => v.toFixed(1) },
  ], data, (k) => { CP.sel = k; cpM.selected = k; restyleSelection(cpM); cpCharts(calc, rows); zoomTo(cpM, k); }, $("cp-table")._state || { key: "apct", dir: -1 });
}
function initCompare() {
  $("cp-year").innerHTML = D.meta.wp_years.map((y) => `<option ${y === 2025 ? "selected" : ""}>${y}</option>`).join("");
  cpM = makeMap("cp-map");
  $("cp-level").onchange = (e) => { CP.level = e.target.value; CP.sel = null; $("cp-table")._state = null; cpRender(); };
  $("cp-year").onchange = (e) => { CP.year = +e.target.value; cpRender(); };
  $("cp-metric").onchange = (e) => { CP.metric = e.target.value; cpRender(); };
  $("cp-overlay").onchange = (e) => { CP.overlay = e.target.value; cpRender(); };
  return cpRender();
}

// ================================================================== DISPLACEMENT TAB
const DP = { region: "ne", level: "adm3", var: "idps_dest", a: null, b: null, mapMetric: "d_disp", zero: false, norm: false, sel: null };
let dpM;
function dpData() { return D.disp[DP.region][DP.level]; }
function dpRounds() { return dpData().vars[DP.var]; }
function dpCompute() {
  const d = dpData(), R = dpRounds(), ia = R.findIndex((r) => r.code === DP.a), ib = R.findIndex((r) => r.code === DP.b);
  const tA = R[ia].t, tB = R[ib].t, popRows = D.pop["g3_" + DP.level];
  const out = {};
  for (const [k, u] of Object.entries(d.units)) {
    const s = u[DP.var]; const pr = popRows[k];
    if (!s || !pr) continue;
    let a = s[ia], b = s[ib];
    if (DP.zero) { a = a ?? 0; b = b ?? 0; }
    const pA = popAt(pr, tA), pB = popAt(pr, tB);
    const ok = a != null && b != null;
    const dDisp = ok ? b - a : NaN, dPop = pB - pA;
    const n = DP.norm ? 100 / pA : 1;
    out[k] = { a, b, pA, pB, dDisp: dDisp * n, dPop: dPop * n, rawDDisp: dDisp, rawDPop: dPop, ok, share: b != null && pB > 0 ? (b / pB) * 100 : NaN, resid: (dPop - dDisp) * n };
  }
  return { out, tA, tB, ia, ib };
}
function dpUnitName(k) {
  const r = D.pop["g3_" + DP.level][k];
  return r ? (r.ward ? `${r.ward}, ${r.lga}, ${r.state}` : `${r.lga}, ${r.state}`) : k;
}
async function dpRender() {
  const gj = await geo("g3_" + DP.level);
  const { out, ia, ib } = dpCompute();
  const R = dpRounds();
  const keys = new Set(Object.keys(out));
  const valOf = (k) => { const o = out[k]; if (!o) return NaN; return { d_disp: o.ok ? o.dDisp : NaN, d_pop: o.dPop, resid: o.ok ? o.resid : NaN, share: o.share }[DP.mapMetric]; };
  const vals = [...keys].map(valOf);
  const sc = DP.mapMetric === "share" ? seqScale(vals, true) : divScale(vals);
  const unit = DP.norm ? "% of pop." : "people";
  const ff = DP.mapMetric === "share" ? (v) => (isFinite(v) ? (v < 1 ? v.toFixed(2) : v.toFixed(1)) + "%" : "–") : DP.norm ? (v) => pct(v, 2) : (v) => fmts(v);
  dpM.selected = DP.sel;
  drawChoropleth(dpM, gj, valOf, sc.color, (k) => {
    const o = out[k];
    return `<b>${dpUnitName(k)}</b><br>${VAR_LABEL[DP.var]}: ${fmt(o.a)} (${R[ia].label}) → ${fmt(o.b)} (${R[ib].label})<br>Δ displaced: <b>${o.ok ? fmts(o.rawDDisp, fmt) : "n/a"}</b><br>Populace: ${fmt(o.pA)} → ${fmt(o.pB)} (Δ <b>${fmts(o.rawDPop, fmt)}</b>)` +
      (isFinite(o.share) ? `<br>Displaced share of pop. (B): ${o.share.toFixed(1)}%` : "");
  }, (k) => dpSelect(k), keys);
  const mt = { d_disp: `Δ ${VAR_LABEL[DP.var]} (${unit})`, d_pop: `Δ Populace (${unit})`, resid: `Δ Populace − Δ displaced (${unit})`, share: `${VAR_LABEL[DP.var]} as % of Populace` }[DP.mapMetric];
  setLegend(dpM, `${mt}<br><span style="font-weight:400">${R[ia].label} → ${R[ib].label}</span>`, sc, ff);
  if (!dpM._fitted || dpM._fitted !== DP.region + DP.level) { dpM.map.fitBounds(dpM.layer.getBounds(), { padding: [10, 10] }); dpM._fitted = DP.region + DP.level; }
  dpScatter(out); dpBins(out); dpRegionTS(); dpDetail();
}
function dpScatter(out) {
  const R = dpRounds(), ia = R.findIndex((r) => r.code === DP.a), ib = R.findIndex((r) => r.code === DP.b);
  const keys = Object.keys(out).filter((k) => out[k].ok && isFinite(out[k].dPop) && isFinite(out[k].dDisp));
  const x = keys.map((k) => out[k].dDisp), y = keys.map((k) => out[k].dPop);
  const fit = ols(x, y), ts = theilSen(x, y), r = pearson(x, y), rho = spearman(x, y);
  const totD = keys.reduce((s, k) => s + out[k].rawDDisp, 0), totP = keys.reduce((s, k) => s + out[k].rawDPop, 0);
  const over = Object.values(out).filter((o) => o.b != null && o.b > o.pB).length;
  tiles($("dp-tiles"), [
    { k: "Units compared", v: fmt(keys.length), d: `${Object.keys(out).length - keys.length} lack one round` },
    { k: "Pearson r / Spearman ρ", v: `${isFinite(r) ? r.toFixed(2) : "–"} / ${isFinite(rho) ? rho.toFixed(2) : "–"}` },
    { k: "Slope (OLS · Theil–Sen)", v: `${isFinite(fit.slope) ? fit.slope.toFixed(2) : "–"} · ${isFinite(ts.slope) ? ts.slope.toFixed(2) : "–"}`, d: "Populace Δ per displaced Δ; 1 = full tracking" },
    { k: "Σ Δ displaced vs Σ Δ Populace", v: `${fmts(totD)} / ${fmts(totP)}`, d: "people, across compared units" },
    { k: "Displaced > Populace pop. (B)", v: fmt(over), d: `units where the count exceeds Populace's total — displaced people likely missing from Populace` },
  ]);
  const xl = [quantile(x, 0.01), quantile(x, 0.99)], yl = [quantile(y, 0.01), quantile(y, 0.99)];
  const pad = (l) => { const w = (l[1] - l[0]) || 1; return [l[0] - 0.08 * w, l[1] + 0.08 * w]; };
  const xr = pad(xl), yr = pad(yl);
  const names = keys.map(dpUnitName);
  const selIdx = keys.indexOf(DP.sel);
  const unit = DP.norm ? " (% of pop. at A)" : " (people)";
  const xs = [Math.min(...x), Math.max(...x)];
  const traces = [
    { x: xs, y: xs, mode: "lines", line: { color: C.muted, width: 1, dash: "dash" }, name: "1:1 (full tracking)", hoverinfo: "skip" },
    { x: xs, y: xs.map((v) => ts.intercept + ts.slope * v), mode: "lines", line: { color: C.ink2, width: 2 }, name: `Theil–Sen fit (slope ${ts.slope.toFixed(2)})`, hoverinfo: "skip" },
    { x, y, mode: "markers", customdata: keys, text: names, name: "Units",
      marker: { size: 7, color: C.idps_dest, opacity: 0.65, line: { color: C.surface, width: 1 } },
      hovertemplate: `<b>%{text}</b><br>Δ displaced: %{x:,.${DP.norm ? 2 : 0}f}<br>Δ Populace: %{y:,.${DP.norm ? 2 : 0}f}<extra></extra>` },
  ];
  if (selIdx >= 0) traces.push({ x: [x[selIdx]], y: [y[selIdx]], mode: "markers", marker: { size: 14, color: "rgba(0,0,0,0)", line: { color: C.ink, width: 2 } }, hoverinfo: "skip", showlegend: false });
  Plotly.react("dp-scatter", traces, baseLayout({
    ...legendTop, legend: { orientation: "h", x: 0, y: 1.1, font: { size: 11, color: C.ink2 } }, margin: { l: 64, r: 14, t: 34, b: 44 },
    xaxis: { title: `Δ ${VAR_LABEL[DP.var]}, ${R[ia].label}→${R[ib].label}${unit}`, range: xr, zeroline: true },
    yaxis: { title: `Δ Populace (same dates)${unit}`, range: yr, zeroline: true },
  }), PCONF);
  $("dp-scatter").removeAllListeners?.("plotly_click");
  $("dp-scatter").on("plotly_click", (ev) => { const k = ev.points[0].customdata; if (k) dpSelect(k, true); });
  const unk = Object.values(dpData().unknown_ward || {}).reduce((s, u) => s + ((u[DP.var] || [])[ib] || 0), 0);
  $("dp-scatter-note").innerHTML = `Axes initially clipped to the 1st–99th percentile; double-click the chart to show all points. Populace values are linearly interpolated between quarterly mid-points to each DTM round date.` +
    (DP.level === "adm3" && unk > 0 ? ` ${fmt(unk)} ${VAR_LABEL[DP.var].toLowerCase()} in ${R[ib].label} are recorded with an unknown ward and excluded at ward level (they are included in the LGA view).` : "");
}
function dpBins(out) {
  const keys = Object.keys(out).filter((k) => out[k].ok && isFinite(out[k].dPop));
  const neg = keys.filter((k) => out[k].dDisp < 0), pos = keys.filter((k) => out[k].dDisp > 0), zero = keys.filter((k) => out[k].dDisp === 0);
  const mn = quantile(neg.map((k) => out[k].dDisp), 0.5), mp = quantile(pos.map((k) => out[k].dDisp), 0.5);
  const unitF = DP.norm ? (v) => pct(v, 1) : (v) => fmts(v);
  const groups = [
    { name: `Large decrease<br>(< ${unitF(mn)})`, ks: neg.filter((k) => out[k].dDisp < mn) },
    { name: `Small decrease`, ks: neg.filter((k) => out[k].dDisp >= mn) },
    { name: "No change", ks: zero },
    { name: `Small increase`, ks: pos.filter((k) => out[k].dDisp <= mp) },
    { name: `Large increase<br>(> ${unitF(mp)})`, ks: pos.filter((k) => out[k].dDisp > mp) },
  ].filter((g) => g.ks.length);
  const med = groups.map((g) => quantile(g.ks.map((k) => out[k].dPop), 0.5));
  const q1 = groups.map((g) => quantile(g.ks.map((k) => out[k].dPop), 0.25));
  const q3 = groups.map((g) => quantile(g.ks.map((k) => out[k].dPop), 0.75));
  const medD = groups.map((g) => quantile(g.ks.map((k) => out[k].dDisp), 0.5));
  Plotly.react("dp-bins", [{
    type: "bar", x: groups.map((g) => g.name), y: med, marker: { color: C.populace }, width: 0.5,
    error_y: { type: "data", symmetric: false, array: q3.map((v, i) => v - med[i]), arrayminus: med.map((v, i) => v - q1[i]), color: C.ink2, thickness: 1.5, width: 4 },
    customdata: groups.map((g, i) => [g.ks.length, medD[i], q1[i], q3[i]]),
    hovertemplate: `n = %{customdata[0]}<br>median Δ displaced: %{customdata[1]:,.${DP.norm ? 2 : 0}f}<br>median Δ Populace: %{y:,.${DP.norm ? 2 : 0}f}<br>IQR: %{customdata[2]:,.${DP.norm ? 2 : 0}f} to %{customdata[3]:,.${DP.norm ? 2 : 0}f}<extra></extra>`,
  }], baseLayout({ yaxis: { title: `Median Δ Populace${DP.norm ? " (% of pop.)" : " (people)"}`, zeroline: true }, xaxis: { tickfont: { size: 11 } }, margin: { l: 64, r: 14, t: 10, b: 56 },
    annotations: groups.map((g, i) => ({ x: g.name, y: 0, yref: "y", text: `n=${g.ks.length}`, showarrow: false, yshift: med[i] >= 0 ? -10 : 10, font: { size: 10.5, color: C.muted } })),
  }), PCONF);
}
function dpRegionTS() {
  // index Populace and displaced totals to the first round = 100 (shared base, one axis)
  // same unit set as the scatter (units with values at both A and B), so coverage changes don't create jumps
  const d = dpData(), R = dpRounds(), popRows = D.pop["g3_" + DP.level];
  const ia = R.findIndex((r) => r.code === DP.a), ib = R.findIndex((r) => r.code === DP.b);
  const keys = Object.keys(d.units).filter((k) => {
    const s = d.units[k][DP.var] || []; return popRows[k] && (DP.zero || (s[ia] != null && s[ib] != null));
  });
  // skip rounds that cover <90% of these units — a sparse round would show as a fake drop
  const covered = R.map((_, i) => DP.zero || keys.filter((k) => (d.units[k][DP.var] || [])[i] != null).length >= 0.9 * keys.length);
  const dispTot = R.map((_, i) => covered[i] ? keys.reduce((s, k) => s + ((d.units[k][DP.var] || [])[i] || 0), 0) : null);
  const popQ = D.meta.quarters.map((_, i) => keys.reduce((s, k) => s + popRows[k].populace[i], 0));
  const popAtR = R.map((r) => popAt({ populace: popQ }, r.t));
  const base = ia; if (!(dispTot[base] > 0)) { Plotly.purge("dp-region-ts"); return; }
  const pBase = popAtR[base];
  const tr = [
    { x: D.meta.quarter_t.map(tToDate), y: popQ.map((v) => (v / pBase) * 100), mode: "lines", name: `Populace (same ${keys.length} units)`, line: { color: C.populace, width: 2 },
      customdata: popQ, hovertemplate: "Populace index %{y:.1f}<br>%{customdata:,.0f} people<extra></extra>" },
    { x: R.map((r) => tToDate(r.t)), y: dispTot.map((v) => (v == null ? null : (v / dispTot[base]) * 100)), connectgaps: true, mode: "lines+markers", name: VAR_LABEL[DP.var], line: { color: C[DP.var], width: 2 }, marker: { size: 8, line: { color: C.surface, width: 2 } },
      customdata: R.map((r, i) => [r.label, dispTot[i]]), hovertemplate: "%{customdata[0]}: index %{y:.1f}<br>%{customdata[1]:,.0f} people<extra></extra>" },
  ];
  Plotly.react("dp-region-ts", tr, baseLayout({ ...legendTop, legend: { orientation: "h", x: 0, y: 1.18, font: { size: 11, color: C.ink2 } }, margin: { l: 56, r: 14, t: 30, b: 32 },
    yaxis: { title: `Index (${R[base].label} = 100)` }, xaxis: { range: ["2020-01-01", "2025-09-01"] } }), PCONF);
}
function dpSelect(k, zoom) {
  DP.sel = k; dpM.selected = k; restyleSelection(dpM); if (zoom) zoomTo(dpM, k);
  const { out } = dpCompute(); dpScatter(out); dpDetail();
}
function dpDetail() {
  const k = DP.sel, popRows = D.pop["g3_" + DP.level], d = dpData();
  const xr = ["2020-03-01", "2025-08-01"];
  const R = dpRounds(), ra = R.find((r) => r.code === DP.a), rb = R.find((r) => r.code === DP.b);
  const shapes = [ra, rb].map((r) => ({ type: "line", xref: "x", yref: "paper", x0: tToDate(r.t), x1: tToDate(r.t), y0: 0, y1: 1, line: { color: C.axis, width: 1, dash: "dot" } }));
  if (!k || !popRows[k] || !d.units[k]) {
    $("dp-sel-title").textContent = "Select a unit"; $("dp-sel-sub").textContent = "Click a ward/LGA on the map or a dot in the scatter";
    Plotly.purge("dp-ts-pop"); Plotly.purge("dp-ts-disp"); return;
  }
  const pr = popRows[k], u = d.units[k];
  $("dp-sel-title").textContent = dpUnitName(k);
  $("dp-sel-sub").innerHTML = `GRID3 id ${k}` + (pr.grid3_2025 ? ` · GRID3 2025 population ${fmt(pr.grid3_2025)}` : "") + ` · Populace ${qLabel(D.meta.quarters.at(-1))}: ${fmt(pr.populace.at(-1))}`;
  const pt = tsTraces(pr);
  pt.push({ x: R.map((r) => tToDate(r.t)), y: R.map((r) => popAt(pr, r.t)), mode: "markers", name: "Populace at DTM rounds", marker: { symbol: "line-ns-open", size: 12, color: C.ink2, line: { width: 2 } }, customdata: R.map((r) => r.label), hovertemplate: "%{customdata}: %{y:,.0f}<extra>interpolated</extra>" });
  Plotly.react("dp-ts-pop", pt, baseLayout({ ...legendTop, legend: { orientation: "h", x: 0, y: 1.22, font: { size: 11, color: C.ink2 } }, hovermode: "x unified", margin: { l: 60, r: 14, t: 34, b: 24 }, xaxis: { range: xr }, yaxis: { title: "Population", rangemode: "tozero" }, shapes }), PCONF);
  const dt = Object.keys(d.vars).map((v) => ({
    x: d.vars[v].map((r) => tToDate(r.t)), y: u[v], name: VAR_LABEL[v], mode: "lines+markers", connectgaps: false,
    line: { color: C[v], width: v === DP.var ? 2.5 : 1.5 }, marker: { size: v === DP.var ? 9 : 6, color: C[v], line: { color: C.surface, width: 2 } },
    customdata: d.vars[v].map((r) => r.label), hovertemplate: "%{customdata}: %{y:,.0f}<extra>" + VAR_LABEL[v] + "</extra>",
  })).filter((t) => t.y.some((v) => v != null));
  Plotly.react("dp-ts-disp", dt, baseLayout({ ...legendTop, legend: { orientation: "h", x: 0, y: 1.25, font: { size: 11, color: C.ink2 } }, margin: { l: 60, r: 14, t: 38, b: 30 }, xaxis: { range: xr }, yaxis: { title: "Displaced persons", rangemode: "tozero" }, shapes }), PCONF);
}
function dpSetRounds() {
  const R = dpRounds();
  const opts = R.map((r) => `<option value="${r.code}">${r.label}</option>`).join("");
  $("dp-a").innerHTML = $("dp-b").innerHTML = opts;
  // default A = earliest round with reasonable coverage (some early rounds cover few units)
  const units = Object.values(dpData().units);
  const cover = R.map((_, i) => units.filter((u) => (u[DP.var] || [])[i] != null).length);
  const maxC = Math.max(...cover);
  DP.a = R[Math.max(0, cover.findIndex((c) => c >= 0.6 * maxC))].code; DP.b = R.at(-1).code;
  if (DP.a === DP.b && R.length > 1) DP.a = R[0].code;
  $("dp-a").value = DP.a; $("dp-b").value = DP.b;
}
function dpSetVars() {
  const vars = Object.keys(dpData().vars).filter((v) => dpData().vars[v].length > 1); // need two rounds to difference
  $("dp-var").innerHTML = vars.map((v) => `<option value="${v}">${VAR_LABEL[v]} (${dpData().vars[v].length} rounds)</option>`).join("");
  DP.var = vars.includes(DP.var) ? DP.var : vars[0]; $("dp-var").value = DP.var;
  dpSetRounds();
}
function initDisp() {
  dpM = makeMap("dp-map");
  dpSetVars();
  $("dp-region").onchange = (e) => { DP.region = e.target.value; DP.sel = null; dpSetVars(); dpRender(); };
  $("dp-level").onchange = (e) => { DP.level = e.target.value; DP.sel = null; dpSetVars(); dpRender(); };
  $("dp-var").onchange = (e) => { DP.var = e.target.value; dpSetRounds(); dpRender(); };
  $("dp-a").onchange = (e) => { DP.a = e.target.value; dpRender(); };
  $("dp-b").onchange = (e) => { DP.b = e.target.value; dpRender(); };
  $("dp-map-metric").onchange = (e) => { DP.mapMetric = e.target.value; dpRender(); };
  $("dp-zero").onchange = (e) => { DP.zero = e.target.checked; dpRender(); };
  $("dp-norm").onchange = (e) => { DP.norm = e.target.checked; dpRender(); };
  return dpRender();
}

// ================================================================== ABOUT
function initAbout() {
  const n = D.meta.national;
  $("about").innerHTML = `
  <h2>What this explorer shows</h2>
  <p><b>Populace</b>: quarterly gridded population estimates for Nigeria at 40 m resolution (World Cylindrical Equal Area, ESRI:54034),
  ${D.meta.quarters.length} quarters from ${qLabel(D.meta.quarters[0])} to ${qLabel(D.meta.quarters.at(-1))}. Every pixel was summed exactly into each polygon
  (pixel-centre assignment on the native 40 m grid; no resampling), so unit totals are true zonal sums.</p>
  <p><b>Boundaries</b>: OCHA COD-AB Nigeria (HDX <code>cod-ab-nga</code>, v01, valid 2019-04-17). Admin 1 (37 states incl. FCT) and admin 2 (774 LGAs) cover the country;
  OCHA admin 3 (wards) is only published for Borno, Adamawa and Yobe (714 wards). State totals are aggregated from LGA sums.</p>
  <p><b>WorldPop</b>: Global2 R2025A constrained 100 m population counts for 2020–2025 (<code>nga_pop_YYYY_CN_100m_R2025A_v1.tif</code>), summed into the same polygons
  on the WorldPop grid. WorldPop is an annual mid-year product, so comparisons use Populace's Q2 estimate for the same year.</p>
  <p><b>Displacement</b>: GRID3 / WorldPop <i>Spatially Integrated Displacement Datasets for Nigeria v1</i> (June 2026), which harmonises IOM-DTM assessment rounds
  onto GRID3 ward (adm3) and LGA (adm2) boundaries for two DTM operational regions: North-East (NE; 2022-07 to 2025-03) and North-Central/North-West (NCNW; 2022-01 to 2025-03).
  Populace was summed into the same GRID3 polygons so that the displaced counts and population are compared on identical geography.</p>
  <h2>How the displacement comparison works</h2>
  <ul>
    <li>For each unit with a value in both rounds A and B, Δ displaced = count(B) − count(A).</li>
    <li>Populace is linearly interpolated between quarter mid-points to each round's date (mid-month), and Δ Populace = pop(B) − pop(A).</li>
    <li>If Populace fully captured displacement flows, a ward gaining 1,000 IDPs would gain ~1,000 people in Populace on top of background growth: points would fall
    along a line parallel to 1:1 with slope ≈ 1. A slope near 0 means Populace changes are unrelated to recorded displacement change.</li>
    <li>The Theil–Sen slope (median of pairwise slopes) is shown alongside OLS because a few large camps dominate least-squares fits.</li>
    <li>"Treat missing as 0" fills blank DTM values with zero. The data dictionary says blank = "no value available or generated", so the default is to drop those units.</li>
    <li>"IDPs by area of origin" counts people displaced <i>from</i> a unit; an increase there should correspond to a population <i>decrease</i> in that unit (negative slope).</li>
  </ul>
  <h2>Caveats</h2>
  <ul>
    <li><b>Large state-level differences between Populace and WorldPop.</b> Nationally the two are within ~10%, but some states differ by a factor of 2–3 (e.g. 2025: Lagos 5.0M Populace vs 13.0M WorldPop; Plateau 17.6M vs 5.0M; Taraba 10.6M vs 3.3M).
    These figures were checked with an independent masked sum of the raw raster, so they come from the Populace surface itself, not from this pipeline. Some single 40 m Populace pixels hold more than 1,000 people.</li>
    <li>In many IDP-hosting wards the DTM displaced count is <i>larger</i> than Populace's total population for the ward (see the "Displaced > Populace pop." tile), which suggests camp populations are under-represented in Populace.</li>
    <li>Wards that sit in both DTM regions (69 GRID3 wards) appear in both region views with region-specific counts.</li>
    <li>DTM rows with an unknown ward have no geometry; they are excluded at ward level but present in the LGA files.</li>
    <li>The July 2023 NCNW region has two assessments (<code>2307</code> and <code>2307B</code>); both are available as separate rounds.</li>
    <li>Raster overlays are 400 m aggregates (sums of 10×10 Populace pixels) re-projected to Web Mercator for display only; all statistics use the native 40 m grid.</li>
    <li>Populace national raster totals: ${fmtc(n.populace_raster_total[0])} → ${fmtc(n.populace_raster_total.at(-1))}. ${n.worldpop_raster_total ? `WorldPop: ${fmtc(n.worldpop_raster_total[0])} → ${fmtc(n.worldpop_raster_total.at(-1))}.` : ""}</li>
  </ul>
  <p class="muted small">Data built ${D.meta.built} by <code>build_data.py</code>.</p>`;
}

// ================================================================== boot
async function boot() {
  try {
    D.meta = await getJSON("data/meta.json");
    const levels = ["ocha_adm1", "ocha_adm2", "ocha_adm3", "g3_adm3", "g3_adm2"];
    const res = await Promise.all([...levels.map((l) => getJSON(`data/pop_${l}.json`)), getJSON("data/displacement.json")]);
    levels.forEach((l, i) => (D.pop[l] = res[i]));
    D.disp = res.at(-1);
    await initExplorer();
    initAbout();
    $("loading").remove();
  } catch (e) {
    $("loading").textContent = "Failed to load data: " + e.message; console.error(e); return;
  }
  const inited = { explore: true };
  document.querySelectorAll("#tabs button").forEach((b) => b.onclick = async () => {
    document.querySelectorAll("#tabs button").forEach((x) => x.classList.toggle("active", x === b));
    document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t.id === "tab-" + b.dataset.tab));
    const t = b.dataset.tab;
    for (const M of [exM, cpM, dpM]) if (M) M.map.invalidateSize();
    try {
      if (!inited[t]) { inited[t] = true; if (t === "compare") await initCompare(); if (t === "disp") await initDisp(); }
    } catch (e) { console.error(e); }
    document.querySelectorAll("#tab-" + t + " .js-plotly-plot").forEach((p) => Plotly.Plots.resize(p));
  });

  // theme switch: re-colour everything that was drawn with JS colours
  const applyTheme = async () => {
    const pref = $("theme").value;
    if (pref === "auto") delete document.documentElement.dataset.theme; else document.documentElement.dataset.theme = pref;
    try { localStorage.setItem("nga-theme", pref); } catch (e) {}
    const dark = isDark(pref);
    if (dark === DARK) return;
    setThemeColors(dark);
    for (const M of [exM, cpM, dpM]) if (M) { M.base.setUrl(basemapUrl("Base")); M.labels.setUrl(basemapUrl("Reference")); }
    exNational(); await exRender();
    if (inited.compare) await cpRender();
    if (inited.disp) await dpRender();
  };
  $("theme").value = themePref();
  $("theme").onchange = applyTheme;
  darkQuery.addEventListener("change", () => { if ($("theme").value === "auto") applyTheme(); });
}
boot();
