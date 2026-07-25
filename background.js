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
    sendToDevin(request.prompt, request.data).then(sendResponse);
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

async function sendToDevin(prompt, data) {
  const opts = await chrome.storage.sync.get({
    apiKey: '',
    sessionId: '',
    apiVersion: 'v1',
    orgId: '',
    imageMode: 'attachment'
  });

  if (!opts.apiKey) return { ok: false, error: 'Devin API key not set. Open extension options.' };
  if (!opts.sessionId) return { ok: false, error: 'Devin session ID not set. Open extension options.' };

  let sessionId = opts.sessionId;
  if (opts.apiVersion === 'v3') {
    if (!opts.orgId) return { ok: false, error: 'Organization ID is required for v3 API.' };
    if (!sessionId.startsWith('devin-')) sessionId = 'devin-' + sessionId;
  }

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

  const url = opts.apiVersion === 'v3'
    ? `https://api.devin.ai/v3/organizations/${opts.orgId}/sessions/${sessionId}/messages`
    : `https://api.devin.ai/v1/sessions/${sessionId}/message`;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${opts.apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(body)
    });
    if (res.ok || res.status === 200) {
      return { ok: true };
    }
    let detail = '';
    try { detail = await res.text(); } catch (e) {}
    return { ok: false, error: `Devin API ${res.status}: ${detail || res.statusText}` };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

function buildMessage(prompt, data, opts, attachmentUrl) {
  const parts = [];

  parts.push(`# Design Mode Request`);
  parts.push(`Page: ${data.pageUrl}`);
  parts.push(`Viewport: ${data.viewport.width}x${data.viewport.height}`);
  parts.push(`Selected items: ${data.itemCount}`);
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
    data.elements.forEach((el, idx) => {
      parts.push(`### Element ${idx + 1}: ${el.tag}${el.id ? '#' + el.id : ''}${el.componentName ? ' (' + el.componentName + ')' : ''}`);
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