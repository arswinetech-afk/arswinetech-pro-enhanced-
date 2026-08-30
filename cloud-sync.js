/* ═══════════════════════════════════════════════════════════════════════════
   ARSwineTech Pro — Real-Time Background Auto-Synchronization Engine
   Provides seamless, silent background syncing across all farm devices.
   ═══════════════════════════════════════════════════════════════════════════ */
(function() {
  'use strict';

  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Unique persistent device identifier
  const DEVICE_ID = (() => {
    let id = window.STORE ? STORE.getItem('ars-device-id') : null;
    if (!id) {
      id = 'dev-' + Math.random().toString(36).slice(2, 9) + '-' + Date.now().toString(36);
      if (window.STORE) STORE.setItem('ars-device-id', id);
    }
    return id;
  })();

  let syncState = 'synced'; // 'synced' | 'syncing' | 'offline' | 'pending'
  let autoPushTimer = null;
  let pollIntervalTimer = null;
  let lastPushTimestamp = 0;
  let lastPullTimestamp = 0;
  let isSyncingInProgress = false;

  function updateSyncIndicator(state, customLabel = '', tooltip = '') {
    syncState = state;
    const indicators = document.querySelectorAll('#liveSyncIndicator, .live-sync-indicator');
    indicators.forEach(el => {
      el.classList.remove('synced', 'syncing', 'offline', 'error', 'pending');
      el.classList.add(state);

      const dot = el.querySelector('.sync-dot');
      const icon = el.querySelector('.sync-icon');
      const label = el.querySelector('.sync-label');

      if (state === 'syncing') {
        if (icon) icon.textContent = '⟳';
        if (label) label.textContent = customLabel || 'Syncing...';
        el.title = tooltip || 'Synchronizing with cloud in background...';
      } else if (state === 'offline') {
        if (icon) icon.textContent = '⚡';
        if (label) label.textContent = customLabel || 'Offline';
        el.title = tooltip || 'Saved locally on this device. Will sync automatically when back online.';
      } else if (state === 'error') {
        if (icon) icon.textContent = '⚠️';
        if (label) label.textContent = customLabel || 'Sync blocked';
        el.title = tooltip || 'Cloud synchronization is blocked until the issue is reviewed.';
      } else if (state === 'pending') {
        if (icon) icon.textContent = '⏸';
        if (label) label.textContent = customLabel || 'Pending';
        el.title = tooltip || 'Local changes are preserved and awaiting a safe conflict check.';
      } else {
        // 'synced'
        if (icon) icon.textContent = '☁️';
        if (label) label.textContent = customLabel || 'Synced';
        el.title = tooltip || 'All farm updates are fully synchronized with the cloud.';
      }
    });
  }

  function getFarmDataSummary(f) {
    if (!f) return { total: 0, details: [] };
    const sows = (f.sows || []).length;
    const piglets = (f.piglets || []).length;
    const boars = (f.boars || []).length;
    const feed = (f.feed || []).length;
    const reservations = (f.reservations || []).length;
    const tx = (f.transactions || []).length;
    const ledger = (f.pigletLedger || []).length;
    const semen = (f.semen || []).length;
    const semenSales = (f.semenSales || []).length;
    const semenResellers = (f.semenResellers || []).length;
    const semenResellerTx = (f.semenResellerTx || []).length;
    const semenResellerAdjustments = (f.semenResellerAdjustments || []).length;
    const feedOrders = (f.feedOrders || []).length;
    const feedTrials = (f.feedTrials || []).length;
    const medicines = (f.medicines || []).length;
    const vaccinations = (f.vaccinations || []).length;
    const treatments = (f.treatments || []).length;
    const heatRecords = (f.heatRecords || []).length;
    const breedingRecords = (f.breedingRecords || []).length;
    const barns = (f.barns || []).length;
    const movements = (f.movements || []).length;
    const productionEvents = (f.productionEvents || []).length;
    const feedAllocations = (f.feedAllocations || []).length;
    const auditLog = (f.auditLog || []).length;
    const integrationEvents = (f.integrationEvents || []).length;
    const populationSnapshots = (f.populationSnapshots || []).length;
    const benchmarkProfiles = (f.benchmarkProfiles || []).length;
    const feedDuplicateRecovery = (f.feedDuplicateRecovery || []).length;
    const hasLogo = Boolean(f.logo || f.logo_url || (window.STORE && STORE.getItem('ars-farm-logo-' + (window.farmId || ''))));

    const total = sows + piglets + boars + feed + reservations + tx + ledger + semen + semenSales + semenResellers + semenResellerTx + semenResellerAdjustments + feedOrders + feedTrials + medicines + vaccinations + treatments + heatRecords + breedingRecords + barns + movements + productionEvents + feedAllocations + auditLog + integrationEvents + populationSnapshots + benchmarkProfiles + feedDuplicateRecovery + (hasLogo ? 1 : 0);

    return {
      total,
      sows,
      piglets,
      boars,
      feed,
      reservations,
      tx,
      ledger,
      semen,
      semenSales,
      semenResellers,
      semenResellerTx,
      semenResellerAdjustments,
      feedOrders,
      feedTrials,
      medicines,
      vaccinations,
      treatments,
      heatRecords,
      breedingRecords,
      barns,
      movements,
      productionEvents,
      feedAllocations,
      auditLog,
      integrationEvents,
      populationSnapshots,
      benchmarkProfiles,
      feedDuplicateRecovery,
      hasLogo
    };
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     DEBOUNCED BACKGROUND AUTO-PUSH (Runs silently on any local change)
     ═══════════════════════════════════════════════════════════════════════════ */
  function scheduleAutoPush(delayMs = 800) {
    if (!navigator.onLine) {
      updateSyncIndicator('offline', 'Offline', 'Local changes remain on this device and have not been uploaded.');
      return;
    }
    const fId = window.__arsActiveFarmId || window.farmId;
    const farm = fId && window.DB ? window.DB[fId] : null;
    if (!window.arsContextReady || !window.__arsCloudBaselineReady || !fId || !farm) {
      updateSyncIndicator('pending', 'Not synced', 'Cloud baseline is not verified; no local data was uploaded.');
      return;
    }
    if (window.__arsPendingUnverifiedSave === true && !(window.ARSCloud && typeof ARSCloud.hasDirtyChanges === 'function' && ARSCloud.hasDirtyChanges(fId))) {
      // A save without a known local baseline cannot be uploaded. Once the
      // baseline is verified, a dirty save can safely proceed through pushFarm's
      // remote preflight instead of being trapped behind this marker forever.
      updateSyncIndicator('pending', 'Review needed', 'A local save has not been compared with a verified cloud baseline. No data was uploaded automatically.');
      return;
    }
    if (window.ARSCloud && typeof ARSCloud.hasDirtyChanges === 'function' && !ARSCloud.hasDirtyChanges(fId)) {
      updateSyncIndicator('synced', 'Synced', 'Verified cloud baseline; no pending local changes.');
      return;
    }

    updateSyncIndicator('syncing', 'Syncing changes...', 'Uploading only reviewed dirty records after a remote conflict check.');
    clearTimeout(autoPushTimer);
    autoPushTimer = setTimeout(async () => {
      if (isSyncingInProgress || Number(window.__arsDirectCloudVerification) > 0) {
        autoPushTimer = setTimeout(() => {
          autoPushTimer = null;
          scheduleAutoPush(0);
        }, 500);
        return;
      }
      isSyncingInProgress = true;
      const queueSafeRetry = (delayMs = 12000) => {
        clearTimeout(autoPushTimer);
        autoPushTimer = setTimeout(() => {
          autoPushTimer = null;
          const stillDirty = window.ARSCloud && typeof ARSCloud.hasDirtyChanges === 'function' && ARSCloud.hasDirtyChanges(fId);
          if (navigator.onLine && stillDirty) scheduleAutoPush(0);
        }, delayMs);
      };
      try {
        const res = await ARSCloud.pushFarm(fId, farm, { dirtyOnly: true });
        lastPushTimestamp = Date.now();
        const reason = String(res?.reason || '');
        const conflict = Boolean(res?.conflicts?.length) || /remote changes detected|conflict|farm context changed/i.test(reason);
        if (res && res.success === false) {
          if (conflict && res?.conflicts?.length) {
            // A real remote conflict must stop automatic retries. The local
            // value stays dirty and preserved; the review sheet lets the
            // manager decide instead of silently losing either side (FIX C2).
            updateSyncIndicator('error', 'Review needed', reason || 'Remote changes were detected; no local row was overwritten.');
            openConflictReview(fId, res.conflicts);
          } else if (conflict) {
            updateSyncIndicator('error', 'Review needed', reason || 'Farm context changed; no row was overwritten.');
          } else {
            updateSyncIndicator('pending', 'Pending changes', reason || 'Cloud write failed; a safe retry is scheduled.');
            queueSafeRetry(15000);
          }
        } else if (res?.pending) {
          updateSyncIndicator('pending', 'Pending changes', 'Some local changes remain pending; a safe retry is scheduled.');
          queueSafeRetry(5000);
        } else {
          updateSyncIndicator('synced', 'Synced', `✓ ${res?.count || 0} changed records verified with the cloud.`);
        }
      } catch (e) {
        updateSyncIndicator('pending', 'Pending changes', `${e.message || String(e)} A safe retry is scheduled.`);
        queueSafeRetry(15000);
      } finally {
        isSyncingInProgress = false;
      }
    }, delayMs);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     SILENT BACKGROUND AUTO-PULL (Checks for remote updates from other staff)
     ═══════════════════════════════════════════════════════════════════════════ */
  async function performBackgroundPull(force = false) {
    if (!navigator.onLine || isSyncingInProgress) return;
    const fId = window.__arsActiveFarmId || window.farmId;
    if (!window.arsContextReady || !window.__arsCloudBaselineReady || !window.ARSCloud || !ARSCloud.configured() || !fId) return;
    if (typeof ARSCloud.hasDirtyChanges === 'function' && ARSCloud.hasDirtyChanges(fId)) {
      updateSyncIndicator('pending', 'Pending changes', 'Remote refresh is paused until local changes are safely written or reviewed.');
      return;
    }

    // Editing forms must not be replaced while a user is typing. A search
    // field is different: it is only a view filter, so we can refresh the
    // cloud data and restore the query afterward.
    const activeModal = document.querySelector('.modal-bg.open, .due-modal-bg');
    const activeElement = document.activeElement;
    const activeInput = activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(activeElement.tagName);
    const activeSearch = Boolean(activeElement && activeElement.matches && activeElement.matches('#drillModal input.search, #reservations input.search, #table-reservations ~ input.search'));
    if ((activeModal || (activeInput && !activeSearch)) && !force) return;

    // Keep open drill-down views synchronized too. renderAll() refreshes page
    // sections, but older builds left #drillModal/#batchHub frozen in place.
    const openDrill = document.getElementById('drillModal');
    const drillSearchValue = openDrill?.querySelector('.drill-controls input.search')?.value || '';
    const openBatch = document.getElementById('batchHub');
    const openBatchId = openBatch?.querySelector('.drill-header h2')?.textContent?.trim() || '';

    try {
      isSyncingInProgress = true;
      updateSyncIndicator('syncing', 'Refreshing cloud...');
      const res = await ARSCloud.pullFarm(fId);
      lastPullTimestamp = Date.now();
      if (!res || res.success === false) {
        updateSyncIndicator('error', 'Sync blocked', res?.reason || 'Cloud refresh failed; local data was not marked current.');
        return;
      }
      if (window.applyCustomLogo) window.applyCustomLogo();
      const currentlyTyping = document.activeElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement.tagName);
      const canRefreshView = !currentlyTyping || activeSearch || force;
      /* [REBUILD FIX 71] Only touch the DOM when the cloud actually delivered
         new data (or a forced refresh). The 18-second heartbeat used to call
         renderAll() after every successful poll even with zero changes, which
         rebuilt open pages — e.g. wiping Signs/Symptoms search results while
         the user was reading them. */
      const dataChanged = force || res.changed !== false;
      if (window.renderAll && canRefreshView && (!activeModal || force) && dataChanged) window.renderAll();

      // Rebuild the currently open drill-down/modal from the freshly pulled
      // farm bucket, then restore the user's search text.
      if (dataChanged && canRefreshView && (!activeModal || force)) {
        if (openDrill && window.refreshOpenDrilldown) {
          window.refreshOpenDrilldown();
          const search = document.querySelector('#drillModal .drill-controls input.search');
          if (search && drillSearchValue) {
            search.value = drillSearchValue;
            window.filterDrilldown?.(drillSearchValue);
          }
        }
        if (openBatch && openBatchId && window.refreshOpenBatchHub) window.refreshOpenBatchHub();
      }
      updateSyncIndicator('synced', 'Synced', `✓ Cloud refresh verified: ${res.count} records.`);
      /* [FIX 87] weekly real-file backup to Downloads — survives browser cleaning */
      if (window.arsMaybeAutoDeviceBackup) window.arsMaybeAutoDeviceBackup();
    } catch (e) {
      updateSyncIndicator('error', 'Sync blocked', e.message || String(e));
    } finally {
      isSyncingInProgress = false;
    }
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     LIFECYCLE LISTENERS: AUTO-SYNC ON STARTUP, VISIBILITY & NETWORK RECONNECT
     ═══════════════════════════════════════════════════════════════════════════ */
  function initAutoSync() {
    // 1. Hook into window.save() globally
    const priorSave = window.save;
    window.save = function() {
      if (typeof priorSave === 'function') priorSave.apply(this, arguments);
    };

    // 2. Auto-pull on app load / startup
    setTimeout(() => {
      performBackgroundPull(true);
    }, 1200);

    // 3. Tab visibility / App unlock sync: when a farmer or staff unlocks phone or returns to app
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        performBackgroundPull(false);
      }
    });
    window.addEventListener('focus', () => {
      performBackgroundPull(false);
    });

    // 4. Online / Offline network event listeners
    window.addEventListener('online', () => {
      updateSyncIndicator('syncing', 'Reconnecting...');
      scheduleAutoPush(400);
      performBackgroundPull(false);
    });
    window.addEventListener('offline', () => {
      updateSyncIndicator('offline', 'Offline', 'Working offline. Records saved on phone.');
    });

    // 5. Periodic background heartbeat polling every 18 seconds
    if (pollIntervalTimer) clearInterval(pollIntervalTimer);
    pollIntervalTimer = setInterval(() => {
      if (document.visibilityState === 'visible') {
        performBackgroundPull(false);
      }
    }, 18000);
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     DATA TRANSFER & BACKUP MODAL (Clean, Non-intrusive Management)
     ═══════════════════════════════════════════════════════════════════════════ */
  function openDataTransferModal() {
    const fId = window.farmId || Object.keys(window.DB || {})[0];
    const farm = (window.DB && window.DB[fId]) || (window.F ? window.F() : null);
    const farmName = farm?.name || "RM's Hog Farm";
    const s = getFarmDataSummary(farm);
    const diagnosticAction = window.platformAdminVerified ? '<button type="button" class="btn ghost" onclick="openSyncDiagnostics()">Read-only diagnostics</button>' : '';

    document.getElementById('transferModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `
      <div class="due-modal-bg" id="transferModal" style="z-index:999999!important">
        <div class="due-modal" style="max-width:540px">
          <div class="modal-top">
            <div>
              <div class="eyebrow" style="color:var(--teal2);font-weight:800">AUTOMATIC CLOUD SYNC &amp; BACKUP</div>
              <h2 style="margin:2px 0 4px 0">${esc(farmName)}</h2>
              <small class="muted">Live State: <b>${s.total} items on this device</b> (${s.sows} sows · ${s.piglets} litters · ${s.reservations} reservations · ${s.semenResellers} resellers)</small>
            </div>
            <button type="button" class="close-reminder" onclick="document.getElementById('transferModal').remove()">×</button>
          </div>

          <!-- Real-Time Auto Sync Status Box -->
          <div style="background:linear-gradient(135deg,rgba(13,141,145,0.14),rgba(7,94,99,0.06));border:1.5px solid rgba(19,185,173,0.35);border-radius:14px;padding:14px 16px;margin:14px 0">
            <div style="display:flex;align-items:center;justify-content:space-between;gap:8px">
              <div style="display:flex;align-items:center;gap:10px">
                <span style="font-size:22px">☁️</span>
                <div>
                  <b style="font-size:13.5px">Automated Background Sync is Active</b>
                  <small class="muted" style="display:block">All updates across staff, managers, and devices sync silently in real-time.</small>
                </div>
              </div>
              <span class="tag ok" style="font-size:11px">● LIVE AUTO-SYNC</span>
            </div>
          </div>

          <!-- [REBUILD FIX 96] when a push keeps failing, show WHY + retry -->
          ${window.__arsLastPushError ? `<div style="background:rgba(245,158,11,.12);border:1.5px solid #f59e0b;border-radius:14px;padding:12px 14px;margin:14px 0">
            <b style="color:#f59e0b;font-size:12.5px">⚠ Last sync attempt:</b>
            <small style="display:block;margin:4px 0 8px;color:var(--ink)">${esc(window.__arsLastPushError)}</small>
            <button type="button" class="btn small" onclick="window.scheduleAutoPush && window.scheduleAutoPush(0)">🔄 Retry sync now</button>
          </div>` : ''}

          <!-- [REBUILD FIX 106/108] owner tools (platform admin ONLY):
               live trial census + packet import -->
          ${window.ARSCloud && window.ARSCloud.isPlatformAdmin && window.ARSCloud.isPlatformAdmin() ? `<div style="display:flex;gap:8px;flex-wrap:wrap;margin:14px 0">
            <button type="button" class="btn ghost" style="flex:1" onclick="window.arsTrialBoard && window.arsTrialBoard()">🎁 Trial dashboard — who's on trial / needs migration</button>
            <button type="button" class="btn ghost" style="flex:1" onclick="window.arsImportTrialPacketUI && window.arsImportTrialPacketUI()">📥 Import trial packet into active farm</button>
          </div>` : ''}

          <!-- Direct JSON Export / Import Tray -->
          <div style="background:rgba(0,0,0,0.25);border:1px solid var(--line);border-radius:14px;padding:14px 16px;margin:14px 0">
            <b style="font-size:13.5px;display:flex;align-items:center;gap:6px">
              <span>💾</span> <span>Offline Backup &amp; Read-only Comparison</span>
            </b>
            <p class="muted" style="font-size:12px;margin:4px 0 12px 0">
              Download a complete backup file to transfer directly between devices.
            </p>

            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:12px">
              <button type="button" class="btn ghost" style="flex:1;background:rgba(14,165,233,0.15);color:#38bdf8;border:1px solid rgba(14,165,233,0.3)" onclick="exportFarmJSON()">
                📥 Export Backup File (.json)
              </button>
              <button type="button" class="btn ghost" style="flex:1" onclick="copyFarmJSONToClipboard()">
                📋 Copy Raw JSON
              </button>
              <button type="button" class="btn ghost" style="flex:1" onclick="exportLocalRecoverySnapshots()">
                🛟 Download Preserved Recovery Data
              </button>
            </div>

            <!-- Import Section -->
            <div style="border-top:1px dashed var(--line);padding-top:12px;margin-top:10px">
              <small style="font-weight:750;color:var(--ink);display:block;margin-bottom:6px">Compare a backup file — no automatic import:</small>
              <div style="display:flex;gap:8px;align-items:center">
                <input type="file" id="jsonFileInput" accept=".json,application/json" style="font-size:12px" onchange="handleJSONFileUpload(event)">
              </div>
              <div style="margin-top:8px">
                <small class="muted" style="display:block;margin-bottom:4px">Or paste backup JSON code directly:</small>
                <textarea id="jsonPasteInput" placeholder="Paste backup JSON here to compare with this farm safely" style="width:100%;height:65px;font-size:11px;font-family:monospace;background:rgba(0,0,0,0.3);border:1px solid var(--line);border-radius:8px;padding:6px;color:var(--ink)"></textarea>
                <button type="button" class="btn small" style="margin-top:6px;width:100%" onclick="importPastedJSON()">
                  🔎 Compare Backup Safely
                </button>
              </div>
            </div>
          </div>

          <div class="due-actions" style="margin-top:14px">
            ${diagnosticAction}
            <button type="button" class="btn ghost" onclick="document.getElementById('transferModal').remove()">Close</button>
          </div>
        </div>
      </div>
    `);
  }

  /* ═══════════════════════════════════════════════════════════════════════
     FIX C2 — CONFLICT REVIEW SHEET
     Previously a two-device edit deadlocked the safe engine with no way out
     except an allowDirty pull that silently replaced the local value. This
     sheet shows every conflicting row and offers explicit choices:
       • Keep my copy   → adopts the remote version as the baseline, keeps the
                          local edit dirty, then re-pushes (local wins by choice)
       • Use cloud      → drops the local dirty flag; the cloud version wins on
                          the next refresh (local copy stays in recovery data)
       • Export both    → downloads farm JSON (local + recovery) before deciding
     ═══════════════════════════════════════════════════════════════════════ */
  function openConflictReview(fId, conflicts) {
    if (!Array.isArray(conflicts) || !conflicts.length) return;
    document.getElementById('conflictReviewModal')?.remove();
    const rows = conflicts.map((c, i) => `
      <div class="conflict-row" style="border:1px solid var(--line);border-radius:10px;padding:10px 12px;margin-bottom:8px;background:rgba(239,68,68,0.05)">
        <div style="display:flex;justify-content:space-between;align-items:center;gap:8px;flex-wrap:wrap">
          <div>
            <b style="font-size:12.5px">${esc(c.entity_type || 'record')} · ${esc(c.local_id || 'row')}</b>
            <small class="muted" style="display:block">Changed on another device at ${esc(c.remote_updated_at || '—')} — your local edit is preserved.</small>
          </div>
          <div style="display:flex;gap:6px">
            <button type="button" class="btn small" onclick="resolveConflictRow(${i},'local')">📱 Keep mine</button>
            <button type="button" class="btn ghost small" onclick="resolveConflictRow(${i},'remote')">☁ Use cloud</button>
          </div>
        </div>
      </div>`).join('');
    document.body.insertAdjacentHTML('beforeend', `
      <div class="due-modal-bg open" id="conflictReviewModal" style="z-index:1000001!important">
        <div class="due-modal" style="max-width:620px;width:96%">
          <div class="modal-top">
            <div>
              <div class="eyebrow" style="color:#f87171">⚠ SYNC CONFLICT · REVIEW REQUIRED</div>
              <h2 style="margin:2px 0 4px">${conflicts.length} record(s) changed on two devices</h2>
              <small class="muted">Nothing was overwritten. Choose what this farm should keep. Your local copy also stays in the recovery backup.</small>
            </div>
            <button type="button" class="close-reminder" onclick="document.getElementById('conflictReviewModal').remove()">×</button>
          </div>
          <div style="margin:14px 0;max-height:46vh;overflow:auto">${rows}</div>
          <div class="due-actions" style="justify-content:space-between;flex-wrap:wrap">
            <button type="button" class="btn ghost small" onclick="exportFarmJSON()">📥 Export farm backup first</button>
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              <button type="button" class="btn ghost" onclick="resolveAllConflicts(${JSON.stringify(conflicts).replace(/"/g, '&quot;')},'remote')">☁ Use cloud for all</button>
              <button type="button" class="btn" onclick="resolveAllConflicts(${JSON.stringify(conflicts).replace(/"/g, '&quot;')},'local')">📱 Keep mine for all</button>
            </div>
          </div>
          <p class="muted" style="font-size:11px;margin-top:8px">Conflict data is never merged automatically; this is a deliberate one-time resolution. The sync indicator will return to Synced afterwards.</p>
        </div>
      </div>`);
    window.__arsConflictList = conflicts;
  }
  window.openConflictReview = openConflictReview;

  function resolveConflictRow(i, mode) {
    const list = window.__arsConflictList || [];
    const c = list[i];
    if (!c) return;
    if (window.ARSCloud?.resolveConflict) window.ARSCloud.resolveConflict(window.__arsActiveFarmId || window.farmId, c, mode);
    list[i]._resolved = mode;
    const btn = document.querySelectorAll('#conflictReviewModal .conflict-row')[i];
    if (btn) btn.style.opacity = '0.45';
  }
  window.resolveConflictRow = resolveConflictRow;

  async function resolveAllConflicts(conflicts, mode) {
    const fId = window.__arsActiveFarmId || window.farmId;
    const list = window.__arsConflictList || [];
    if (!window.ARSCloud?.resolveConflict) return;
    (Array.isArray(conflicts) && conflicts.length ? conflicts : list).forEach(c => {
      window.ARSCloud.resolveConflict(fId, c, mode);
    });
    window.__arsConflictList = [];
    document.getElementById('conflictReviewModal')?.remove();
    if (window.ARSCloud?.saveLocalRecovery) ARSCloud.saveLocalRecovery(fId, window.DB?.[fId], 'conflict resolution snapshot before apply');
    if (mode === 'local') {
      toast(`📱 Applying your local values (${(Array.isArray(conflicts) ? conflicts : list).length} row(s))…`);
      await manualSyncNow('push');
      await performBackgroundPull(false);
    } else {
      toast(`☁ Applying cloud values… your local copies remain in recovery backup.`);
      await ARSCloud.pullFarm(fId, { allowDirty: true });
      if (window.renderAll) window.renderAll();
      updateSyncIndicator('synced', 'Synced', 'Cloud version applied after conflict review.');
      if (window.ARSCloud?.hasDirtyChanges?.(fId)) scheduleAutoPush(400);
    }
  }
  window.resolveAllConflicts = resolveAllConflicts;

  async function manualSyncNow(mode = 'pull') {
    const fId = window.__arsActiveFarmId || window.farmId;
    const farm = fId && window.DB ? window.DB[fId] : null;
    if (!fId || !farm || !window.arsContextReady) {
      toast('Cloud sync is unavailable until the authenticated farm context is verified.');
      return;
    }

    if (mode === 'push') {
      updateSyncIndicator('syncing', 'Checking changes...');
      toast('☁️ Checking only changed records against the cloud...');
      const res = await ARSCloud.pushFarm(fId, farm, { dirtyOnly: true });
      if (res && res.success !== false) {
        toast(`✓ Verified ${res.count || 0} changed records with the cloud.`);
        updateSyncIndicator(res.pending ? 'pending' : 'synced', res.pending ? 'Pending changes' : 'Synced');
      } else if (res?.conflicts?.length) {
        openConflictReview(fId, res.conflicts);
        toast(`⚠️ ${res.conflicts.length} record(s) changed on another device — nothing was overwritten.`);
      } else {
        toast(`⚠️ Cloud write blocked: ${res?.reason || 'Check internet'}`);
        updateSyncIndicator('error', 'Review needed');
      }
      return;
    }

    updateSyncIndicator('syncing', 'Refreshing cloud...');
    toast('☁️ Downloading the verified cloud dataset...');
    const res = await ARSCloud.pullFarm(fId);
    if (res && res.success !== false) {
      if (window.applyCustomLogo) window.applyCustomLogo();
      if (window.renderAll) window.renderAll();
      toast(`✓ Verified ${res.count} cloud records.`);
      updateSyncIndicator('synced', 'Synced');
    } else {
      toast(`⚠️ Cloud refresh blocked: ${res?.reason || 'Could not reach Supabase'}`);
      updateSyncIndicator('error', 'Sync blocked');
    }
  }

  async function openSyncDiagnostics() {
    if (!window.platformAdminVerified) {
      toast('Administrator access is required for diagnostics.');
      return;
    }
    const farmId = window.__arsActiveFarmId || window.farmId;
    const farm = farmId && window.DB ? window.DB[farmId] : null;
    const localSummary = getFarmDataSummary(farm);
    let memberships = [];
    let cloudCounts = null;
    try { memberships = await ARSCloud.getFarmMemberships(); } catch (_) {}
    try { if (farmId && ARSCloud.getFarmRecordCounts) cloudCounts = await ARSCloud.getFarmRecordCounts(farmId); } catch (error) { cloudCounts = { error: error.message || String(error) }; }
    let registrations = [];
    try {
      registrations = 'serviceWorker' in navigator ? (await navigator.serviceWorker.getRegistrations()).map(r => ({ scope: r.scope, active: r.active?.scriptURL || null, waiting: r.waiting?.scriptURL || null, updateViaCache: r.updateViaCache || null })) : [];
    } catch (_) {}
    const snapshot = {
      authenticated_user_id: window.arsSessionUser?.id || null,
      email: window.arsSessionUser?.email || null,
      farm_id: farmId || null,
      farm_name: farm?.name || window.arsActiveMembership?.farms?.name || null,
      role: window.arsActiveMembership?.role || window.myFarmRole || null,
      plan: window.arsActiveMembership?.plan || null,
      application_version: window.ARS_APP_VERSION || 'not embedded',
      deployment_id: window.ARS_DEPLOYMENT_ID || 'not embedded',
      service_worker: registrations,
      service_worker_cache_name: null,
      online: navigator.onLine,
      cloud_baseline_verified: window.__arsCloudBaselineReady === true,
      pending_local_changes: ARSCloud.hasDirtyChanges ? ARSCloud.hasDirtyChanges(farmId) : null,
      last_cloud_sync: window.STORE?.getItem('ars-last-cloud-sync') || null,
      last_successful_data_fetch: window.__arsLastSuccessfulSyncAt || null,
      local_summary: localSummary,
      cloud_visible_counts: cloudCounts,
      active_memberships: memberships.map(m => ({ farm_id: m.farm_id, role: m.role, plan: m.plan, is_active: m.is_active }))
    };
    try {
      const sw = await fetch('./sw.js', { cache: 'no-store' });
      const text = await sw.text();
      snapshot.service_worker_cache_name = text.match(/CACHE_NAME\s*=\s*['\"]([^'\"]+)/)?.[1] || null;
    } catch (_) {}
    document.getElementById('syncDiagnosticsModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg open" id="syncDiagnosticsModal" style="z-index:1000000!important"><div class="due-modal" style="max-width:760px;width:96%"><div class="modal-top"><div><div class="eyebrow" style="color:var(--teal2)">SUPER ADMIN · READ-ONLY DIAGNOSTICS</div><h2>Verified sync context</h2><small class="muted">No credentials or record payloads are displayed.</small></div><button type="button" class="close-reminder" onclick="document.getElementById('syncDiagnosticsModal').remove()">×</button></div><pre style="white-space:pre-wrap;word-break:break-word;max-height:60vh;overflow:auto;background:rgba(0,0,0,.25);border:1px solid var(--line);border-radius:10px;padding:12px;font-size:11px;color:var(--ink)">${esc(JSON.stringify(snapshot, null, 2))}</pre><div class="due-actions"><button type="button" class="btn ghost" onclick="document.getElementById('syncDiagnosticsModal').remove()">Close</button></div></div></div>`);
  }

  function exportLocalRecoverySnapshots() {
    const snapshots = ARSCloud.listLocalRecoverySnapshots ? ARSCloud.listLocalRecoverySnapshots() : [];
    if (!snapshots.length) {
      toast('No preserved local recovery snapshot is available on this device.');
      return;
    }
    const blob = new Blob([JSON.stringify({ exported_at: new Date().toISOString(), snapshots }, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `arswine-local-recovery-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(link);
    link.click();
    setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 500);
    toast(`✓ Exported ${snapshots.length} preserved local recovery snapshot(s). Nothing was uploaded.`);
  }

  function exportFarmJSON() {
    const fId = window.farmId || Object.keys(window.DB || {})[0];
    const farm = (window.DB && window.DB[fId]) || (window.F ? window.F() : null);
    if (!farm) {
      toast('No farm data available to export.');
      return;
    }
    const cleanName = (farm.name || 'farm').replace(/[^a-zA-Z0-9_-]/g, '-');
    const todayStr = new Date().toISOString().slice(0, 10);
    const fileName = `${cleanName}-backup-${todayStr}.json`;

    const logoData = farm.logo || farm.logo_url || (window.STORE && STORE.getItem('ars-farm-logo-' + fId)) || null;
    const exportObj = {
      ...farm,
      logo: logoData,
      logo_url: logoData,
      _farm_id: fId, /* [FIX 87] so a restore-on-login knows where to put it */
      _exported_at: new Date().toISOString(),
      _device_id: DEVICE_ID,
      _app: 'ARSwineTech Pro'
    };

    const jsonStr = JSON.stringify(exportObj, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = fileName;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    }, 200);
    try { STORE.setItem('ars-last-device-backup', new Date().toISOString()); } catch (_) {}
    toast(`✓ Exported backup: ${fileName}`);
  }

  /* [REBUILD FIX 87] DEVICE-FILE BACKUP & RESTORE.
     Browsers sandbox web apps: localStorage/IndexedDB are "site data" and die
     when a user clears browsing data. The cloud (Supabase) stays authoritative,
     but a backup .json in the Downloads folder is a REAL file that survives
     any browser cleaning — and can now be restored right from the login
     screen, even before signing in. */
  function arsRestoreFromBackupFile(file) {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result || 'null'));
        if (!data || typeof data !== 'object') throw new Error('not a JSON object');
        const farm = data.farm && typeof data.farm === 'object' ? data.farm : data; /* recovery snapshot or export */
        const id = String(data._farm_id || data.farm_id || farm.id || farm.farm_id || '').trim();
        if (!farm || !id) throw new Error('backup has no farm id — export again from a signed-in device');
        const dbRaw = STORE.getItem('arswine-db-v1');
        const db = dbRaw ? JSON.parse(dbRaw) : {};
        db[id] = Object.assign(db[id] || {}, farm);
        STORE.setItem('arswine-db-v1', JSON.stringify(db));
        STORE.setItem('arswine-active-farm', id);
        toast('✓ Backup restored to this device — now sign in to sync with the cloud.');
        setTimeout(() => location.reload(), 1200);
      } catch (e) {
        toast('⚠ Could not restore backup: ' + (e.message || e));
      }
    };
    reader.onerror = () => toast('⚠ Could not read that file.');
    reader.readAsText(file);
  }
  window.arsRestoreFromBackupFile = arsRestoreFromBackupFile;

  /* Once-a-week silent backup into the Downloads folder (survives browser
     cleaning). Chrome may ask once for download permission — allow it. */
  function maybeAutoDeviceBackup() {
    try {
      const last = Date.parse(STORE.getItem('ars-last-device-backup') || '') || 0;
      if (Date.now() - last < 7 * 86400000) return;
      exportFarmJSON();
    } catch (_) {}
  }
  window.arsMaybeAutoDeviceBackup = maybeAutoDeviceBackup;

  function copyFarmJSONToClipboard() {
    const fId = window.farmId || Object.keys(window.DB || {})[0];
    const farm = (window.DB && window.DB[fId]) || (window.F ? window.F() : null);
    if (!farm) {
      toast('No farm data to copy.');
      return;
    }
    const logoData = farm.logo || farm.logo_url || (window.STORE && STORE.getItem('ars-farm-logo-' + fId)) || null;
    const exportObj = {
      ...farm,
      logo: logoData,
      logo_url: logoData,
      _exported_at: new Date().toISOString(),
      _device_id: DEVICE_ID,
      _app: 'ARSwineTech Pro'
    };

    const jsonStr = JSON.stringify(exportObj, null, 2);
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(jsonStr).then(() => {
        toast('✓ Farm JSON copied to clipboard!');
      }).catch(() => {
        prompt('Copy your farm backup JSON:', jsonStr);
      });
    } else {
      prompt('Copy your farm backup JSON:', jsonStr);
    }
  }

  function handleJSONFileUpload(e) {
    const file = e.target?.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = function(evt) {
      const content = evt.target?.result;
      if (content) {
        compareImportedJSON(content);
      }
    };
    reader.readAsText(file);
  }

  function importPastedJSON() {
    const text = document.getElementById('jsonPasteInput')?.value?.trim();
    if (!text) {
      toast('Please paste valid JSON data into the text box.');
      return;
    }
    compareImportedJSON(text);
  }

  function compareImportedJSON(jsonString) {
    try {
      const data = JSON.parse(jsonString);
      if (!data || typeof data !== 'object') throw new Error('Invalid JSON structure.');
      const fId = window.__arsActiveFarmId || window.farmId;
      const farm = fId && window.DB ? window.DB[fId] : null;
      if (!farm) throw new Error('No verified active farm is available for comparison.');
      const keys = [
        'sows', 'piglets', 'feed', 'semen', 'transactions', 'sales', 'reminders',
        'medicines', 'vaccinations', 'reservations', 'semenSales', 'semenResellers',
        'semenResellerTx', 'feedTrials', 'feedOrders', 'boars', 'barns', 'movements',
        'rfid_tags', 'rfid_scans', 'breedingRecords', 'pigletLedger', 'heatRecords',
        'treatments', 'med_movements', 'vaccination_events', 'vaxSchedules', 'vetCatalog', 'marketQuotes'
      ];
      const localId = (item, index) => String(item?._ars_cloud_local_id || item?.id || item?.no || item?.tag || item?.code || item?.name || `row-${index}`).trim().toLowerCase();
      const stable = item => {
        try { const copy = JSON.parse(JSON.stringify(item || {})); delete copy.updated_at; return JSON.stringify(copy); } catch (_) { return ''; }
      };
      const comparison = { generated_at: new Date().toISOString(), farm_id: fId, backup_name: data.name || null, datasets: {}, backup_only: {}, local_only: {}, conflicts: {} };
      keys.forEach(key => {
        const backupRows = Array.isArray(data[key]) ? data[key] : [];
        const localRows = Array.isArray(farm[key]) ? farm[key] : [];
        const backupMap = new Map(backupRows.map((row, index) => [localId(row, index), row]));
        const localMap = new Map(localRows.map((row, index) => [localId(row, index), row]));
        const backupOnly = [...backupMap.keys()].filter(id => !localMap.has(id));
        const localOnly = [...localMap.keys()].filter(id => !backupMap.has(id));
        const conflicts = [...backupMap.keys()].filter(id => localMap.has(id) && stable(backupMap.get(id)) !== stable(localMap.get(id)));
        comparison.datasets[key] = { backup_count: backupRows.length, local_count: localRows.length, backup_only_count: backupOnly.length, local_only_count: localOnly.length, conflict_count: conflicts.length };
        if (backupOnly.length) comparison.backup_only[key] = backupOnly;
        if (localOnly.length) comparison.local_only[key] = localOnly;
        if (conflicts.length) comparison.conflicts[key] = conflicts;
      });
      comparison.logo_present_in_backup = Boolean(data.logo || data.logo_url);
      comparison.feed_plan_present_in_backup = Boolean(data.feedPlan);

      const blob = new Blob([JSON.stringify(comparison, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `arswine-backup-comparison-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      setTimeout(() => { link.remove(); URL.revokeObjectURL(url); }, 500);
      const totalBackupOnly = Object.values(comparison.datasets).reduce((sum, row) => sum + row.backup_only_count, 0);
      const totalConflicts = Object.values(comparison.datasets).reduce((sum, row) => sum + row.conflict_count, 0);
      toast(`✓ Comparison complete: ${totalBackupOnly} backup-only rows, ${totalConflicts} conflicts. Nothing was imported or uploaded.`);
    } catch (err) {
      toast(`⚠️ Comparison failed: ${err.message || 'Invalid JSON format'}`);
    }
  }

  // Initialize auto-sync engine
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initAutoSync);
  } else {
    initAutoSync();
  }

  window.scheduleAutoPush = scheduleAutoPush;
  window.performBackgroundPull = performBackgroundPull;
  window.updateSyncIndicator = updateSyncIndicator;
  window.openDataTransferModal = openDataTransferModal;
  window.openSyncDiagnostics = openSyncDiagnostics;
  window.manualSyncNow = manualSyncNow;
  window.manualCloudSync = manualSyncNow;
  window.exportFarmJSON = exportFarmJSON;
  window.exportLocalRecoverySnapshots = exportLocalRecoverySnapshots;
  window.copyFarmJSONToClipboard = copyFarmJSONToClipboard;
  window.handleJSONFileUpload = handleJSONFileUpload;
  window.importPastedJSON = importPastedJSON;
  window.compareImportedJSON = compareImportedJSON;
  window.getFarmDataSummary = getFarmDataSummary;
})();
