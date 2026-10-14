# Nigeria Population Explorer

A static web app with four tabs:

1. **Populace explorer**: choropleth maps of OCHA states, LGAs and wards (wards for Borno, Adamawa and Yobe only), showing population, density, change, or annualised growth over the 21 quarterly Populace rasters (2020 Q2–2025 Q2). Includes 400 m raster overlays, a time series per unit and a sortable ranking table.
2. **Populace vs WorldPop**: % or absolute difference against WorldPop R2025A constrained 100 m (2020–2025), plus a log–log agreement scatter, a growth-rate comparison and a table of the largest disagreements.
3. **Displacement vs population**: GRID3/IOM-DTM IDP and returnee rounds on GRID3 wards and LGAs (NE and NC/NW regions), compared with Populace change on the same polygons over the same dates. Includes a scatter with OLS and Theil–Sen fits, binned medians, per-unit small multiples and indexed region totals.
4. **About the data**: methods and caveats.

## Data sources and attribution

- **Populace**: quarterly 40 m gridded population for Nigeria, 2020 Q2–2025 Q2 (shown here as unit aggregates and 400 m overlays).
- **GRID3 / WorldPop**: Noskov, A., Qader, S., & Lazar, A. (2026). *Spatially Integrated Displacement Datasets for Nigeria (NGA), Version 1.* WorldPop, University of Southampton. [doi:10.5258/SOTON/WP00826](https://doi.org/10.5258/SOTON/WP00826). CC BY 4.0. Built from IOM-DTM assessment data.
- **WorldPop**: Global2 R2025A constrained 100 m population, 2020–2025. WorldPop, University of Southampton. CC BY 4.0.
- **OCHA**: Nigeria subnational administrative boundaries (COD-AB), [HDX cod-ab-nga](https://data.humdata.org/dataset/cod-ab-nga). CC BY-IGO.
- **Basemap**: Esri Canvas (Light/Dark Gray), © Esri, HERE, Garmin, © OpenStreetMap contributors.

Changes made: the boundaries are simplified for display, and the population rasters are summed into each boundary polygon.

## Run

Double-click `index.html`. All data is inlined in `data/bundle.js`, so no server is needed. You can also serve it locally:

```bash
python -m http.server 8765 --directory "Populace/explorer"
```

Then open http://127.0.0.1:8765. The app needs internet access only for the Esri basemap tiles.

## Rebuild data

`build_data.py` computes exact zonal sums on the native 40 m Populace grid, reading the rasters straight from the zip. It needs:

- OCHA COD-AB shapefiles: https://data.humdata.org/dataset/cod-ab-nga (`nga_admin_boundaries.shp.zip`)
- WorldPop rasters: `https://data.worldpop.org/GIS/Population/Global_2015_2030/R2025A/<YEAR>/NGA/v1/100m/constrained/nga_pop_<YEAR>_CN_100m_R2025A_v1.tif`

```bash
python build_data.py --ocha <ocha_dir> --worldpop <worldpop_dir> --cache <scratch_dir>
```

The Populace pass takes about 15 minutes; WorldPop and export take about 2 minutes.
