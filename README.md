# Mach-1 Analyzer

A browser-based tool for analysing Biomomentum Mach-1 mechanical test files (TXT exports from Mach-1 Motion). It supports two experimental methods, chosen with **Experiment type** at the top of the page:

- **Probe Tack**: imports whole experiment folders, separates every movement (run), extracts peak forces, screens for outliers and compares conditions.
- **Lap Shear**: peak load, apparent nominal lap-shear strength, mechanical work and work per bonded area for every run, with editable specimen dimensions and failure modes (see [Lap Shear analysis](#lap-shear-analysis)).
- **90° Peel**: average peel force (steady state), peel strength, peel energy, peak and initiation peak forces, area under the graph (work) and work per peeled area, with editable gel dimensions (see [90° peel analysis](#90-peel-analysis)).

**Each test has its own files.** Files opened while Probe Tack is selected belong to Probe Tack only; switch to Lap Shear or 90° Peel and you start with an empty file list and import that test's files there. Each test's files, ticks and settings are kept separately in autosave and in saved projects. Remove files with × (one file or folder) or *Remove all*; the files on your computer are never changed.

Both export Excel workbooks with editable charts and save projects.

**Website:** https://tofuscream-rgb.github.io/mach1-analyzer/

**Your data stay on your computer.** The website is a set of static files. Files you open are read by your own browser and are never uploaded. See [SECURITY.md](SECURITY.md) for exactly what that means and its limits.

No installation, account, Python or server is needed. Collaborators only need the link and a current browser (Chrome, Edge, Firefox or Safari).

---

## Using the website

**1. Open your experiments** (left side). Choose how to import, **folder** (recommended), **TXT file(s)** or a **ZIP file**, and click **Browse**. You can also drag a folder onto the page. Every TXT file found is listed, with its sub-folders kept. **Try it with example data** loads invented example files. Every imported file has a tick box, grouped by folder. Untick a file (or a whole folder) to leave it out of the graphs, averages, outlier checks, comparisons and Excel export, and tick it again to bring it back. Unticked files stay in the list, are marked in the Files tab, are listed in the Excel *Analysis Settings* sheet, and are remembered in saved projects.

**2. Choose your experiment.** The dropdowns are built from your folder names:

- **Charge ratio**, then **Total monomer concentration** (only the concentrations measured at that charge ratio), then **Substrate**.
- **TXT file to view**: the files of that experiment, sorted by holding time (e.g. `1s.txt`, `1s-2.txt`, `30s.txt`, `60s.txt`).
- Tick **Overlay additional TXT files** to put more files of the same experiment on the graph. Use it to check that repeats agree (`1s.txt` and `1s-3.txt`) or to compare holding times (`1s`, `30s`, `60s`).

The small ticks next to each file show its runs, coloured by flag. A hollow tick is an outlier that is left out of the averages.

**3. Look at the results** in the tabs:

- **Graph**: adhesion force vs displacement for every run of the chosen file(s). Every run starts at displacement 0, and adhesion is shown as a positive force (both can be changed under Settings → Force and displacement). Change the axes, show or hide single runs or whole files, and drag to zoom. ▲ marks each run's peak adhesion force. Outlier runs are drawn grey and dashed; untick **Show outlier runs** to hide them. **Save graph** as PNG, SVG or an Excel file with an editable chart. Click **Stress–strain** to plot the **nominal stress σN = F / Amax (kPa or MPa)** against the **nominal strain ε = (h − h₀) / h₀**, as in Creton & Ciccotti, *Fracture and adhesion of soft materials: a review*, Rep. Prog. Phys. 79, 046601 (2016), eq. 9. Enter the **probe diameter d** (Amax = π (d/2)², the contact area of the flat probe) and the **initial gel thickness h₀** above the graph or under Settings; nothing is assumed, and the curve is drawn only once both are entered. h − h₀ is the displacement of each run from its start (Settings → Relative displacement). **Force–displacement** switches back.
- **Data analysis**: the peak summary of the chosen experiment, one block per holding time. Each block gives the **average ± SD (n)** of all runs and **without outliers**. Each run is listed with its peak force, **Z-score** and flag, and outliers are highlighted with the reason. Untick or tick **In average** to decide yourself whether a run counts. Click a run to see its curve, all notes, metadata (and correct it, e.g. a missing concentration) and the point data.
- **Compare charge ratios**: choose which data sets to compare by ticking **Substrate**, **Charge ratio**, **Concentration** and **Holding time** (several of each). Every ticked combination with data becomes one data set (one substrate × charge ratio × concentration). For example, Glass + 0.25 + 2.1/2.5/2.98 M gives three sets, and three substrates × four charge ratios gives twelve. Untick single sets in the list below the choices. The bar chart has one panel per substrate (dashed separators), charge ratios high → low or low → high, and one pastel bar per holding time with mean ± SD error bars; save it as PNG or SVG. Below it are a table of mean ± SD (n) and a chart of peak force vs holding time. Concentrations are never averaged together, and substrate names that differ only in capitals (`ss`, `SS`) are the same substrate. The selection is saved with the project.
- **Settings**: which flag colours count as outliers that are left out of the averages (red and orange by default), how outliers are detected, force unit, peak metric, displacement and baseline. **Advanced** holds single-point glitch screening.
- **Files** (small tab, top right): the import status of every file. Nothing is skipped silently.

**4. Export Excel** (top right). Choose which data (this experiment, only the files on the graph, or everything) and what to include: the graph as an editable chart, the statistical summary, the run summary, point data and settings. You can also use the shortcuts **Everything**, **Graph + summary tables** or **Summary tables only**. **Save project** downloads a project file to continue later, and the page also autosaves in your browser. **Restore original data** clears all your manual In average choices and point exclusions.

### How folder and file names are read

| Example path | Read as |
|---|---|
| `0.25/Glass/60s-2.txt` | charge ratio 0.25, substrate Glass, hold 60 s, Repeat 2 |
| `0.25 (2.5M)/Glass/30s.txt` or `2.5 M/0.25/Glass/30s.txt` | concentration 2.5 M |
| `CR 0.75/Gel B/PTFE/1s-3.txt` | charge ratio 0.75, substrate PTFE, Repeat 3 |
| `After conference/ss/f1.05/1s_new.txt` | charge ratio 1.05 (one letter before a decimal number is allowed), substrate ss, hold 1 s |
| `f=0.5`, `f= 0.5`, `f: 0.5`, `F 0.50`, `f_0.5`, `CR=0.5`, `cr0.5`, `ratio_0.5`, `charge ratio 0.5`, `gel 1.05`, `0,5` (decimal comma) | charge ratio 0.5 (or 1.05), in a folder name, or in the file name when no folder gives one (`f= 0.5 glass.txt` → charge ratio 0.5, substrate glass). Unlabelled numbers in file names (`1s`, `60s-2`, `trial 70n`) are never read as a charge ratio. |
| `probe tack October/0.25 2.5M/glass/1s.txt` (gel, then substrate) or `after conference/stainless steel/0.75/1s.txt` (substrate, then gel) | both orders are read: charge ratio, concentration (2.1 M default if none), substrate. A substrate folder whose name is not a known material word is taken from its position next to the charge-ratio folder and marked “please check”; the top folder you picked for import is never used as the substrate. |
| `60s.txt` | Repeat 1. `60s-2.txt`, `60s-3.txt` are separate repeats (Repeat 2, Repeat 3), never merged. |
| `peel 2026 Oct/0.25 2.98M 90/glass.txt` | charge ratio 0.25, concentration 2.98 M, substrate glass (named in the file; a trailing number such as a peel angle in the folder name is ignored) |
| `0.5/PET-2.txt` | charge ratio 0.5, substrate PET, Repeat 2 |

In Lap Shear and 90° Peel the graph legend is built from these conditions (for example “0.25 · 2.98 M · glass”), with *Run k* when a file holds several runs and the file name only where two runs would otherwise get the same label.

Concentration must be written with a capital **M** or as **mol/L** (so “mm” and “min” are never mistaken for it). If no concentration is found, 2.1 M is assumed and clearly labelled as a default. Groups with different concentrations are never merged in statistics.

Holding time per run comes from the `Wait` duration recorded in the file. The file name is only a fallback.

---

## What the analysis does

### Parsing

Each Mach-1 operation is a block: `<INFO>` (date, time, instrument, load cell, calibration, filter settings) → operation tag (`<Wait>`, `<Move Relative>`, …) with its parameters → a tab-separated `<DATA>` table. A **run** is one movement block, paired with the `Wait` (hold) immediately before it. Each file is one **repeat** (`60s.txt` is Repeat 1, `60s-2.txt` is Repeat 2), and the runs inside it are numbered Run 1, Run 2, … Each run keeps its source file, sequence number, hold time, commanded amplitude and velocity, timestamp and original values. Unknown sections are kept and reported. Malformed rows and missing `<END DATA>` tags are counted and reported, never silently dropped.

### Per-run values

Minimum, maximum and absolute peak force; mean; SD (n − 1); number of points; time, z position and displacement at the minimum and maximum; optional baseline and baseline-corrected minimum. Maximum force and time at maximum are written to the Excel export but are not shown on screen.

- **Peak metric** (Settings): minimum (default; adhesion appears as negative force), maximum, maximum absolute, or baseline-corrected minimum.
- **Units:** gf or N, with 1 gf = 0.00980665 N. Calculations are always done in gf and converted for display. The load-cell calibration factor is applied by the instrument and is unrelated.
- **Force sign:** the instrument records pulling (adhesion) as negative force. By default the site multiplies displayed and exported forces by −1, so adhesion and the peak are positive (SDs stay positive). Calculations and flags use the recorded values, and the point-data sheets in Excel keep the recorded Fz. Choose *As recorded* under Settings to turn this off.
- **Relative displacement:** each run is zeroed at its own start (z₀ = first recorded z of that run), so runs that start at different stage heights all begin at 0. The default is the distance travelled, |z − z₀|, which counts up from 0; z − z₀ and z₀ − z are also available. This definition has **not** yet been checked against Mach-1 Analysis.
- **Baseline correction** is off by default and never chosen automatically. You can use the mean of the last N s of the preceding hold, or the mean of a time interval you type in under **Settings → Force and displacement**.
- **Nominal stress and strain** (graph and Excel graph data only): σN = F / Amax with Amax = π (d/2)², and ε = Δh / h₀, using the probe diameter d and gel thickness h₀ entered under Settings. They are a rescaling of force and displacement; the peak force results are unchanged.
- **No smoothing or extra low-pass filtering is applied.** The files report the instrument’s 3 Hz low-pass filter; whether exported values already include it has not been independently confirmed.

### Level A: point screening within a curve

This is a Hampel-type method with an isolation check:

1. rolling median over ±5 points; residual r = F − median
2. local robust scale s = max(1.4826 × median |r| in the window, floor). The default floor is the force resolution of the recording (≈0.5 gf in the sample data, where MAD is often exactly zero)
3. Hampel z = |r| / s
4. isolation = smallest distance of the point from the straight line through its neighbours at ±1 and ±2 points, divided by s
5. robust z = min(Hampel z, isolation); score = z² / (z² + 5²)

A point must stand out from the local median *and* from its immediate neighbours. Broad adhesion peaks and sharp detachment steps therefore score near zero, while isolated spikes score high. The score (0–1) is a **severity index for review, not a probability**. The defaults are green < 0.3 ≤ yellow < 0.6 ≤ orange < 0.8 ≤ red. Every flag shows why it was raised.

### Level B: run screening

Each run is compared only with runs under the same conditions (selectable; default charge ratio, concentration, substrate and hold time).

- **Modified Z-score** of the peak, 0.6745 (x − median) / MAD, only when at least 4 runs are available. It falls back to the mean absolute deviation if MAD = 0.
- **Positive-only response** (force never negative) and **missing peak** (minimum within 3 resolution steps of the reference level).
- **Weak response** (peak depth below 25% of the condition median).
- **Incomplete movement** (stage travel below 95% of the commanded amplitude).
- **Start position**: the movement started more than 1 mm beyond the previous run’s start, in the travel direction. This suggests the probe did not re-approach the specimen.
- Informational notes (do not change the QC colour):
  - a repeat differing from the other repeats by more than 30%;
  - force not back at the reference level when the movement ended (specimen possibly still attached).

A single inconsistent run never invalidates its file. By default, red and orange runs are left out of the processed statistics. You can change which colours are excluded under Settings and override any single run with the In average tick box in Data analysis. Flags are always computed the same way, whatever is excluded.

### Statistics

Statistics are grouped by the variables you choose; concentration is always included. Results are reported at two levels:

- **Run level** treats each movement (run) as one value. Runs on the same specimen are **not** independent replicates.
- **Repeat level** averages each file (repeat) first, then summarises across repeats.

---

## Lap Shear analysis

Choose **Experiment type → Lap Shear** at the top and open your lap-shear files there (they are separate from the Probe Tack and 90° Peel files). Probe Tack's settings and results are not changed.

### Using it

1. **Open your experiments** exactly as in Probe Tack mode: a folder, one or more TXT files, or a ZIP. Untick files you do not want to use.
2. **Choose files and runs to analyse.** Every `<Move Relative>` section of a TXT file is one run (a file with three pulls gives Run 1, Run 2 and Run 3); runs are never merged. Tick any number of files (all their runs), or open a file (▸) and tick single runs; filter the list by name or folder. Runs from different files are shown together; when files share a name, runs are labelled with their folder path. A run that cannot be analysed shows which measurements are missing (*Time, s*, *Position (z), mm*, *Fz, gf*). Files are not rejected just because they do not say they are lap-shear files.
3. **Graph**: the ticked runs vs displacement. Choose the **Y axis**: **shear strength τ = F/A (kPa, the default, or MPa)** or loading force (gf or N), each run with its own bonded area, so its peak equals the strength in the Results tab. ▲ marks each peak (with optional labels) and × marks complete failure. To keep many curves readable, **click a curve** (or choose it under *Highlight*) to draw it bold while the others fade. **Shade area under curve** is *Off* by default; choose *Highlighted run only* or *All runs* to shade the interval used for the *selected integration work*. Choose the integration (full curve, start to peak, or a custom displacement range) above the graph. Zoom by dragging; save as PNG or SVG. **Curve labels**: keep the *Legend box*, choose *Label on curves* to write each curve's name next to the curve in its own colour (as you would by hand; only the conditions that differ between the curves are written, e.g. “glass”, “PET”), or *None*. Drag a label to move it. **Rename curves** gives any curve your own name (for example “stainless steel”), used in the legend and on the curves. **Axis titles** lets you type your own X and Y axis titles (leave empty for the automatic one; the Y title goes back to automatic when you change the Y quantity). **Graph title** adds an optional bold title above the graph; *Use …* fills in the conditions all curves share (e.g. “0.25 · 2.5 M”). Labels and title are saved with the project and included in PNG/SVG downloads.
4. **Results**: one row per run with editable **overlap length, overlap width and gel thickness** (defaults 25 × 10 × 1 mm, bonded area 250 mm²), a **failure mode** (Not specified, Adhesive, Cohesive, Mixed) and an optional **failure displacement**. All results update immediately, and the curve itself never changes. Use *Set dimensions for all selected runs* for a whole batch. Below the table: mean ± sample SD (n) of every property, also per condition when the runs come from different folders.
5. **Compare charge ratios**: like the Probe Tack comparison. Tick substrates, charge ratios, concentrations and holding times (from the folder and file names); every combination with ticked runs is one data set (substrate × charge ratio × concentration). Choose the property to compare (for example apparent lap-shear strength or work per bonded area) and get pastel bars per substrate panel with mean ± SD error bars, a table, and PNG/SVG export.
6. **Settings**: integration interval, gap handling, complete-failure criterion, baseline correction, loading direction and the default dimensions.
7. **Export Excel**: a summary sheet (every run, dimensions, bonded area, failure mode, mean ± SD), an editable Excel chart, one sheet per run (time, original position, relative displacement, original signed force, corrected force, peak, integration interval, cumulative work) and the analysis settings.

Dimensions, failure modes, manual failure points and settings are saved with the project and in the browser's autosave.

### How the values are calculated

| Quantity | Definition |
|---|---|
| Displacement | δ = \|z − z₀\| along the pull direction, z₀ = first valid position of the run |
| Loading force | The force sign with the larger magnitude is the loading direction (or set it in Settings). It is shown as a positive magnitude; the original signed values are kept and exported. |
| Peak force | Largest loading force, in gf and N (1 gf = 0.00980665 N), with its displacement and time |
| Bonded overlap area | A = overlap length × overlap width (mm²). Gel thickness is recorded but does not enter the strength. |
| Apparent nominal lap-shear strength | τ = F<sub>max</sub> / A: kPa = N/mm² × 1000, MPa = N/mm². Average stress over the original bonded area at peak load, not the maximum local stress in the joint. |
| Mechanical work | W = ∫ F dδ by the trapezoidal rule, in N·mm = mJ. Full-curve work = work to peak + post-peak work. |
| Selected integration work | Full curve, start to peak, or a custom δ range; the force is interpolated at the exact custom limits. |
| Work per bonded area | W<sub>A</sub> = W (mJ) × 1000 / A (mm²), in J/m², for the selected and the full-curve work |
| Complete failure | First point after the peak where the loading force stays below 5% of the peak for 20 consecutive valid points (both adjustable). Left blank if this never happens; a typed value overrides it. The end of machine travel is never taken as separation. Work to failure is reported separately from full recorded work. |
| Statistics | Mean and sample SD (n − 1). Strength and work per area are computed per run with that run's own area before averaging. |

Work per bonded area is **apparent mechanical work per bonded area**. It can include elastic deformation, viscoelastic dissipation, cohesive damage, interfacial separation, frictional sliding after failure and fixture compliance, so it is not labelled adhesion energy or fracture toughness. Failure mode is entered from your observation of the specimen and is never inferred from the curve. No stiffness fitting is done.

**Data quality.** Points with missing or non-finite time, position or force are skipped. Work is never integrated across skipped points or time steps longer than 5 × the median step. Only displacement beyond everything reached before is integrated, so small backward steps of the stage (common in real files) neither cancel nor double-count work; the signed work including reversals is also exported. Steps with no displacement change add nothing. The raw data are never sorted or modified, and each run lists these events (hover ⚠ in the Results table).

**Zero-force baseline correction** (off by default): the median force of the first 30 valid points is subtracted, but only if they look unloaded (spread ≤ 2 gf and small compared with the largest force); otherwise the run says why no correction was applied. Raw values are kept; when correction is on, the raw curve can be shown dashed on the graph.

## 90° peel analysis

Choose **Experiment type → 90° Peel** and open your peel files. A Mach-1 file recorded with a `<Scripts>` section (sliding stage moving x and z together so the peel stays at 90°) is one run; files with `<Move>` sections give one run per move.

1. **Choose your experiment** (step 2), as in Probe Tack: pick the **charge ratio**, then the **total monomer concentration** (only those measured at that charge ratio), then the **substrate**, from dropdowns built from the folder and file names. Each dropdown also has *All*, to put several charge ratios, concentrations or substrates on one graph. **Files and runs** (step 3) lists every file of that choice; untick a file, or open it (▸) to untick single runs. The graph, Results and Excel export use the ticked runs of the chosen experiment; *Compare charge ratios* uses the ticked runs of every experiment.
2. **Gel dimensions** (step 4): gel length, width, thickness and peel angle (defaults 60 × 10 × 1 mm, 90°). *Apply* sets them for every selected run; single runs can be changed in the Results tab.
3. **Graph**: the ticked runs vs peel displacement. Choose the **Y axis**: **peel energy G = F/w · (1 − cos θ) in J/m²** (the default; each run with its own gel width and peel angle, so its steady-state average equals Γ in the Results tab), peel force (gf or N) or nominal stress F/A (kPa or MPa, with each run's gel length × width). F/A is nominal: in a peel the load is carried at the peel front, not by the whole bonded area. ▲ marks the peak, × the detachment. Click a curve to highlight it. *Shade area under curve* (off by default) shows the steady-state window used for the average peel force together with that average (dashed line). Change the window above the graph. **Curve labels**: keep the *Legend box*, choose *Label on curves* to write each curve's name next to the curve in its own colour (as you would by hand; only the conditions that differ between the curves are written, e.g. “glass”, “PET”), or *None*. Drag a label to move it. **Rename curves** gives any curve your own name (for example “stainless steel”), used in the legend and on the curves. **Axis titles** lets you type your own X and Y axis titles (leave empty for the automatic one; the Y title goes back to automatic when you change the Y quantity). **Graph title** adds an optional bold title above the graph; *Use …* fills in the conditions all curves share (e.g. “0.25 · 2.5 M”). Labels and title are saved with the project and included in PNG/SVG downloads.
4. **Results**: every run, mean ± SD, and failure mode (Adhesive, Cohesive, Mixed, chosen by you).
5. **Compare charge ratios**: as in Lap Shear, for example peel energy or average peel force per substrate, charge ratio and concentration.
6. **Export Excel** writes a summary, an editable chart, one sheet per run and the settings.

**What is reported, and why.** Peel test standards (ASTM D6862 and ISO 8510-1 for 90° peel of flexible-to-rigid assemblies) and hydrogel adhesion papers report more than the peak force and the area under the curve:

| Quantity | Definition |
|---|---|
| Average peel force F̄ (steady state) | Mean force in the steady-state window, leaving out the initiation peak and the final release. ASTM D6862 records at least 76 mm of peel and disregards the first 25 mm; short gel strips use a fraction of the peeled length instead (default 20–80%, adjustable, or a custom mm range). Peak forces scatter much more than the plateau, so F̄ is the main result. |
| Steady-state force SD, CV and range | Spread of the force points in the window: CV = SD / F̄ × 100% (the standard coefficient of variation). A higher CV means the force varied more within the window, for example from stick–slip, uneven bonding, or a window that still includes part of the initiation or the release. No standard sets a pass/fail value for it; compare it between your own runs. |
| Peel strength | F̄ / w, in N/m and N/mm. |
| Peel energy G | G = F̄ / w · (1 − cos θ), in J/m²; at 90° this equals F̄ / w. The energy balance of a steady peel of a strip that does not stretch (Rivlin 1944; Kendall 1975, J. Phys. D 8, 1449, with the elastic term neglected), as used for the interfacial toughness of hydrogels in 90° peel (e.g. Yuk et al. 2016, Nature Materials 15, 190). A 180° peel would give 2F̄/w. Called “apparent interfacial toughness Γ” before version 1.10. |
| Peak force (maximum), peak per width | Highest force anywhere in the run. In many gel strips this is the last rise before detachment, not the start of peeling. |
| Initiation peak force | Highest force between the start of the run and the start of the steady-state window: the force needed to start the peel front. |
| Area under the graph (work) and work per peeled area | W = ∫ F dδ (mJ) over the full curve, to detachment, and over a chosen range (Settings › Work: full curve, start to peak, **steady-state window**, or a custom mm range); work to detachment / (w × peeled length) is an energy-based estimate that should be close to Γ for a steady peel. |
| Peeled length, detachment | End of peeling: force below 5% of the peak for 20 points (adjustable; a typed value overrides it). If none is found, the end of the recording is used and the run says so. |
| Peel rate, angle, width, failure mode | Test conditions to report alongside the results. |

Force, displacement, baseline, loading direction, data-quality handling and work integration are the same as in Lap Shear mode.

## Excel export

The workbook is generated in the browser and contains eight sheets:

1. Experiment Summary
2. Run Summary
3. Raw Data
4. Flagged Data (score, class and reason per point)
5. Processed Data (retained points)
6. Statistical Summary
7. Charts
8. Analysis Settings (all parameters, versions, exclusions with reasons, metadata corrections, file SHA-256)

**Charts are native, editable Excel scatter charts** linked to the data columns on the Charts sheet. The free versions of SheetJS and ExcelJS cannot create charts, so this project writes the chart XML itself (`src/export/xlsxWriter.ts`). The output has been verified to open with charts in LibreOffice and to be recognised as charts by openpyxl. Please confirm it in your version of Microsoft Excel (see the status table). Sheets longer than Excel’s row limit continue on additional sheets.

The **XLSX** button next to a graph exports just that graph’s plotted data with its chart. **PNG** (4× resolution) and **SVG** export images.

## Saving work

- **Autosave:** the session (settings and copies of the imported files) is stored in this browser’s IndexedDB. When you reopen the site on the same computer and browser, you are offered to restore it. This is not a backup. It can be cleared by the browser or by you (Privacy → Remove all data). If the files exceed the browser’s storage quota, settings are still saved and you are told so.
- **Save project → Settings only:** settings, corrections, exclusions, graphs and file fingerprints (SHA-256), with no measurements. After **Load project**, select the original folder again. Files are matched by content, so moved or renamed files are still found, and changed files are reported.
- **Save project → Complete:** the same plus the original TXT files. Treat it as confidential data.

Project files carry a schema version, the app and algorithm versions, and are validated on load.

---

## Feature status

| Area | Status |
|---|---|
| TXT parsing, run detection, error reporting | Implemented and tested (synthetic + real sample files) |
| Folder/file metadata inference, 2.1 M default, overrides | Implemented and tested |
| Folder, multi-file, ZIP and drag-and-drop import | Implemented. Folder picker tested in Chromium; drag-and-drop not automatically tested |
| Peak extraction, units, displacement, baseline | Implemented and tested |
| Level A and Level B screening | Implemented and tested; thresholds are starting points to tune on your data |
| Automatic run exclusion, Keep/Exclude overrides, raw vs processed statistics | Implemented, tested (logic) and exercised in the browser |
| Two-step sidebar (open, choose experiment) and tabs (Graph, Data analysis, Compare charge ratios, Settings, Files) | Implemented; exercised in Chromium at 1280 px width |
| Lap Shear mode: runs, dimensions, strength, work, failure endpoint, baseline, statistics, Excel | Implemented and tested (synthetic cases with known answers); exercised in the browser with a real two-run lap-shear file |
| 90° Peel mode: Script-section runs, gel dimensions, average peel force, peel strength, peel energy, work, detachment, Excel | Implemented and tested (synthetic cases with known answers); exercised in the browser with a real peel file |
| Separate files per test, remove files, per-test autosave and projects | Implemented and tested; older sessions are sorted into tests by file content |
| Grouped statistics with run- and repeat-level variation | Implemented and tested |
| Excel export with native charts | Implemented and tested; **verify in Microsoft Excel** |
| PNG / SVG / graph-data export | Implemented; exercised in the browser |
| Autosave (IndexedDB), project save/load, file reconnection | Implemented and tested |
| No network transmission of data | CSP enforced; browser test confirmed only the site’s own host is contacted |
| GitHub Pages subdirectory build | Implemented; build checked in CI |
| **Equivalence with Mach-1 Analysis plots** | **Not validated.** Compare axis definitions and values on a few curves before relying on it |
| Tested browsers | Chromium (automated). Safari and Firefox: please check manually |

---

## For maintainers

The code is TypeScript + React, built with Vite. Main parts:

```
src/parser/      Mach-1 parser, folder-name metadata, ZIP import, hashing, Web Worker
src/analysis/    statistics, per-run metrics, point and run screening, grouping; lapShear.ts and peel.ts = lap-shear and 90° peel calculations
src/plotting/    Plotly wrapper, axis definitions, colours, display-only downsampling
src/export/      XLSX writer with native charts, workbook builder
src/storage/     IndexedDB autosave, project files
src/components/  interface panels (lapShear/ = Lap Shear mode, peel/ = 90° Peel mode)
tests/           automated tests (Vitest)
examples/        synthetic, non-confidential example data (and its generator in scripts/)
```

On your own computer (requires Node.js 22):

```
npm install
npm run dev        # local preview at http://localhost:5173/mach1-analyzer/
npm test           # run tests
npm run build      # production build into dist/
```

To test with real files locally, put them in a folder named `private-data/` in the project. It is listed in `.gitignore` (so it is never committed), and `tests/real-data.test.ts` uses it when present.

Deployment is unchanged: every push to `main` runs the tests, builds the site and publishes it to GitHub Pages through `.github/workflows/deploy.yml` (see below). No new dependencies are needed for Lap Shear mode.

Algorithm changes that alter numerical results should increase `ALGORITHM_VERSION` in `src/types/index.ts`. It is recorded in every export and project.

Publishing and updating: see [docs/PUBLISHING.md](docs/PUBLISHING.md).

## License

MIT, see [LICENSE](LICENSE).
