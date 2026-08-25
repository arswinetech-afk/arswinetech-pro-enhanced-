/*
 * ARSwineTech Pro — long-list collapse/expand enhancer.
 *
 * It preserves every record in the DOM and only changes which rows are visible:
 *   - tables: first 8 rows by default;
 *   - long farm cards/row lists: first 6 items by default.
 *
 * Search/filter input automatically expands the relevant list so matching rows
 * remain discoverable. Expansion state is kept for the current page session so
 * a background cloud refresh does not immediately collapse a list the user
 * just opened.
 */
(function () {
  'use strict';

  const TABLE_LIMIT = 8;
  const CARD_LIMIT = 6;
  const state = window.__arsCollapsibleState = window.__arsCollapsibleState || {};
  let enhanceTimer = null;

  function activePage() {
    return document.querySelector('.page.active') || document;
  }

  function activePageId() {
    return document.querySelector('.page.active')?.id || 'document';
  }

  function rowsForTable(table) {
    return Array.from(table.querySelectorAll('tbody tr')).filter(row => {
      return !row.classList.contains('search-empty-row') && !row.querySelector('.empty');
    });
  }

  function directRows(container) {
    const selectors = [
      ':scope > .summary-row',
      ':scope > .vax-row',
      ':scope > .drill-row',
      ':scope > .piglet-live-row',
      ':scope > .reseller-card'
    ];
    const result = [];
    selectors.forEach(selector => {
      try { result.push(...container.querySelectorAll(selector)); } catch (_) {}
    });
    return Array.from(new Set(result));
  }

  function keyFor(container, kind) {
    const pageId = activePageId();
    if (container.dataset.collapsibleKey) return container.dataset.collapsibleKey;
    const table = container.querySelector('table');
    if (table?.id) return `${pageId}:${kind}:${table.id}`;
    if (container.id) return `${pageId}:${kind}:${container.id}`;
    const heading = container.querySelector('h2,h3')?.textContent?.trim().replace(/\s+/g, ' ');
    return `${pageId}:${kind}:${heading || Array.from(activePage().querySelectorAll('.med-inv,.vax-sec,.batch-cards')).indexOf(container)}`;
  }

  function applyRows(rows, limit, expanded) {
    rows.slice(limit).forEach(row => row.classList.toggle('collapsible-extra-row', !expanded));
  }

  function makeToggle(container, total, limit, key, isExpanded, setExpanded) {
    if (container.querySelector(':scope > .collapsible-list-toggle')) return null;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'btn ghost collapsible-list-toggle';
    button.dataset.collapsibleKey = key;
    button.setAttribute('aria-expanded', String(isExpanded()));
    button.textContent = isExpanded() ? '▲ Show fewer' : `▼ Show all ${total}`;
    button.title = isExpanded() ? `Show the first ${limit} items` : `Expand all ${total} items`;
    button.addEventListener('click', event => {
      event.preventDefault();
      event.stopPropagation();
      setExpanded(!isExpanded());
      updateToggle();
    });
    container.appendChild(button);

    function updateToggle() {
      const expanded = isExpanded();
      button.setAttribute('aria-expanded', String(expanded));
      button.textContent = expanded ? '▲ Show fewer' : `▼ Show all ${total}`;
      button.title = expanded ? `Show the first ${limit} items` : `Expand all ${total} items`;
    }
    return { button, updateToggle };
  }

  function enhanceTable(panel) {
    if (panel.dataset.collapsibleEnhanced === 'table') return;
    const table = panel.querySelector('table');
    if (!table || table.id === 'table-reservations' || table.id === 'table-useradmin' || table.id === 'table-farmadmin') return;
    const rows = rowsForTable(table);
    if (rows.length <= TABLE_LIMIT) return;

    const key = keyFor(panel, 'table');
    let expanded = state[key] === true;
    applyRows(rows, TABLE_LIMIT, expanded);
    panel.dataset.collapsibleEnhanced = 'table';
    const control = makeToggle(panel, rows.length, TABLE_LIMIT, key, () => expanded, value => {
      expanded = value;
      state[key] = value;
      applyRows(rows, TABLE_LIMIT, expanded);
    });
    if (control) control.updateToggle();
  }

  function enhanceCardList(container) {
    if (container.dataset.collapsibleEnhanced === 'cards') return;
    const rows = directRows(container).filter(row => !row.classList.contains('empty'));
    if (rows.length <= CARD_LIMIT) return;

    const key = keyFor(container, 'cards');
    let expanded = state[key] === true;
    applyRows(rows, CARD_LIMIT, expanded);
    container.dataset.collapsibleEnhanced = 'cards';
    const control = makeToggle(container, rows.length, CARD_LIMIT, key, () => expanded, value => {
      expanded = value;
      state[key] = value;
      applyRows(rows, CARD_LIMIT, expanded);
    });
    if (control) control.updateToggle();
  }

  function expandForSearch(input) {
    const page = input.closest('.page') || document;
    page.querySelectorAll('.collapsible-extra-row').forEach(row => row.classList.remove('collapsible-extra-row'));
    page.querySelectorAll('.collapsible-list-toggle').forEach(button => {
      if (button.dataset.collapsibleKey) state[button.dataset.collapsibleKey] = true;
      button.setAttribute('aria-expanded', 'true');
      button.textContent = '▲ Show fewer';
      button.title = 'Show the compact list';
    });
  }

  function enhance() {
    enhanceTimer = null;
    const page = activePage();
    page.querySelectorAll('.panel.table-wrap').forEach(enhanceTable);
    page.querySelectorAll('.med-inv, .vax-sec, #pigletRowList, .batch-cards, #boarRegistryPanel, #medRecentContainer').forEach(enhanceCardList);
  }

  function scheduleEnhance() {
    if (enhanceTimer) return;
    enhanceTimer = setTimeout(enhance, 40);
  }

  const oldRenderAll = window.renderAll;
  window.renderAll = function () {
    const result = typeof oldRenderAll === 'function' ? oldRenderAll.apply(this, arguments) : undefined;
    scheduleEnhance();
    return result;
  };

  document.addEventListener('input', event => {
    if (event.target && event.target.matches('input.search, input.fg-search, input.med-filter, input[type="search"]')) {
      expandForSearch(event.target);
      scheduleEnhance();
    }
  }, true);

  const observer = new MutationObserver(scheduleEnhance);
  observer.observe(document.body, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enhance);
  else scheduleEnhance();

  window.enhanceCollapsibleLists = enhance;
})();
