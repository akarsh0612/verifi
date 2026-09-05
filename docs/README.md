# Verifi — Medical Claim Fact-Checker (Chrome Extension MV3)

Verifi is an AI-powered Google Chrome extension (Manifest V3) that extracts and fact-checks health and medical claims on any webpage in real time. It highlights claims in-place and renders an interactive hover tooltip displaying scientific consensus, explanations, and rich academic paper preview cards with citations from PubMed, Crossref, and Semantic Scholar.

---

## Key Features

- **High-Speed Claim Extraction**: Uses Groq (`openai/gpt-oss-20b`) in JSON mode with strict biomedical prompts to isolate verifiable health claims and their verbatim source substrings.
- **Evidence-Grounded Fact-Checking**: Queries Gemini (`gemini-3.6-flash`) with Google Search grounding enabled to verify assertions against peer-reviewed research and public health consensus.
- **Multi-Node TreeWalker Highlighting**: Locates verbatim text across inline DOM boundaries (`<em>`, `<strong>`, links, etc.) using `TreeWalker` and wraps matches in `<mark>` elements:
  - 🟢 **Supported by Evidence** (`hc-supported`)
  - 🔴 **Refuted by Evidence** (`hc-refuted`)
  - 🟡 **Evidence Uncertain / Inconclusive** (`hc-uncertain`)
- **Shadow DOM Encapsulated Tooltips**: Complete CSS isolation preventing webpage stylesheet conflicts.
- **Rich Citation Preview Cards**: Fetches academic metadata (titles, authors, journals, publication years, and abstract snippets) dynamically via PubMed E-utilities (`esummary`/`efetch`), Crossref, and Semantic Scholar APIs.
- **Resilient Concurrency & Retries**: Batch concurrency limiting (max 2 concurrent Gemini calls), exponential backoff on HTTP 429 rate limits, and fallback model redundancy.
- **Privacy-First**: No keys hardcoded. API keys are stored solely in `chrome.storage.local`.

---

## Project Structure

```
verifi/
├── manifest.json         # Chrome MV3 manifest
├── background.js        # Service worker orchestrating Groq, Gemini & citation APIs
├── content.js           # Text extraction, TreeWalker DOM highlighter & Shadow DOM tooltip
├── content.css          # In-page highlight marker styling and animations
├── popup.html           # Popup user interface with progress bars & live claim tally
├── popup.js             # Popup interaction logic and background communication
├── options.html         # Settings UI for Groq and Gemini API keys
├── options.js           # Secure storage of configuration in chrome.storage.local
├── icons/               # 16x16, 48x48, 128x128 extension icons
│   ├── icon-16.png
│   ├── icon-48.png
│   └── icon-128.png
├── generate_icons.py    # Python icon generator using Pillow
├── test-page.html       # Built-in sample article with diverse medical claims
├── CHROMEWEBSTORE.md    # Chrome Web Store submission & permissions justifications
└── README.md            # Documentation and setup instructions
```

---

## How to Install & Use

### 1. Load Unpacked Extension in Chrome
1. Open Google Chrome and navigate to `chrome://extensions`.
2. Enable **Developer mode** toggle in the upper-right corner.
3. Click **Load unpacked**.
4. Select the directory:
   ```
   C:\Users\USER\.gemini\antigravity\scratch\verifi
   ```
5. The **Verifi** extension icon will now appear in your browser toolbar.

### 2. Configure API Keys
1. Right-click the **Verifi** toolbar icon and click **Options** (or click the gear ⚙ icon in the popup).
2. Enter your:
   - **Groq API Key**: Obtain from [console.groq.com/keys](https://console.groq.com/keys)
   - **Gemini API Key**: Obtain from [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey)
3. Click **Save Settings**.

### 3. Test with the Built-in Test Page
1. Open the included sample file `test-page.html` in Chrome:
   - File URL: `file:///C:/Users/USER/.gemini/antigravity/scratch/verifi/test-page.html`
2. Click the **Verifi** icon in the toolbar.
3. Click **Fact-Check Page**.
4. Watch the progress bar update as claims are extracted and checked.
5. Notice the highlighted claims on the page:
   - Hover over green highlights (e.g. aerobic exercise, vaccines) to see supporting consensus.
   - Hover over red highlights (e.g. alkaline water curing diabetes, colloidal silver) to see refuting medical evidence.
   - Hover over amber highlights (e.g. tart cherry extract) to see preliminary/inconclusive evidence notes.
    - Inspect the rich academic preview cards and click "Open full paper ↗" to view the citation in a new tab.
