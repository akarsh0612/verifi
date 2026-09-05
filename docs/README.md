# Verifi — Medical Claim Fact-Checker (Chrome Extension MV3)

Verifi is an AI-powered Google Chrome extension (Manifest V3) that extracts and fact-checks health and medical claims on any webpage in real time. It highlights claims in-place and renders an interactive hover tooltip displaying scientific consensus, explanations, and rich academic paper preview cards with citations from PubMed, Crossref, and Semantic Scholar.

---

## Key Features

- **High-Speed Claim Extraction**: Uses Groq (`groq/compound-mini` with high TPM quota) in JSON mode with strict biomedical prompts to isolate verifiable health claims and their verbatim source substrings.
- **Evidence-Grounded Fact-Checking**: Queries Gemini (`gemini-3.5-flash` with automatic model fallback) with Google Search grounding enabled to verify assertions against peer-reviewed research and public health consensus.
- **Multi-Node TreeWalker Highlighting**: Locates verbatim text across inline DOM boundaries (`<em>`, `<strong>`, links, etc.) using `TreeWalker` and wraps matches in `<mark>` elements:
  - 🟢 **Supported by Evidence** (`hc-supported`)
  - 🔴 **Refuted by Evidence** (`hc-refuted`)
  - 🟡 **Evidence Uncertain / Inconclusive** (`hc-uncertain`)
- **Shadow DOM Encapsulated Tooltips**: Complete CSS isolation preventing webpage stylesheet conflicts.
- **Rich Citation Preview Cards**: Fetches academic metadata (titles, authors, journals, publication years, and abstract snippets) dynamically via PubMed E-utilities (`esummary`/`efetch`), Crossref, and Semantic Scholar APIs.
- **Resilient Concurrency & Retries**: Batch concurrency limiting, exponential backoff on HTTP 429 rate limits, and fallback model redundancy.
- **Privacy-First & Secure Architecture**: No API keys committed to git. Credentials are kept exclusively in `.env` and compiled into runtime configuration via `sync_env`.

---

## Project Structure

```
Verifi/
├── .env                     # Local environment variables & API keys (git-ignored)
├── .env.example             # Template for required environment variables
├── .gitignore               # Excludes secrets, local configs, and Python caches
├── sync_env.bat             # Windows one-click script to compile .env into config.js
├── watch_env.bat            # Windows daemon to auto-compile config.js on .env file save
├── test-page.html           # Built-in sample article with diverse biomedical claims
│
├── docs/
│   ├── README.md            # Comprehensive project documentation & setup guide
│   └── CHROMEWEBSTORE.md    # Chrome Web Store listing, permissions audit, & privacy policy
│
├── extension/               # Unpacked extension root (load this directory in Chrome)
│   ├── manifest.json        # Chrome MV3 manifest
│   ├── config.js            # Auto-compiled runtime configuration (from .env)
│   ├── background.js        # MV3 Service Worker: extraction, verification, & citations
│   ├── content.js           # TreeWalker DOM highlighter & Shadow DOM tooltip
│   ├── content.css          # In-page highlight marker styling and badge animations
│   ├── popup.html           # Toolbar popup user interface
│   ├── popup.js             # Popup interaction logic, progress bar, & claim tally
│   ├── options.html         # Settings UI for grounding, pacing, & batch sizes
│   ├── options.js           # Settings persistence in chrome.storage.local
│   └── icons/               # Extension icons (16x16, 48x48, 128x128)
│       ├── icon-16.png
│       ├── icon-48.png
│       └── icon-128.png
│
└── util/
    ├── generate_icons.py    # Generates extension icon PNGs using Pillow
    ├── sync_env.py          # Compiles root .env to extension/config.js
    └── watch_env.py         # Real-time watcher daemon for .env edits
```

---

## How to Install & Use

### 1. Configure Environment & API Keys
1. Open the project root folder:
   - Ensure a `.env` file exists (copy from `.env.example` if creating for the first time).
2. Add your API keys in `.env`:
   - **Groq API Key**: Obtain from [console.groq.com/keys](https://console.groq.com/keys)
   - **Google Gemini API Key**: Obtain from [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
3. Compile the `.env` file into extension configuration:
   - On Windows, double-click `sync_env.bat` or run:
     ```bash
     python util/sync_env.py
     ```
   - *(Optional)* During development, run `watch_env.bat` (or `python util/watch_env.py`) to auto-sync every time you save changes to `.env`.

### 2. Load Unpacked Extension in Chrome
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable the **Developer mode** toggle in the upper-right corner.
3. Click **Load unpacked**.
4. Select the **`extension/`** subdirectory inside this project (e.g. `C:\Verifi_New\extension`).
5. The **Verifi** extension icon will now appear in your browser toolbar.

### 3. Customize Settings (Optional)
1. Right-click the **Verifi** toolbar icon and select **Options** (or click the gear ⚙ icon in the popup).
2. Confirm that your Groq and Gemini keys show as **Active**.
3. Adjust runtime preferences:
   - **Google Search Grounding**: Toggle live web search verification on or off.
   - **Cooldown Between Requests**: Adjust pacing delay (default: 6 seconds) to prevent free-tier rate limits.
   - **Claims per Request**: Adjust batch size (default: 8 claims per request).
4. Click **Save Options**.

### 4. Test with the Built-in Test Page
1. Open the included sample file `test-page.html` in Chrome:
   - Open `test-page.html` directly or navigate to `file:///C:/Verifi_New/test-page.html`.
2. Click the **Verifi** icon in the toolbar.
3. Click **Fact-Check Page**.
4. Watch the progress bar update in real time as claims are extracted and checked.
5. Inspect the highlighted claims directly on the page:
   - Hover over **green highlights** (e.g., aerobic exercise, vaccines) to see supporting consensus.
   - Hover over **red highlights** (e.g., alkaline water curing diabetes, colloidal silver) to see refuting medical evidence.
   - Hover over **amber highlights** (e.g., tart cherry extract) to see preliminary/inconclusive evidence notes.
   - Inspect the rich academic preview cards and click "Open full paper ↗" to view the citation in a new tab.
