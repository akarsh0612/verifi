# Chrome Web Store Listing — Verifi - Medical Claim Fact-Checker

> Last Updated: 2026-09-05

## Store Listing

**Extension Name**
Verifi - Medical Claim Fact-Checker

**Short Description**
Detects and fact-checks medical and health claims on any webpage with real-time academic literature citations and in-page highlights.

**Detailed Description**
Verifi helps you evaluate biomedical, nutritional, and medical claims across the web by analyzing page content against verified scientific consensus.

When you click "Fact-Check Page", Verifi:
1. Scans visible page text to locate specific medical, pharmacological, or health claims.
2. Extracts verbatim statements using Groq's high-speed inference engine.
3. Fact-checks each assertion against biomedical literature using Google Gemini with Google Search grounding.
4. Highlights each claim directly in the article using color-coded badges: Green for supported by evidence, Red for refuted by evidence, and Amber for uncertain or preliminary evidence.
5. Displays rich academic preview cards on hover with study titles, authors, journals, publication years, and abstract snippets from PubMed, Crossref, and Semantic Scholar.

HOW TO USE IT:
1. Open the extension Options page and provide your Groq and Google Gemini API keys (keys are stored securely in your browser's local storage and never transmitted to any third party).
2. Visit any news article, blog post, or forum discussing health advice or medical topics.
3. Click the Verifi icon in your browser toolbar and select "Fact-Check Page".
4. Review the claim counter and hover over any highlighted text on the page to view the scientific consensus and study citations.

PRIVACY & DATA USE:
Verifi does not track your browsing history or collect personally identifiable information. Page text is only sent to your designated Groq and Gemini API endpoints upon explicit user click, and your API keys are stored locally on your device.

SUPPORT:
For questions, feedback, or issues, please visit our GitHub repository or contact support.

**Category**
Search Tools

**Single Purpose**
Finds and fact-checks medical and health assertions on web pages against peer-reviewed scientific literature.

**Primary Language**
English

---

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `icons/icon-128.png` |
| Small Icon | 16×16 PNG | ✅ Ready | `icons/icon-16.png` |
| Medium Icon | 48×48 PNG | ✅ Ready | `icons/icon-48.png` |
| Screenshot 1 [REQUIRED] | 1280×800 | ⬜ To capture | In-page highlights and tooltip on article |
| Screenshot 2 [RECOMMENDED] | 1280×800 | ⬜ To capture | Extension popup with progress and stats |
| Screenshot 3 [RECOMMENDED] | 1280×800 | ⬜ To capture | Options page with secure API key setup |

---

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `activeTab` | permissions | Required to read visible article text and highlight claims on the currently active tab when the user clicks "Fact-Check Page". |
| `scripting` | permissions | Required to inject the content highlighter script (`content.js`) and highlight styling (`content.css`) into the active tab on user invocation. |
| `storage` | permissions | Required to persist user API keys (Groq and Gemini) and save per-tab fact-checking results across popup sessions. |
| `https://api.groq.com/*` | host_permissions | Required to communicate with Groq chat completions API for high-speed biomedical claim extraction. |
| `https://generativelanguage.googleapis.com/*` | host_permissions | Required to communicate with Google Gemini API with Google Search grounding tool to fact-check claims against authoritative sources. |
| `https://eutils.ncbi.nlm.nih.gov/*` | host_permissions | Required to fetch paper metadata and abstract snippets from PubMed E-utilities for scientific citation cards. |
| `https://api.semanticscholar.org/*` | host_permissions | Required to look up scholarly paper metadata and author information for citation preview cards. |
| `https://api.crossref.org/*` | host_permissions | Required to resolve DOI citations and fetch journal container titles and publication metadata. |

---

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

| Data Type | Collected? | Transmitted Off-Device? | Purpose | Shared with Third Parties? |
|-----------|-----------|------------------------|---------|---------------------------|
| Personally identifiable info | No | No | N/A | No |
| Health info | No | No | N/A | No |
| Financial info | No | No | N/A | No |
| Authentication info | No | No | Keys stored in local storage only | No |
| Personal communications | No | No | N/A | No |
| Location | No | No | N/A | No |
| Web history | No | No | N/A | No |
| User activity | No | No | N/A | No |
| Website content | User-initiated only | Transmitted only to Groq & Gemini APIs | Only on explicit click to evaluate claims on current page | Not shared with any other parties |

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

---

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.0.0 | 2026-09-05 | Initial release with Groq claim extraction, Gemini Search grounding, multi-node TreeWalker highlighter, and rich academic citation preview cards. | Draft |
