document.addEventListener('DOMContentLoaded', async () => {
  const fields = ['apiKey', 'sessionId', 'apiVersion', 'orgId', 'imageMode'];
  const defaults = { apiKey: '', sessionId: '', apiVersion: 'v1', orgId: '', imageMode: 'attachment' };
  const stored = await chrome.storage.sync.get(defaults);
  fields.forEach(f => {
    const el = document.getElementById(f);
    if (el) el.value = stored[f];
  });

  const sessionSelect = document.getElementById('sessionSelect');
  const sessionHelp = document.getElementById('sessionHelp');

  async function loadSessions() {
    const apiKey = document.getElementById('apiKey').value.trim();
    const apiVersion = document.getElementById('apiVersion').value;
    const orgId = document.getElementById('orgId').value.trim();
    const sessionId = document.getElementById('sessionId').value.trim();

    if (!apiKey) {
      sessionSelect.innerHTML = '<option value="">— enter API key and click Refresh —</option>';
      sessionHelp.textContent = 'Enter your Devin API key first.';
      return;
    }

    sessionSelect.innerHTML = '<option value="">Loading sessions…</option>';
    sessionSelect.disabled = true;
    sessionHelp.textContent = 'Fetching sessions from Devin…';

    try {
      const res = await chrome.runtime.sendMessage({ action: 'getSessions', apiVersion, apiKey, orgId });
      sessionSelect.disabled = false;
      if (!res.ok) {
        sessionSelect.innerHTML = '<option value="">— error loading sessions —</option>';
        sessionHelp.textContent = `Error: ${res.error}`;
        return;
      }

      const sessions = res.sessions || [];
      let html = '<option value="">— select a session —</option>';
      html += '<option value="__manual__">Enter session ID manually</option>';
      sessions.forEach(s => {
        const label = `${s.title} (${s.session_id.slice(0, 12)}…) — ${s.status}`;
        html += `<option value="${s.session_id}">${escapeHtml(label)}</option>`;
      });
      sessionSelect.innerHTML = html;

      if (sessionId) {
        const found = sessions.some(s => s.session_id === sessionId);
        if (found) {
          sessionSelect.value = sessionId;
        } else {
          sessionSelect.value = '__manual__';
        }
      } else {
        sessionSelect.value = '';
      }

      sessionHelp.textContent = sessions.length
        ? `${sessions.length} session(s) found. Select one or enter an ID manually.`
        : 'No sessions found. Enter an ID manually.';
    } catch (e) {
      sessionSelect.disabled = false;
      sessionSelect.innerHTML = '<option value="">— error loading sessions —</option>';
      sessionHelp.textContent = `Error: ${e.message}`;
    }
  }

  function escapeHtml(str) {
    return str.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  sessionSelect.addEventListener('change', () => {
    const val = sessionSelect.value;
    if (val && val !== '__manual__') {
      document.getElementById('sessionId').value = val;
    } else if (val === '__manual__') {
      document.getElementById('sessionId').focus();
    }
  });

  document.getElementById('refreshSessions').addEventListener('click', loadSessions);

  document.getElementById('save').onclick = async () => {
    const values = {};
    fields.forEach(f => {
      const el = document.getElementById(f);
      if (el) values[f] = el.value.trim();
    });
    await chrome.storage.sync.set(values);
    document.getElementById('status').textContent = 'Saved.';
    setTimeout(() => document.getElementById('status').textContent = '', 2000);
  };

  // Auto-load sessions if API key is already stored.
  if (stored.apiKey) await loadSessions();
});