/**
 * HealthCheck - Popup Script
 * Manages user triggers, live progress tracking, verdict counters, and claim list navigation.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const keysWarning = document.getElementById('keysWarning');
  const configureKeysBtn = document.getElementById('configureKeysBtn');
  const openOptionsBtn = document.getElementById('openOptionsBtn');
  const runScanBtn = document.getElementById('runScanBtn');
  const runBtnText = document.getElementById('runBtnText');
  const progressSection = document.getElementById('progressSection');
  const progressTitle = document.getElementById('progressTitle');
  const progressCounts = document.getElementById('progressCounts');
  const progressBarFill = document.getElementById('progressBarFill');
  const progressStatusText = document.getElementById('progressStatusText');
  const statsRow = document.getElementById('statsRow');
  const statSupported = document.getElementById('statSupported');
  const statRefuted = document.getElementById('statRefuted');
  const statUncertain = document.getElementById('statUncertain');
  const claimsListSection = document.getElementById('claimsListSection');
  const claimsList = document.getElementById('claimsList');
  const errorBanner = document.getElementById('errorBanner');

  // Active tab reference
  let currentTabId = null;

  // Open Options page handlers
  configureKeysBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());
  openOptionsBtn.addEventListener('click', () => chrome.runtime.openOptionsPage());

  // 1. Check API Key configuration
  const statusResp = await chrome.runtime.sendMessage({ type: 'CHECK_STATUS' });
  if (!statusResp?.hasGroqKey || !statusResp?.hasGeminiKey) {
    keysWarning.style.display = 'block';
  } else {
    keysWarning.style.display = 'none';
  }

  // 2. Identify active tab
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab && tab.id) {
      currentTabId = tab.id;

      // Don't re-scan unless Run is clicked again: check if tab already has scan data
      const tabDataResp = await chrome.runtime.sendMessage({
        type: 'GET_TAB_CLAIMS',
        tabId: currentTabId
      });

      if (tabDataResp?.tabData && tabDataResp.tabData.claims?.length > 0) {
        restoreExistingScan(tabDataResp.tabData);
      }
    }
  } catch (err) {
    console.warn('Could not query active tab:', err);
  }

  // 3. Handle Run button click
  runScanBtn.addEventListener('click', async () => {
    if (!currentTabId) return;

    hideError();
    resetUIForNewScan();

    runScanBtn.disabled = true;
    runBtnText.textContent = 'Scanning...';
    progressSection.style.display = 'block';
    progressTitle.textContent = 'Scanning Page';
    progressCounts.textContent = '0 / 0';
    progressBarFill.style.width = '10%';
    progressStatusText.textContent = 'Extracting page text...';

    // Clear previous marks on the page
    try {
      await chrome.tabs.sendMessage(currentTabId, { type: 'CLEAR_HIGHLIGHTS' });
    } catch (_) {}

    try {
      const response = await chrome.runtime.sendMessage({
        type: 'RUN_SCAN',
        tabId: currentTabId
      });

      if (response?.error) {
        showError(response.error);
        finishScanUI();
      } else if (response?.status === 'complete') {
        finishScanUI();
        if (response.totalClaims === 0) {
          progressStatusText.textContent = 'No verifiable medical/health claims found on this page.';
          progressBarFill.style.width = '100%';
        }
      }
    } catch (err) {
      console.error('Scan execution error:', err);
      showError(err.message || 'Scan failed to complete.');
      finishScanUI();
    }
  });

  // 4. Listen for progress updates from background worker
  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'SCAN_UPDATE' && message.tabId === currentTabId) {
      handleScanUpdate(message);
    }
  });

  function handleScanUpdate(update) {
    switch (update.state) {
      case 'extracting':
        progressStatusText.textContent = update.message || 'Extracting visible text...';
        progressBarFill.style.width = '15%';
        break;

      case 'analyzing':
        progressStatusText.textContent = update.message || 'Extracting health claims via Groq...';
        progressBarFill.style.width = '35%';
        break;

      case 'claims_found':
        progressTitle.textContent = 'Fact-Checking Claims';
        progressCounts.textContent = `${update.totalClaims} claims found / 0 checked`;
        progressStatusText.textContent = `Verifying ${update.totalClaims} claims against medical literature...`;
        progressBarFill.style.width = '40%';
        statsRow.style.display = 'grid';
        claimsListSection.style.display = 'block';
        claimsList.innerHTML = '';
        break;

      case 'progress': {
        const total = update.totalClaims || 1;
        const checked = update.checkedClaims || 0;
        const pct = Math.min(95, 40 + Math.round((checked / total) * 55));

        progressCounts.textContent = `${total} claims found / ${checked} checked`;
        progressBarFill.style.width = `${pct}%`;
        progressStatusText.textContent = `Fact-checked claim ${checked} of ${total}...`;

        if (update.claim) {
          upsertClaimItem(update.claim);
          updateStats();
        }
        break;
      }

      case 'complete': {
        const total = update.totalClaims || 0;
        const checked = update.checkedClaims || 0;
        progressTitle.textContent = 'Fact-Check Complete';
        progressCounts.textContent = `${total} claims found / ${checked} checked`;
        progressBarFill.style.width = '100%';
        progressStatusText.textContent = total === 0 ? 'No health claims found on page.' : 'All claims verified & highlighted.';
        finishScanUI();
        if (Array.isArray(update.claims)) {
          renderClaimsList(update.claims);
          updateStats();
        }
        break;
      }
    }
  }

  function restoreExistingScan(tabData) {
    progressSection.style.display = 'block';
    progressTitle.textContent = 'Previous Scan Results';
    progressCounts.textContent = `${tabData.totalClaims} claims found / ${tabData.checkedClaims} checked`;
    progressBarFill.style.width = '100%';
    progressStatusText.textContent = 'Page highlighted. Hover over marks to inspect evidence.';

    statsRow.style.display = 'grid';
    claimsListSection.style.display = 'block';
    renderClaimsList(tabData.claims || []);
    updateStats();
  }

  function resetUIForNewScan() {
    claimsList.innerHTML = '';
    claimsListSection.style.display = 'none';
    statsRow.style.display = 'none';
    statSupported.textContent = '0';
    statRefuted.textContent = '0';
    statUncertain.textContent = '0';
  }

  function finishScanUI() {
    runScanBtn.disabled = false;
    runBtnText.textContent = 'Re-Run Fact-Check';
  }

  function upsertClaimItem(claim) {
    claimsListSection.style.display = 'block';
    let li = document.getElementById(`li-${claim.id}`);
    if (!li) {
      li = document.createElement('li');
      li.id = `li-${claim.id}`;
      li.className = 'claim-item';
      li.addEventListener('click', () => {
        if (currentTabId) {
          chrome.tabs.sendMessage(currentTabId, {
            type: 'SCROLL_TO_CLAIM',
            claimId: claim.id
          }).catch(() => {});
        }
      });
      claimsList.appendChild(li);
    }

    const verdict = claim.verdict || 'uncertain';
    const pillClass = `pill-${verdict}`;
    const verdictLabel = verdict.toUpperCase();

    li.innerHTML = `
      <div class="claim-item-top">
        <span class="verdict-pill ${pillClass}">${verdictLabel}</span>
      </div>
      <div class="claim-item-text">${escapeHtml(claim.normalized_claim || claim.verbatim_text)}</div>
      <div class="claim-item-sub">${escapeHtml(claim.explanation || 'Pending scientific consensus...')}</div>
    `;
  }

  function renderClaimsList(claims) {
    claimsList.innerHTML = '';
    if (!claims || claims.length === 0) return;
    claimsListSection.style.display = 'block';
    statsRow.style.display = 'grid';

    claims.forEach((c) => upsertClaimItem(c));
  }

  function updateStats() {
    let supported = 0;
    let refuted = 0;
    let uncertain = 0;

    const items = claimsList.querySelectorAll('.verdict-pill');
    items.forEach((pill) => {
      const text = pill.textContent.trim().toLowerCase();
      if (text.includes('supported')) supported++;
      else if (text.includes('refuted')) refuted++;
      else uncertain++;
    });

    statSupported.textContent = supported;
    statRefuted.textContent = refuted;
    statUncertain.textContent = uncertain;
  }

  function showError(msg) {
    errorBanner.textContent = msg;
    errorBanner.style.display = 'block';
  }

  function hideError() {
    errorBanner.style.display = 'none';
    errorBanner.textContent = '';
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
});
