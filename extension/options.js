/**
 * Verifi - Options Script
 * Handles loading and saving verification options (grounding, pacing, batch size) in chrome.storage.local.
 * API keys and models are strictly read from .env (config.js).
 */

document.addEventListener('DOMContentLoaded', async () => {
  const enableSearchGroundingInput = document.getElementById('enableSearchGrounding');
  const pacingDelayInput = document.getElementById('pacingDelay');
  const batchSizeInput = document.getElementById('batchSize');
  const groqStatus = document.getElementById('groqStatus');
  const geminiStatus = document.getElementById('geminiStatus');
  const groqModelDisplay = document.getElementById('groqModelDisplay');
  const geminiModelDisplay = document.getElementById('geminiModelDisplay');
  const statusAlert = document.getElementById('statusAlert');
  const form = document.getElementById('settingsForm');

  const envConfig = (typeof CONFIG !== 'undefined' ? CONFIG : {});

  // Purge any legacy API keys from storage immediately
  try {
    await chrome.storage.local.remove(['groqApiKey', 'geminiApiKey', 'groqModel', 'geminiModel']);
  } catch (_) {}

  // 1. Display .env key status
  if (groqStatus) {
    if (envConfig.GROQ_API_KEY && envConfig.GROQ_API_KEY.trim()) {
      const k = envConfig.GROQ_API_KEY.trim();
      const masked = k.length > 10 ? k.slice(0, 6) + '...' + k.slice(-4) : '••••••••';
      groqStatus.innerHTML = `<span style="color:#059669; font-weight:600;">✓ Active</span> <code style="margin-left:6px; background:#dcfce7; color:#166534; padding:2px 6px; border-radius:4px;">${masked}</code>`;
    } else {
      groqStatus.innerHTML = `<span style="color:#dc2626; font-weight:600;">✗ Missing</span> <span style="font-size:12px; color:#6b7280; margin-left:4px;">(set in .env)</span>`;
    }
  }

  if (geminiStatus) {
    if (envConfig.GEMINI_API_KEY && envConfig.GEMINI_API_KEY.trim()) {
      const k = envConfig.GEMINI_API_KEY.trim();
      const masked = k.length > 10 ? k.slice(0, 6) + '...' + k.slice(-4) : '••••••••';
      geminiStatus.innerHTML = `<span style="color:#059669; font-weight:600;">✓ Active</span> <code style="margin-left:6px; background:#dcfce7; color:#166534; padding:2px 6px; border-radius:4px;">${masked}</code>`;
    } else {
      geminiStatus.innerHTML = `<span style="color:#dc2626; font-weight:600;">✗ Missing</span> <span style="font-size:12px; color:#6b7280; margin-left:4px;">(set in .env)</span>`;
    }
  }

  if (groqModelDisplay) {
    groqModelDisplay.textContent = envConfig.GROQ_MODEL || 'groq/compound-mini';
  }
  if (geminiModelDisplay) {
    geminiModelDisplay.textContent = envConfig.GEMINI_MODEL || 'gemini-3.5-flash';
  }

  // 2. Load user-configurable settings from storage
  try {
    const data = await chrome.storage.local.get([
      'enableSearchGrounding',
      'pacingDelay',
      'batchSize'
    ]);

    if (typeof data.enableSearchGrounding === 'boolean') {
      enableSearchGroundingInput.checked = data.enableSearchGrounding;
    } else if (typeof envConfig.ENABLE_SEARCH_GROUNDING === 'boolean') {
      enableSearchGroundingInput.checked = envConfig.ENABLE_SEARCH_GROUNDING;
    }

    if (data.pacingDelay) {
      pacingDelayInput.value = String(data.pacingDelay);
    } else if (envConfig.PACING_DELAY) {
      pacingDelayInput.value = String(envConfig.PACING_DELAY);
    }

    if (data.batchSize) {
      batchSizeInput.value = String(data.batchSize);
    } else if (envConfig.BATCH_SIZE) {
      batchSizeInput.value = String(envConfig.BATCH_SIZE);
    }
  } catch (err) {
    console.error('Error loading settings:', err);
  }

  // 3. Save settings (only execution options)
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const enableSearchGrounding = enableSearchGroundingInput.checked;
    const pacingDelay = parseInt(pacingDelayInput.value, 10) || 6000;
    const batchSize = parseInt(batchSizeInput.value, 10) || 8;

    try {
      await chrome.storage.local.set({
        enableSearchGrounding,
        pacingDelay,
        batchSize
      });

      // Ensure no API keys or models ever linger in storage
      await chrome.storage.local.remove(['groqApiKey', 'geminiApiKey', 'groqModel', 'geminiModel']);

      showAlert('Settings saved successfully! Options are active.', 'success');
    } catch (err) {
      console.error('Failed to save settings:', err);
      showAlert('Failed to save settings. Please try again.', 'error');
    }
  });

  function showAlert(msg, type) {
    statusAlert.textContent = msg;
    statusAlert.className = `alert ${type}`;
    statusAlert.scrollIntoView({ behavior: 'smooth' });

    setTimeout(() => {
      statusAlert.className = 'alert';
    }, 4000);
  }
});
