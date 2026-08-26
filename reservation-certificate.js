/* Full-page reservation certificate: one layout for screen and print/PDF. */
(function() {
  const escH = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  const txt = v => v === undefined || v === null || v === '' ? 'N/A' : v;
  const field = (label, value) => `<div class="cert-field"><span>${label}</span><b>${txt(value)}</b></div>`;

  function generateCertQRCode(payloadText, fallbackId = '') {
    try {
      if (window.QRCode) {
        var qr = new QRCode(0, 'M');
        qr.addData(payloadText);
        qr.make();
        return `<div class="cert-qr real-qr" title="${escH(fallbackId)}">${qr.createSvgTag(3, 2)}</div>`;
      }
    } catch (e) {
      console.warn('QR Code generation error:', e);
    }
    return `<div class="cert-qr real-qr" title="${escH(fallbackId)}"><div style="padding:6px;font-size:10px;text-align:center"><b>VERIFIED CERTIFICATE</b><br>${escH(fallbackId)}</div></div>`;
  }

  function formatLineageCodeAndBreed(refOrObj, fallbackBreed = '', fallbackName = '') {
    let obj = null;
    let rawRef = '';
    
    if (typeof refOrObj === 'object' && refOrObj !== null) {
      obj = refOrObj;
      rawRef = obj.name || obj.id || '';
    } else {
      rawRef = String(refOrObj || '').trim();
      if (rawRef && rawRef !== '—' && rawRef !== 'N/A' && rawRef !== '-') {
        if (window.resolveAnimalLabel) {
          const resolved = window.resolveAnimalLabel(rawRef);
          if (resolved && (resolved.hit || resolved.hasObj)) {
            obj = resolved.hit || resolved;
          }
        }
        if (!obj) {
          const f = (typeof F === 'function' && F()) ? F() : {};
          const allAnimals = [...(f.boars || []), ...(f.sows || []), ...(f.ancestors || [])];
          obj = allAnimals.find(x => x && (x.id === rawRef || String(x.id).toLowerCase() === rawRef.toLowerCase() || String(x.name || '').toLowerCase() === rawRef.toLowerCase()));
          if (!obj && f.semen) {
            obj = f.semen.find(s => s && (s.id === rawRef || s.semen_batch_no === rawRef || s.boar_id === rawRef || String(s.boar_name || s.boar || '').toLowerCase() === rawRef.toLowerCase()));
          }
        }
      }
    }

    if (!obj && (!rawRef || rawRef === '—' || rawRef === 'N/A' || rawRef === '-')) {
      return 'N/A';
    }

    let name = String(obj?.name || obj?.boar_name || obj?.boar || rawRef || fallbackName || '').trim();
    let breed = String(obj?.breed || obj?.customBreed || fallbackBreed || '').trim();
    let id = String(obj?.id || obj?.code || obj?.tag || obj?.tag_no || obj?.semen_batch_no || obj?.boar_id || '').trim();

    // Check if name has embedded breed e.g. "Jolly Bugarin (German Pietrain)"
    let matchBreedInName = name.match(/^(.*?)\s*\(([^)]+)\)$/);
    if (matchBreedInName) {
      const part1 = matchBreedInName[1].trim();
      const part2 = matchBreedInName[2].trim();
      if (!breed || breed === '—' || breed === 'N/A') {
        name = part1 || part2;
        breed = part2;
      }
    }

    // Lookup breed across database if not yet found
    if (!breed || breed === '—' || breed === 'N/A') {
      const f = (typeof F === 'function' && F()) ? F() : {};
      const match = [...(f.boars || []), ...(f.sows || []), ...(f.semen || []), ...(f.ancestors || [])].find(x => x && (x.name === name || x.id === id || x.boar === name));
      if (match && (match.breed || match.customBreed)) {
        breed = match.breed || match.customBreed;
      }
    }

    // Format lineage name and code cleanly
    let matchParen = name.match(/^\(([^\)]+)\)\s*(.*)$/);
    let displayName = name;
    let lineageCode = '';
    if (matchParen) {
      lineageCode = matchParen[1].trim();
      const rest = matchParen[2].trim();
      displayName = rest ? `(${lineageCode}) ${rest}` : `(${lineageCode})`;
    }

    displayName = displayName.replace(/\s+/g, ' ').trim();
    breed = breed.replace(/\s+/g, ' ').trim();

    if (displayName && breed && breed !== '—' && breed !== 'N/A') {
      if (displayName.toLowerCase().endsWith(`(${breed.toLowerCase()})`)) {
        return displayName;
      }
      return `${displayName} (${breed})`;
    } else if (displayName && displayName !== '—' && displayName !== 'N/A') {
      return displayName;
    } else if (breed && breed !== '—' && breed !== 'N/A') {
      return breed;
    } else {
      return 'N/A';
    }
  }

  function openReservationDetails(i) {
    let r = null;
    const allRes = F().reservations || [];
    if (typeof i === 'object' && i !== null) {
      r = i;
      i = allRes.indexOf(r);
    } else if (typeof i === 'number' && isFinite(i)) {
      r = allRes[i];
    } else if (typeof i === 'string') {
      const clean = String(i).trim();
      r = allRes.find(x => x.id === clean || x.no === clean || String(x.no || '').toLowerCase() === clean.toLowerCase());
      i = allRes.indexOf(r);
    }
    if (!r) {
      if (window.toast) toast('Reservation record not found.');
      return;
    }
      b = (F().piglets || []).find(x => x.id === r.batch_id),
      /* [REBUILD FIX 57] multi-batch reservations: every batch the reservation names */
      resLineBatches = Array.isArray(r.lines) && r.lines.length > 1
        ? [...new Set(r.lines.map(L => L.batch_id))].map(id => (F().piglets || []).find(x => x.id === id)).filter(Boolean)
        : (b ? [b] : []),
      resMulti = resLineBatches.length > 1,
      dam = (F().sows || []).find(x => x.id === b?.dam_id || x.name === (b?.dam_name || b?.sow)),
      breedRec = (F().breedingRecords || []).find(x => x.id === b?.breeding_record_id),
      boar = (F().boars || []).find(x => x.id === b?.sire_id || x.id === breedRec?.boar_id || x.name === (b?.sire_name || b?.sire || breedRec?.boar_name)),
      semen = (F().semen || []).find(x => x.id === breedRec?.semen_id),
      ageDays = b?.birth ? Math.max(0, Math.floor((new Date() - new Date(b.birth + 'T00:00:00')) / 86400000)) : null,
      age = ageDays === null ? 'N/A' : (ageDays < 30 ? ageDays + ' days' : Math.floor(ageDays / 30) + ' month' + (Math.floor(ageDays / 30) !== 1 ? 's' : '') + (ageDays % 30 ? ' ' + (ageDays % 30) + ' days' : '')),
      resVaxIds = resLineBatches.length ? resLineBatches.map(x => x.id) : (b ? [b.id] : []),
      vax = b ? (F().vaccinations || F().vaccination_events || []).filter(x => x.target_type === 'batch' && resVaxIds.some(id => String(x.target_id) === String(id))) : [],
      farm = F(),
      farmLogo = document.querySelector('.sidebar .logo-img')?.src || '',
      appLogo = document.querySelector('.sidebar .logo-img')?.dataset?.defaultSrc || farmLogo,
      created = r.created_at || r.date || new Date().toISOString(),
      timeline = [
        ['Reservation Created', r.date],
        ['Payment Received', r.paid > 0 ? `${peso(r.paid)} received` : 'Pending payment'],
        ['Piglet Assigned', `${r.gender} · ${r.quantity}`],
        ['Health Checked', r.vaccination_name || 'No health record'],
        /* [REBUILD] Release-gate logic per farm workflow: this step tracks the release
           record itself — Pending while unreleased; Approved once released. Defensive:
           older records can carry released_at while status was recomputed to fully_paid. */
        ['Ready for Release', (r.status === 'released' || r.released_at) ? 'Approved' : 'Pending'],
        ['Released', r.released_at ? new Date(r.released_at).toLocaleDateString('en-PH', {month: 'short', day: 'numeric', year: 'numeric'}) : 'Not released']
      ],
      /* [REBUILD] Batch performance metrics + ear-notch registry (module:
         js/batch-performance.js). Measured release data of THIS reservation
         (weight/date) takes priority over batch-level averages. */
      perf = b && window.batchPerformance ? window.batchPerformance(b, r) : null,
      perfCard = perf && perf.hasAny ? (() => {
        /* [REBUILD FIX 60] buyer-facing metrics big and first; every other metric
           stays on the certificate in a quieter supporting strip (no data removed) */
        const PRIM = ['Birth Weight (Avg)', 'Release Weight', 'Age at Release', 'Average Daily Gain (ADG)', 'Weaning Weight (Avg)'],
          relDate = perf.release ? [['Release Date', (typeof fmtDate === 'function' ? fmtDate(perf.release) : perf.release), 'actual / target date']] : [],
          prim = PRIM.map(l2 => perf.cells.find(c2 => c2[0] === l2)).filter(Boolean).concat(relDate),
          sec = perf.cells.filter(c2 => !prim.includes(c2)),
          pcell = c2 => `<div class="perf-cell"><small>${c2[0]}</small><b>${c2[1]}</b>${c2[2] ? `<i>${c2[2]}</i>` : ''}</div>`,
          scell = c2 => `<div class="perf-cell s"><small>${c2[0]}</small><b>${c2[1]}</b>${c2[2] ? `<i>${c2[2]}</i>` : ''}</div>`;
        return `<section class="cert-card cert-wide perf-card"><h3>Batch Performance Metrics</h3><div class="cert-perf-grid perf-primary">${prim.map(pcell).join('')}</div><div class="cert-perf-grid perf-secondary">${sec.map(scell).join('')}</div></section>`;
      })() : '',
      roster = b && Array.isArray(b.roster) ? b.roster.filter(x => x.renn || x.lenn || x.teats) : [],
      
      /* [REBUILD FIX 57] one reservation covering several batches → per-line table */
      multiLinesCard = resMulti ? `<section class="cert-card cert-wide"><h3>Reserved Piglets — ${resLineBatches.length} Batches on One Reservation</h3><table class="res-cert-lines"><thead><tr><th>Batch</th><th>Breed</th><th>Sow / Sire</th><th>Heads</th><th>Price / head</th><th>Amount</th></tr></thead><tbody>${r.lines.map(L => { let bb = resLineBatches.find(x => x.id === L.batch_id) || {}; return `<tr><td><b>${escH(L.batch_id)}</b></td><td>${escH(L.breed || bb.breed || '—')}</td><td>${escH(L.dam || bb.dam_name || bb.sow || '—')} / ${escH(L.sire || bb.sire_name || bb.sire || '—')}</td><td>${L.quantity} ${L.gender}</td><td>${peso(L.price)}</td><td>${peso(L.quantity * L.price)}</td></tr>` }).join('')}<tr class="res-cert-total"><td colspan="3"><b>Total</b></td><td><b>${r.quantity} heads</b></td><td></td><td><b>${peso(r.total)}</b></td></tr></tbody></table></section>` : '',
      rosterFull = b && Array.isArray(b.roster) ? b.roster : [],
      /* [REBUILD FIX 41] When the reservation names specific piglets, the Ear Notch section
         shows ONLY those (details pulled live from the batch's Ear Notch Registry —
         weights/teats update when the performance record is edited). Reservations
         without a selection keep the legacy whole-batch registry. */
      selIdx = Array.isArray(r.notch_rows) ? r.notch_rows.filter(x => typeof x === 'number') : [],
      selPigs = selIdx.map((ix, k) => {
        let live = rosterFull[ix] || {},
          snap = (Array.isArray(r.notch_snapshot) ? r.notch_snapshot[k] : null) || {},
          m = Object.assign({}, snap, Object.fromEntries(Object.entries(live).filter(([kk, v]) => v !== '' && v !== undefined && kk !== '_sel')));
        return (m.renn || m.lenn || m.teats || m.sex) ? m : null;
      }).filter(Boolean),
      manualPigs = Array.isArray(r.notches_manual) ? r.notches_manual.filter(x => x && (x.renn || x.lenn || x.teats)) : [],
      personal = [...selPigs, ...manualPigs],
      notchWeights = x => {
        let w = [], ws = x.weights || {};
        if (ws.birth) w.push(`<b>Birth</b> ${escH(ws.birth)} kg`);
        if (ws.weaning) w.push(`<b>Wean</b> ${escH(ws.weaning)} kg`);
        if (ws.release) w.push(`<b>Release</b> ${escH(ws.release)} kg`);
        if (!w.length && x.weight) w.push(`<b>Weighed</b> ${escH(x.weight)} kg`);
        return w.length ? `<span class="nw">${w.join(' · ')}</span>` : '';
      },
      /* [REBUILD FIX 59] certificate redesign: hero identity + lineage + payment + status */
      batchMeta = bb => {
        let dm = (F().sows || []).find(x => x.id === bb?.dam_id || x.name === (bb?.dam_name || bb?.sow)),
          br = (F().breedingRecords || []).find(x => x.id === bb?.breeding_record_id),
          bo = (F().boars || []).find(x => x.id === bb?.sire_id || x.id === br?.boar_id || x.name === (bb?.sire_name || bb?.sire || br?.boar_name)),
          sm = (F().semen || []).find(x => x.id === br?.semen_id || x.semen_batch_no === bb?.semen_batch_no || x.boar_name === (bb?.sire_name || bb?.sire)),
          ad = bb?.birth ? Math.max(0, Math.floor((new Date() - new Date(bb.birth + 'T00:00:00')) / 86400000)) : null,
          ag = ad === null ? 'N/A' : (ad < 30 ? ad + ' days' : Math.floor(ad / 30) + ' month' + (Math.floor(ad / 30) !== 1 ? 's' : '') + (ad % 30 ? ' ' + (ad % 30) + ' days' : '')),
          damLineage = formatLineageCodeAndBreed(dm || bb?.dam_id || bb?.dam_name || bb?.sow, dm?.breed || bb?.dam_breed || ''),
          sireLineage = formatLineageCodeAndBreed(bo || bb?.sire_id || bb?.sire_name || bb?.sire, bo?.breed || bb?.sire_breed || ''),
          semenLineage = formatLineageCodeAndBreed(sm || br?.semen_id || bo, sm?.breed || bo?.breed || br?.semen_breed || '');
        return { dm, bo, sm, ag, damLineage, sireLineage, semenLineage };
      },
      capG = s => { s = String(s || ''); return s ? s[0].toUpperCase() + s.slice(1) : s },
      isFloating = r.status === 'floating' || r.is_floating,
      statusPretty = isFloating ? 'FLOATING WAITLIST (PRIORITY QUEUE)' : capG(String(r.status || '').replace(/_/g, ' ')),
      payState = (r.total > 0 && r.paid >= r.total) ? 'paid' : (r.paid > 0 ? 'partial' : 'pending'),
      payBadge = isFloating ? (r.paid > 0 ? `DEPOSIT ACKNOWLEDGED (${peso(r.paid)})` : 'WAITLIST QUEUE') : (payState === 'paid' ? 'PAID IN FULL' : payState === 'partial' ? 'PARTIAL PAYMENT' : 'PENDING PAYMENT'),
      cellh = (label, value) => `<div class="hero-cell"><small>${label}</small><b>${value}</b></div>`,

      damLineage = formatLineageCodeAndBreed(dam || b?.dam_id || b?.dam_name || b?.sow, dam?.breed || b?.dam_breed || ''),
      sireLineage = formatLineageCodeAndBreed(boar || b?.sire_id || b?.sire_name || b?.sire, boar?.breed || b?.sire_breed || ''),
      semenLineage = formatLineageCodeAndBreed(semen || breedRec?.semen_id || boar, semen?.breed || boar?.breed || breedRec?.semen_breed || ''),

      pedCols = (damLbl, dm, sireLbl, bo) => `<div class="pedline"><div class="ped-col"><b>Dam: ${escH(damLbl)}</b><span>↳ Dam's Sire: ${escH(formatLineageCodeAndBreed(dm?.sire || dm?.sireRef, dm?.sire_breed || ''))}</span><span>↳ Dam's Dam: ${escH(formatLineageCodeAndBreed(dm?.dam || dm?.damRef, dm?.dam_breed || ''))}</span></div><div class="ped-col"><b>Sire: ${escH(sireLbl)}</b><span>↳ Sire's Sire: ${escH(formatLineageCodeAndBreed(bo?.sire || bo?.sireRef, bo?.sire_breed || ''))}</span><span>↳ Sire's Dam: ${escH(formatLineageCodeAndBreed(bo?.dam || bo?.damRef, bo?.dam_breed || ''))}</span></div></div>`,
      /* centerpiece: the reserved piglet(s) — most important information on the page */
      heroCard = resMulti
        ? `<section class="cert-hero"><div class="csec-head">Reserved Piglets — ${resLineBatches.length} Batches on One Reservation</div><table class="res-cert-lines"><thead><tr><th>Batch</th><th>Breed</th><th>Sow / Sire</th><th>Heads</th><th>Price / head</th><th>Amount</th></tr></thead><tbody>${r.lines.map(L => { let bb = resLineBatches.find(x => x.id === L.batch_id) || {}; let m = batchMeta(bb); return `<tr><td><b>${escH(L.batch_id)}</b></td><td>${escH(L.breed || bb.breed || '—')}</td><td>${escH(m.damLineage)} / ${escH(m.sireLineage)}</td><td>${L.quantity} ${L.gender}</td><td>${peso(L.price)}</td><td>${peso(L.quantity * L.price)}</td></tr>` }).join('')}<tr class="res-cert-total"><td colspan="3"><b>Total</b></td><td><b>${r.quantity} heads</b></td><td></td><td><b>${peso(r.total)}</b></td></tr></tbody></table></section>`
        : (b ? `<section class="cert-hero"><div class="csec-head">Reserved Piglet${r.quantity > 1 ? 's' : ''}</div><div class="hero-title"><b>${escH(b.id)}</b><span>${escH(b.breed || '—')}${r.quantity > 1 ? ' · ' + r.quantity + ' heads' : ''}</span></div><div class="hero-grid">${cellh('Sex', capG(r.gender))}${cellh('Birth Date', fmtDate(b.birth))}${cellh('Age', age)}${cellh('Weight', r.summary_overrides?.weight ?? (r.weight ? r.weight + ' kg' : 'N/A'))}${cellh('ADG', perf && perf.adg != null ? Number(perf.adg).toFixed(2) + ' kg/day' : '—')}${(r.tag_no || r.summary_overrides?.tag) ? cellh('Tag No.', r.summary_overrides?.tag ?? r.tag_no) : ''}</div><div class="hero-dam"><span>Dam: <b>${escH(damLineage)}</b></span><span>Sire: <b>${escH(sireLineage)}</b></span></div></section>` : ''),
      /* lineage: dam/sire grandparents per batch (premium pedigree feel) */
      lineageCard = `<section class="cert-lineage"><div class="csec-head">Lineage Details${resMulti ? ' — ' + resLineBatches.length + ' Batches' : ''}</div>${resMulti
        ? `<div class="batch-groups">${resLineBatches.map(bb => { let m = batchMeta(bb); return `<div class="batch-group"><div class="batch-group-head"><b>${escH(bb.id)}</b>${bb.breed ? `<span> · ${escH(bb.breed)}</span>` : ''}</div><div class="batch-group-line">Dam / Sire: <b>${escH(m.damLineage)} / ${escH(m.sireLineage)}</b> · Born: <b>${fmtDate(bb.birth)}</b> · Age: <b>${m.ag}</b></div>${pedCols(m.damLineage, m.dm, m.sireLineage, m.bo)}</div>` }).join('')}</div>`
        : (b ? pedCols(damLineage, dam, sireLineage, boar) : '')}</section>`,
      /* payment: strong summary with the balance in focus + status badge */
      payCard = `<section class="cert-pay"><div class="csec-head">Payment Summary</div><div class="pay-grid"><div class="pay-cell"><small>Total Amount</small><b>${peso(r.total)}</b></div><div class="pay-cell"><small>Amount Paid</small><b>${peso(r.paid)}</b></div><div class="pay-cell bal"><small>Balance</small><b>${peso(r.balance)}</b></div></div><span class="pay-badge ${payState}">${payBadge}</span>${(() => { /* [FIX 82] legacy records: hide stale waitlist tag once allocated */ const raw = String(r.summary_overrides?.notes ?? r.notes ?? ''); const dn = (!r.is_floating && String(r.status || '') !== 'floating') ? raw.replace(/\[FLOATING WAITLIST\]\s*/gi, '') : raw; return dn.trim() ? `<div class="pay-notes">Notes: ${escH(dn)}</div>` : ''; })()}</section>`,
      /* reservation status stepper: done / pending at a glance */
      stepDone = [true, r.paid > 0, true, !!r.vaccination_name, r.status === 'released' || !!r.released_at, !!r.released_at],
      _firstTodo = stepDone.indexOf(false), /* [REBUILD FIX 60] pending stage gets an amber highlight */
      /* [REBUILD FIX 57] multi-batch notch rendering: per-batch groups of reserved
         piglets (live from each batch's own registry), falling back to per-batch
         registry grids when no specific piglets were picked. */
      multiPicks = resMulti ? r.lines.map(L => {
        let bb = resLineBatches.find(x => x.id === L.batch_id),
          rf = bb && Array.isArray(bb.roster) ? bb.roster : [],
          idxs = Array.isArray(L.notch_rows) ? L.notch_rows.filter(x => typeof x === 'number') : [],
          pigs = idxs.map((ix, k) => {
            let live = rf[ix] || {},
              snap = (Array.isArray(L.notch_snapshot) ? L.notch_snapshot[k] : null) || {},
              m = Object.assign({}, snap, Object.fromEntries(Object.entries(live).filter(([kk, v]) => v !== '' && v !== undefined && kk !== '_sel')));
            return (m.renn || m.lenn || m.teats || m.sex) ? m : null
          }).filter(Boolean);
        return { id: L.batch_id, pigs }
      }).filter(g => g.pigs.length) : [],
      multiRegs = resMulti ? resLineBatches.map(bb => ({ id: bb.id, rr: (Array.isArray(bb.roster) ? bb.roster : []).filter(x => x.renn || x.lenn || x.teats) })).filter(g => g.rr.length) : [],
      notchChipHTML = (x, idx) => `<div class="notch-chip"><b>${x.sex === 'F' ? '♀' : x.sex === 'M' ? '♂' : 'Pig'} ${idx + 1}${x.manual ? ' (manual)' : ''}</b><span>R&nbsp;${escH(x.renn) || '—'} · L&nbsp;${escH(x.lenn) || '—'}${(x.teats ?? '') !== '' ? ` · ${escH(x.teats)} teats` : ''}</span>${notchWeights(x)}</div>`,
      notchCard = resMulti
        ? (multiPicks.length || manualPigs.length
            ? `<section class="cert-card cert-wide notch-card"><h3>Ear Notch — Reserved Piglets <small class="notch-sub">Specific to this reservation · from each batch's Ear Notch Registry · RENN = right ear (litter no.) · LENN = left ear (pig no.) · teat count for females</small></h3>${multiPicks.map(g => `<div class="cert-notch-group"><div class="cert-notch-batch">${escH(g.id)}</div><div class="notch-grid">${g.pigs.map(notchChipHTML).join('')}</div></div>`).join('')}${manualPigs.length ? `<div class="cert-notch-group"><div class="cert-notch-batch">Added manually</div><div class="notch-grid">${manualPigs.map(notchChipHTML).join('')}</div></div>` : ''}</section>`
            : '')
        : (personal.length
        ? `<section class="cert-card cert-wide notch-card"><h3>Ear Notch — Reserved Piglet${personal.length > 1 ? 's' : ''} <small class="notch-sub">Specific to this reservation · from the batch's Ear Notch Registry · RENN = right ear (litter no.) · LENN = left ear (pig no.) · teat count for females</small></h3><div class="notch-grid">${personal.map((x, idx) => `<div class="notch-chip"><b>${x.sex === 'F' ? '♀' : x.sex === 'M' ? '♂' : 'Pig'} ${idx + 1}${x.manual ? ' (manual)' : ''}</b><span>R&nbsp;${escH(x.renn) || '—'} · L&nbsp;${escH(x.lenn) || '—'}${(x.teats ?? '') !== '' ? ` · ${escH(x.teats)} teats` : ''}</span>${notchWeights(x)}</div>`).join('')}</div></section>`
        : ''),
            /* [REBUILD FIX 41] health card: batch vaccinations auto-fetched from the
         Vaccination Center (recorded vaccinations for this piglet batch), plus the
         optional medication / treatment history from the Recent Treatments log. */
      healthCard = (() => {
          baseLine = r.vaccination_name
            ? `✓ Batch vaccination: Up to date — ${r.vaccination_name}${r.vaccination_date ? ' ' + fmtDate(String(r.vaccination_date).slice(0, 10)) : ''}`
            : (b && b.vaccination_status ? '✓ Batch vaccination: ' + b.vaccination_status + (b.vaccines_given ? ' — ' + b.vaccines_given : '')
            : (vax.length ? '✓ Vaccination recorded (Vaccination Center)' : '• No vaccination record')), /* [REBUILD FIX 41] never say "no record" beside auto-fetched doses */

          vaxHtml = vax.map(e => {
            /* [REBUILD FIX 58] vaccine NAME only on the certificate (batch-tagged when
               several batches share the reservation) — no dose/date/head details */
            return `<div class="health-line vax-auto">${resMulti ? '<b>' + escH(String(e.target_id)) + '</b> · ' : ''}💉 ${escH(e.vaccine)}</div>`;
          }).join(''),
          tr = (r.include_treatments && b) ? (F().treatments || []).filter(t =>
              /* [REBUILD FIX 82] BATCH-scoped treatments only. The old matcher
                 also accepted t.sow_id / t.sow_name / animal-label matches, so
                 when a batch carries its dam's name (batch "Siete", sow
                 "Siete"), the certificate printed the SOW's treatment history
                 instead of the piglets'. */
              resVaxIds.some(id =>
                t.batch_id === id || t.animal_ref === id || t.animal_ref === 'batch:' + id ||
                (t.category === 'batch' && String(t.animal_label || '').toLowerCase().includes(String(id).toLowerCase())))
            ).sort((a, z) => String(z.date || '').localeCompare(String(a.date || ''))).slice(0, 8) : [],
          trHtml = tr.length
            /* [REBUILD FIX 58] .no-print → treatment records never reach the PDF output */
            ? `<div class="cert-treat-block no-print"><div class="health-line tr-head"><b>💊 Treatment history (Recent Treatments)</b></div>` + tr.map(t => `<div class="health-line tr-line">💊 ${escH(t.medicine || t.item_name || t.medicine_name || t.type || 'Treatment')} · <b>${txt(t.date ? fmtDate(String(t.date).slice(0, 10)) : t.date)}</b>${t.heads ? ` · ${t.heads} heads` : ''}${(t.dosage_ml ?? t.total_ml) !== undefined && (t.dosage_ml ?? t.total_ml) !== null ? ` · ${t.dosage_ml ?? t.total_ml} ml` : ''}${t.reason || t.notes ? ` · <small>${escH(t.reason || t.notes)}</small>` : ''}</div>`).join('') + `</div>`
            : (r.include_treatments ? `<div class="cert-treat-block no-print"><div class="health-line tr-line">💊 No treatments recorded for this batch in Recent Treatments.</div></div>` : '');
        return `<section class="cert-card cert-health"><h3>Health &amp; Vaccination</h3><div class="health-line">${escH(baseLine)}</div>${vaxHtml}${b && b.health_status ? `<div class="health-line">Batch health status: <b>${escH(b.health_status)}</b></div>` : ''}${trHtml}<div class="health-line note-line">${(r.release_notes || (b && b.perf_notes) || 'No medical or special instructions recorded.')}</div></section>`;
      })();
    const qrPayload = (() => {
      let lines = [];
      lines.push(`🐷 ARSWINETECH PRO · RESERVATION CERTIFICATE`);
      lines.push(`----------------------------------------`);
      lines.push(`Doc No: ${r.no || 'RES-' + Date.now()}`);
      lines.push(`Farm: ${farm.name || 'Farm'}`);
      lines.push(`Customer: ${r.summary_overrides?.customer ?? r.customer}`);
      if (r.contact && r.contact !== 'N/A') lines.push(`Contact: ${r.summary_overrides?.contact ?? r.contact}`);
      lines.push(`Date Issued: ${fmtDate(String(r.date || '').slice(0, 10))}`);
      lines.push(`Status: ${statusPretty.toUpperCase()}`);
      lines.push(`Total: P${(+r.total || 0).toLocaleString()} · Paid: P${(+r.paid || 0).toLocaleString()} · Balance: P${(+r.balance || 0).toLocaleString()}`);
      lines.push(`----------------------------------------`);

      lines.push(`🐖 PIGLETS & BATCH DETAILS:`);
      if (resMulti) {
        lines.push(`Multi-Batch Reservation (${resLineBatches.length} Batches · ${r.quantity} Heads)`);
        r.lines.forEach(L => {
          lines.push(`  Batch: ${L.batch_id} (${L.breed || '—'}) · ${L.quantity} ${L.gender} · P${L.price}`);
        });
      } else if (b) {
        lines.push(`Batch ID: ${b.id}`);
        lines.push(`Breed: ${b.breed || '—'}`);
        lines.push(`Reserved: ${r.quantity} head(s) · ${capG(r.gender)}`);
        lines.push(`Birth Date: ${b.birth ? fmtDate(b.birth) : '—'} (Age: ${age})`);
        if (b.release_weight) lines.push(`Release Weight: ${b.release_weight} kg`);
        else if (b.weaning_weight) lines.push(`Weaning Weight: ${b.weaning_weight} kg`);
        else if (b.birth_weight) lines.push(`Birth Weight: ${b.birth_weight} kg`);
      } else {
        lines.push(`Reserved: ${r.quantity} head(s) · ${capG(r.gender)}`);
      }

      if (personal && personal.length > 0) {
        lines.push(`Ear Notches & Teats (Reserved Piglets):`);
        personal.forEach((p, idx) => {
          let tStr = (p.teats !== undefined && p.teats !== '' && p.teats !== null) ? ` · ${p.teats} teats` : '';
          lines.push(`  #${idx + 1} (${p.sex || 'Pig'}): R-${p.renn || '—'} L-${p.lenn || '—'}${tStr}`);
        });
      } else if (b && Array.isArray(b.roster) && b.roster.some(x => x.teats)) {
        const femaleTeats = b.roster.filter(x => x.teats).map(x => x.teats);
        if (femaleTeats.length) {
          lines.push(`Batch Female Teats: ${[...new Set(femaleTeats)].join(', ')} teats`);
        }
      }

      lines.push(`----------------------------------------`);
      lines.push(`🧬 LINEAGE & PEDIGREE:`);
      if (resMulti) {
        resLineBatches.forEach(bb => {
          let m = batchMeta(bb);
          lines.push(`Batch ${bb.id}: Dam ${m.damLineage} / Sire ${m.sireLineage}`);
        });
      } else if (b) {
        lines.push(`Dam: ${damLineage} (Sire: ${formatLineageCodeAndBreed(dam?.sire || dam?.sireRef)} · Dam: ${formatLineageCodeAndBreed(dam?.dam || dam?.damRef)})`);
        lines.push(`Sire: ${sireLineage} (Sire: ${formatLineageCodeAndBreed(boar?.sire || boar?.sireRef)} · Dam: ${formatLineageCodeAndBreed(boar?.dam || boar?.damRef)})`);
      }

      lines.push(`----------------------------------------`);
      lines.push(`💉 VACCINES & HEALTH:`);
      if (r.vaccination_name) {
        lines.push(`Vaccine: ${r.vaccination_name}`);
      } else if (b && b.vaccines_given) {
        lines.push(`Vaccines Given: ${b.vaccines_given}`);
      } else if (vax && vax.length > 0) {
        lines.push(`Vaccines: ${vax.map(v => v.vaccine).join('; ')}`);
      } else {
        lines.push(`Health: Verified on farm`);
      }

      const resNotesRaw = String(r.summary_overrides?.notes ?? r.notes ?? r.release_notes ?? '');
      const resNotes = ((!r.is_floating && String(r.status || '') !== 'floating') ? resNotesRaw.replace(/\[FLOATING WAITLIST\]\s*/gi, '') : resNotesRaw).trim();
      if (resNotes) {
        lines.push(`----------------------------------------`);
        lines.push(`📝 RESERVATION NOTES / REMARKS:`);
        lines.push(`${resNotes}`);
      }

      lines.push(`----------------------------------------`);
      lines.push(`✓ Verified Authentic Certificate · ${farm.name || 'ARSwineTech Pro'}`);

      return lines.join('\n');
    })();

    document.body.insertAdjacentHTML('beforeend', `<div class="drill-bg" id="reservationDetail" style="position:fixed!important;inset:0!important;z-index:999999!important"><article class="certificate" style="position:relative"><button class="close-reminder no-print" onclick="closeReservationCertificate()" title="Close certificate">×</button><header class="cert-top"><div class="ct-logo"><img src="${farmLogo}" alt="${farm.name} logo"></div><div class="ct-mid"><div class="ct-farm">${escH(farm.name || 'Farm')}</div><h1>Reservation Certificate</h1><div class="ct-sub">Piglet Reservation &amp; Batch Record</div><div class="ct-meta">Reservation No. <b>${r.no}</b> &nbsp;·&nbsp; Date Issued <b>${fmtDate(String(r.date || '').slice(0, 10))}</b></div></div><div class="ct-right no-print"><img src="${appLogo}" alt="ARSwineTech"><div class="cert-btn-group"><button class="btn btn-pdf" onclick="window.print()" title="Print or Save as PDF">Download PDF</button><button class="btn btn-png" onclick="downloadReservationPNG('${escH(r.no || 'CERT')}')" title="Save certificate as high-resolution PNG image">Save as PNG</button></div></div></header><div class="cert-rule"></div><main><div class="cduo"><section class="cflat"><div class="csec-head">Customer Information</div>${field('Customer', r.summary_overrides?.customer ?? r.customer)}${field('Contact', r.summary_overrides?.contact ?? r.contact)}</section><section class="cflat"><div class="csec-head">Reservation Information</div><p class="ct-statusline">Status <span class="ct-status ${escH(String(r.status))}">${statusPretty}</span></p>${field('Reservation Date', r.date)}${field('Piglets Reserved', r.quantity + ' heads · ' + capG(r.gender))}</section></div>${heroCard}${lineageCard}<section class="cert-photo ${r.photo ? 'has-photo' : 'no-photo'}">${r.photo ? `<img src="${r.photo}" alt="Piglet" onclick="uploadReservationPhoto(${i})">` : `<button type="button" class="photo-empty no-print" onclick="uploadReservationPhoto(${i})">📷 Add piglet photo</button>`}</section><div class="cert-duo2 nh">${notchCard}${healthCard}</div><div class="cert-duo2 pp">${perfCard}${payCard}</div><section class="timeline-card"><div class="csec-head">Reservation Status</div><ol class="cert-timeline">${timeline.map((x, k2) => `<li class="${stepDone[k2] ? 'done' : (k2 === _firstTodo ? 'next todo' : 'todo')}"><i>${stepDone[k2] ? '✓' : '○'}</i><span><b>${x[0]}</b><small>${txt(x[1])}</small></span></li>`).join('')}</ol></section></main><footer><div class="cert-bottom"><div class="cert-verify"><div class="cv-qr">${generateCertQRCode(qrPayload, r.no)}<small>SCAN TO VERIFY</small></div><div class="cv-text"><b>Certificate Verification</b><p>Scan to verify this reservation and livestock record.</p><small>Reservation <b>${r.no}</b> · ${escH(farm.name || '')} · Status: ${statusPretty}</small></div></div><div class="cert-signs2"><div class="cs"><span class="cs-line"></span><b>Customer / Buyer</b><small>Signature over printed name · Date</small></div><div class="cs"><span class="cs-line"></span><b>Farm Owner / Representative</b><small>Signature over printed name · Date</small></div></div></div><div class="cv-meta cv-meta-line"><span>Generated On<b>${new Date(created).toLocaleDateString('en-PH', {month: 'short', day: 'numeric', year: 'numeric'})}</b></span><span>Generated By<b>${escH(farm.name || '')}</b></span><span>Document ID<b>${r.no}</b></span></div><div class="cert-foot-note">This document is system-generated by ARSwineTech Pro and may be verified using the QR code.<br>Thank you for trusting ${escH(farm.name || '')}!</div></footer></article></div>`)
  }

  function uploadReservationPhoto(i) {
    let reservation = F().reservations[i];
    if (reservation.photo) {
      let action = prompt('Photo options: Replace, Remove, or Cancel', 'Replace');
      if (!action || action.toLowerCase() === 'cancel') return;
      if (action.toLowerCase() === 'remove') {
        if (confirm('Are you sure you want to remove this piglet photo?')) {
          delete reservation.photo;
          save();
          document.getElementById('reservationDetail').remove();
          openReservationDetails(i)
        }
        return
      }
      if (action.toLowerCase() !== 'replace') return
    }
    let input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.onchange = () => {
      let f = input.files?.[0];
      if (!f) return;
      if (f.size > 3 * 1024 * 1024) {
        toast('Photo must be 3 MB or smaller.');
        return
      }
      let r = new FileReader();
      r.onload = () => {
        reservation.photo = r.result;
        save();
        document.getElementById('reservationDetail').remove();
        openReservationDetails(i)
      };
      r.readAsDataURL(f)
    };
    input.click()
  }

  function closeReservationCertificate() {
    document.getElementById('reservationDetail')?.remove();
    if (!document.querySelector('.modal-bg.open,.due-modal-bg,.reminder-modal-bg,.drill-bg,.onboard-screen.open,.reset-screen.open')) document.body.classList.remove('app-modal-open');
    document.body.style.pointerEvents = '';
    document.body.style.overflow = ''
  }

  function editCertificate(i) {
    let r = F().reservations[i];
    let customer = prompt('Customer name', r.summary_overrides?.customer ?? r.customer);
    if (customer === null) return;
    let notes = prompt('Customer / release notes', r.summary_overrides?.notes ?? r.notes ?? '');
    r.summary_overrides = {
      ...(r.summary_overrides || {}),
      customer,
      notes
    };
    save();
    document.getElementById('reservationDetail').remove();
    openReservationDetails(i)
  }
  async function downloadElementPNG(target, filename = 'Certificate') {
    let el = typeof target === 'string' ? (document.getElementById(target) || document.querySelector(target)) : target;
    if (!el) {
      if (window.toast) toast('Certificate element not found.');
      return;
    }
    if (el.classList.contains('drill-bg') || el.id === 'reservationDetail') {
      el = el.querySelector('.certificate') || el;
    }

    const cleanFilename = String(filename).endsWith('.png') ? filename : `${filename}.png`;
    if (window.toast) toast('Generating high-resolution PNG image...');

    const triggerSave = (blobOrDataUrl) => {
      try {
        if (typeof blobOrDataUrl === 'string') {
          const link = document.createElement('a');
          link.download = cleanFilename;
          link.href = blobOrDataUrl;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          if (window.toast) toast('Certificate saved as PNG image!');
        } else if (blobOrDataUrl instanceof Blob) {
          const url = URL.createObjectURL(blobOrDataUrl);
          const link = document.createElement('a');
          link.download = cleanFilename;
          link.href = url;
          document.body.appendChild(link);
          link.click();
          document.body.removeChild(link);
          setTimeout(() => URL.revokeObjectURL(url), 2500);
          if (window.toast) toast('Certificate saved as PNG image!');
        }
      } catch (err) {
        console.error('PNG download error:', err);
        if (window.toast) toast('Download failed: ' + err.message);
      }
    };

    // Primary: html2canvas
    if (window.html2canvas) {
      try {
        const canvas = await window.html2canvas(el, {
          scale: 2.5, // Crisp 300 DPI high-DPI quality
          useCORS: true,
          allowTaint: true,
          backgroundColor: '#ffffff',
          logging: false,
          ignoreElements: (node) => {
            return node.classList && (
              node.classList.contains('no-print') ||
              node.classList.contains('close-reminder') ||
              node.classList.contains('photo-empty')
            );
          }
        });
        canvas.toBlob((blob) => {
          if (blob) {
            triggerSave(blob);
          } else {
            triggerSave(canvas.toDataURL('image/png'));
          }
        }, 'image/png', 1.0);
        return;
      } catch (e) {
        console.warn('html2canvas capture error, attempting SVG fallback:', e);
      }
    }

    // Fallback: SVG foreignObject
    try {
      const clone = el.cloneNode(true);
      clone.querySelectorAll('.no-print, .close-reminder, .photo-empty').forEach(n => n.remove());

      const rect = el.getBoundingClientRect();
      const width = Math.ceil(rect.width || 740);
      const height = Math.ceil(rect.height || 1050);

      // Convert images to data URLs
      const imgs = clone.querySelectorAll('img');
      for (let img of imgs) {
        try {
          if (img.src && !img.src.startsWith('data:')) {
            const imgCanvas = document.createElement('canvas');
            imgCanvas.width = img.naturalWidth || img.width || 80;
            imgCanvas.height = img.naturalHeight || img.height || 80;
            const ctx = imgCanvas.getContext('2d');
            ctx.drawImage(img, 0, 0);
            img.src = imgCanvas.toDataURL('image/png');
          }
        } catch (err) {}
      }

      let cssText = '';
      for (let sheet of document.styleSheets) {
        try {
          for (let rule of sheet.cssRules) {
            cssText += rule.cssText + '\n';
          }
        } catch (err) {}
      }

      const styleEl = document.createElement('style');
      styleEl.textContent = cssText + `\n.certificate{box-shadow:none!important;border:none!important;margin:0!important;}`;
      clone.insertBefore(styleEl, clone.firstChild);

      const serialized = new XMLSerializer().serializeToString(clone);
      const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><foreignObject width="100%" height="100%">${serialized}</foreignObject></svg>`;
      const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        canvas.width = width * 2;
        canvas.height = height * 2;
        const ctx = canvas.getContext('2d');
        ctx.scale(2, 2);
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0);
        URL.revokeObjectURL(url);
        canvas.toBlob((b) => {
          if (b) triggerSave(b);
          else triggerSave(canvas.toDataURL('image/png'));
        }, 'image/png', 1.0);
      };
      img.onerror = () => {
        URL.revokeObjectURL(url);
        if (window.toast) toast('Error rendering certificate image.');
      };
      img.src = url;
    } catch (err) {
      console.error('SVG snapshot error:', err);
      if (window.toast) toast('Could not generate PNG image: ' + err.message);
    }
  }

  function downloadReservationPNG(resNo) {
    const certEl = document.querySelector('#reservationDetail .certificate') || document.getElementById('reservationDetail');
    return downloadElementPNG(certEl, `Reservation-${resNo || 'CERT'}.png`);
  }

  window.closeReservationCertificate = closeReservationCertificate;
  window.uploadReservationPhoto = uploadReservationPhoto;
  window.openReservationDetails = openReservationDetails;
  window.openReservationCertificate = openReservationDetails;
  window.editCertificate = editCertificate;
  window.downloadElementPNG = downloadElementPNG;
  window.downloadReservationPNG = downloadReservationPNG;
})()