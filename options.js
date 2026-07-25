document.addEventListener('DOMContentLoaded', async () => {
  const fields = ['apiKey', 'sessionId', 'apiVersion', 'orgId', 'imageMode'];
  const defaults = { apiKey: '', sessionId: '', apiVersion: 'v1', orgId: '', imageMode: 'base64' };
  const stored = await chrome.storage.sync.get(defaults);
  fields.forEach(f => document.getElementById(f).value = stored[f]);

  document.getElementById('save').onclick = async () => {
    const values = {};
    fields.forEach(f => values[f] = document.getElementById(f).value.trim());
    await chrome.storage.sync.set(values);
    document.getElementById('status').textContent = 'Saved.';
    setTimeout(() => document.getElementById('status').textContent = '', 2000);
  };
});