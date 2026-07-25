chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'toggle') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (!tabs[0]) return sendResponse({ active: false });
      chrome.tabs.sendMessage(tabs[0].id, { action: 'toggle' }, (res) => {
        sendResponse(res || { active: false });
      });
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

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-design-mode') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) chrome.tabs.sendMessage(tabs[0].id, { action: 'toggle' });
    });
  }
});

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

async function sendToDevin(prompt, data) {
  const opts = await chrome.storage.sync.get({
    apiKey: '',
    sessionId: '',
    apiVersion: 'v1',
    orgId: '',
    imageMode: 'base64'
  });

  if (!opts.apiKey) return { ok: false, error: 'Devin API key not set. Open extension options.' };
  if (!opts.sessionId) return { ok: false, error: 'Devin session ID not set. Open extension options.' };

  let sessionId = opts.sessionId;
  if (opts.apiVersion === 'v3') {
    if (!opts.orgId) return { ok: false, error: 'Organization ID is required for v3 API.' };
    if (!sessionId.startsWith('devin-')) sessionId = 'devin-' + sessionId;
  }

  const message = await buildMessage(prompt, data, opts);

  const url = opts.apiVersion === 'v3'
    ? `https://api.devin.ai/v3/organizations/${opts.orgId}/sessions/${sessionId}/messages`
    : `https://api.devin.ai/v1/sessions/${sessionId}/message`;

  const body = opts.apiVersion === 'v3'
    ? { message, attachment_urls: data.attachmentUrls || [] }
    : { message };

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

async function buildMessage(prompt, data, opts) {
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

  if (data.screenshot && data.screenshot.ok && opts.imageMode === 'base64') {
    parts.push(`## Screenshot`);
    parts.push(`Current page screenshot is attached below as a base64 image.`);
    parts.push(`![Current page](${data.screenshot.dataUrl})`);
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