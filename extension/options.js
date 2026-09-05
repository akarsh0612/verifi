/**
 * HealthCheck - Options Script
 * Handles loading and saving API keys and models in chrome.storage.local.
 */

document.addEventListener('DOMContentLoaded', async () => {
  const groqInput = document.getElementById('groqApiKey');
  const geminiInput = document.getElementById('geminiApiKey');
  const groqModelInput = document.getElementById('groqModel');
  const geminiModelInput = document.getElementById('geminiModel');
  const enableSearchGroundingInput = document.getElementById('enableSearchGrounding');
  const pacingDelayInput = document.getElementById('pacingDelay');
  const batchSizeInput = document.getElementById('batchSize');
  const statusAlert = document.getElementById('statusAlert');
  const form = document.getElementById('settingsForm');

  // Load saved settings
  try {
    const data = await chrome.storage.local.get([
      'groqApiKey',
      'geminiApiKey',
      'groqModel',
      'geminiModel',
      'enableSearchGrounding',
      'pacingDelay',
      'batchSize'
    ]);

    if (data.groqApiKey) groqInput.value = data.groqApiKey;
    if (data.geminiApiKey) geminiInput.value = data.geminiApiKey;
    if (data.groqModel) groqModelInput.value = data.groqModel;
    if (data.geminiModel) geminiModelInput.value = data.geminiModel;
    if (typeof data.enableSearchGrounding === 'boolean') {
      enableSearchGroundingInput.checked = data.enableSearchGrounding;
    }
    if (data.pacingDelay) pacingDelayInput.value = String(data.pacingDelay);
    if (data.batchSize) batchSizeInput.value = String(data.batchSize);
  } catch (err) {
    console.error('Error loading settings:', err);
  }

  // Password visibility toggle
  document.querySelectorAll('.toggle-visibility').forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-target');
      const input = document.getElementById(targetId);
      if (input.type === 'password') {
        input.type = 'text';
        btn.textContent = '🔒';
      } else {
        input.type = 'password';
        btn.textContent = '👁';
      }
    });
  });

  // Save settings
  form.addEventListener('submit', async (e) => {
    e.preventDefault();

    const groqApiKey = groqInput.value.trim();
    const geminiApiKey = geminiInput.value.trim();
    const groqModel = groqModelInput.value.trim() || 'openai/gpt-oss-20b';
    const geminiModel = geminiModelInput.value.trim() || 'gemini-3.6-flash';
    const enableSearchGrounding = enableSearchGroundingInput.checked;
    const pacingDelay = parseInt(pacingDelayInput.value, 10) || 6000;
    const batchSize = parseInt(batchSizeInput.value, 10) || 8;

    try {
      await chrome.storage.local.set({
        groqApiKey,
        geminiApiKey,
        groqModel,
        geminiModel,
        enableSearchGrounding,
        pacingDelay,
        batchSize
      });

      showAlert('Settings saved successfully! You can now use HealthCheck.', 'success');
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
