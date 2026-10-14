"""
Build the data bundle for the Nigeria Population Explorer.

Steps (each cached, re-run safely):
  1. units      - load OCHA admin 1/2/3 and GRID3 ward / LGA polygons, assign integer labels
  2. populace   - zonal sums of the 21 quarterly Populace rasters (40 m, ESRI:54034) over every unit set,
                  plus 400 m block sums used for raster overlays
  3. worldpop   - zonal sums of WorldPop R2025A constrained 100 m (2020-2025) over the same units
  4. export     - simplified GeoJSON, attribute/time-series JSON, displacement JSON, PNG overlays

Usage:
  python build_data.py --ocha <dir with nga_admin*.shp> --worldpop <dir with nga_pop_YYYY_CN_100m_R2025A_v1.tif>
                       --cache <scratch dir> [--steps units,populace,worldpop,export]
"""
import argparse
import json
import os
import re
import sys
import time
from pathlib import Path

import geopandas as gpd
import numpy as np
import pandas as pd
import rasterio
from rasterio import features
from rasterio.warp import reproject, Resampling, transform_bounds
from rasterio.transform import Affine
from shapely.geometry import box

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent  # .../Nigeria Mapping
POPULACE_ZIP = HERE.parent / "NGA_Spatially_Integrated_Displacement_Datasets_v1.zip"
GRID3_DIR = ROOT / "NGA_Spatially_Integrated_Displacement_Datasets_v1"
OUT = HERE / "data"

QUARTERS = [f"{y}q{q}" for y in range(2020, 2026) for q in range(1, 5)]
QUARTERS = [q for q in QUARTERS if "2020q2" <= q <= "2025q2"]
WP_YEARS = list(range(2020, 2026))
STRIP = 1000          # rows per strip; multiple of BLOCK
BLOCK = 10            # 40 m -> 400 m block sums for overlays
UNIT_SETS = ["ocha_adm2", "ocha_adm3", "g3_adm3", "g3_adm2"]


def log(*a):
    print(time.strftime("%H:%M:%S"), *a, flush=True)


# ---------------------------------------------------------------- 1. units
def load_units(ocha_dir: Path):
    """Return dict name -> GeoDataFrame (EPSG:4326) with integer column 'lab' (1..n) and 'key'."""
    u = {}
    a2 = gpd.read_file(ocha_dir / "nga_admin2.shp")
    a2 = a2[["adm2_pcode", "adm2_name", "adm1_pcode", "adm1_name", "geometry"]].rename(
        columns={"adm2_pcode": "key", "adm2_name": "name", "adm1_pcode": "parent", "adm1_name": "state"})
    u["ocha_adm2"] = a2
    a3 = gpd.read_file(ocha_dir / "nga_admin3.shp")
    a3 = a3[["adm3_pcode", "adm3_name", "adm2_pcode", "adm2_name", "adm1_name", "geometry"]].rename(
        columns={"adm3_pcode": "key", "adm3_name": "name", "adm2_pcode": "parent", "adm2_name": "lga", "adm1_name": "state"})
    u["ocha_adm3"] = a3

    for lvl, namecols in (("adm3", ["state", "lga", "ward"]), ("adm2", ["state", "lga"])):
        parts = []
        for reg in ("ne", "ncnw"):
            g = gpd.read_file(GRID3_DIR / f"{reg}_{lvl}.gpkg")
            g = g[g.grid3_id.notna() & ~g.geometry.is_empty & g.geometry.notna()]
            parts.append(g[["grid3_id", *namecols, "grid3_2025_population", "geometry"]])
        g = pd.concat(parts).drop_duplicates("grid3_id")
        g["key"] = g.grid3_id.astype(str)
        g["name"] = g[namecols[-1]]
        u[f"g3_{lvl}"] = gpd.GeoDataFrame(g.drop(columns="grid3_id"), crs="EPSG:4326")

    for k, g in u.items():
        g = g.reset_index(drop=True)
        g["lab"] = np.arange(1, len(g) + 1, dtype=np.int32)
        g["geometry"] = g.geometry.make_valid()
        u[k] = g
        log(f"units {k}: {len(g)}")
    return u


# ---------------------------------------------------------------- zonal engine
def zonal_strips(src_paths, units, crs, transform, width, height, block=None, nodata_nan=True):
    """
    Stream through rasters strip by strip; for each strip rasterize every unit set once
    and bincount every raster against it.
    Returns sums[set] -> array (n_rasters, n_units+1), counts[set] -> (n_units+1,), totals (n_rasters,),
    and optionally block sums (n_rasters, H/block, W/block).
    """
    proj = {k: g.to_crs(crs) for k, g in units.items()}
    sindex = {k: g.sindex for k, g in proj.items()}
    sums = {k: np.zeros((len(src_paths), len(g) + 1)) for k, g in proj.items()}
    counts = {k: np.zeros(len(g) + 1) for k, g in proj.items()}
    totals = np.zeros(len(src_paths))
    blocks = None
    if block:
        bw = -(-width // block)
        bh = -(-height // block)
        blocks = np.zeros((len(src_paths), bh, bw), dtype=np.float32)
    srcs = [rasterio.open(p) for p in src_paths]
    try:
        for r0 in range(0, height, STRIP):
            nrow = min(STRIP, height - r0)
            st = transform * Affine.translation(0, r0)
            x0, y1 = st * (0, 0)
            x1, y0 = st * (width, nrow)
            labs = {}
            for k, g in proj.items():
                idx = sindex[k].query(box(x0, y0, x1, y1))
                if len(idx) == 0:
                    labs[k] = None
                    continue
                sub = g.iloc[idx]
                labs[k] = features.rasterize(
                    zip(sub.geometry, sub.lab), out_shape=(nrow, width), transform=st,
                    fill=0, dtype="int32").ravel()
                counts[k] += np.bincount(labs[k], minlength=len(g) + 1)
            for i, s in enumerate(srcs):
                a = s.read(1, window=((r0, r0 + nrow), (0, width)))
                if s.nodata is not None and not np.isnan(s.nodata):
                    a = np.where(a == s.nodata, 0, a)
                a = np.nan_to_num(a, nan=0.0).astype(np.float64)
                totals[i] += a.sum()
                flat = a.ravel()
                for k, lab in labs.items():
                    if lab is not None:
                        sums[k][i] += np.bincount(lab, weights=flat, minlength=sums[k].shape[1])
                if block:
                    pad_w = blocks.shape[2] * block - width
                    pad_h = (-nrow) % block
                    ap = np.pad(a, ((0, pad_h), (0, pad_w)))
                    bs = ap.reshape(ap.shape[0] // block, block, ap.shape[1] // block, block).sum(axis=(1, 3))
                    b0 = r0 // block
                    blocks[i, b0:b0 + bs.shape[0]] = bs
            log(f"  strip {r0}/{height}")
    finally:
        for s in srcs:
            s.close()
    return sums, counts, totals, blocks


def step_populace(units, cache: Path):
    paths = [f"/vsizip/{POPULACE_ZIP.as_posix()}/NGA_{q}.tif" for q in QUARTERS]
    with rasterio.open(paths[0]) as r:
        crs, tr, w, h = r.crs, r.transform, r.width, r.height
    log(f"populace grid {w}x{h} {crs.to_string()[:40]}")
    sums, counts, totals, blocks = zonal_strips(paths, units, crs, tr, w, h, block=BLOCK)
    np.savez(cache / "populace_zonal.npz", totals=totals,
             **{f"sum_{k}": v for k, v in sums.items()}, **{f"cnt_{k}": v for k, v in counts.items()})
    np.save(cache / "populace_blocks.npy", blocks)
    with open(cache / "populace_grid.json", "w") as f:
        json.dump({"crs": crs.to_wkt(), "transform": list(tr)[:6], "block": BLOCK}, f)


def step_worldpop(units, cache: Path, wp_dir: Path):
    paths = [str(wp_dir / f"nga_pop_{y}_CN_100m_R2025A_v1.tif") for y in WP_YEARS]
    with rasterio.open(paths[0]) as r:
        crs, tr, w, h = r.crs, r.transform, r.width, r.height
    log(f"worldpop grid {w}x{h}")
    sums, counts, totals, blocks = zonal_strips(paths, units, crs, tr, w, h, block=4)
    np.savez(cache / "worldpop_zonal.npz", totals=totals,
             **{f"sum_{k}": v for k, v in sums.items()}, **{f"cnt_{k}": v for k, v in counts.items()})
    np.save(cache / "worldpop_blocks.npy", blocks)
    with open(cache / "worldpop_grid.json", "w") as f:
        json.dump({"crs": crs.to_wkt(), "transform": list(tr)[:6], "block": 4}, f)


# ---------------------------------------------------------------- 4. export
def write_geojson(g, path, tol, props):
    g = g[["geometry", *props]].copy()
    g["geometry"] = g.geometry.simplify(tol, preserve_topology=True)
    g.to_file(path, driver="GeoJSON", COORDINATE_PRECISION=4)


def rnd(a, nd=0):
    return [None if (v is None or not np.isfinite(v)) else (int(round(v)) if nd == 0 else round(float(v), nd)) for v in a]


def yymm_to_decimal(s):
    yy, mm = int(s[:2]), int(s[2:4])
    return 2000 + yy + (mm - 0.5) / 12


def quarter_decimal(q):
    y, n = int(q[:4]), int(q[-1])
    return y + (n - 1) * 0.25 + 0.125  # mid-quarter


def displacement_tables():
    """Per region & level: rounds and series for each unit (keyed like g3 units)."""
    out = {}
    pat = re.compile(r"^(idps|rets)_(orig|dest)_(\d{4}B?)$")
    for reg in ("ne", "ncnw"):
        out[reg] = {}
        for lvl in ("adm3", "adm2"):
            g = gpd.read_file(GRID3_DIR / f"{reg}_{lvl}.gpkg")
            cols = [c for c in g.columns if pat.match(c)]
            vars_ = {}
            for c in cols:
                p, d, r = pat.match(c).groups()
                vars_.setdefault(f"{p}_{d}", []).append(r)
            vars_ = {k: sorted(v) for k, v in vars_.items()}
            units = {}
            unknown = {}
            for _, row in g.iterrows():
                series = {v: rnd([row[f"{v}_{r}"] for r in rs]) for v, rs in vars_.items()}
                if pd.isna(row.grid3_id):
                    # IDPs attributed to an LGA but no ward ("unknown" ward); keep as LGA-level remainder
                    unknown.setdefault(row.lga + "|" + row.state, series)
                    continue
                units[str(row.grid3_id)] = series
            out[reg][lvl] = {
                "vars": {v: [{"code": r, "t": round(yymm_to_decimal(r), 4),
                              "label": f"20{r[:2]}-{r[2:4]}" + (" (B)" if r.endswith("B") else "")} for r in rs]
                         for v, rs in vars_.items()},
                "units": units,
                "unknown_ward": unknown,
            }
    return out


def colorize(arr, stops, vmin, vmax, log_scale=False, alpha_mask=None):
    """Map array to RGBA using piecewise-linear interpolation over hex stops."""
    from PIL import Image  # noqa
    cols = np.array([[int(h[i:i + 2], 16) for i in (1, 3, 5)] for h in stops], dtype=float)
    a = arr.astype(float)
    if log_scale:
        a = np.log10(np.clip(a, vmin, vmax))
        lo, hi = np.log10(vmin), np.log10(vmax)
    else:
        lo, hi = vmin, vmax
    t = np.clip((a - lo) / (hi - lo), 0, 1) * (len(stops) - 1)
    i0 = np.floor(t).astype(int).clip(0, len(stops) - 2)
    f = (t - i0)[..., None]
    rgb = cols[i0] * (1 - f) + cols[i0 + 1] * f
    alpha = np.full(arr.shape, 255, dtype=np.uint8)
    if alpha_mask is not None:
        alpha[alpha_mask] = 0
    return np.dstack([rgb.astype(np.uint8), alpha])


def to_webmercator(src, src_crs, src_tr, max_px=2400):
    h, w = src.shape
    west, south, east, north = transform_bounds(src_crs, "EPSG:3857", *rasterio.transform.array_bounds(h, w, src_tr))
    res = max((east - west) / max_px, (north - south) / max_px)
    dw, dh = int((east - west) / res), int((north - south) / res)
    dst_tr = Affine(res, 0, west, 0, -res, north)
    dst = np.full((dh, dw), np.nan, dtype=np.float32)
    reproject(src.astype(np.float32), dst, src_transform=src_tr, src_crs=src_crs, dst_transform=dst_tr,
              dst_crs="EPSG:3857", resampling=Resampling.bilinear, src_nodata=np.nan, dst_nodata=np.nan)
    ll = transform_bounds("EPSG:3857", "EPSG:4326", west, south, east, north)
    return dst, [[ll[1], ll[0]], [ll[3], ll[2]]]


def step_export(units, cache: Path, ocha_dir: Path):
    from PIL import Image
    OUT.mkdir(exist_ok=True)
    (OUT / "rasters").mkdir(exist_ok=True)
    pz = np.load(cache / "populace_zonal.npz")
    wz = np.load(cache / "worldpop_zonal.npz") if (cache / "worldpop_zonal.npz").exists() else None

    # --- geometry
    a1 = gpd.read_file(ocha_dir / "nga_admin1.shp")[["adm1_pcode", "adm1_name", "geometry"]].rename(
        columns={"adm1_pcode": "key", "adm1_name": "name"})
    write_geojson(a1, OUT / "ocha_adm1.geojson", 0.01, ["key", "name"])
    write_geojson(units["ocha_adm2"], OUT / "ocha_adm2.geojson", 0.004, ["key", "name"])
    write_geojson(units["ocha_adm3"], OUT / "ocha_adm3.geojson", 0.002, ["key", "name"])
    write_geojson(units["g3_adm3"], OUT / "g3_adm3.geojson", 0.0015, ["key", "name"])
    write_geojson(units["g3_adm2"], OUT / "g3_adm2.geojson", 0.003, ["key", "name"])

    # --- population tables
    px_km2_pop = 0.04 * 0.04
    tables = {}
    for k, g in units.items():
        s = pz[f"sum_{k}"]
        cnt = pz[f"cnt_{k}"]
        ws = wz[f"sum_{k}"] if wz is not None else None
        rows = {}
        for _, r in g.iterrows():
            lab = r.lab
            row = {"name": r["name"], "area_km2": round(cnt[lab] * px_km2_pop, 2),
                   "populace": rnd(s[:, lab])}
            for c in ("parent", "state", "lga", "ward"):
                if c in g.columns and pd.notna(r.get(c)):
                    row[c] = r[c]
            if "grid3_2025_population" in g.columns and pd.notna(r.grid3_2025_population):
                row["grid3_2025"] = int(r.grid3_2025_population)
            if ws is not None:
                row["worldpop"] = rnd(ws[:, lab])
            rows[r.key] = row
        tables[k] = rows

    # admin1 = aggregate of admin2 (OCHA pcodes nest)
    a1rows = {}
    for key, r in tables["ocha_adm2"].items():
        p = r["parent"]
        d = a1rows.setdefault(p, {"name": r["state"], "area_km2": 0.0,
                                  "populace": np.zeros(len(QUARTERS)), "worldpop": np.zeros(len(WP_YEARS))})
        d["area_km2"] += r["area_km2"]
        d["populace"] += np.array([v or 0 for v in r["populace"]])
        if "worldpop" in r:
            d["worldpop"] += np.array([v or 0 for v in r["worldpop"]])
    for d in a1rows.values():
        d["area_km2"] = round(d["area_km2"], 1)
        d["populace"] = rnd(d["populace"])
        d["worldpop"] = rnd(d["worldpop"]) if wz is not None else None
    tables["ocha_adm1"] = a1rows

    for k, rows in tables.items():
        with open(OUT / f"pop_{k}.json", "w") as f:
            json.dump(rows, f, separators=(",", ":"))

    meta = {
        "quarters": QUARTERS,
        "quarter_t": [quarter_decimal(q) for q in QUARTERS],
        "wp_years": WP_YEARS,
        "wp_t": [y + 0.5 for y in WP_YEARS],
        "national": {
            "populace_raster_total": rnd(pz["totals"]),
            "populace_in_adm2": rnd(pz["sum_ocha_adm2"][:, 1:].sum(axis=1)),
            "worldpop_raster_total": rnd(wz["totals"]) if wz is not None else None,
            "worldpop_in_adm2": rnd(wz["sum_ocha_adm2"][:, 1:].sum(axis=1)) if wz is not None else None,
        },
        "built": time.strftime("%Y-%m-%d %H:%M"),
    }

    # --- displacement
    disp = displacement_tables()
    with open(OUT / "displacement.json", "w") as f:
        json.dump(disp, f, separators=(",", ":"))

    # --- raster overlays (Populace 400 m block sums -> people / km2, and change)
    grid = json.load(open(cache / "populace_grid.json"))
    src_crs = rasterio.crs.CRS.from_wkt(grid["crs"])
    tr = Affine(*grid["transform"]) * Affine.scale(grid["block"])
    blocks = np.load(cache / "populace_blocks.npy", mmap_mode="r")
    cell_km2 = (0.04 * grid["block"]) ** 2
    seq = ["#f0efec", "#cde2fb", "#86b6ef", "#3987e5", "#1c5cab", "#104281", "#0d366b"]
    div = ["#b3261e", "#e34948", "#f19b9a", "#f0efec", "#9ec5f4", "#3987e5", "#104281"]  # loss <- 0 -> gain
    # dark-theme variants: low values recede into the dark surface, extremes brighten
    seq_dark = ["#232a33", "#16325a", "#184f95", "#2a78d6", "#5598e7", "#9ec5f4", "#e4eefb"]
    div_dark = ["#f3b1b0", "#e66767", "#9e2a2b", "#383835", "#1c5cab", "#5598e7", "#b7d3f6"]
    dark_of = {tuple(seq): seq_dark, tuple(div): div_dark}
    overlays = []
    # nation mask from admin0 to blank out-of-country pixels
    a0 = gpd.read_file(ocha_dir / "nga_admin0.shp").to_crs(src_crs)
    mask = features.rasterize(a0.geometry, out_shape=blocks.shape[1:], transform=tr, fill=0, dtype="uint8") == 0

    def emit(name, arr, colors, vmin, vmax, log_scale, label, legend):
        arr = np.where(mask, np.nan, arr)
        merc, bounds = to_webmercator(arr, src_crs, tr)
        for suffix, cols in (("", colors), ("_dark", dark_of[tuple(colors)])):
            rgba = colorize(merc, cols, vmin, vmax, log_scale, alpha_mask=~np.isfinite(merc))
            Image.fromarray(rgba, "RGBA").save(OUT / "rasters" / f"{name}{suffix}.png", optimize=True)
        legend["colors_dark"] = dark_of[tuple(colors)]
        overlays.append({"id": name, "label": label, "bounds": bounds, "legend": legend})
        log(f"  overlay {name}")

    for q in QUARTERS:
        if q.endswith("q2"):
            i = QUARTERS.index(q)
            emit(f"density_{q}", np.asarray(blocks[i]) / cell_km2, seq, 10, 20000, True,
                 f"Populace density {q.upper()} (people/km²)",
                 {"type": "log", "colors": seq, "min": 10, "max": 20000, "unit": "people/km²"})
    for a, b in (("2020q2", "2025q2"), ("2022q2", "2025q2"), ("2024q2", "2025q2")):
        d = (np.asarray(blocks[QUARTERS.index(b)]) - np.asarray(blocks[QUARTERS.index(a)])) / cell_km2
        lim = 300 if a != "2024q2" else 100
        emit(f"change_{a}_{b}", d, div, -lim, lim, False,
             f"Populace change {a.upper()}→{b.upper()} (people/km²)",
             {"type": "linear", "colors": div, "min": -lim, "max": lim, "unit": "Δ people/km²"})

    # WorldPop vs Populace difference (2025 vs 2025Q2), on the WorldPop 400 m grid
    if (cache / "worldpop_blocks.npy").exists():
        wgrid = json.load(open(cache / "worldpop_grid.json"))
        wcrs = rasterio.crs.CRS.from_wkt(wgrid["crs"])
        wtr = Affine(*wgrid["transform"]) * Affine.scale(wgrid["block"])
        wb = np.load(cache / "worldpop_blocks.npy", mmap_mode="r")[-1]
        # resample Populace 400 m block sums onto WorldPop block grid (sum-preserving via density)
        pop_dens = np.asarray(blocks[QUARTERS.index("2025q2")]) / cell_km2
        dst = np.full(wb.shape, np.nan, dtype=np.float32)
        reproject(pop_dens.astype(np.float32), dst, src_transform=tr, src_crs=src_crs, dst_transform=wtr,
                  dst_crs=wcrs, resampling=Resampling.average)
        lat = wtr.f + (np.arange(wb.shape[0]) + 0.5) * wtr.e
        cell_area = (np.abs(wtr.a) * 111.32 * np.cos(np.radians(lat)))[:, None] * (np.abs(wtr.e) * 110.57)
        wp_dens = np.asarray(wb) / cell_area
        wmask = features.rasterize(a0.to_crs(wcrs).geometry, out_shape=wb.shape, transform=wtr, fill=0,
                                   dtype="uint8") == 0
        diff = np.where(wmask, np.nan, dst - wp_dens)
        merc, bounds = to_webmercator(diff, wcrs, wtr)
        lim = 500
        for suffix, cols in (("", div), ("_dark", div_dark)):
            rgba = colorize(merc, cols, -lim, lim, False, alpha_mask=~np.isfinite(merc))
            Image.fromarray(rgba, "RGBA").save(OUT / "rasters" / f"diff_populace_worldpop_2025{suffix}.png", optimize=True)
        overlays.append({"id": "diff_populace_worldpop_2025", "bounds": bounds,
                         "label": "Populace 2025Q2 minus WorldPop 2025 (people/km²)",
                         "legend": {"type": "linear", "colors": div, "colors_dark": div_dark, "min": -lim, "max": lim,
                                    "unit": "Populace − WorldPop, people/km²"}})
        log("  overlay diff")

    meta["overlays"] = overlays
    with open(OUT / "meta.json", "w") as f:
        json.dump(meta, f, indent=1)
    write_bundle()
    log("export done ->", OUT)


def write_bundle():
    """Inline every JSON/GeoJSON into data/bundle.js so index.html works from file:// (browsers block fetch there)."""
    names = sorted(p.name for p in OUT.iterdir() if p.suffix in (".json", ".geojson"))
    with open(OUT / "bundle.js", "w", encoding="utf-8") as f:
        f.write("window.NGA_DATA = {\n")
        for n in names:
            obj = json.load(open(OUT / n, encoding="utf-8"))
            f.write(f"{json.dumps(n)}: {json.dumps(obj, separators=(',', ':'))},\n")
        f.write("};\n")
    log("bundle.js written")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--ocha", required=True, type=Path)
    ap.add_argument("--worldpop", required=True, type=Path)
    ap.add_argument("--cache", required=True, type=Path)
    ap.add_argument("--steps", default="populace,worldpop,export")
    a = ap.parse_args()
    if a.steps == "bundle":
        write_bundle()
        return
    a.cache.mkdir(parents=True, exist_ok=True)
    steps = a.steps.split(",")
    units = load_units(a.ocha)
    if "populace" in steps:
        step_populace(units, a.cache)
    if "worldpop" in steps:
        step_worldpop(units, a.cache, a.worldpop)
    if "export" in steps:
        step_export(units, a.cache, a.ocha)


if __name__ == "__main__":
    main()
