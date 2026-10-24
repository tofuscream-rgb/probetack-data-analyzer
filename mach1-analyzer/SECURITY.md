# Privacy and security model

## What the website does with your files

The website is a collection of static files (HTML, JavaScript, CSS, fonts) hosted by GitHub Pages. GitHub only serves those files; it never receives your measurements.

When you choose files, a folder or a ZIP archive, your browser reads them through its local file APIs. Everything after that happens inside the browser tab on your computer:

- parsing and analysis;
- graphs;
- Excel workbooks;
- project files.

Downloads are created in memory and saved by your browser. There is no backend, database, account system, analytics, telemetry or third-party script. All libraries (React, Plotly, fflate, the IBM Plex fonts) are bundled into the site rather than loaded from other servers.

The published page includes a **Content-Security-Policy** with `connect-src 'self'`. This is enforced by the browser: even if code tried to send data to another server with `fetch`, `XMLHttpRequest`, `WebSocket` or a beacon, the browser would block it. The only network requests the page makes are for its own files on the same github.io site.

Two researchers using the same link at the same time share nothing. Each browser works only with the files chosen on that computer.

## What is stored on your computer

- **Autosave.** The current session is stored in the browser’s IndexedDB for this website. That includes settings, decisions and copies of the imported TXT files. It stays in that browser profile on that computer until it is cleared. To remove it, use **Privacy → Remove all data from this browser**, or clear site data in the browser settings.
- **Downloaded files.** Excel workbooks, images and project files go wherever your browser saves downloads. A *complete* project file contains the original measurements.

## Limits: what this does not protect against

- **Changes to the code.** The protection depends on the website code. Anyone with write access to the GitHub repository could change it, and a compromised dependency could too. Keep the repository’s collaborators to people you trust, enable two-factor authentication on your GitHub account, and review changes before merging.
- **Shared computers.** Anyone using the same computer account and browser can open the website and restore the autosaved session. Use **Remove all data** after working on a shared machine, or use a private window. Autosave is disabled or short-lived there.
- **Browser extensions** can read the contents of pages you visit, including this one.
- **Same-origin storage.** All GitHub Pages sites under one account (for example every site under `tofuscream-rgb.github.io`) share one browser storage origin. Code on another site you publish there could read this site’s autosaved data. Do not publish untrusted pages under the same account.
- **Storage loss.** Browsers may clear IndexedDB when disk space is low, or when the user clears browsing data. Use Save project for anything important.
- **Your downloads and sharing.** Once a file is downloaded, its handling is up to you. Never commit real TXT files, complete project files or exported workbooks to the public repository. The deployment workflow refuses to publish if it finds `.txt`, `.zip` or `.xlsx` files outside the synthetic examples, but deleting a committed file does not remove it from git history.

## Checking for yourself that no data leave your computer

You can do this in about two minutes with the browser’s developer tools.

**Chrome or Edge**
1. Open the website.
2. Press F12 (Mac: ⌥⌘I) and choose the **Network** tab. Tick **Preserve log**.
3. Import a folder, analyse, export Excel and save a project.
4. Look at the **Domain** column (right-click the column headers to add it if needed). Every entry should be your own `…github.io` site. Entries of type `blob:` or `data:` are files created in memory on your computer, not uploads.
5. Optional: in the Console tab, the page reports any blocked attempt to contact another server as a Content-Security-Policy error. There should be none.

**Safari**
1. Enable Safari → Settings → Advanced → Show features for web developers.
2. Choose Develop → Show Web Inspector → **Network**, and repeat steps 3–4.

**Firefox**
1. Press F12 (Mac: ⌥⌘I) and choose **Network**.
2. Repeat steps 3–4.

A stronger test is to go offline. Load the website, turn off Wi-Fi, then import and analyse files. Everything keeps working, because nothing needs the network after the page has loaded.

## Reporting a problem

If you believe the website sends data anywhere, stop using it and contact the repository owner.
