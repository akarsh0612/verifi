/**
 * HealthCheck - Background Service Worker (Manifest V3)
 * Orchestrates Groq claim extraction, Gemini fact-checking with Google Search grounding,
 * concurrency queueing, retry handling, and academic paper metadata resolution.
 */

// Default models
const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-20b';
const DEFAULT_GEMINI_MODEL = 'gemini-3.6-flash';
const CONCURRENCY_LIMIT = 2;

// In-memory citation cache (persists while service worker is active)
const citationCache = new Map();

/**
 * Message Listener
 */
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  (async () => {
    try {
      switch (message.type) {
        case 'CHECK_STATUS': {
          const { groqApiKey, geminiApiKey } = await chrome.storage.local.get([
            'groqApiKey',
            'geminiApiKey'
          ]);
          sendResponse({
            hasGroqKey: Boolean(groqApiKey?.trim()),
            hasGeminiKey: Boolean(geminiApiKey?.trim())
          });
          break;
        }

        case 'RUN_SCAN': {
          const tabId = message.tabId;
          const result = await handleScanRequest(tabId);
          sendResponse(result);
          break;
        }

        case 'RESOLVE_CITATION': {
          const metadata = await resolveCitationMetadata(message.citation);
          sendResponse({ success: true, metadata });
          break;
        }

        case 'GET_TAB_CLAIMS': {
          const tabId = message.tabId;
          const { [getTabKey(tabId)]: tabData } = await chrome.storage.session.get(getTabKey(tabId));
          sendResponse({ tabData: tabData || null });
          break;
        }

        default:
          sendResponse({ error: `Unknown message type: ${message.type}` });
      }
    } catch (err) {
      console.error('[HealthCheck SW Error]', err);
      sendResponse({ error: err.message || 'An unexpected error occurred in background script.' });
    }
  })();
  return true; // Keep channel open for async response
});

function getTabKey(tabId) {
  return `tab_scan_${tabId}`;
}

/**
 * Main Scan Orchestrator
 */
async function handleScanRequest(tabId) {
  const {
    groqApiKey,
    geminiApiKey,
    groqModel = DEFAULT_GROQ_MODEL,
    geminiModel = DEFAULT_GEMINI_MODEL
  } = await chrome.storage.local.get([
    'groqApiKey',
    'geminiApiKey',
    'groqModel',
    'geminiModel'
  ]);

  if (!groqApiKey?.trim()) {
    throw new Error('Groq API Key is missing. Please set it in HealthCheck Options.');
  }
  if (!geminiApiKey?.trim()) {
    throw new Error('Gemini API Key is missing. Please set it in HealthCheck Options.');
  }

  // Ensure content script and styles are injected
  await ensureContentScriptInjected(tabId);

  // 1. Extract visible text from active tab
  notifyPopup(tabId, { state: 'extracting', message: 'Extracting visible text from page...' });
  
  let pageTextData;
  try {
    pageTextData = await chrome.tabs.sendMessage(tabId, { type: 'EXTRACT_TEXT' });
  } catch (err) {
    throw new Error('Could not read text from page. Please refresh the page and try again.');
  }

  if (!pageTextData || !pageTextData.text || pageTextData.text.trim().length < 50) {
    throw new Error('No sufficient readable text found on this page.');
  }

  // 2. Call Groq to extract medical claims
  notifyPopup(tabId, {
    state: 'analyzing',
    message: 'Analyzing text for medical claims with Groq...'
  });

  const claims = await extractClaimsWithGroq(pageTextData.text, groqApiKey.trim(), groqModel.trim() || DEFAULT_GROQ_MODEL);

  if (!claims || claims.length === 0) {
    const emptyResult = {
      status: 'complete',
      totalClaims: 0,
      checkedClaims: 0,
      claims: []
    };
    await chrome.storage.session.set({ [getTabKey(tabId)]: emptyResult });
    notifyPopup(tabId, { state: 'complete', ...emptyResult });
    return emptyResult;
  }

  // Save initial claims state
  const initialTabData = {
    status: 'checking',
    totalClaims: claims.length,
    checkedClaims: 0,
    claims: claims.map((c, i) => ({
      id: `claim-${i}-${Date.now()}`,
      verbatim_text: c.verbatim_text,
      normalized_claim: c.normalized_claim,
      status: 'pending',
      verdict: null,
      explanation: null,
      citations: []
    }))
  };

  await chrome.storage.session.set({ [getTabKey(tabId)]: initialTabData });
  notifyPopup(tabId, { state: 'claims_found', ...initialTabData });

  // 3. Batched verification via Gemini to minimize API requests and avoid 429 quota exhaustion
  let activeModel = (geminiModel?.trim() || DEFAULT_GEMINI_MODEL);
  if (activeModel.includes('2.0')) {
    activeModel = DEFAULT_GEMINI_MODEL;
    await chrome.storage.local.set({ geminiModel: DEFAULT_GEMINI_MODEL });
  }

  const {
    enableSearchGrounding = true,
    pacingDelay = 6000,
    batchSize = 8
  } = await chrome.storage.local.get(['enableSearchGrounding', 'pacingDelay', 'batchSize']);

  // Chunk claims into larger batches (default 8) to reduce total requests down to 1-2 calls per page
  const parsedBatchSize = Math.max(1, parseInt(batchSize, 10) || 8);
  const parsedDelay = Math.max(1000, parseInt(pacingDelay, 10) || 6000);

  const batches = [];
  for (let i = 0; i < initialTabData.claims.length; i += parsedBatchSize) {
    batches.push(initialTabData.claims.slice(i, i + parsedBatchSize));
  }

  let checkedCount = 0;
  const verifiedClaims = [];

  for (let b = 0; b < batches.length; b++) {
    const batch = batches[b];

    // Throttle pacing between batches to respect free tier rate limits
    if (b > 0) {
      notifyPopup(tabId, {
        state: 'progress',
        totalClaims: claims.length,
        checkedClaims: checkedCount,
        message: `Pacing API calls to avoid rate limits (${Math.round(parsedDelay / 1000)}s cooldown)...`
      });
      await new Promise((r) => setTimeout(r, parsedDelay));
    }

    notifyPopup(tabId, {
      state: 'progress',
      totalClaims: claims.length,
      checkedClaims: checkedCount,
      message: `Verifying batch ${b + 1} of ${batches.length} with Gemini...`
    });

    const evaluatedBatch = await verifyBatchWithGemini(
      batch,
      geminiApiKey.trim(),
      activeModel,
      enableSearchGrounding
    );

    for (const evaluatedClaim of evaluatedBatch) {
      verifiedClaims.push(evaluatedClaim);
      checkedCount++;

      // Update session storage
      const { [getTabKey(tabId)]: curData } = await chrome.storage.session.get(getTabKey(tabId));
      if (curData) {
        curData.checkedClaims = checkedCount;
        const target = curData.claims.find((c) => c.id === evaluatedClaim.id);
        if (target) Object.assign(target, evaluatedClaim);
        await chrome.storage.session.set({ [getTabKey(tabId)]: curData });
      }

      // Notify popup about incremental progress
      notifyPopup(tabId, {
        state: 'progress',
        totalClaims: claims.length,
        checkedClaims: checkedCount,
        claim: evaluatedClaim
      });

      // Send highlighted claim to content script for in-page highlighting
      try {
        await chrome.tabs.sendMessage(tabId, {
          type: 'HIGHLIGHT_CLAIM',
          claim: evaluatedClaim
        });
      } catch (domErr) {
        console.warn('Failed to send highlight to tab:', domErr);
      }
    }
  }

  const finalResult = {
    status: 'complete',
    totalClaims: claims.length,
    checkedClaims: checkedCount,
    claims: verifiedClaims
  };

  await chrome.storage.session.set({ [getTabKey(tabId)]: finalResult });
  notifyPopup(tabId, { state: 'complete', ...finalResult });

  return finalResult;
}

/**
 * Ensure content.js and content.css are active on the tab
 */
async function ensureContentScriptInjected(tabId) {
  try {
    const pong = await chrome.tabs.sendMessage(tabId, { type: 'PING' });
    if (pong && pong.status === 'ok') return;
  } catch (_) {
    // Script not present, proceed to inject
  }

  await chrome.scripting.insertCSS({
    target: { tabId },
    files: ['content.css']
  });

  await chrome.scripting.executeScript({
    target: { tabId },
    files: ['content.js']
  });
}

/**
 * Send progress update to popup if open
 */
function notifyPopup(tabId, payload) {
  chrome.runtime.sendMessage({
    type: 'SCAN_UPDATE',
    tabId,
    ...payload
  }).catch(() => {
    // Popup might be closed, perfectly normal
  });
}

/**
 * Extract claims using Groq chat completions
 */
async function extractClaimsWithGroq(text, apiKey, model) {
  // Truncate to reasonable context window (~16,000 characters)
  const truncatedText = text.slice(0, 16000);

  const systemPrompt = `You are a strict biomedical information extraction engine.
Your task is to identify and extract medical, health, nutritional, therapeutic, pharmacological, and physiological claims from the text.

CRITICAL EXTRACTION RULES:
1. Extract ONLY objective assertions of medical/health fact (e.g. disease etiology, clinical treatments, drug efficacy, herbal remedies, physiological mechanisms, vaccine safety, dietary impacts, health risks).
2. Completely IGNORE:
   - Personal opinions, subjective stories, questions, speculations.
   - Non-medical statements (technology, business, daily routines, politics).
   - Metaphorical or vague colloquialisms.
3. EXACT VERBATIM MATCH REQUIRED:
   - For every claim, you MUST copy the EXACT, UNMODIFIED substring from the provided text as 'verbatim_text'.
   - Do NOT rephrase, correct spelling, or change punctuation in 'verbatim_text'. It MUST match character-for-character so it can be located in the webpage DOM.
4. Provide a 'normalized_claim': A concise, factual 1-sentence statement of the core health assertion.

OUTPUT FORMAT:
You MUST respond with valid JSON matching:
{
  "claims": [
    {
      "verbatim_text": "Exact substring as it appears in the text",
      "normalized_claim": "Concise normalized claim statement"
    }
  ]
}
If no health or medical claims are found, return: { "claims": [] }`;

  const response = await fetch('https://api.groq.com/openai/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: model,
      response_format: { type: 'json_object' },
      temperature: 0.1,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: `Extract all medical and health claims from this webpage text:\n\n${truncatedText}` }
      ]
    })
  });

  if (!response.ok) {
    let errorDetails = '';
    try {
      const errJson = await response.json();
      errorDetails = errJson?.error?.message || response.statusText;
    } catch (_) {
      errorDetails = response.statusText;
    }
    throw new Error(`Groq API Error (${response.status}): ${errorDetails}`);
  }

  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  if (!content) return [];

  try {
    const parsed = JSON.parse(content);
    if (Array.isArray(parsed.claims)) {
      // Filter out claims that have empty verbatim_text
      return parsed.claims.filter(
        (c) => c && typeof c.verbatim_text === 'string' && c.verbatim_text.trim().length > 5
      );
    }
    return [];
  } catch (err) {
    console.error('Failed to parse Groq JSON output:', content);
    return [];
  }
}

/**
 * Verify a batch of claims with Gemini using Google Search grounding
 * Bundling claims into batches minimizes API calls and avoids HTTP 429 rate limit errors.
 */
async function verifyBatchWithGemini(claims, apiKey, model, enableSearch = true, retryCount = 0) {
  if (!claims || claims.length === 0) return [];

  const claimsListPrompt = claims
    .map((c, i) => `[Claim #${i + 1} | ID: ${c.id}]\n- Normalized Claim: "${c.normalized_claim}"\n- Context: "${c.verbatim_text}"`)
    .join('\n\n');

  const prompt = `Fact-check the following health/medical claims against current biomedical and scientific consensus.
${enableSearch ? 'Use the Google Search tool to ground your response in verified peer-reviewed scientific literature, clinical trials, or authoritative public health institutions.' : 'Evaluate each claim based on established biomedical and clinical consensus.'}

${claimsListPrompt}

You MUST return a STRICT JSON object only (no markdown fences, no text outside the JSON) conforming to this exact schema:
{
  "evaluations": [
    {
      "id": "Claim ID as specified above (e.g. ${claims[0].id})",
      "verdict": "supported" | "refuted" | "uncertain",
      "explanation": "A concise one-line scientific consensus explanation for this specific claim.",
      "citations": [
        {
          "title": "Study, trial, or guideline title",
          "url": "Direct URL to paper, PubMed, DOI, or health agency"
        }
      ]
    }
  ]
}

Verdict criteria:
- "supported": Strong peer-reviewed scientific consensus or clinical evidence supports the claim.
- "refuted": Robust scientific consensus or clinical trials disprove or contradict the claim.
- "uncertain": Evidence is preliminary, mixed, inconclusive, or insufficient.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ]
  };

  if (enableSearch) {
    requestBody.tools = [{ google_search: {} }];
  }

  let response;
  try {
    response = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(requestBody)
    });
  } catch (netErr) {
    if (retryCount < 2) {
      await new Promise((r) => setTimeout(r, 2000));
      return verifyBatchWithGemini(claims, apiKey, model, enableSearch, retryCount + 1);
    }
    throw new Error(`Network error contacting Gemini: ${netErr.message}`);
  }

  // Handle Rate Limit (HTTP 429) with progressive backoff & search tool fallback
  if (response.status === 429) {
    if (retryCount < 2) {
      const waitMs = (retryCount + 1) * 6000;
      console.warn(`[HealthCheck] Gemini 429 hit. Backing off for ${waitMs}ms (retry #${retryCount + 1})...`);
      await new Promise((r) => setTimeout(r, waitMs));
      // On retry, disable search tool to bypass search-grounding quota limits
      return verifyBatchWithGemini(claims, apiKey, model, false, retryCount + 1);
    }

    let errMsg = 'Gemini quota/rate limit exceeded (429).';
    try {
      const errData = await response.json();
      errMsg = errData.error?.message || errMsg;
    } catch (_) {}

    return claims.map((c) => ({
      ...c,
      status: 'verified',
      verdict: 'uncertain',
      explanation: `Quota limit (429): ${errMsg.slice(0, 160)}`,
      citations: []
    }));
  }

  // Handle 400 Bad Request on tools (e.g. search tool not available on this tier)
  if (!response.ok && response.status === 400 && enableSearch) {
    console.warn('[HealthCheck] Google search tool rejected with 400, retrying batch without search tool...');
    return verifyBatchWithGemini(claims, apiKey, model, false, retryCount);
  }

  if (!response.ok) {
    let errMsg = response.statusText;
    try {
      const errData = await response.json();
      errMsg = errData.error?.message || errMsg;
    } catch (_) {}
    throw new Error(`Gemini API Error (${response.status}): ${errMsg}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  const rawText = candidate?.content?.parts?.[0]?.text || '';
  const parsed = parseJsonFromText(rawText);
  const groundingCitations = extractGroundingCitations(candidate?.groundingMetadata);

  // Normalize evaluations array
  let evalList = [];
  if (Array.isArray(parsed)) {
    evalList = parsed;
  } else if (parsed && Array.isArray(parsed.evaluations)) {
    evalList = parsed.evaluations;
  } else if (parsed && Array.isArray(parsed.results)) {
    evalList = parsed.results;
  } else if (parsed && Array.isArray(parsed.claims)) {
    evalList = parsed.claims;
  } else if (parsed && typeof parsed === 'object') {
    evalList = Object.values(parsed).filter((v) => v && typeof v === 'object' && v.verdict);
  }

  return claims.map((claim, index) => {
    let ev = evalList.find((e) => e && (e.id === claim.id || e.id === `Claim #${index + 1}`));
    if (!ev && evalList[index]) {
      ev = evalList[index];
    }

    let verdict = (ev?.verdict || 'uncertain').toLowerCase();
    if (verdict.includes('support')) verdict = 'supported';
    else if (verdict.includes('refut') || verdict.includes('false') || verdict.includes('debunk')) verdict = 'refuted';
    else verdict = 'uncertain';

    const explanation = ev?.explanation || (rawText ? rawText.slice(0, 160) : 'No specific evaluation text returned.');

    const citations = [];
    const seenUrls = new Set();
    if (Array.isArray(ev?.citations)) {
      for (const c of ev.citations) {
        if (c && c.url && !seenUrls.has(c.url)) {
          seenUrls.add(c.url);
          citations.push({ title: c.title || 'Scientific Source', url: c.url });
        }
      }
    }
    if (citations.length === 0 && groundingCitations.length > 0) {
      for (const gc of groundingCitations) {
        if (gc && gc.url && !seenUrls.has(gc.url)) {
          seenUrls.add(gc.url);
          citations.push(gc);
        }
      }
    }

    return {
      ...claim,
      status: 'verified',
      verdict,
      explanation,
      citations: citations.slice(0, 4)
    };
  });
}

/**
 * Verify a claim with Gemini using Google Search grounding
 */
async function verifyClaimWithGemini(claim, apiKey, model, isRetry = false) {
  const prompt = `Fact-check this medical/health claim against biomedical and scientific consensus.
Use the Google Search tool to ground your response in verified peer-reviewed medical literature, clinical guidelines, or authoritative public health institutions.

Claim to evaluate: "${claim.normalized_claim}"
Original page context: "${claim.verbatim_text}"

Return STRICT JSON only (no markdown backticks, no text outside the JSON object) adhering to this schema:
{
  "verdict": "supported" | "refuted" | "uncertain",
  "explanation": "A concise one-line scientific explanation of current biomedical consensus regarding this claim.",
  "citations": [
    {
      "title": "Full title of study, trial, systematic review, or authoritative guideline",
      "url": "Direct URL to paper, PubMed, DOI link, or health agency source"
    }
  ]
}

Criteria:
- "supported": High-quality scientific consensus or clinical trials support the claim.
- "refuted": High-quality scientific consensus, systematic reviews, or trials disprove or contradict the claim.
- "uncertain": Evidence is inconclusive, conflicting, preliminary, or of low quality.`;

  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;

  const requestBody = {
    contents: [
      {
        role: 'user',
        parts: [{ text: prompt }]
      }
    ],
    tools: [
      { google_search: {} }
    ]
  };

  let response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': apiKey
    },
    body: JSON.stringify(requestBody)
  });

  if (response.status === 429 && !isRetry) {
    // Retry once on rate limit with backoff
    await new Promise((r) => setTimeout(r, 2500));
    return verifyClaimWithGemini(claim, apiKey, model, true);
  }

  // If 400 Bad Request (e.g. google_search tool not permitted on this API key/tier), retry once on same model without tool
  if (!response.ok && response.status === 400 && !isRetry) {
    console.warn(`Search tool rejected with 400, retrying ${model} without search tool...`);
    const fallbackBody = {
      contents: [
        {
          role: 'user',
          parts: [{ text: prompt }]
        }
      ]
    };
    const fallbackResp = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': apiKey
      },
      body: JSON.stringify(fallbackBody)
    });
    if (fallbackResp.ok) {
      response = fallbackResp;
    }
  }

  if (!response.ok) {
    let errMsg = response.statusText;
    try {
      const errData = await response.json();
      errMsg = errData.error?.message || errMsg;
    } catch (_) {}
    throw new Error(`Gemini API Error (${response.status}): ${errMsg}`);
  }

  const data = await response.json();
  const candidate = data.candidates?.[0];
  if (!candidate) {
    return {
      verdict: 'uncertain',
      explanation: 'No response candidate generated by Gemini.',
      citations: []
    };
  }

  const rawText = candidate.content?.parts?.[0]?.text || '';
  let parsed = parseJsonFromText(rawText);

  // Extract grounding citations from Gemini's Google Search groundingMetadata
  const groundingCitations = extractGroundingCitations(candidate.groundingMetadata);

  if (!parsed || typeof parsed !== 'object') {
    parsed = {
      verdict: 'uncertain',
      explanation: rawText.replace(/[\n\r]+/g, ' ').slice(0, 160),
      citations: []
    };
  }

  // Normalize verdict
  const v = (parsed.verdict || '').toLowerCase();
  if (v.includes('support')) parsed.verdict = 'supported';
  else if (v.includes('refut') || v.includes('false') || v.includes('debunk')) parsed.verdict = 'refuted';
  else parsed.verdict = 'uncertain';

  // Merge citations: combine LLM citations with grounding metadata citations
  const combinedCitations = [];
  const seenUrls = new Set();

  if (Array.isArray(parsed.citations)) {
    for (const c of parsed.citations) {
      if (c && c.url && !seenUrls.has(c.url)) {
        seenUrls.add(c.url);
        combinedCitations.push({
          title: c.title || 'Scientific Reference',
          url: c.url
        });
      }
    }
  }

  for (const gc of groundingCitations) {
    if (gc && gc.url && !seenUrls.has(gc.url)) {
      seenUrls.add(gc.url);
      combinedCitations.push(gc);
    }
  }

  parsed.citations = combinedCitations.slice(0, 4); // Keep up to 4 top sources
  return parsed;
}

/**
 * Extract citations from Gemini's grounding metadata
 */
function extractGroundingCitations(metadata) {
  if (!metadata) return [];
  const citations = [];
  
  if (Array.isArray(metadata.groundingChunks)) {
    for (const chunk of metadata.groundingChunks) {
      if (chunk?.web?.uri) {
        citations.push({
          title: chunk.web.title || 'Web Reference',
          url: chunk.web.uri
        });
      }
    }
  }

  return citations;
}

/**
 * Parse strict or fenced JSON from model response
 */
function parseJsonFromText(text) {
  if (!text) return null;
  // Try direct parse
  try {
    return JSON.parse(text);
  } catch (_) {}

  // Strip markdown code fences ```json ... ```
  const match = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  if (match && match[1]) {
    try {
      return JSON.parse(match[1]);
    } catch (_) {}
  }

  // Look for first '{' and last '}'
  const start = text.indexOf('{');
  const end = text.lastIndexOf('}');
  if (start !== -1 && end !== -1 && end > start) {
    try {
      return JSON.parse(text.substring(start, end + 1));
    } catch (_) {}
  }

  return null;
}

/**
 * Concurrency Pool: Run async tasks with limited concurrency
 */
async function runConcurrencyPool(items, limit, asyncFn) {
  const results = [];
  const executing = new Set();

  for (const item of items) {
    const promise = Promise.resolve().then(() => asyncFn(item));
    results.push(promise);
    executing.add(promise);

    const clean = () => executing.delete(promise);
    promise.then(clean, clean);

    if (executing.size >= limit) {
      await Promise.race(executing);
    }
  }

  return Promise.all(results);
}

/**
 * Rich Academic Paper Metadata Resolver
 * Fetches title, authors, journal/source, year, and abstract snippet
 * via PubMed E-utilities, Crossref, or Semantic Scholar APIs.
 */
async function resolveCitationMetadata(citation) {
  if (!citation || !citation.url) {
    return createFallbackMetadata(citation);
  }

  const cacheKey = citation.url;
  if (citationCache.has(cacheKey)) {
    return citationCache.get(cacheKey);
  }

  try {
    // 1. Check for PubMed ID in URL
    const pmidMatch = citation.url.match(/(?:pubmed\.ncbi\.nlm\.nih\.gov|ncbi\.nlm\.nih\.gov\/pubmed)\/(\d+)/i);
    if (pmidMatch && pmidMatch[1]) {
      const pmid = pmidMatch[1];
      const pmidData = await fetchPubMedMetadata(pmid, citation.url);
      if (pmidData) {
        citationCache.set(cacheKey, pmidData);
        return pmidData;
      }
    }

    // 2. Check for DOI in URL or citation
    const doiMatch = citation.url.match(/(?:doi\.org\/|doi:)(10\.\d{4,9}\/[-._;()/:A-Za-z0-9]+)/i);
    if (doiMatch && doiMatch[1]) {
      const doi = doiMatch[1];
      const doiData = await fetchCrossrefMetadata(doi, citation.url);
      if (doiData) {
        citationCache.set(cacheKey, doiData);
        return doiData;
      }
    }

    // 3. Search Semantic Scholar by title if title is descriptive
    if (citation.title && citation.title.length > 15) {
      const s2Data = await fetchSemanticScholarByTitle(citation.title, citation.url);
      if (s2Data) {
        citationCache.set(cacheKey, s2Data);
        return s2Data;
      }
    }

    // 4. Fallback to rich web source preview
    const fallback = createFallbackMetadata(citation);
    citationCache.set(cacheKey, fallback);
    return fallback;
  } catch (err) {
    console.warn('Citation resolution error:', err);
    return createFallbackMetadata(citation);
  }
}

/**
 * Fetch PubMed metadata using E-utilities esummary and efetch
 */
async function fetchPubMedMetadata(pmid, originalUrl) {
  try {
    const summaryUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi?db=pubmed&id=${pmid}&retmode=json`;
    const resp = await fetch(summaryUrl);
    if (!resp.ok) return null;

    const data = await resp.json();
    const doc = data.result?.[pmid];
    if (!doc) return null;

    const title = cleanText(doc.title || '');
    const authors = Array.isArray(doc.authors)
      ? doc.authors.slice(0, 3).map((a) => a.name).join(', ') + (doc.authors.length > 3 ? ' et al.' : '')
      : 'Author details not listed';
    const journal = doc.source || 'PubMed';
    const year = doc.pubdate ? doc.pubdate.split(' ')[0] : 'Recent';

    // Attempt to fetch abstract via efetch XML
    let abstract = '';
    try {
      const fetchUrl = `https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?db=pubmed&id=${pmid}&retmode=xml`;
      const fetchResp = await fetch(fetchUrl);
      if (fetchResp.ok) {
        const xmlText = await fetchResp.text();
        const abstractMatch = xmlText.match(/<AbstractText[^>]*>([\s\S]*?)<\/AbstractText>/i);
        if (abstractMatch && abstractMatch[1]) {
          abstract = cleanText(abstractMatch[1]).slice(0, 240) + '...';
        }
      }
    } catch (_) {}

    return {
      title,
      authors,
      journal,
      year,
      abstract: abstract || 'Peer-reviewed biomedical publication indexed on PubMed.',
      pmid,
      url: originalUrl,
      sourceType: 'pubmed'
    };
  } catch (e) {
    return null;
  }
}

/**
 * Fetch DOI metadata via Crossref API
 */
async function fetchCrossrefMetadata(doi, originalUrl) {
  try {
    const crossrefUrl = `https://api.crossref.org/works/${encodeURIComponent(doi)}`;
    const resp = await fetch(crossrefUrl);
    if (!resp.ok) return null;

    const data = await resp.json();
    const item = data.message;
    if (!item) return null;

    const title = Array.isArray(item.title) ? cleanText(item.title[0]) : (item.title || '');
    let authors = 'Authors not listed';
    if (Array.isArray(item.author) && item.author.length > 0) {
      const names = item.author.slice(0, 3).map((a) => `${a.given ? a.given[0] + '. ' : ''}${a.family || ''}`.trim());
      authors = names.join(', ') + (item.author.length > 3 ? ' et al.' : '');
    }

    const journal = Array.isArray(item['container-title'])
      ? item['container-title'][0]
      : (item['publisher'] || 'Academic Journal');

    let year = 'Recent';
    if (item.published?.['date-parts']?.[0]?.[0]) {
      year = String(item.published['date-parts'][0][0]);
    }

    let abstract = '';
    if (item.abstract) {
      // Remove JATS XML markup
      abstract = cleanText(item.abstract.replace(/<[^>]+>/g, '')).slice(0, 240) + '...';
    }

    return {
      title: title || 'Academic Study',
      authors,
      journal,
      year,
      abstract: abstract || 'Peer-reviewed research publication.',
      doi,
      url: originalUrl,
      sourceType: 'doi'
    };
  } catch (e) {
    return null;
  }
}

/**
 * Search Semantic Scholar by title
 */
async function fetchSemanticScholarByTitle(title, originalUrl) {
  try {
    const query = encodeURIComponent(title.slice(0, 100));
    const url = `https://api.semanticscholar.org/graph/v1/paper/search?query=${query}&limit=1&fields=title,authors,year,venue,abstract,externalIds`;
    const resp = await fetch(url);
    if (!resp.ok) return null;

    const data = await resp.json();
    const paper = data.data?.[0];
    if (!paper) return null;

    let authors = 'Authors not listed';
    if (Array.isArray(paper.authors) && paper.authors.length > 0) {
      authors = paper.authors.slice(0, 3).map((a) => a.name).join(', ') + (paper.authors.length > 3 ? ' et al.' : '');
    }

    return {
      title: paper.title || title,
      authors,
      journal: paper.venue || 'Scientific Repository',
      year: paper.year ? String(paper.year) : 'Recent',
      abstract: paper.abstract ? paper.abstract.slice(0, 240) + '...' : 'Scholarly biomedical research paper.',
      url: originalUrl,
      sourceType: 'semanticscholar'
    };
  } catch (e) {
    return null;
  }
}

/**
 * Fallback metadata generator for non-academic/general health URLs
 */
function createFallbackMetadata(citation) {
  let hostname = '';
  try {
    hostname = new URL(citation.url).hostname.replace(/^www\./, '');
  } catch (_) {
    hostname = 'Web Resource';
  }

  // Recognize known public health domains
  let domainBadge = hostname;
  if (hostname.includes('cdc.gov')) domainBadge = 'CDC (Public Health)';
  else if (hostname.includes('who.int')) domainBadge = 'World Health Organization';
  else if (hostname.includes('nih.gov')) domainBadge = 'National Institutes of Health';
  else if (hostname.includes('mayoclinic.org')) domainBadge = 'Mayo Clinic Clinical Evidence';
  else if (hostname.includes('hopkinsmedicine.org')) domainBadge = 'Johns Hopkins Medicine';
  else if (hostname.includes('cochranelibrary.com')) domainBadge = 'Cochrane Systematic Reviews';

  return {
    title: citation.title || 'Medical / Health Evidence Reference',
    authors: domainBadge,
    journal: hostname,
    year: 'Authoritative Source',
    abstract: 'Verified reference provided by search grounding to evaluate biomedical claim consensus.',
    url: citation.url,
    sourceType: 'web'
  };
}

function cleanText(str) {
  return str
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}
