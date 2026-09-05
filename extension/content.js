/**
 * HealthCheck - Content Script
 * Extracts visible body text, highlights claims via multi-node DOM TreeWalker,
 * and renders an isolated Shadow DOM hover tooltip with rich academic citation cards.
 */

(function () {
  // Prevent double-initialization
  if (window.__healthCheckContentScriptLoaded) return;
  window.__healthCheckContentScriptLoaded = true;

  // Stored claim metadata: Map<claimId, claimData>
  const claimsMap = new Map();
  // Resolved citation metadata cache: Map<citationUrl, metadata>
  const citationMetadataCache = new Map();

  // Active hover tracking
  let activeClaimId = null;
  let hideTooltipTimeout = null;
  let activeHighlightedMarks = [];

  // Shadow DOM Tooltip Elements
  let tooltipHost = null;
  let shadowRoot = null;
  let tooltipCard = null;

  // Initialize Tooltip Shadow DOM
  initTooltip();

  /**
   * Message Listener
   */
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    switch (message.type) {
      case 'PING':
        sendResponse({ status: 'ok' });
        break;

      case 'EXTRACT_TEXT':
        const extractedText = extractVisibleText();
        sendResponse({ text: extractedText });
        break;

      case 'CLEAR_HIGHLIGHTS':
        clearAllHighlights();
        sendResponse({ success: true });
        break;

      case 'HIGHLIGHT_CLAIM':
        if (message.claim) {
          claimsMap.set(message.claim.id, message.claim);
          highlightClaimInDOM(message.claim);
        }
        sendResponse({ success: true });
        break;

      case 'SCROLL_TO_CLAIM':
        scrollToClaim(message.claimId);
        sendResponse({ success: true });
        break;

      default:
        sendResponse({ error: `Unknown message: ${message.type}` });
    }
    return false;
  });

  /**
   * Extract readable visible text from the page
   */
  function extractVisibleText() {
    const ignoredTags = new Set([
      'SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'OBJECT', 'EMBED',
      'SVG', 'CANVAS', 'VIDEO', 'AUDIO', 'NAV', 'FOOTER', 'HEADER'
    ]);

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

          if (ignoredTags.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
          if (parent.closest('#hc-tooltip-host')) return NodeFilter.FILTER_REJECT;

          // Check visibility
          if (parent.offsetParent === null && parent.tagName !== 'BODY') {
            return NodeFilter.FILTER_REJECT;
          }

          const style = window.getComputedStyle(parent);
          if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') {
            return NodeFilter.FILTER_REJECT;
          }

          if (node.nodeValue.trim().length === 0) {
            return NodeFilter.FILTER_SKIP;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const chunks = [];
    let currentNode;
    while ((currentNode = walker.nextNode())) {
      const text = currentNode.nodeValue.replace(/\s+/g, ' ').trim();
      if (text.length > 0) {
        chunks.push(text);
      }
    }

    return chunks.join('\n\n');
  }

  /**
   * Locate verbatim substring across text nodes and wrap in <mark>
   */
  function highlightClaimInDOM(claim) {
    if (!claim.verbatim_text || claim.verbatim_text.trim().length === 0) return;

    requestAnimationFrame(() => {
      try {
        const textNodes = collectValidTextNodes();
        if (textNodes.length === 0) return;

        // Build continuous string with mapped text node offsets
        let fullString = '';
        const nodeMap = [];

        for (const node of textNodes) {
          const start = fullString.length;
          fullString += node.nodeValue;
          const end = fullString.length;
          nodeMap.push({ node, start, end });
        }

        // Search for verbatim substring
        const targetStr = claim.verbatim_text;
        let matchStart = fullString.indexOf(targetStr);

        // Fallback: search with normalized whitespace
        let matchEnd = -1;
        if (matchStart !== -1) {
          matchEnd = matchStart + targetStr.length;
        } else {
          const normalizedTarget = escapeRegex(targetStr).replace(/\s+/g, '\\s+');
          const regex = new RegExp(normalizedTarget, 'i');
          const match = fullString.match(regex);
          if (match && match.index !== undefined) {
            matchStart = match.index;
            matchEnd = matchStart + match[0].length;
          }
        }

        // If not found, skip silently as required
        if (matchStart === -1 || matchEnd === -1) {
          return;
        }

        // Find intersecting text nodes
        const intersecting = [];
        for (const item of nodeMap) {
          if (item.end > matchStart && item.start < matchEnd) {
            intersecting.push(item);
          }
        }

        if (intersecting.length === 0) return;

        // Wrap intersecting nodes in reverse to avoid offset changes
        for (let i = intersecting.length - 1; i >= 0; i--) {
          const { node, start, end } = intersecting[i];
          const localStart = Math.max(0, matchStart - start);
          const localEnd = Math.min(node.nodeValue.length, matchEnd - start);

          if (localStart >= localEnd) continue;

          // Split node for the target slice
          let targetNode = node;
          if (localStart > 0) {
            targetNode = node.splitText(localStart);
          }
          const sliceLen = localEnd - localStart;
          if (targetNode.nodeValue.length > sliceLen) {
            targetNode.splitText(sliceLen);
          }

          // Create <mark> element
          const mark = document.createElement('mark');
          mark.className = `hc-mark hc-${claim.verdict}`;
          mark.setAttribute('data-claim-id', claim.id);
          mark.setAttribute('tabindex', '0');

          targetNode.parentNode.insertBefore(mark, targetNode);
          mark.appendChild(targetNode);

          // Add interactive event listeners
          mark.addEventListener('mouseenter', onMarkMouseEnter);
          mark.addEventListener('mouseleave', onMarkMouseLeave);
          mark.addEventListener('focus', onMarkMouseEnter);
          mark.addEventListener('blur', onMarkMouseLeave);
        }
      } catch (err) {
        console.warn('[HealthCheck] Highlight error for claim:', claim.id, err);
      }
    });
  }

  /**
   * Helper to collect eligible text nodes
   */
  function collectValidTextNodes() {
    const ignoredTags = new Set([
      'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'INPUT', 'IFRAME',
      'SVG', 'BUTTON', 'SELECT', 'CODE', 'PRE'
    ]);

    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      {
        acceptNode(node) {
          const parent = node.parentElement;
          if (!parent) return NodeFilter.FILTER_REJECT;

          if (ignoredTags.has(parent.tagName)) return NodeFilter.FILTER_REJECT;
          if (parent.closest('#hc-tooltip-host')) return NodeFilter.FILTER_REJECT;
          if (parent.closest('mark.hc-mark')) return NodeFilter.FILTER_REJECT;

          if (parent.offsetParent === null && parent.tagName !== 'BODY') {
            return NodeFilter.FILTER_REJECT;
          }

          return NodeFilter.FILTER_ACCEPT;
        }
      }
    );

    const nodes = [];
    let n;
    while ((n = walker.nextNode())) {
      nodes.push(n);
    }
    return nodes;
  }

  /**
   * Remove all HealthCheck marks from page
   */
  function clearAllHighlights() {
    const marks = document.querySelectorAll('mark.hc-mark');
    marks.forEach((mark) => {
      const parent = mark.parentNode;
      while (mark.firstChild) {
        parent.insertBefore(mark.firstChild, mark);
      }
      parent.removeChild(mark);
      parent.normalize();
    });
    claimsMap.clear();
    hideTooltip();
  }

  /**
   * Scroll viewport smoothly to claim mark
   */
  function scrollToClaim(claimId) {
    const mark = document.querySelector(`mark.hc-mark[data-claim-id="${claimId}"]`);
    if (mark) {
      mark.scrollIntoView({ behavior: 'smooth', block: 'center' });
      mark.classList.add('hc-active');
      setTimeout(() => mark.classList.remove('hc-active'), 2000);
    }
  }

  /**
   * Mark hover handlers
   */
  function onMarkMouseEnter(e) {
    clearTimeout(hideTooltipTimeout);
    const mark = e.currentTarget;
    const claimId = mark.getAttribute('data-claim-id');
    const claim = claimsMap.get(claimId);
    if (!claim) return;

    activeClaimId = claimId;

    // Highlight all marks belonging to this claim
    document.querySelectorAll(`mark.hc-mark[data-claim-id="${claimId}"]`).forEach((m) => {
      m.classList.add('hc-active');
    });

    renderTooltipContent(claim, mark);
    positionTooltip(mark);
    showTooltip();
  }

  function onMarkMouseLeave(e) {
    const claimId = e.currentTarget.getAttribute('data-claim-id');
    hideTooltipTimeout = setTimeout(() => {
      document.querySelectorAll(`mark.hc-mark[data-claim-id="${claimId}"]`).forEach((m) => {
        m.classList.remove('hc-active');
      });
      hideTooltip();
    }, 250);
  }

  /**
   * Initialize Shadow DOM for Tooltip
   */
  function initTooltip() {
    tooltipHost = document.createElement('div');
    tooltipHost.id = 'hc-tooltip-host';
    document.body.appendChild(tooltipHost);

    shadowRoot = tooltipHost.attachShadow({ mode: 'open' });

    // Stylesheet inside Shadow DOM
    const style = document.createElement('style');
    style.textContent = `
      :host {
        all: initial;
        font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
        font-size: 14px;
        line-height: 1.45;
        color: #1e293b;
      }

      * {
        box-sizing: border-box;
      }

      .hc-tooltip {
        position: fixed;
        width: 380px;
        max-width: 90vw;
        max-height: 480px;
        background: #ffffff;
        border-radius: 12px;
        box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.18), 0 8px 10px -6px rgba(0, 0, 0, 0.12), 0 0 0 1px rgba(0, 0, 0, 0.08);
        overflow-y: auto;
        opacity: 0;
        visibility: hidden;
        pointer-events: none;
        transition: opacity 0.18s ease, transform 0.18s ease;
        transform: translateY(6px);
        z-index: 2147483647;
      }

      .hc-tooltip.visible {
        opacity: 1;
        visibility: visible;
        pointer-events: auto;
        transform: translateY(0);
      }

      .hc-header {
        display: flex;
        align-items: center;
        justify-content: space-between;
        padding: 12px 14px;
        border-bottom: 1px solid #f1f5f9;
        background: #f8fafc;
        border-top-left-radius: 12px;
        border-top-right-radius: 12px;
      }

      .hc-badge {
        display: inline-flex;
        align-items: center;
        gap: 6px;
        font-weight: 700;
        font-size: 11px;
        letter-spacing: 0.04em;
        text-transform: uppercase;
        padding: 4px 10px;
        border-radius: 9999px;
      }

      .hc-badge-supported {
        background: #ecfdf5;
        color: #065f46;
        border: 1px solid #a7f3d0;
      }

      .hc-badge-refuted {
        background: #fef2f2;
        color: #991b1b;
        border: 1px solid #fecaca;
      }

      .hc-badge-uncertain {
        background: #fffbeb;
        color: #92400e;
        border: 1px solid #fde68a;
      }

      .hc-close-btn {
        background: transparent;
        border: none;
        color: #94a3b8;
        cursor: pointer;
        font-size: 18px;
        line-height: 1;
        padding: 2px 6px;
        border-radius: 4px;
      }

      .hc-close-btn:hover {
        background: #e2e8f0;
        color: #334155;
      }

      .hc-body {
        padding: 14px;
        display: flex;
        flex-direction: column;
        gap: 12px;
      }

      .hc-claim-box {
        background: #f8fafc;
        border-left: 3px solid #0284c7;
        padding: 8px 10px;
        border-radius: 0 6px 6px 0;
      }

      .hc-claim-label {
        font-size: 10px;
        font-weight: 700;
        text-transform: uppercase;
        color: #0284c7;
        letter-spacing: 0.05em;
        margin-bottom: 2px;
      }

      .hc-claim-text {
        font-weight: 600;
        color: #0f172a;
        font-size: 13px;
        line-height: 1.35;
      }

      .hc-explanation {
        font-size: 13px;
        color: #334155;
        line-height: 1.45;
      }

      .hc-citations-section {
        margin-top: 4px;
        border-top: 1px solid #f1f5f9;
        padding-top: 10px;
      }

      .hc-citations-title {
        font-size: 11px;
        font-weight: 700;
        text-transform: uppercase;
        color: #64748b;
        letter-spacing: 0.04em;
        margin-bottom: 8px;
        display: flex;
        align-items: center;
        gap: 6px;
      }

      .hc-cards-list {
        display: flex;
        flex-direction: column;
        gap: 8px;
      }

      .hc-card {
        display: block;
        background: #f8fafc;
        border: 1px solid #e2e8f0;
        border-radius: 8px;
        padding: 10px;
        text-decoration: none;
        color: inherit;
        cursor: pointer;
        transition: border-color 0.15s ease, box-shadow 0.15s ease, background 0.15s ease;
      }

      .hc-card:hover {
        background: #f1f5f9;
        border-color: #cbd5e1;
        box-shadow: 0 2px 6px rgba(0, 0, 0, 0.06);
      }

      .hc-card-header {
        display: flex;
        align-items: flex-start;
        justify-content: space-between;
        gap: 8px;
        margin-bottom: 4px;
      }

      .hc-card-title {
        font-size: 12px;
        font-weight: 600;
        color: #0369a1;
        line-height: 1.35;
        flex: 1;
      }

      .hc-card:hover .hc-card-title {
        color: #0284c7;
        text-decoration: underline;
      }

      .hc-card-year {
        font-size: 10px;
        font-weight: 700;
        background: #e2e8f0;
        color: #475569;
        padding: 2px 6px;
        border-radius: 4px;
        white-space: nowrap;
      }

      .hc-card-meta {
        font-size: 11px;
        color: #64748b;
        display: flex;
        flex-wrap: wrap;
        gap: 6px;
        margin-bottom: 6px;
      }

      .hc-card-journal {
        font-style: italic;
        color: #0f766e;
        font-weight: 500;
      }

      .hc-card-abstract {
        font-size: 11px;
        color: #475569;
        line-height: 1.38;
        display: -webkit-box;
        -webkit-line-clamp: 3;
        -webkit-box-orient: vertical;
        overflow: hidden;
      }

      .hc-card-action {
        display: inline-flex;
        align-items: center;
        gap: 4px;
        font-size: 11px;
        font-weight: 600;
        color: #0284c7;
        margin-top: 6px;
      }

      .hc-shimmer {
        height: 12px;
        background: linear-gradient(90deg, #f1f5f9 25%, #e2e8f0 50%, #f1f5f9 75%);
        background-size: 200% 100%;
        animation: hcShimmer 1.5s infinite;
        border-radius: 4px;
        margin-bottom: 6px;
      }

      @keyframes hcShimmer {
        0% { background-position: 200% 0; }
        100% { background-position: -200% 0; }
      }
    `;

    shadowRoot.appendChild(style);

    // Tooltip Card Container
    tooltipCard = document.createElement('div');
    tooltipCard.className = 'hc-tooltip';
    shadowRoot.appendChild(tooltipCard);

    // Keep tooltip visible when hovered
    tooltipCard.addEventListener('mouseenter', () => {
      clearTimeout(hideTooltipTimeout);
    });

    tooltipCard.addEventListener('mouseleave', () => {
      hideTooltipTimeout = setTimeout(() => {
        if (activeClaimId) {
          document.querySelectorAll(`mark.hc-mark[data-claim-id="${activeClaimId}"]`).forEach((m) => {
            m.classList.remove('hc-active');
          });
        }
        hideTooltip();
      }, 200);
    });

    // Close on Escape key
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') hideTooltip();
    });
  }

  /**
   * Populate Tooltip HTML for a given claim
   */
  function renderTooltipContent(claim, anchorMark) {
    const verdict = claim.verdict || 'uncertain';
    let badgeClass = 'hc-badge-uncertain';
    let badgeIcon = '⚠️';
    let badgeText = 'Evidence Uncertain';

    if (verdict === 'supported') {
      badgeClass = 'hc-badge-supported';
      badgeIcon = '✓';
      badgeText = 'Supported by Evidence';
    } else if (verdict === 'refuted') {
      badgeClass = 'hc-badge-refuted';
      badgeIcon = '✕';
      badgeText = 'Refuted by Evidence';
    }

    const citations = Array.isArray(claim.citations) ? claim.citations : [];

    tooltipCard.innerHTML = `
      <div class="hc-header">
        <div class="hc-badge ${badgeClass}">
          <span>${badgeIcon}</span>
          <span>${badgeText}</span>
        </div>
        <button class="hc-close-btn" title="Close" aria-label="Close tooltip">&times;</button>
      </div>
      <div class="hc-body">
        <div class="hc-claim-box">
          <div class="hc-claim-label">Normalized Claim</div>
          <div class="hc-claim-text">${escapeHtml(claim.normalized_claim || claim.verbatim_text)}</div>
        </div>
        <div class="hc-explanation">
          ${escapeHtml(claim.explanation || 'No scientific evaluation available.')}
        </div>
        <div class="hc-citations-section">
          <div class="hc-citations-title">
            <span>📚</span>
            <span>Scientific Consensus & Sources (${citations.length})</span>
          </div>
          <div class="hc-cards-list" id="hc-cards-container">
            ${
              citations.length === 0
                ? '<div style="font-size:12px;color:#94a3b8;font-style:italic;">No direct study citations returned.</div>'
                : citations.map((c, idx) => renderInitialCitationCard(c, idx)).join('')
            }
          </div>
        </div>
      </div>
    `;

    // Hook up close button
    const closeBtn = tooltipCard.querySelector('.hc-close-btn');
    if (closeBtn) {
      closeBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        hideTooltip();
      });
    }

    // Attach click events to open full source in new tab
    citations.forEach((citation, idx) => {
      const cardEl = tooltipCard.querySelector(`[data-citation-index="${idx}"]`);
      if (cardEl && citation.url) {
        cardEl.addEventListener('click', (ev) => {
          ev.preventDefault();
          window.open(citation.url, '_blank', 'noopener,noreferrer');
        });
      }

      // Asynchronously fetch enriched metadata (PubMed/Crossref/Semantic Scholar)
      enrichCitationCard(citation, idx);
    });
  }

  /**
   * Render initial citation card placeholder
   */
  function renderInitialCitationCard(citation, idx) {
    const cached = citationMetadataCache.get(citation.url);
    if (cached) {
      return renderFullCitationCard(cached, idx);
    }

    return `
      <div class="hc-card" data-citation-index="${idx}" role="button" tabindex="0">
        <div class="hc-card-header">
          <div class="hc-card-title">${escapeHtml(citation.title || 'Referenced Study / Source')}</div>
          <span class="hc-card-year">Source</span>
        </div>
        <div class="hc-shimmer" style="width: 75%;"></div>
        <div class="hc-shimmer" style="width: 50%;"></div>
        <div class="hc-card-action">Open paper &rarr;</div>
      </div>
    `;
  }

  /**
   * Enrich citation card with PubMed / Crossref / Semantic Scholar metadata
   */
  async function enrichCitationCard(citation, idx) {
    if (!citation || !citation.url) return;

    if (citationMetadataCache.has(citation.url)) {
      updateCardDOM(idx, citationMetadataCache.get(citation.url));
      return;
    }

    try {
      chrome.runtime.sendMessage(
        { type: 'RESOLVE_CITATION', citation },
        (response) => {
          if (response && response.success && response.metadata) {
            citationMetadataCache.set(citation.url, response.metadata);
            updateCardDOM(idx, response.metadata);
          }
        }
      );
    } catch (_) {}
  }

  function updateCardDOM(idx, meta) {
    const container = tooltipCard.querySelector(`[data-citation-index="${idx}"]`);
    if (!container) return;

    container.innerHTML = `
      <div class="hc-card-header">
        <div class="hc-card-title">${escapeHtml(meta.title)}</div>
        <span class="hc-card-year">${escapeHtml(meta.year || 'Study')}</span>
      </div>
      <div class="hc-card-meta">
        <span class="hc-card-journal">${escapeHtml(meta.journal)}</span>
        <span>•</span>
        <span>${escapeHtml(meta.authors)}</span>
      </div>
      <div class="hc-card-abstract">${escapeHtml(meta.abstract)}</div>
      <div class="hc-card-action">Open full paper &rarr;</div>
    `;
  }

  function renderFullCitationCard(meta, idx) {
    return `
      <div class="hc-card" data-citation-index="${idx}" role="button" tabindex="0">
        <div class="hc-card-header">
          <div class="hc-card-title">${escapeHtml(meta.title)}</div>
          <span class="hc-card-year">${escapeHtml(meta.year || 'Study')}</span>
        </div>
        <div class="hc-card-meta">
          <span class="hc-card-journal">${escapeHtml(meta.journal)}</span>
          <span>•</span>
          <span>${escapeHtml(meta.authors)}</span>
        </div>
        <div class="hc-card-abstract">${escapeHtml(meta.abstract)}</div>
        <div class="hc-card-action">Open full paper &rarr;</div>
      </div>
    `;
  }

  /**
   * Position tooltip relative to anchor mark with smart viewport flipping
   */
  function positionTooltip(anchorMark) {
    const rect = anchorMark.getBoundingClientRect();
    const tooltipWidth = 380;
    const padding = 16;

    // Horizontal positioning centered over mark, clamped to viewport
    let left = rect.left + rect.width / 2 - tooltipWidth / 2;
    left = Math.max(padding, Math.min(left, window.innerWidth - tooltipWidth - padding));

    // Vertical positioning: decide whether to place above or below
    const spaceAbove = rect.top;
    const spaceBelow = window.innerHeight - rect.bottom;
    const estimatedHeight = 320;

    let top;
    if (spaceAbove >= estimatedHeight || spaceAbove > spaceBelow) {
      // Place above
      top = Math.max(padding, rect.top - estimatedHeight - 10);
    } else {
      // Place below
      top = rect.bottom + 10;
    }

    tooltipCard.style.left = `${Math.round(left)}px`;
    tooltipCard.style.top = `${Math.round(top)}px`;
  }

  function showTooltip() {
    tooltipCard.classList.add('visible');
  }

  function hideTooltip() {
    tooltipCard.classList.remove('visible');
    activeClaimId = null;
    document.querySelectorAll('mark.hc-mark.hc-active').forEach((m) => {
      m.classList.remove('hc-active');
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  function escapeRegex(str) {
    return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
})();
