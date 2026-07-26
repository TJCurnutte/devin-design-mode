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
      const res = await listSessions(opts.apiVersion, opts.apiKey, opts.orgId);
      if (res.ok) {
        sendResponse({ ok: true, sessions: res.sessions, defaultSessionId: opts.sessionId });
      } else {
        sendResponse(res);
      }
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

  const all = [];
  let offset = 0;
  const limit = 100;
  const maxPages = 3;

  for (let page = 0; page < maxPages; page++) {
    const baseUrl = apiVersion === 'v3'
      ? `https://api.devin.ai/v3/organizations/${orgId}/sessions?limit=${limit}&offset=${offset}`
      : `https://api.devin.ai/v1/sessions?limit=${limit}&offset=${offset}`;
    try {
      const res = await fetch(baseUrl, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${apiKey}` }
      });
      if (!res.ok) {
        if (all.length) break;
        let detail = '';
        try { detail = await res.text(); } catch (e) {}
        return { ok: false, error: `Devin API ${res.status}: ${detail || res.statusText}` };
      }
      const json = await res.json();
      const sessions = (json.sessions || []);
      if (!sessions.length) break;
      all.push(...sessions);
      if (sessions.length < limit) break;
      offset += limit;
    } catch (e) {
      if (all.length) break;
      return { ok: false, error: e.message };
    }
  }

  const mapped = all.map(s => ({
    session_id: s.session_id,
    title: s.title || '(untitled)',
    status: s.status,
    updated_at: s.updated_at
  })).sort((a, b) => new Date(b.updated_at) - new Date(a.updated_at));

  return { ok: true, sessions: mapped };
}

async function getSpacesFromDevinUI() {
  try {
    const tabs = await chrome.tabs.query({
      url: ['https://app.devin.ai/*', 'https://devin.ai/*', 'https://*.devin.ai/*']
    });
    if (!tabs.length) {
      return { ok: false, error: 'Open app.devin.ai to load Spaces.' };
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
  const results = [];
  const seen = new Set();

  function add(title, id, url, type) {
    if (!title || !id || seen.has(url)) return;
    seen.add(url);
    results.push({ title, id, url, type, updated_at: null });
  }

  // 1. Try to find the Spaces heading and nearby links.
  const all = document.querySelectorAll('*');
  let spacesHeading = null;
  for (const el of all) {
    if (el.children.length === 1 && el.children[0].nodeType === 3 && el.textContent.trim() === 'Spaces') {
      spacesHeading = el;
      break;
    }
    if (el.children.length === 0 && el.textContent.trim() === 'Spaces') {
      spacesHeading = el;
      break;
    }
  }
  if (spacesHeading) {
    let container = spacesHeading.parentElement;
    for (let i = 0; i < 8 && container; i++) {
      const links = container.querySelectorAll('a[href*="/sessions/"], a[href*="/spaces/"]');
      if (links.length >= 1) {
        links.forEach(a => {
          const href = a.getAttribute('href') || '';
          const m = href.match(/\/(?:sessions|spaces)\/([^/?#]+)/);
          const title = a.textContent.trim();
          if (m && title) add(title, m[1], href, href.includes('/spaces/') ? 'space' : 'session');
        });
        break;
      }
      container = container.parentElement;
    }
  }

  // 2. Fallback: left-hand links anywhere on the page.
  if (!results.length) {
    const vw = window.innerWidth;
    document.querySelectorAll('a[href*="/sessions/"], a[href*="/spaces/"]').forEach(a => {
      const rect = a.getBoundingClientRect();
      if (rect.left > vw * 0.35) return;
      const href = a.getAttribute('href') || '';
      const m = href.match(/\/(?:sessions|spaces)\/([^/?#]+)/);
      const title = a.textContent.trim();
      if (m && title) add(title, m[1], href, href.includes('/spaces/') ? 'space' : 'session');
    });
  }

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