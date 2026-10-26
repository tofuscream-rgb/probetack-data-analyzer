# Mach-1 Analyzer

A browser-based tool for analysing Biomomentum Mach-1 mechanical test files (TXT exports from Mach-1 Motion). It imports whole experiment folders, separates every movement (run), extracts peak forces, screens for outliers, compares conditions, exports Excel workbooks with editable charts, and saves projects.

**Website:** https://tofuscream-rgb.github.io/mach1-analyzer/

**Your data stay on your computer.** The website is a set of static files. Files you open are read by your own browser and are never uploaded. See [SECURITY.md](SECURITY.md) for exactly what that means and its limits.

No installation, account, Python or server is needed. Collaborators only need the link and a current browser (Chrome, Edge, Firefox or Safari).

---

## Using the website

**1. Open your experiments** (left side). Choose how to import, **folder** (recommended), **TXT file(s)** or a **ZIP file**, and click **Browse**. You can also drag a folder onto the page. Every TXT file found is listed, with its sub-folders kept. **Try it with example data** loads invented example files.

**2. Choose your experiment.** The dropdowns are built from your folder names:

- **Charge ratio**, then **Total monomer concentration** (only the concentrations measured at that charge ratio), then **Substrate**.
- **TXT file to view**: the files of that experiment, sorted by holding time (e.g. `1s.txt`, `1s-2.txt`, `30s.txt`, `60s.txt`).
- Tick **Overlay additional TXT files** to put more files of the same experiment on the graph. Use it to check that repeats agree (`1s.txt` and `1s-3.txt`) or to compare holding times (`1s`, `30s`, `60s`).

The small ticks next to each file show its runs, coloured by flag. A hollow tick is an outlier that is left out of the averages.

**3. Look at the results** in the tabs:

- **Graph**: adhesion force vs displacement for every run of the chosen file(s). Every run starts at displacement 0, and adhesion is shown as a positive force (both can be changed under Settings → Force and displacement). Change the axes, show or hide single runs or whole files, and drag to zoom. ▲ marks each run's peak adhesion force. Outlier runs are drawn grey and dashed; untick **Show outlier runs** to hide them. **Save graph** as PNG, SVG or an Excel file with an editable chart.
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
| `60s.txt` | Repeat 1. `60s-2.txt`, `60s-3.txt` are separate repeats (Repeat 2, Repeat 3), never merged. |

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
src/analysis/    statistics, per-run metrics, point and run screening, grouping
src/plotting/    Plotly wrapper, axis definitions, colours, display-only downsampling
src/export/      XLSX writer with native charts, workbook builder
src/storage/     IndexedDB autosave, project files
src/components/  interface panels
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

To test with real files locally, put them in a folder named `private-data/` in the project. It is git-ignored, and `tests/real-data.test.ts` uses it when present.

Algorithm changes that alter numerical results should increase `ALGORITHM_VERSION` in `src/types/index.ts`. It is recorded in every export and project.

Publishing and updating: see [docs/PUBLISHING.md](docs/PUBLISHING.md).

## License

MIT, see [LICENSE](LICENSE).
