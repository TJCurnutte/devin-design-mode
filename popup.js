document.addEventListener('DOMContentLoaded', async () => {
  const status = document.getElementById('status');
  const opts = await chrome.storage.sync.get({ apiKey: '', sessionId: '' });
  status.textContent = opts.apiKey && opts.sessionId
    ? `Session: ${opts.sessionId.slice(0, 18)}…`
    : 'Not configured — open Settings';

  document.getElementById('toggle').onclick = async () => {
    try {
      const res = await chrome.runtime.sendMessage({ action: 'toggle' });
      if (res && res.error) {
        alert(res.error);
      }
    } catch (e) {
      alert('Could not toggle Design Mode on this page.');
    }
    window.close();
  };

  document.getElementById('options').onclick = () => {
    chrome.runtime.openOptionsPage();
  };
});