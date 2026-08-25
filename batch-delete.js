/*
 * ARSwineTech Pro — platform-owner batch deletion controls.
 *
 * Supported datasets:
 *   - sows              -> entity_type sow
 *   - piglet batches    -> entity_type piglet_batch
 *   - semen collection  -> entity_type semen_inventory
 *   - registered boars   -> entity_type boar
 *
 * The UI is hidden unless the verified platform-owner guard is true. The cloud
 * deletion itself uses a platform-owner-only RPC; it never falls back to a
 * member-authorized table DELETE.
 */
(function () {
  'use strict';

  const CONFIG = {
    sows: { label: 'sows', entity: 'sow', localKey: 'sows', selector: '#table-sows tbody tr[data-batch-delete-row]' },
    piglets: { label: 'piglet batches', entity: 'piglet_batch', localKey: 'piglets', selector: '#piglets [data-batch-delete-row][data-batch-delete-entity="piglet_batch"]' },
    semen: { label: 'semen collection records', entity: 'semen_inventory', localKey: 'semen', selector: '#table-semen tbody tr[data-batch-delete-row]' },
    boars: { label: 'boars', entity: 'boar', localKey: 'boars', selector: '#boarRegistryPanel [data-batch-delete-row][data-batch-delete-entity="boar"]' },
    financials: { label: 'financial transactions', entity: 'transaction', localKey: 'transactions', selector: '#table-financials tbody tr[data-batch-delete-row]' }
  };

  let refreshTimer = null;

  function isPlatformOwner() {
    return typeof window.isSuperAdmin === 'function'
      ? window.isSuperAdmin() === true
      : window.platformAdminVerified === true && String(window.arsSessionUser?.email || '').trim().toLowerCase() === 'arswinetech@gmail.com';
  }

  function activeConfig() {
    const page = document.querySelector('.page.active');
    if (!page) return null;
    return CONFIG[page.id] || null;
  }

  function rowsFor(config) {
    return config ? Array.from(document.querySelectorAll(config.selector)) : [];
  }

  function localId(item, entity, index) {
    const raw = item && (item._ars_cloud_local_id || item.id || item.no || item.tag || item.code || item.name);
    return String(raw || `${entity}-${index}`);
  }

  function removeControls() {
    document.querySelectorAll('.batch-delete-bar, .batch-delete-check').forEach(el => el.remove());
  }

  function ensureCheckbox(row) {
    // Table checkboxes live inside the first <td>; card checkboxes are direct
    // children. Use a descendant check so MutationObserver does not append the
    // same checkbox repeatedly.
    if (row.querySelector('.batch-delete-check')) return;
    const key = row.dataset.batchDeleteKey || '';
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'batch-delete-check';
    checkbox.dataset.batchDeleteKey = key;
    checkbox.setAttribute('aria-label', `Select ${key} for deletion`);
    checkbox.addEventListener('click', event => event.stopPropagation());
    checkbox.addEventListener('change', updateBar);
    if (row.matches('tr')) {
      const cell = row.querySelector('td');
      if (cell) cell.prepend(checkbox);
    } else {
      row.prepend(checkbox);
    }
  }

  function activePageElement() {
    return document.querySelector('.page.active') || document;
  }

  function selectedKeys() {
    return Array.from(activePageElement().querySelectorAll('.batch-delete-check:checked'))
      .map(input => input.dataset.batchDeleteKey)
      .filter(Boolean);
  }

  function updateBar() {
    const bar = activePageElement().querySelector('.batch-delete-bar');
    if (!bar) return;
    const selected = selectedKeys();
    const count = bar.querySelector('.batch-delete-count');
    const deleteButton = bar.querySelector('.batch-delete-action');
    if (count) count.textContent = `${selected.length} selected`;
    if (deleteButton) deleteButton.disabled = selected.length === 0;
  }

  function toggleAllVisible() {
    const inputs = Array.from(activePageElement().querySelectorAll('.batch-delete-check'))
      .filter(input => !input.closest('.collapsible-extra-row'));
    if (!inputs.length) return;
    const shouldSelect = inputs.some(input => !input.checked);
    inputs.forEach(input => { input.checked = shouldSelect; });
    updateBar();
  }

  async function deleteSelected() {
    if (!isPlatformOwner()) {
      toast('Platform owner access is required for batch deletion.');
      return;
    }
    const config = activeConfig();
    const keys = selectedKeys();
    if (!config || !keys.length) return;
    const typed = prompt(`PERMANENTLY DELETE ${keys.length} ${config.label}?\n\nThis removes the selected records from the active farm in the cloud and on this device. This cannot be undone.\n\nType DELETE to confirm:`);
    if (typed === null || typed.trim().toUpperCase() !== 'DELETE') {
      toast('Batch deletion cancelled.');
      return;
    }
    if (!confirm(`Final confirmation: permanently delete these ${keys.length} ${config.label}?`)) return;

    const farmId = window.__arsActiveFarmId || window.farmId;
    if (!farmId || !window.ARSCloud?.deleteAppRecordsBatch) {
      toast('Batch deletion is unavailable until the platform-owner RPC is installed.');
      return;
    }

    const bar = activePageElement().querySelector('.batch-delete-bar');
    if (bar) bar.classList.add('is-working');
    try {
      const result = await ARSCloud.deleteAppRecordsBatch(farmId, config.entity, keys);
      if (!result || result.success === false) throw new Error(result?.reason || 'Cloud batch deletion failed.');
      const farm = window.DB && window.DB[farmId];
      if (farm && Array.isArray(farm[config.localKey])) {
        farm[config.localKey] = farm[config.localKey].filter((item, index) => !keys.includes(localId(item, config.entity, index)));
      }
      if (window.save) window.save();
      if (window.renderAll) window.renderAll();
      toast(`✓ Deleted ${result.deleted ?? keys.length} selected ${config.label}.`);
    } catch (error) {
      toast(`⚠️ Nothing was removed locally because the cloud deletion was blocked: ${error.message || error}`);
    } finally {
      if (bar) bar.classList.remove('is-working');
    }
  }

  function ensureBar(config, rows) {
    const page = document.querySelector('.page.active');
    if (!page || page.querySelector('.batch-delete-bar')) return;
    const bar = document.createElement('div');
    bar.className = 'panel batch-delete-bar';
    bar.innerHTML = `<div><b>Platform-owner batch deletion</b><small>Select ${config.label} to remove permanently from the cloud and this device.</small></div><span class="batch-delete-count">0 selected</span><button type="button" class="btn ghost small batch-select-all">Select all visible</button><button type="button" class="btn danger-btn small batch-delete-action" disabled>Delete selected</button>`;
    const anchor = page.querySelector('.toolbar, .section-head, .notice') || page.firstElementChild;
    if (anchor) anchor.insertAdjacentElement('afterend', bar);
    else page.prepend(bar);
    bar.querySelector('.batch-select-all')?.addEventListener('click', toggleAllVisible);
    bar.querySelector('.batch-delete-action')?.addEventListener('click', deleteSelected);
  }

  function enhance() {
    refreshTimer = null;
    if (!isPlatformOwner()) {
      removeControls();
      return;
    }
    const config = activeConfig();
    const rows = rowsFor(config);
    if (!config || !rows.length) {
      removeControls();
      return;
    }
    rows.forEach(ensureCheckbox);
    ensureBar(config, rows);
    updateBar();
  }

  function schedule() {
    if (refreshTimer) return;
    refreshTimer = setTimeout(enhance, 60);
  }

  const oldRenderAll = window.renderAll;
  window.renderAll = function () {
    const result = typeof oldRenderAll === 'function' ? oldRenderAll.apply(this, arguments) : undefined;
    schedule();
    return result;
  };

  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', enhance);
  else schedule();

  window.toggleAllBatchDelete = toggleAllVisible;
  window.deleteSelectedBatchRecords = deleteSelected;
  window.enhanceBatchDelete = enhance;
})();
