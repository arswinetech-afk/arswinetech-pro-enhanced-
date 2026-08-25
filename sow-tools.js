/* Sow record profile, heat logging, insemination and farm-scoped deletion tools. */
(function() {
  async function deleteRecord(kind, index) {
    const c = (typeof configs !== 'undefined' ? configs : window.configs)?.[kind] || { key: kind };
    const farm = F();
    const list = Array.isArray(farm[c.key]) ? farm[c.key] : [];
    const record = list[index];
    if (!record) return;
    if (!confirm(`Delete ${record.name || record.id || record.title || record.type || record.description || 'this record'}? This cannot be undone.`)) return;

    const entityMap = {
      sows: 'sow', piglets: 'piglet_batch', feed: 'feed_inventory', semen: 'semen_inventory',
      transactions: 'transaction', financials: 'transaction', sales: 'pos_sale', pos: 'pos_sale',
      reminders: 'reminder', reservations: 'reservation'
    };
    const entityType = entityMap[kind] || kind;
    // Matches client.js localIdFor() for legacy rows with no business ID.
    const cloudLocalId = String(record._ars_cloud_local_id || record.id || record.no || record.tag || record.code || record.name || `${entityType}-${index}`).trim();
    const activeFarmId = window.__arsActiveFarmId || window.farmId || farmId;

    try {
      if (!activeFarmId || !window.ARSCloud?.deleteAppRecord) throw new Error('Verified cloud deletion is unavailable.');
      // Cloud-first prevents the next background pull from restoring a row.
      await ARSCloud.deleteAppRecord(activeFarmId, entityType, cloudLocalId);
    } catch (error) {
      toast(`⚠️ Record was not removed: cloud deletion failed — ${error.message || error}`);
      return;
    }

    // Remove only the selected row from the active farm. Never filter all
    // buckets and never compare against an empty key.
    list.splice(index, 1);
    farm[c.key] = list;
    save();
    renderAll();
    if (window.refreshOpenDrilldown) window.refreshOpenDrilldown();
    toast('Record deleted from the cloud and this device');
  }

  function closeTool(id) {
    document.getElementById(id)?.remove()
  }

  function openSowProfile(index) {
    let sow = F().sows[index];
    if (!sow) return;
    /* [FIX L4] user-entered names/ids are escaped on display and URI-encoded in
       inline handlers so quotes or markup cannot break the modal. */
    const e = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
    const uid = encodeURIComponent(String(sow.id || ''));
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="sowProfileModal"><div class="due-modal sow-profile"><div class="modal-top"><div><div class="eyebrow">SOW PROFILE · FARM-SCOPED</div><h2>${e(sow.name)}</h2><p>${e(sow.id)} · ${e(sow.breed)||'Breed not recorded'}</p></div><button class="close-reminder" onclick="closeSowProfile()">×</button></div><div class="sow-profile-grid"><div><small>Current status</small><b>${status(sow)}</b></div><div><small>Parity</small><b>${sow.parity||0}</b></div><div><small>Sire</small><b>${e(sow.sire)||'Not recorded'}</b></div><div><small>Dam</small><b>${e(sow.dam)||'Not recorded'}</b></div><div><small>Insemination</small><b>${fmtDate(sow.insemination)}</b></div><div><small>Gestation</small><b>${sow.insemination?days(sow.insemination)+' days':'—'}</b></div><div><small>Expected farrowing</small><b>${sow.insemination?fmtDate(isoOff(114-days(sow.insemination))):'—'}</b></div></div><div class="pedigree-mini"><b>Pedigree summary</b><p class="muted">Sire: ${e(sow.sire)||'Unknown'} · Dam: ${e(sow.dam)||'Unknown'}</p><small class="muted">Use Breed / Inseminate to run the farm’s relationship screening before recording semen.</small></div><div class="profile-actions"><button class="btn ghost" onclick="openHeatRecord(${index})">☼ Record heat</button><button class="btn" onclick="openBreedSow(${index})">⌁ Breed / inseminate</button>${sow.insemination && !sow.farrowingDate && !sow.lactationStart ? `<button class="btn ghost" onclick="closeSowProfile();openLinkedPigletModal(null,decodeURIComponent('${uid}'))">🐷 Record farrowing</button>` : ''}<button class="btn ghost" onclick="editRecord('sows',${index});closeSowProfile()">Edit record</button><button class="btn danger-btn" onclick="deleteRecord('sows',${index});closeSowProfile()">Delete sow</button></div></div></div>`)
  }

  function closeSowProfile() {
    closeTool('sowProfileModal')
  }

  function openHeatRecord(index, isReheat = false) {
    let sow = F().sows[index],
      label = isReheat ? 'REHEAT RECORD' : 'HEAT RECORD';
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="heatModal"><form class="due-modal sow-profile" onsubmit="saveHeatRecord(event,${index},${isReheat})"><div class="eyebrow">${label}</div><h2>${sow.name}</h2>${isReheat?'<p class="muted">Return to heat will mark the active insemination cycle as failed.</p>':''}<div class="field" style="text-align:left;margin:15px 0"><label>Heat detection date</label><input name="date" type="date" value="${(window.localToday ? window.localToday() : new Date().toISOString().slice(0,10))}" required></div><div class="field" style="text-align:left"><label>Observations</label><textarea name="notes" placeholder="Standing heat, vulva swelling, behavior…"></textarea></div><div class="form-error" id="heatSaveError"></div><div class="due-actions" style="margin-top:18px"><button type="button" class="btn ghost" onclick="closeTool('heatModal')">Cancel</button><button type="button" class="btn" onclick="saveHeatRecord(event,${index},${isReheat})">Save heat record</button></div></form></div>`)
  }

  async function saveHeatRecord(e, index, isReheat = false) {
    if (e) e.preventDefault();
    let error = document.getElementById('heatSaveError');
    if (error) error.classList.remove('show');
    try {
      let form = document.querySelector('#heatModal form'),
        data = Object.fromEntries(new FormData(form)),
        farm = F(),
        sow = farm.sows?.[Number(index)];
      if (!sow) throw new Error('Sow record could not be found.');
      if (!data.date) throw new Error('Heat detection date is required.');
      farm.heatRecords = farm.heatRecords || [];
      farm.heatRecords.push({
        id: 'heat-' + Date.now(),
        sow_id: sow.id,
        sow_name: sow.name,
        date: data.date,
        notes: data.notes || '',
        is_reheat: Boolean(isReheat),
        farm_id: farmId
      });
      sow.lastHeatDate = data.date;
      sow.lastHeatNotes = data.notes || '';
      sow.status = isReheat ? 'Reheat' : 'Heat';
      sow.lifecycle = isReheat ? 'Reheat' : 'Heat';
      sow.insemination = null;
      sow.farrowingDate = null;
      sow.lactationStart = null;
      sow.weanedAt = null;
      sow.lactationEndedAt = null;
      sow.current_breeding_record_id = null;
      if (Boolean(isReheat)) {
        sow.reheatDate = data.date;
        sow.reheatNotes = data.notes || '';
        let records = farm.breedingRecords || [],
          r = records.find(x => x.id === sow.current_breeding_record_id && !x.deleted_at) || records.filter(x => x.sow_id === sow.id && x.status === 'inseminated' && !x.deleted_at).sort((a, b) => String(b.insemination_date).localeCompare(String(a.insemination_date)))[0]; /* [REBUILD FIX 33] skip deleted records */
        if (r) {
          r.status = 'failed';
          r.failure_reason = 'Return to heat';
          r.failed_at = data.date
        }
      } else {
        sow.reheatDate = null;
        sow.reheatNotes = '';
      }
      save();
      document.getElementById('heatModal')?.remove();
      document.getElementById('sowProfileModal')?.remove();
      renderAll();
      const sync = window.ARSCloud?.verifyFarmSave
        ? await ARSCloud.verifyFarmSave(window.__arsActiveFarmId || farmId, `sow ${sow.id || sow.name} heat record`)
        : { success: false, reason: 'Cloud verification is unavailable.' };
      if (sync.success) toast(Boolean(isReheat) ? 'Reheat saved and cloud-verified. Breeding cycle marked failed.' : 'Heat record saved and cloud-verified.');
      else {
        toast(`✓ Heat record saved locally; cloud verification pending — ${sync.reason || 'retry will continue safely.'}`);
        window.updateSyncIndicator?.('pending', 'Heat record pending', sync.reason || 'The heat record remains safely local until verified.');
      }
      setTimeout(() => {
        try {
          if (window.refreshOpenDrilldown) refreshOpenDrilldown()
        } catch (_) {
          if (window.refreshOpenDrilldown) refreshOpenDrilldown()
        }
      }, 0)
    } catch (ex) {
      if (error) {
        error.textContent = String(ex?.message || ex || 'Unable to save heat record.');
        error.classList.add('show')
      } else toast('Unable to save heat record.')
    }
  }

  function knownBoars() {
    let profiles = F().boars || [],
      semen = [...new Set((F().semen || []).map(x => x.boar))].filter(Boolean);
    return [...profiles, ...semen.filter(n => !profiles.some(b => b.name === n)).map(n => ({
      id: 'name-' + n,
      name: n,
      breed: (F().semen.find(x => x.boar === n) || {}).breed || 'Unknown'
    }))]
  }

  function relationshipCheck(sow, boar) {
    if (!boar) return {
      risk: 'SAFE',
      f: 0,
      message: 'Enter or select a boar/semen name to check compatibility.'
    };
    if (window.calculateCompatibility && boar.id && sow.id) {
      let deep = window.calculateCompatibility(boar.id, sow.id);
      return {
        risk: deep.r,
        f: deep.f,
        message: deep.message
      }
    }
    let sireMatch = sow.sire && sow.sire.toLowerCase() === boar.name.toLowerCase(),
      damMatch = sow.dam && sow.dam.toLowerCase() === boar.name.toLowerCase();
    if (sireMatch || damMatch) return {
      risk: 'CRITICAL RISK',
      f: 25,
      message: 'Parent × offspring relationship detected. Breeding is blocked.'
    };
    if (boar.sire && sow.sire && boar.sire === sow.sire && boar.dam && sow.dam && boar.dam === sow.dam) return {
      risk: 'CRITICAL RISK',
      f: 25,
      message: 'Full sibling relationship detected. Breeding is blocked.'
    };
    if ((boar.sire && sow.sire && boar.sire === sow.sire) || (boar.dam && sow.dam && boar.dam === sow.dam)) return {
      risk: 'HIGH RISK',
      f: 12.5,
      message: 'Half sibling relationship detected. Breeding is not recommended.'
    };
    return {
      risk: 'SAFE',
      f: 0,
      message: 'No shared parent is recorded for this pairing. Add full pedigree data for a deeper 3-generation check.'
    }
  }

  function openBreedSow(index) {
    let sow = F().sows[index],
      boars = knownBoars();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="breedModal"><form class="due-modal sow-profile" onsubmit="saveInsemination(event,${index})"><div class="modal-top"><div><div class="eyebrow">BREED / INSEMINATE</div><h2>${sow.name}</h2><p>${sow.id} · ${sow.breed||''}</p></div><button type="button" class="close-reminder" onclick="closeTool('breedModal')">×</button></div><div class="field" style="text-align:left;margin:16px 0"><label>Insemination date</label><small class="field-hint">Breeding day counts as Day 0 — Day 1 of gestation starts the next day · due date = insemination + 114 days. [REBUILD FIX 61]</small><input name="insemination" type="date" value="${(window.localToday ? window.localToday() : new Date().toISOString().slice(0,10))}" required></div><div class="field" style="text-align:left"><label>Semen used / boar</label><input list="boarList" name="boar" oninput="updateCompatibility(${index},this.value)" placeholder="Search or enter semen / boar name" required><datalist id="boarList">${boars.map(b=>`<option value="${b.name}">${b.breed||''}</option>`).join('')}</datalist></div><div id="compatibilityCard" class="pedigree-mini" style="text-align:left"><b>Compatibility check</b><p class="muted">Choose a boar to screen direct recorded relationships.</p></div><div class="due-actions" style="margin-top:18px"><button type="button" class="btn ghost" onclick="closeTool('breedModal')">Cancel</button><button class="btn">Record insemination</button></div></form></div>`)
  }

  function updateCompatibility(index, name) {
    let sow = F().sows[index],
      boar = knownBoars().find(b => b.name.toLowerCase() === name.toLowerCase()),
      r = relationshipCheck(sow, boar),
      bad = r.risk !== 'SAFE';
    let box = document.getElementById('compatibilityCard');
    box.style.borderColor = bad ? '#f08c55' : '#4fce8b';
    box.innerHTML = `<b style="color:${bad?'#ffad79':'#54df91'}">${bad?'⚠ ': '✓ '}${r.risk} · Estimated F ${r.f.toFixed(2)}%</b><p class="muted">${r.message}</p>`
  }

  function saveInsemination(e, index) {
    e.preventDefault();
    let data = Object.fromEntries(new FormData(e.target)),
      sow = F().sows[index],
      boar = knownBoars().find(b => b.name.toLowerCase() === data.boar.toLowerCase()),
      r = relationshipCheck(sow, boar);
    if (r.risk === 'CRITICAL RISK') {
      toast('Breeding blocked: critical inbreeding risk.');
      return
    }
    sow.insemination = data.insemination;
    /* [FIX H2] the service boar is NOT the sow's biological sire. Overwriting
       sow.sire corrupted the pedigree engine (parents(sow)) and produced false
       inbreeding flags after every insemination. Store the semen source in the
       same dedicated fields the linked breeding flow (lineage.js) uses. */
    sow.lastSemenBoarName = data.boar;
    sow.lastSemenBoarId = boar?.id || null;
    sow.lastCompatibility = {
      risk: r.risk,
      f: r.f,
      checked_at: new Date().toISOString()
    };
    save();
    closeTool('breedModal');
    closeSowProfile();
    renderAll();
    toast('Insemination recorded')
  }
  window.closeTool = closeTool;
  window.deleteRecord = deleteRecord;
  window.openSowProfile = openSowProfile;
  window.closeSowProfile = closeSowProfile;
  window.openReheatRecord = index => openHeatRecord(index, true);
  window.openHeatRecord = openHeatRecord;
  window.saveHeatRecord = saveHeatRecord;
  window.openBreedSow = openBreedSow;
  window.updateCompatibility = updateCompatibility;
  window.saveInsemination = saveInsemination;
})();