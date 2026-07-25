(function () {
  'use strict';

  if (window.__devinDesignModeLoaded) return;
  window.__devinDesignModeLoaded = true;

  const STATE = {
    active: false,
    selecting: false,
    boxStart: null,
    boxEl: null,
    selected: new Set(),
    hoverEl: null,
    shiftDown: false,
    metaDown: false,
    toolbar: null,
    promptPanel: null,
    overlay: null
  };

  const SELECTOR_ATTR = 'data-devin-design-selected';
  const HOVER_ATTR = 'data-devin-design-hover';

  const ICON = `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>`;

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
        <button class="devin-btn devin-btn-primary" id="devin-ask">Ask Devin</button>
      </div>
      <button class="devin-close" id="devin-close" title="Exit Design Mode">×</button>
    `;
    tb.querySelector('#devin-clear').onclick = clearSelection;
    tb.querySelector('#devin-ask').onclick = openPromptPanel;
    tb.querySelector('#devin-close').onclick = toggleActive;
    STATE.toolbar = tb;
    document.body.appendChild(tb);
    return tb;
  }

  function updateToolbar() {
    const tb = getToolbar();
    const count = STATE.selected.size;
    tb.querySelector('.devin-toolbar-title').textContent = count
      ? `Devin Design Mode — ${count} selected`
      : 'Devin Design Mode';
  }

  function openPromptPanel() {
    if (STATE.selected.size === 0) return alert('Select at least one element or area first.');
    if (STATE.promptPanel) STATE.promptPanel.remove();

    const panel = createNode('div', 'devin-design-prompt');
    panel.innerHTML = `
      <div class="devin-prompt-header">Send to Devin</div>
      <textarea class="devin-prompt-text" placeholder="Describe what you want to change..."></textarea>
      <div class="devin-prompt-actions">
        <button class="devin-btn devin-btn-secondary" id="devin-prompt-cancel">Cancel</button>
        <button class="devin-btn devin-btn-primary" id="devin-prompt-submit">Send</button>
      </div>
      <div class="devin-prompt-status"></div>
    `;
    const textarea = panel.querySelector('textarea');
    panel.querySelector('#devin-prompt-cancel').onclick = () => panel.remove();
    panel.querySelector('#devin-prompt-submit').onclick = () => submitToDevin(panel, textarea.value);
    STATE.promptPanel = panel;
    document.body.appendChild(panel);
    textarea.focus();
  }

  function clearSelection() {
    STATE.selected.forEach(el => el.removeAttribute(SELECTOR_ATTR));
    STATE.selected.clear();
    updateToolbar();
  }

  function isInToolbar(el) {
    return el.closest && el.closest('.devin-design-toolbar, .devin-design-prompt');
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

    return {
      tag: el.tagName.toLowerCase(),
      id: el.id || null,
      className: el.className || null,
      componentName,
      selector,
      text,
      html,
      styles,
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

  function collectSelectionData() {
    const elements = Array.from(STATE.selected);
    const pageUrl = window.location.href;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const scroll = { x: window.scrollX, y: window.scrollY };

    const items = elements.map(el => {
      const info = elementInfo(el);
      return info;
    });

    const bounds = items.map(i => i.bounds);
    const minX = Math.min(...bounds.map(b => b.left));
    const minY = Math.min(...bounds.map(b => b.top));
    const maxX = Math.max(...bounds.map(b => b.right));
    const maxY = Math.max(...bounds.map(b => b.bottom));

    return {
      pageUrl,
      viewport,
      scroll,
      itemCount: items.length,
      combinedBounds: bounds.length ? { x: minX, y: minY, width: maxX - minX, height: maxY - minY } : null,
      elements: items
    };
  }

  async function submitToDevin(panel, promptText) {
    if (!promptText.trim()) return;
    const status = panel.querySelector('.devin-prompt-status');
    status.textContent = 'Capturing context…';

    const data = collectSelectionData();

    try {
      const screenshot = await chrome.runtime.sendMessage({ action: 'captureScreenshot' });
      data.screenshot = screenshot;
      status.textContent = 'Sending to Devin…';
      const res = await chrome.runtime.sendMessage({
        action: 'sendToDevin',
        prompt: promptText,
        data
      });
      if (res.ok) {
        status.textContent = 'Sent to Devin.';
        setTimeout(() => panel.remove(), 1000);
      } else {
        status.textContent = `Error: ${res.error}`;
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
    target.setAttribute(HOVER_ATTR, 'true');
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
    updateToolbar();
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

    // Prefer topmost (smallest) elements that are at least half inside the box.
    const selected = candidates.filter(el => {
      const r = el.getBoundingClientRect();
      const iw = Math.max(0, Math.min(r.right, rect.right) - Math.max(r.left, rect.left));
      const ih = Math.max(0, Math.min(r.bottom, rect.bottom) - Math.max(r.top, rect.top));
      const area = r.width * r.height;
      const overlap = iw * ih;
      // skip children whose parent is already a candidate and fully contains them
      const parent = candidates.find(p => p !== el && p.contains(el));
      if (parent) {
        const pr = parent.getBoundingClientRect();
        if (pr.left <= r.left && pr.top <= r.top && pr.right >= r.right && pr.bottom >= r.bottom) {
          return false;
        }
      }
      return overlap > 0;
    });

    selected.forEach(el => {
      STATE.selected.add(el);
      el.setAttribute(SELECTOR_ATTR, 'true');
    });
  }

  function toggleElement(el) {
    if (STATE.selected.has(el)) {
      STATE.selected.delete(el);
      el.removeAttribute(SELECTOR_ATTR);
    } else {
      STATE.selected.add(el);
      el.setAttribute(SELECTOR_ATTR, 'true');
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
    if (e.key === 'Escape' && STATE.active && !STATE.promptPanel) toggleActive();
    if (e.key === 'Delete' && STATE.active) clearSelection();
  }

  function onKeyUp(e) {
    if (e.key === 'Shift') STATE.shiftDown = false;
    if (e.key === 'Meta' || e.key === 'Control') STATE.metaDown = false;
  }

  function toggleActive() {
    STATE.active = !STATE.active;
    const overlay = getOverlay();
    if (STATE.active) {
      overlay.classList.add('devin-design-active');
      getToolbar().style.display = 'flex';
      document.addEventListener('mousemove', onMouseMove, true);
      document.addEventListener('mousedown', onMouseDown, true);
      document.addEventListener('mousemove', onMouseMoveBox, true);
      document.addEventListener('mouseup', onMouseUp, true);
      document.addEventListener('click', onClick, true);
      document.addEventListener('keydown', onKeyDown, true);
      document.addEventListener('keyup', onKeyUp, true);
    } else {
      overlay.classList.remove('devin-design-active');
      getToolbar().style.display = 'none';
      if (STATE.promptPanel) STATE.promptPanel.remove();
      clearSelection();
      document.removeEventListener('mousemove', onMouseMove, true);
      document.removeEventListener('mousedown', onMouseDown, true);
      document.removeEventListener('mousemove', onMouseMoveBox, true);
      document.removeEventListener('mouseup', onMouseUp, true);
      document.removeEventListener('click', onClick, true);
      document.removeEventListener('keydown', onKeyDown, true);
      document.removeEventListener('keyup', onKeyUp, true);
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