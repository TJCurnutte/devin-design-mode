chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'toggle') {
    chrome.tabs.query({ active: true, currentWindow: true }, async (tabs) => {
      if (!tabs[0]) return sendResponse({ active: false, error: 'No active tab.' });
      const result = await toggleActiveTab(tabs[0].id, tabs[0].url);
      sendResponse(result);
    });
    return true;
  }

  if (request.action === 'captureScreenshot') {
    capture(sender.tab).then(sendResponse);
    return true;
  }

  if (request.action === 'sendToDevin') {
    sendToDevin(request.prompt, request.data, request.sessionId).then(sendResponse);
    return true;
  }

  if (request.action === 'getSessions') {
    chrome.storage.sync.get({ apiKey: '', apiVersion: 'v1', orgId: '', sessionId: '' }, async (opts) => {
      // Request values (typed into Options but not yet saved) win over stored ones.
      const merged = {
        apiKey: request.apiKey || opts.apiKey,
        apiVersion: request.apiVersion || opts.apiVersion,
        orgId: request.orgId || opts.orgId,
        sessionId: opts.sessionId
      };
      const res = await listSessions(merged.apiVersion, merged.apiKey, merged.orgId);
      sendResponse({ ...res, apiKeySet: !!merged.apiKey, defaultSessionId: merged.sessionId });
    });
    return true;
  }

  if (request.action === 'getSpacesFromDevinUI') {
    getSpacesFromDevinUI().then(sendResponse);
    return true;
  }

  if (request.action === 'verifyTarget') {
    chrome.storage.sync.get({ apiKey: '', apiVersion: 'v1', orgId: '' }, async (opts) => {
      if (!opts.apiKey) return sendResponse({ ok: false, error: 'Devin API key not set.' });
      sendResponse(await resolveTarget(opts, request.sessionId));
    });
    return true;
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'toggle-design-mode') {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    if (tab) await toggleActiveTab(tab.id, tab.url);
  }
});

async function toggleActiveTab(tabId, tabUrl) {
  if (tabUrl && (tabUrl.startsWith('chrome://') || tabUrl.startsWith('https://chrome.google.com/webstore'))) {
    return { active: false, error: 'Devin Design Mode cannot run on Chrome internal pages or the Web Store.' };
  }

  try {
    return await chrome.tabs.sendMessage(tabId, { action: 'toggle' });
  } catch (e) {
    // Content script not loaded. Inject it and try again.
    try {
      await chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
      await chrome.scripting.insertCSS({ target: { tabId }, files: ['styles.css'] });
      return await chrome.tabs.sendMessage(tabId, { action: 'toggle' });
    } catch (e2) {
      return { active: false, error: 'Could not activate Design Mode on this page.' };
    }
  }
}

async function capture(tab) {
  try {
    const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: 'png' });
    const resized = await resizeImage(dataUrl, 1280);
    return { ok: true, dataUrl: resized };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

async function resizeImage(dataUrl, maxWidth) {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const scale = Math.min(1, maxWidth / bitmap.width);
    if (scale === 1) return dataUrl;
    const canvas = new OffscreenCanvas(bitmap.width * scale, bitmap.height * scale);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const outBlob = await canvas.convertToBlob({ type: 'image/png' });
    const buffer = await outBlob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return 'data:image/png;base64,' + btoa(binary);
  } catch (e) {
    return dataUrl;
  }
}

async function cropImage(dataUrl, bounds, scroll, dpr) {
  try {
    const res = await fetch(dataUrl);
    const blob = await res.blob();
    const bitmap = await createImageBitmap(blob);
    const sx = Math.max(0, (bounds.x - scroll.x) * dpr);
    const sy = Math.max(0, (bounds.y - scroll.y) * dpr);
    const sWidth = Math.min(bitmap.width - sx, bounds.width * dpr);
    const sHeight = Math.min(bitmap.height - sy, bounds.height * dpr);
    if (sWidth <= 0 || sHeight <= 0) return dataUrl;
    const canvas = new OffscreenCanvas(sWidth, sHeight);
    const ctx = canvas.getContext('2d');
    ctx.drawImage(bitmap, sx, sy, sWidth, sHeight, 0, 0, sWidth, sHeight);
    const outBlob = await canvas.convertToBlob({ type: 'image/png' });
    const buffer = await outBlob.arrayBuffer();
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
    return 'data:image/png;base64,' + btoa(binary);
  } catch (e) {
    return dataUrl;
  }
}

async function dataUrlToBlob(dataUrl) {
  const res = await fetch(dataUrl);
  return res.blob();
}

async function uploadAttachment(dataUrl, apiKey) {
  const blob = await dataUrlToBlob(dataUrl);
  const form = new FormData();
  form.append('file', blob, 'selection.png');
  const res = await fetch('https://api.devin.ai/v1/attachments', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: form
  });
  if (!res.ok) {
    let detail = '';
    try { detail = await res.text(); } catch (e) {}
    throw new Error(`Upload failed ${res.status}: ${detail || res.statusText}`);
  }
  return res.text();
}

async function sendToDevin(prompt, data, overrideSessionId) {
  const opts = await chrome.storage.sync.get({
    apiKey: '',
    sessionId: '',
    apiVersion: 'v1',
    orgId: '',
    imageMode: 'attachment'
  });

  if (!opts.apiKey) return { ok: false, error: 'Devin API key not set. Open extension options.' };

  const targetSessionId = overrideSessionId || opts.sessionId;
  if (!targetSessionId) return { ok: false, error: 'Devin session ID not set. Open extension options.' };

  if (opts.apiVersion === 'v3' && !opts.orgId) {
    return { ok: false, error: 'Organization ID is required for v3 API.' };
  }

  // Confirm exactly which session we are about to message before sending anything.
  const target = await resolveTarget(opts, targetSessionId);
  if (!target.ok) return target;

  let attachmentUrl = null;

  if (data.screenshot && data.screenshot.ok && opts.imageMode !== 'none') {
    try {
      let imageUrl = data.screenshot.dataUrl;
      if (opts.imageMode === 'attachment' && data.combinedBounds) {
        const cropped = await cropImage(
          data.screenshot.dataUrl,
          data.combinedBounds,
          data.scroll || { x: 0, y: 0 },
          data.devicePixelRatio || 1
        );
        imageUrl = cropped;
      }
      if (opts.imageMode === 'attachment') {
        attachmentUrl = await uploadAttachment(imageUrl, opts.apiKey);
      } else {
        // base64 fallback — keep the data URL for markdown embed
        attachmentUrl = imageUrl;
      }
    } catch (e) {
      console.warn('Devin Design Mode: image handling failed', e);
    }
  }

  const message = buildMessage(prompt, data, opts, attachmentUrl);
  const body = opts.apiVersion === 'v3'
    ? { message, attachment_urls: attachmentUrl && opts.imageMode === 'attachment' ? [attachmentUrl] : [] }
    : { message };

  const url = messageUrl(opts, target.sessionId);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (res.ok) {
      return { ok: true, target: { sessionId: target.sessionId, title: target.title, status: target.status } };
    }
    let detail = '';
    try { detail = await res.text(); } catch (e) {}
    let error = `Devin API ${res.status}: ${detail || res.statusText}`;
    if (res.status === 401 || res.status === 403) {
      error += '. Check that your API key is correct and that this session belongs to your account.';
    } else if (res.status === 404) {
      error += '. The session may have been archived or deleted.';
    }
    return { ok: false, error };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function sessionUrl(opts, id) {
  return opts.apiVersion === 'v3'
    ? `https://api.devin.ai/v3/organizations/${opts.orgId}/sessions/${id}`
    : `https://api.devin.ai/v1/sessions/${id}`;
}

function messageUrl(opts, id) {
  return opts.apiVersion === 'v3'
    ? `https://api.devin.ai/v3/organizations/${opts.orgId}/sessions/${id}/messages`
    : `https://api.devin.ai/v1/sessions/${id}/message`;
}

// Accepts a raw ID, a prefixed ID, or a full Devin URL. Confirms the session
// really exists and returns the exact ID the API recognises, plus its title.
async function resolveTarget(opts, input) {
  const raw = extractSessionId(input);
  if (!raw) return { ok: false, error: 'Could not read a session ID from that value.' };

  const candidates = [];
  const push = (v) => { if (v && !candidates.includes(v)) candidates.push(v); };
  push(raw);
  push(raw.startsWith('devin-') ? raw.slice(6) : 'devin-' + raw);

  let lastError = '';
  for (const id of candidates) {
    try {
      const res = await fetch(sessionUrl(opts, id), {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${opts.apiKey}` }
      });
      if (res.ok) {
        const json = await res.json();
        return {
          ok: true,
          sessionId: json.session_id || id,
          title: json.title || '(untitled)',
          status: json.status_enum || json.status || 'unknown'
        };
      }
      if (res.status === 401 || res.status === 403) {
        return { ok: false, error: `Devin API ${res.status}: your API key cannot access this session.` };
      }
      lastError = `Devin API ${res.status}`;
    } catch (e) {
      lastError = e.message;
    }
  }

  return {
    ok: false,
    error: `Session not found (${lastError}). "${raw}" is not a session your API key can reach. Spaces cannot receive messages — pick a session inside the Space.`
  };
}

function extractSessionId(input) {
  if (!input) return '';
  const value = String(input).trim();
  const urlMatch = value.match(/\/(?:sessions|session|spaces)\/([^/?#\s]+)/);
  if (urlMatch) return urlMatch[1];
  return value;
}

async function listSessions(apiVersion, apiKey, orgId) {
  if (!apiKey) return { ok: false, error: 'API key not set.' };
  if (apiVersion === 'v3') {
    if (!orgId) return { ok: false, error: 'Organization ID is required for v3 API.' };
    return listSessionsV3(apiKey, orgId);
  }
  return listSessionsV1(apiKey);
}

async function listSessionsV1(apiKey) {
  const all = [];
  const limit = 100;
  for (let page = 0; page < 5; page++) {
    const url = `https://api.devin.ai/v1/sessions?limit=${limit}&offset=${page * limit}`;
    try {
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${apiKey}` } });
      if (!res.ok) {
        if (all.length) break;
        return { ok: false, error: await apiError(res) };
      }
      const json = await res.json();
      const batch = json.sessions || [];
      all.push(...batch);
      if (batch.length < limit) break;
    } catch (e) {
      if (all.length) break;
      return { ok: false, error: e.message };
    }
  }
  return { ok: true, sessions: normalizeSessions(all) };
}

async function listSessionsV3(apiKey, orgId) {
  const all = [];
  let after = null;
  for (let page = 0; page < 5; page++) {
    let url = `https://api.devin.ai/v3/organizations/${orgId}/sessions?first=100`;
    if (after) url += `&after=${encodeURIComponent(after)}`;
    try {
      const res = await fetch(url, { headers: { 'Authorization': `Bearer ${apiKey}` } });
      if (!res.ok) {
        if (all.length) break;
        return { ok: false, error: await apiError(res) };
      }
      const json = await res.json();
      const batch = json.items || json.sessions || [];
      all.push(...batch);
      if (!json.has_next_page || !json.end_cursor) break;
      after = json.end_cursor;
    } catch (e) {
      if (all.length) break;
      return { ok: false, error: e.message };
    }
  }
  return { ok: true, sessions: normalizeSessions(all) };
}

function normalizeSessions(list) {
  return list.map(s => ({
    session_id: s.devin_id || s.session_id || s.id || '',
    title: s.title || '(untitled)',
    status: s.status_enum || s.status || 'unknown',
    updated_at: s.updated_at || s.created_at || null
  })).filter(s => s.session_id)
    .sort((a, b) => new Date(b.updated_at || 0) - new Date(a.updated_at || 0));
}

async function apiError(res) {
  let detail = '';
  try { detail = await res.text(); } catch (e) {}
  return `Devin API ${res.status}: ${detail || res.statusText}`;
}

async function getSpacesFromDevinUI() {
  try {
    const tabs = await chrome.tabs.query({
      url: ['https://app.devin.ai/*', 'https://devin.ai/*', 'https://*.devin.ai/*']
    });
    if (!tabs.length) {
      return { ok: false, error: 'No Devin tab open. Open app.devin.ai to include Spaces sidebar items.' };
    }
    const all = [];
    for (const tab of tabs) {
      try {
        const [result] = await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          func: scrapeDevinSidebar
        });
        if (result && result.result && result.result.length) {
          all.push(...result.result);
        }
      } catch (e) {
        // ignore tabs that cannot be scripted
      }
    }
    if (!all.length) {
      return { ok: false, error: 'No Spaces found in the Devin UI. Make sure the Spaces sidebar is open.' };
    }
    const seen = new Set();
    const unique = all.filter(r => {
      if (seen.has(r.url)) return false;
      seen.add(r.url);
      return true;
    });
    return { ok: true, spaces: unique };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function scrapeDevinSidebar() {
  // Collect every session/space link on the Devin page, in DOM order.
  // The Spaces sidebar items are anchors; dedupe by ID.
  const results = [];
  const seen = new Set();
  document.querySelectorAll('a[href*="/sessions/"], a[href*="/spaces/"]').forEach(a => {
    const href = a.getAttribute('href') || '';
    const m = href.match(/\/(?:sessions|spaces)\/([^/?#]+)/);
    if (!m || seen.has(m[1])) return;
    const title = (a.textContent || '').trim();
    if (!title || title.length > 120) return;
    seen.add(m[1]);
    results.push({
      title,
      id: m[1],
      url: href,
      type: href.includes('/spaces/') ? 'space' : 'session',
      updated_at: null
    });
  });
  return results;
}

function buildMessage(prompt, data, opts, attachmentUrl) {
  const parts = [];
  const labels = data.labels && data.labels.length ? data.labels : [];

  parts.push(`# Design Mode Request`);
  parts.push(`Page: ${data.pageUrl}`);
  parts.push(`Viewport: ${data.viewport.width}x${data.viewport.height}`);
  if (labels.length) {
    parts.push(`Selected elements: ${labels.join(', ')}`);
  } else {
    parts.push(`Selected items: ${data.itemCount}`);
  }
  parts.push('');
  parts.push(`## User request`);
  parts.push(prompt);
  parts.push('');

  if (data.combinedBounds) {
    parts.push(`## Selection bounds`);
    parts.push(`x: ${Math.round(data.combinedBounds.x)}, y: ${Math.round(data.combinedBounds.y)}, width: ${Math.round(data.combinedBounds.width)}, height: ${Math.round(data.combinedBounds.height)}`);
    parts.push('');
  }

  if (attachmentUrl) {
    parts.push(`## Screenshot`);
    if (opts.imageMode === 'attachment') {
      parts.push(`ATTACHMENT:"${attachmentUrl}"`);
    } else {
      parts.push(`Current page screenshot is attached below as a base64 image.`);
      parts.push(`![Current page](${attachmentUrl})`);
    }
    parts.push('');
  }

  if (data.elements && data.elements.length) {
    parts.push(`## Elements`);
    data.elements.forEach((el) => {
      const label = el.label ? `${el.label} ` : '';
      parts.push(`### ${label}${el.tag}${el.id ? '#' + el.id : ''}${el.componentName ? ' (' + el.componentName + ')' : ''}`);
      if (el.label) parts.push(`Label: ${el.label}`);
      parts.push(`Selector: \`${el.selector}\``);
      if (el.className) parts.push(`Classes: \`${el.className}\``);
      parts.push(`Bounds: x=${Math.round(el.bounds.x)} y=${Math.round(el.bounds.y)} w=${Math.round(el.bounds.width)} h=${Math.round(el.bounds.height)}`);
      parts.push(`Styles: ${el.styles}`);
      if (el.componentName) parts.push(`Component: ${el.componentName}`);
      if (el.text) parts.push(`Text: "${el.text.replace(/"/g, '\\"')}"`);
      if (el.html) parts.push(`HTML snippet:\n\`\`\`html\n${el.html}\n\`\`\``);
      parts.push('');
    });
  }

  return parts.join('\n');
}