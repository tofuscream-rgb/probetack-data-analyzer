# Publishing the website on GitHub Pages (beginner guide)

Everything here is done in the GitHub website, with no terminal. GitHub stores the code. A built-in service called **GitHub Actions** automatically tests it, builds the website and publishes it to **GitHub Pages** whenever the code changes.

Your website address will be:

```
https://tofuscream-rgb.github.io/mach1-analyzer/
```

(If you name the repository differently, the last part of the address changes to match. The site adapts automatically.)

---

## 1. Create the repository

1. Sign in at https://github.com.
2. Click **+** (top right) → **New repository**.
3. **Repository name:** `mach1-analyzer`.
4. Choose **Public**. GitHub Pages is free for public repositories. The code is public; your data never go into it.
5. Leave “Add a README”, “.gitignore” and “license” **unticked** (the project already has them).
6. Click **Create repository**.

## 2. Upload the project files

1. Unzip `mach1-analyzer.zip` on your computer. You get a folder `mach1-analyzer`.
2. **Mac users: show hidden files first.** Two important items start with a dot (`.github` and `.gitignore`), and Finder hides them. In Finder, open the `mach1-analyzer` folder and press **⌘ Shift .** (Command, Shift, full stop). Greyed-out `.github` and `.gitignore` now appear. Press the same keys again later to hide them.
3. On the new repository page, click **uploading an existing file**.
4. Open the `mach1-analyzer` folder, select **everything inside it** (⌘A), including `.github` and `.gitignore`, and drag it onto the upload area. Drag the *contents*, not the folder itself, so that `package.json` ends up at the top level of the repository.
5. Wait until all files are listed, then click **Commit changes**.
6. Check the repository’s main page. You should see `README.md`, `package.json`, `src`, `tests`, `docs`, `examples` and `.github` at the top level. If `.github` is missing, see “Adding the workflow by hand” at the end.

> Do **not** upload `node_modules`, `dist` or any folder with real measurements. The ZIP you received contains none of them.

## 3. Turn on GitHub Pages

1. In the repository, click **Settings** (top bar) → **Pages** (left menu).
2. Under **Build and deployment → Source**, choose **GitHub Actions**.

That is the only setting needed.

## 4. Run the deployment workflow

The workflow in `.github/workflows/deploy.yml` runs automatically after every change to the `main` branch. The upload you just made may have started it already.

1. Click the **Actions** tab.
2. If GitHub asks whether to enable workflows, click the green button to enable them.
3. If no run is listed, click **Test and deploy to GitHub Pages** (left) → **Run workflow** → **Run workflow**.
4. Wait 2–4 minutes. A green tick means the tests passed and the site was published. A red cross means something failed: click it, then the red step, to read the message.

## 5. Find the website address

**Settings → Pages** shows “Your site is live at …”. It is also shown in the finished workflow run, under the **deploy** step. The first publication can take a few extra minutes to become reachable.

## 6. Test that it works

1. Open the address. You should see “Mach-1 Analyzer” and the **Open folder** button.
2. Click **Try it with synthetic example data**. Several files should import, including one “No data” file and one with a warning (both intentional).
3. Tick a file, click **Add to graph**, and check the curves appear.
4. Click **Export Excel** and open the workbook. Check the **Charts** sheet, and click a chart to confirm it is a real, editable Excel chart.
5. Import one of your own folders and compare a few peak values with Mach-1 Analysis.
6. Do the privacy check in [SECURITY.md](../SECURITY.md) (“Checking for yourself”).

## 7. Updating the website after changing the code

Any change committed to the `main` branch is tested and published automatically. If the tests fail, the old version stays online.

- **Small edits in the browser:** open a file on GitHub, click the pencil icon, edit, then **Commit changes**.
- **With git tools on your computer:** commit and push to `main`, or open a pull request. A pull request runs the tests without publishing; merge it to publish.

Watch the **Actions** tab for the green tick, then reload the website. If the old version still appears, do a hard refresh (Mac: ⌘ Shift R).

## 8. Sharing with collaborators

Send them the address. They need nothing else: no GitHub account, no installation. Each person’s files stay on their own computer, and nobody can see anyone else’s data through the website. Point them to the README’s “Using the website” section.

If you later want collaborators to *change the code*, add them under **Settings → Collaborators**. Anyone with write access can change what the website does, so keep that list short (see SECURITY.md).

## 9. Making sure no experimental data were uploaded

- Look through the file list on the repository page. Only these may contain measurements:
  - `examples/synthetic-data/` (invented data)
  - `public/synthetic-example.zip` (a zipped copy of the same)
- The workflow’s first step, **“Refuse to publish if experimental data were committed”**, stops publication if it finds `.txt`, `.zip` or `.xlsx` files anywhere else.
- The `.gitignore` file tells git to ignore a local folder named `private-data/` and project/export files. Keep real files there if you work with the code locally.

### If data were uploaded by mistake

1. Open the file on GitHub → **⋯** menu → **Delete file** → **Commit changes**. The live website no longer contains it after the next run.
2. The file still exists in the repository’s *history*. If it is sensitive, the cleanest fix for a young repository is:
   1. download your current code;
   2. delete the repository (**Settings → General →** bottom of page);
   3. create it again with the same name and upload the clean code.

   For an older repository, ask for help removing it from history (GitHub documents this under “Removing sensitive data from a repository”).

## 10. Recovering or redeploying

- **Redeploy the current version:** Actions → Test and deploy to GitHub Pages → **Run workflow**.
- **A change broke the site:** open the repository’s **commits** list (click the clock icon, “… commits”), open the last good commit, and copy the old file contents back. With git tools, revert the last commit and push. The workflow republishes automatically.
- **Pages shows a 404:** check that Settings → Pages → Source is **GitHub Actions**, and that the latest workflow run is green.
- **The workflow fails at “npm ci”:** `package-lock.json` is missing or out of date. Make sure it was uploaded.
- **The page is blank:** do a hard refresh (Mac: ⌘ Shift R). If it persists, open the browser console (⌥⌘I) and check for errors.

---

### Adding the workflow by hand (if `.github` did not upload)

1. In the repository, click **Add file → Create new file**.
2. In the name box, type exactly `.github/workflows/deploy.yml`. The slashes create the folders.
3. Open `deploy.yml` from the unzipped folder in TextEdit, copy everything, paste it into GitHub, and click **Commit changes**.
4. Do the same for `.gitignore` (name: `.gitignore`).
