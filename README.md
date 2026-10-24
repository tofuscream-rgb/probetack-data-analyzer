# Mach-1 Analyzer

A browser-based tool for analysing Biomomentum Mach-1 mechanical test files (TXT exports from Mach-1 Motion). It imports whole experiment folders, separates every movement (run), extracts peak forces, screens for outliers, compares conditions, exports Excel workbooks with editable charts, and saves projects.

**Website:** https://tofuscream-rgb.github.io/mach1-analyzer/

**Your data stay on your computer.** The website is a set of static files. Files you open are read by your own browser and are never uploaded. See [SECURITY.md](SECURITY.md) for exactly what that means and its limits.

No installation, account, Python or server is needed. Collaborators only need the link and a current browser (Chrome, Edge, Firefox or Safari).

---

## Using the website

1. Open the website and click **Open folder** (or drag the folder onto the page). You can also pick individual **TXT files** or a **ZIP archive**. Use **Try it with synthetic example data** to explore without your own files.
2. Check the small **Files** tab (top right). Every file is listed as OK, with warnings, or without usable data (for example a file that contains only the `<Mach-1 File>` header). Nothing is skipped silently; the tab opens by itself when an import has problems.
3. Use the **navigator** on the left: search, **filters** (charge ratio, concentration, substrate, holding time, repeat, flag) and the tree of conditions → files → runs. The filters decide which runs the Data analysis and Data summary tabs show. Each file has a ribbon with one tick per run, coloured by flag: filled = included in the processed statistics, hollow = excluded (automatically or by hand). Click a run to open its details.
4. Work through the four main tabs. The page remembers the selected tab in the project.

   - **Graph**: tick runs, whole files or whole groups in the navigator and click **Add to graph** (or **New graph** for another comparison). Choose the axes (force vs displacement by default) or **Swap axes**, show or hide single curves, and drag to zoom (**Reset zoom** or a double-click resets). **Min marker** marks each run’s minimum force (▼). With **Show excluded runs** (on by default), excluded runs are drawn as thin grey dashed lines; otherwise they are hidden. Export the graph as **PNG**, **SVG** or **XLSX** (its data with an editable chart).
   - **Data analysis**: the filtered runs as a table grouped by condition (charge ratio, concentration, substrate, holding time). Each group shows its processed mean ± SD (n). Each row shows the repeat, run, minimum force, flag colour, the reason for the flag (hover for the full text) and the status. Under **Decision**, choose **Automatic** (follow the rule in Settings), **Keep anyway** or **Exclude anyway**. Keep and Exclude ask for an optional reason, which is saved and exported. Excluded rows are greyed and their value struck through. Click a row to open its details beside the table: the force-vs-displacement curve, metadata (with **Correct metadata** for one file or a whole folder, e.g. when the concentration is only the 2.1 M default), all flag messages and notes, measured values and the point data.
   - **Data summary**: one block per charge ratio + concentration + substrate, one row per holding time. **Raw** lists every run’s value with mean ± SD and n; **Flagged** shows the same values coloured by flag (struck through when excluded); **Processed** gives mean ± SD and n after exclusions and how many runs were excluded. The chart below plots mean ± SD against holding time, one line per block, as **Raw**, **Processed** or **Both** (processed solid, raw dashed). Tick **Also show repeat-level statistics** to average each repeat first.
   - **Settings**: **Processed data** chooses which flag colours are excluded automatically (red and orange by default; manual Keep/Exclude always wins). **Run screening thresholds** holds the Level B settings, and **Force and displacement** the peak metric, unit, displacement definition and baseline. **Advanced** (collapsed) holds single-point screening, which finds one-point recording glitches inside a curve, and the point exclusion rule.
5. **Restore original data** (header) clears every manual run decision and point exclusion. **Export Excel** writes the eight-sheet workbook. **Save project** downloads a project file to continue later. The page also autosaves in your browser.

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
- **Relative displacement:** z − z₀, |z − z₀| or z₀ − z, where z₀ is the first z of the movement. This definition has **not** yet been checked against Mach-1 Analysis.
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

A single inconsistent run never invalidates its file. By default, red and orange runs are left out of the processed statistics. You can change which colours are excluded under Settings and override any single run with Keep anyway / Exclude anyway. Flags are always computed the same way, whatever is excluded.

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
| Tabbed interface (Graph, Data analysis, Data summary, Settings, Files) | Implemented; exercised in Chromium at 1280 px width |
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
