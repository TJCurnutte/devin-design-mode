(function () {
  'use strict';

  if (window.__devinDesignModeLoaded) return;
  window.__devinDesignModeLoaded = true;

  const PALETTE = [
    '#ef4444', '#f97316', '#f59e0b', '#84cc16', '#10b981',
    '#06b6d4', '#3b82f6', '#6366f1', '#8b5cf6', '#d946ef',
    '#f43f5e', '#14b8a6'
  ];

  const STATE = {
    active: false,
    selecting: false,
    boxStart: null,
    boxEl: null,
    selected: new Set(),
    labels: new Map(), // element -> { label, color, badge }
    hoverEl: null,
    shiftDown: false,
    metaDown: false,
    paused: false,
    toolbar: null,
    chatPanel: null,
    overlay: null
  };

  const SELECTOR_ATTR = 'data-devin-design-selected';
  const HOVER_ATTR = 'data-devin-design-hover';

  function createNode(tag, className, html) {
    const el = document.createElement(tag);
    if (className) el.className = className;
    if (html) el.innerHTML = html;
    return el;
  }

  function getOverlay() {
    if (!STATE.overlay) {
      STATE.overlay = createNode('div', 'devin-design-overlay');
      document.body.appendChild(STATE.overlay);
    }
    return STATE.overlay;
  }

  function getToolbar() {
    if (STATE.toolbar) return STATE.toolbar;
    const tb = createNode('div', 'devin-design-toolbar');
    tb.innerHTML = `
      <div class="devin-toolbar-title">Devin Design Mode</div>
      <div class="devin-toolbar-actions">
        <button class="devin-btn devin-btn-secondary" id="devin-clear">Clear</button>
        <button class="devin-btn devin-btn-secondary" id="devin-pause" title="Pause selection so you can click UI tabs">Pause</button>
        <button class="devin-btn devin-btn-primary" id="devin-ask">Ask Devin</button>
      </div>
      <button class="devin-close" id="devin-close" title="Exit Design Mode">×</button>
    `;
    tb.querySelector('#devin-clear').onclick = clearSelection;
    tb.querySelector('#devin-pause').onclick = togglePause;
    tb.querySelector('#devin-ask').onclick = () => openChatPanel();
    tb.querySelector('#devin-close').onclick = toggleActive;
    STATE.toolbar = tb;
    document.body.appendChild(tb);
    return tb;
  }

  function updateToolbar() {
    const tb = getToolbar();
    const count = STATE.selected.size;
    const paused = STATE.paused;
    tb.querySelector('.devin-toolbar-title').textContent = count
      ? `Devin Design Mode — ${count} selected${paused ? ' (paused)' : ''}`
      : `Devin Design Mode${paused ? ' (paused)' : ''}`;
    const pauseBtn = tb.querySelector('#devin-pause');
    pauseBtn.textContent = paused ? 'Resume' : 'Pause';
  }

  function togglePause() {
    STATE.paused = !STATE.paused;
    updateToolbar();
    if (STATE.paused) {
      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('mousemove', onMouseMoveBox, true);
      document.removeEventListener('mouseup', onMouseUp, true);
      document.removeEventListener('click', onClick, true);
      if (STATE.hoverEl) {
        STATE.hoverEl.removeAttribute(HOVER_ATTR);
        STATE.hoverEl = null;
      }
    } else {
      document.addEventListener('mousemove', onMouseMove, true);
      document.addEventListener('mousedown', onMouseDown, true);
      document.addEventListener('mousemove', onMouseMoveBox, true);
      document.addEventListener('mouseup', onMouseUp, true);
      document.addEventListener('click', onClick, true);
    }
  }

  function getChatPanel() {
    if (STATE.chatPanel) return STATE.chatPanel;
    const panel = createNode('div', 'devin-design-chat');
    panel.dataset.minimized = 'false';
    panel.innerHTML = `
      <div class="devin-chat-header" id="devin-chat-header">
        <div class="devin-chat-title">Ask Devin</div>
        <div class="devin-chat-header-actions">
          <button class="devin-minimize" id="devin-chat-minimize" title="Minimize">−</button>
          <button class="devin-close" id="devin-chat-close" title="Close chat and clear selection">×</button>
        </div>
      </div>
      <div class="devin-chat-body" id="devin-chat-body">
        <div class="devin-chat-chips" id="devin-chat-chips"></div>
        <div class="devin-chat-hint">Click a chip to insert its label into your prompt.</div>
        <label class="devin-chat-label" for="devin-chat-session">Send to session</label>
        <select class="devin-chat-select" id="devin-chat-session">
          <option value="">— loading sessions —</option>
        </select>
        <textarea class="devin-chat-text" placeholder="e.g. img1 change this to match formatting of img2"></textarea>
        <div class="devin-chat-actions">
          <button class="devin-btn devin-btn-secondary" id="devin-chat-cancel">Clear</button>
          <button class="devin-btn devin-btn-primary" id="devin-chat-send">Send</button>
        </div>
        <div class="devin-chat-status" id="devin-chat-status"></div>
      </div>
    `;
    const textarea = panel.querySelector('textarea');
    const header = panel.querySelector('#devin-chat-header');
    panel.querySelector('#devin-chat-close').onclick = closeChatPanel;
    panel.querySelector('#devin-chat-minimize').onclick = toggleMinimizeChat;
    panel.querySelector('#devin-chat-cancel').onclick = clearSelection;
    panel.querySelector('#devin-chat-send').onclick = () => submitToDevin(panel, textarea.value);
    panel.querySelector('#devin-chat-chips').onclick = (e) => {
      const chip = e.target.closest('.devin-chip');
      if (chip) insertLabelAtCursor(textarea, chip.dataset.label);
    };
    setupDrag(header, panel);
    STATE.chatPanel = panel;
    document.body.appendChild(panel);
    return panel;
  }

  function setupDrag(handle, panel) {
    let dragging = false;
    let offsetX = 0;
    let offsetY = 0;

    handle.addEventListener('mousedown', (e) => {
      if (e.target.closest('.devin-chat-header-actions')) return;
      dragging = true;
      const rect = panel.getBoundingClientRect();
      offsetX = e.clientX - rect.left;
      offsetY = e.clientY - rect.top;
      panel.style.transition = 'none';
      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const pw = panel.offsetWidth;
      const ph = panel.offsetHeight;
      let left = e.clientX - offsetX;
      let top = e.clientY - offsetY;
      if (left < 0) left = 0;
      if (top < 0) top = 0;
      if (left + pw > vw) left = vw - pw;
      if (top + ph > vh) top = vh - ph;
      panel.style.left = left + 'px';
      panel.style.top = top + 'px';
    });

    document.addEventListener('mouseup', () => {
      if (dragging) {
        dragging = false;
        panel.style.transition = '';
      }
    });
  }

  function openChatPanel() {
    if (STATE.selected.size === 0) return;
    const panel = getChatPanel();
    panel.style.display = 'flex';
    panel.dataset.minimized = 'false';
    panel.classList.remove('devin-chat-minimized');
    updateChatPanel();
    loadSessionOptions();
    if (!panel.style.left) positionChatPanel();
    panel.querySelector('textarea').focus();
  }

  function toggleMinimizeChat() {
    const panel = getChatPanel();
    const isMin = panel.dataset.minimized === 'true';
    panel.dataset.minimized = isMin ? 'false' : 'true';
    panel.classList.toggle('devin-chat-minimized', !isMin);
    if (!isMin) {
      panel.querySelector('#devin-chat-minimize').textContent = '+';
      panel.querySelector('#devin-chat-minimize').title = 'Expand';
    } else {
      panel.querySelector('#devin-chat-minimize').textContent = '−';
      panel.querySelector('#devin-chat-minimize').title = 'Minimize';
      panel.querySelector('textarea').focus();
    }
  }

  function closeChatPanel() {
    if (STATE.chatPanel) {
      STATE.chatPanel.style.display = 'none';
      STATE.chatPanel.dataset.minimized = 'false';
      STATE.chatPanel.classList.remove('devin-chat-minimized');
    }
    clearSelection();
  }

  function updateChatPanel() {
    const panel = getChatPanel();
    const chips = panel.querySelector('#devin-chat-chips');
    chips.innerHTML = '';
    STATE.selected.forEach(el => {
      const data = STATE.labels.get(el);
      if (!data) return;
      const chip = createNode('div', 'devin-chip');
      chip.dataset.label = data.label;
      chip.style.setProperty('--chip-color', data.color);
      chip.textContent = `${data.label} (${el.tagName.toLowerCase()})`;
      chips.appendChild(chip);
    });
    const title = panel.querySelector('.devin-chat-title');
    title.textContent = STATE.selected.size === 1
      ? 'Ask Devin about 1 element'
      : `Ask Devin about ${STATE.selected.size} elements`;
  }

  async function loadSessionOptions() {
    const select = document.getElementById('devin-chat-session');
    if (!select) return;
    select.innerHTML = '<option value="">Loading sessions…</option>';
    try {
      const stored = await chrome.storage.sync.get({ sessionId: '' });
      const res = await chrome.runtime.sendMessage({ action: 'getSessions' });
      if (!res.ok) {
        select.innerHTML = `<option value="">Error: ${res.error}</option>`;
        return;
      }
      select.innerHTML = '';
      if (!res.sessions || res.sessions.length === 0) {
        select.innerHTML = '<option value="">No sessions found</option>';
        return;
      }
      // Active/running sessions first
      const activeStatuses = new Set(['working', 'blocked', 'resume_requested', 'resumed']);
      const sorted = res.sessions.slice().sort((a, b) => {
        const aActive = activeStatuses.has(a.status) ? 1 : 0;
        const bActive = activeStatuses.has(b.status) ? 1 : 0;
        if (aActive !== bActive) return bActive - aActive;
        return new Date(b.updated_at) - new Date(a.updated_at);
      });
      sorted.forEach(s => {
        const label = `${s.title} (${s.session_id.slice(0, 12)}…) — ${s.status}`;
        const opt = createNode('option');
        opt.value = s.session_id;
        opt.textContent = label;
        if (s.session_id === stored.sessionId) opt.selected = true;
        select.appendChild(opt);
      });
    } catch (e) {
      select.innerHTML = `<option value="">Error: ${e.message}</option>`;
    }
  }

  function positionChatPanel() {
    const panel = getChatPanel();
    const rects = Array.from(STATE.selected).map(el => el.getBoundingClientRect());
    const minX = Math.min(...rects.map(r => r.left));
    const minY = Math.min(...rects.map(r => r.top));
    const maxY = Math.max(...rects.map(r => r.bottom));
    const cx = (minX + Math.max(...rects.map(r => r.right))) / 2;

    // Default center below selection, but keep within viewport
    const vw = window.innerWidth;
    const vh = window.innerHeight;
    const pw = Math.min(520, vw - 40);
    panel.style.width = pw + 'px';
    let left = cx - pw / 2;
    let top = maxY + 24;
    if (left < 20) left = 20;
    if (left + pw > vw - 20) left = vw - pw - 20;
    if (top + 280 > vh - 20) top = Math.max(20, minY - 300);

    panel.style.position = 'fixed';
    panel.style.left = left + 'px';
    panel.style.top = top + 'px';
  }

  function insertLabelAtCursor(textarea, label) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    const text = textarea.value;
    const before = text.slice(0, start);
    const after = text.slice(end);
    const pad = before.length && !before.endsWith(' ') ? ' ' : '';
    textarea.value = before + pad + label + ' ' + after;
    textarea.selectionStart = textarea.selectionEnd = before.length + pad.length + label.length + 1;
    textarea.focus();
  }

  function clearSelection() {
    STATE.selected.forEach(el => {
      el.removeAttribute(SELECTOR_ATTR);
      el.style.removeProperty('--devin-selection-color');
    });
    STATE.labels.forEach(data => {
      if (data.badge && data.badge.parentNode) data.badge.remove();
    });
    STATE.selected.clear();
    STATE.labels.clear();
    updateToolbar();
    if (STATE.chatPanel) {
      STATE.chatPanel.style.display = 'none';
      STATE.chatPanel.querySelector('textarea').value = '';
      STATE.chatPanel.querySelector('#devin-chat-status').textContent = '';
    }
  }

  function isInToolbar(el) {
    return el.closest && el.closest('.devin-design-toolbar, .devin-design-chat');
  }

  function elementInfo(el) {
    const rect = el.getBoundingClientRect();
    const computed = window.getComputedStyle(el);
    const relevantStyles = [
      'width', 'height', 'margin', 'padding', 'border', 'display',
      'position', 'top', 'left', 'color', 'background-color',
      'font-size', 'font-weight', 'font-family', 'text-align',
      'flex', 'grid', 'gap', 'align-items', 'justify-content'
    ];
    const styles = relevantStyles
      .map(k => `${k}: ${computed.getPropertyValue(k)}`)
      .filter(Boolean)
      .join('; ');

    const componentName = getComponentName(el);
    const selector = getUniqueSelector(el);
    const text = el.innerText ? el.innerText.slice(0, 500) : '';
    const html = el.outerHTML ? el.outerHTML.slice(0, 1500) : '';
    const labelData = STATE.labels.get(el) || {};

    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      className: el.className || null,
      componentName,
      selector,
      text,
      html,
      styles,
      label: labelData.label || null,
      bounds: {
        x: rect.x + window.scrollX,
        y: rect.y + window.scrollY,
        width: rect.width,
        height: rect.height,
        top: rect.top + window.scrollY,
        right: rect.right + window.scrollX,
        bottom: rect.bottom + window.scrollY,
        left: rect.left + window.scrollX
      }
    };
  }

  function getComponentName(el) {
    try {
      const keys = Object.keys(el);
      const reactKey = keys.find(k => k.startsWith('__reactFiber') || k.startsWith('__reactInternalInstance'));
      if (reactKey) {
        let fiber = el[reactKey];
        while (fiber) {
          if (fiber.elementType && (fiber.elementType.name || fiber.elementType.displayName)) {
            return fiber.elementType.name || fiber.elementType.displayName;
          }
          fiber = fiber.return;
        }
      }
      const vueKey = keys.find(k => k.startsWith('__vue'));
      if (vueKey && el[vueKey]) {
        const vm = el[vueKey];
        return (vm.$options && vm.$options.name) || vm.name || null;
      }
    } catch (e) {}
    return null;
  }

  function getUniqueSelector(el) {
    if (el.id) return `#${el.id}`;
    if (el.className) {
      const classes = el.className.toString().split(/\s+/).filter(c => c && !c.startsWith('devin-'));
      if (classes.length) return `${el.tagName.toLowerCase()}.${classes.slice(0, 3).join('.')}`;
    }
    let path = [];
    let node = el;
    while (node && node.parentElement && path.length < 6) {
      const tag = node.tagName.toLowerCase();
      const idx = Array.from(node.parentElement.children).filter(c => c.tagName === node.tagName).indexOf(node) + 1;
      path.unshift(`${tag}:nth-of-type(${idx})`);
      node = node.parentElement;
    }
    return path.join(' > ');
  }

  function assignLabels() {
    // Remove existing badges
    STATE.labels.forEach(data => {
      if (data.badge && data.badge.parentNode) data.badge.remove();
    });
    STATE.labels.clear();

    const counters = {};
    let colorIndex = 0;
    STATE.selected.forEach(el => {
      const tag = el.tagName.toLowerCase();
      counters[tag] = (counters[tag] || 0) + 1;
      const label = `${tag}${counters[tag]}`;
      const color = PALETTE[colorIndex % PALETTE.length];
      colorIndex++;
      const badge = createBadge(el, label, color);
      STATE.labels.set(el, { label, color, badge });
      el.style.setProperty('--devin-selection-color', color);
      el.setAttribute(SELECTOR_ATTR, 'true');
    });
  }

  function createBadge(el, label, color) {
    const badge = createNode('div', 'devin-element-badge');
    badge.textContent = label;
    badge.style.backgroundColor = color;
    document.body.appendChild(badge);
    positionBadge(badge, el);
    return badge;
  }

  function positionBadge(badge, el) {
    const r = el.getBoundingClientRect();
    badge.style.left = (r.left + window.scrollX) + 'px';
    badge.style.top = (r.top + window.scrollY) + 'px';
  }

  function updateAllBadges() {
    STATE.labels.forEach((data, el) => {
      if (data.badge) positionBadge(data.badge, el);
    });
  }

  function collectSelectionData() {
    const elements = Array.from(STATE.selected);
    const pageUrl = window.location.href;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const scroll = { x: window.scrollX, y: window.scrollY };

    const items = elements.map(el => elementInfo(el));
    const bounds = items.map(i => i.bounds);
    const minX = bounds.length ? Math.min(...bounds.map(b => b.left)) : 0;
    const minY = bounds.length ? Math.min(...bounds.map(b => b.top)) : 0;
    const maxX = bounds.length ? Math.max(...bounds.map(b => b.right)) : 0;
    const maxY = bounds.length ? Math.max(...bounds.map(b => b.bottom)) : 0;

    return {
      pageUrl,
      viewport,
      scroll,
      devicePixelRatio: window.devicePixelRatio || 1,
      itemCount: items.length,
      labels: items.map(i => i.label).filter(Boolean),
      combinedBounds: bounds.length ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null,
      elements: items
    };
  }

  async function submitToDevin(panel, promptText) {
    if (!promptText.trim()) return;
    const status = panel.querySelector('#devin-chat-status');
    const sessionSelect = document.getElementById('devin-chat-session');
    const sessionId = sessionSelect ? sessionSelect.value : '';
    if (!sessionId) {
      status.textContent = 'Error: Select a Devin session first.';
      return;
    }
    status.textContent = 'Capturing context…';

    const data = collectSelectionData();

    try {
      const screenshot = await chrome.runtime.sendMessage({ action: 'captureScreenshot' });
      data.screenshot = screenshot;
      status.textContent = 'Sending to Devin…';
      const res = await chrome.runtime.sendMessage({
        action: 'sendToDevin',
        prompt: promptText,
        data,
        sessionId
      });
      if (res.ok) {
        status.textContent = 'Sent to Devin.';
        setTimeout(() => closeChatPanel(), 1000);
      } else {
        const msg = res.error || '';
        if (msg.includes('403') || msg.toLowerCase().includes('unauthorized')) {
          status.textContent = 'Error: 403 Unauthorized. Check your API key and session ID.';
        } else {
          status.textContent = `Error: ${msg}`;
        }
      }
    } catch (e) {
      status.textContent = `Error: ${e.message}`;
    }
  }

  function onMouseMove(e) {
    if (!STATE.active) return;
    if (STATE.selecting) {
      updateBox(e);
      return;
    }
    const target = document.elementFromPoint(e.clientX, e.clientY);
    if (!target || target === STATE.hoverEl) return;
    if (isInToolbar(target)) return;
    if (STATE.hoverEl) STATE.hoverEl.removeAttribute(HOVER_ATTR);
    STATE.hoverEl = target;
    if (target) target.setAttribute(HOVER_ATTR, 'true');
  }

  function onMouseDown(e) {
    if (!STATE.active || isInToolbar(e.target)) return;
    STATE.selecting = true;
    STATE.boxStart = { x: e.clientX, y: e.clientY };
    STATE.boxEl = createNode('div', 'devin-selection-box');
    STATE.boxEl.style.left = e.clientX + 'px';
    STATE.boxEl.style.top = e.clientY + 'px';
    document.body.appendChild(STATE.boxEl);
    e.preventDefault();
    e.stopPropagation();
  }

  function onMouseMoveBox(e) {
    if (!STATE.selecting || !STATE.boxStart) return;
    updateBox(e);
  }

  function updateBox(e) {
    if (!STATE.boxEl) return;
    const start = STATE.boxStart;
    const x = Math.min(start.x, e.clientX);
    const y = Math.min(start.y, e.clientY);
    const w = Math.abs(e.clientX - start.x);
    const h = Math.abs(e.clientY - start.y);
    STATE.boxEl.style.left = x + 'px';
    STATE.boxEl.style.top = y + 'px';
    STATE.boxEl.style.width = w + 'px';
    STATE.boxEl.style.height = h + 'px';
  }

  function onMouseUp(e) {
    if (!STATE.selecting) return;
    STATE.selecting = false;

    if (STATE.boxEl) {
      const boxRect = STATE.boxEl.getBoundingClientRect();
      const threshold = 4;
      if (boxRect.width > threshold || boxRect.height > threshold) {
        selectElementsInBox(boxRect);
      } else {
        // it was a click, select/deselect the element under the cursor
        const target = document.elementFromPoint(e.clientX, e.clientY);
        if (target && !isInToolbar(target)) toggleElement(target);
      }
      STATE.boxEl.remove();
      STATE.boxEl = null;
      STATE.boxStart = null;
    }
    e.preventDefault();
    e.stopPropagation();
    afterSelectionChange();
  }

  function selectElementsInBox(rect) {
    const addMode = STATE.shiftDown || STATE.metaDown;
    if (!addMode) clearSelection();

    const candidates = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT);
    while (walker.nextNode()) {
      const el = walker.currentNode;
      if (isInToolbar(el)) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue;
      const intersects = !(
        r.right < rect.left ||
        r.left > rect.right ||
        r.bottom < rect.top ||
        r.top > rect.bottom
      );
      if (intersects) candidates.push(el);
    }

    const selected = candidates.filter(el => {
      const r = el.getBoundingClientRect();
      // skip children whose parent is already selected
      const parent = candidates.find(p => p !== el && p.contains(el));
      if (parent) {
        const pr = parent.getBoundingClientRect();
        if (pr.left <= r.left && pr.top <= r.top && pr.right >= r.right && pr.bottom >= r.bottom) {
          return false;
        }
      }
      return true;
    });

    selected.forEach(el => STATE.selected.add(el));
  }

  function toggleElement(el) {
    if (STATE.selected.has(el)) {
      STATE.selected.delete(el);
    } else {
      STATE.selected.add(el);
    }
  }

  function afterSelectionChange() {
    assignLabels();
    updateToolbar();
    updateAllBadges();
    if (STATE.selected.size > 0) {
      openChatPanel();
    } else {
      if (STATE.chatPanel) STATE.chatPanel.style.display = 'none';
    }
  }

  function onClick(e) {
    if (!STATE.active) return;
    if (isInToolbar(e.target)) return;
    e.preventDefault();
    e.stopPropagation();
  }

  function onKeyDown(e) {
    if (e.key === 'Shift') STATE.shiftDown = true;
    if (e.key === 'Meta' || e.key === 'Control') STATE.metaDown = true;
    if (e.key === 'Escape' && STATE.active) {
      if (STATE.chatPanel && STATE.chatPanel.style.display !== 'none') {
        closeChatPanel();
      } else {
        toggleActive();
      }
    }
    if (e.key === 'Delete' && STATE.active) clearSelection();
  }

  function onKeyUp(e) {
    if (e.key === 'Shift') STATE.shiftDown = false;
    if (e.key === 'Meta' || e.key === 'Control') STATE.metaDown = false;
  }

  function onScrollResize() {
    if (!STATE.active) return;
    updateAllBadges();
  }

  function toggleActive() {
    STATE.active = !STATE.active;
    const overlay = getOverlay();
    if (STATE.active) {
      STATE.paused = false;
      overlay.classList.add('devin-design-active');
      getToolbar().style.display = 'flex';
      updateToolbar();
      document.addEventListener('mousemove', onMouseMove, true);
      document.addEventListener('mousedown', onMouseDown, true);
      document.addEventListener('mousemove', onMouseMoveBox, true);
      document.addEventListener('mouseup', onMouseUp, true);
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('keyup', onKeyUp, true);
      window.addEventListener('scroll', onScrollResize, true);
      window.addEventListener('resize', onScrollResize, true);
    } else {
      overlay.classList.remove('devin-design-active');
      getToolbar().style.display = 'none';
      closeChatPanel();
      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('mousemove', onMouseMoveBox, true);
      document.removeEventListener('mouseup', onMouseUp, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keyup', onKeyUp, true);
      window.removeEventListener('scroll', onScrollResize, true);
      window.removeEventListener('resize', onScrollResize, true);
    }
  }

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (msg.action === 'toggle') {
      toggleActive();
      sendResponse({ active: STATE.active });
    }
    return true;
  });
})();