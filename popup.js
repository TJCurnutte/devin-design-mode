document.addEventListener('DOMContentLoaded', async () => {
  const status = document.getElementById('status');
  const opts = await chrome.storage.sync.get({ apiKey: '', sessionId: '' });
  status.textContent = opts.apiKey && opts.sessionId
    ? `Session: ${opts.sessionId.slice(0, 18)}…`
    : 'Not configured — open Settings';

  document.getElementById('toggle').onclick = async () => {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (!tab) return;
    chrome.tabs.sendMessage(tab.id, { action: 'toggle' }, () => window.close());
  };

  document.getElementById('options').onclick = () => {
    chrome.runtime.openOptionsPage();
  };
});