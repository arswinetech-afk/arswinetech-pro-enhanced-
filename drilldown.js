/* Lazy, farm-scoped dashboard drill-downs. Detailed records are built only after a card tap. */
(function() {
  /* [FIX M3] floor() vs the dashboard's round() showed Day 84 here and Day 85
     there after noon — and 114-day overdue decisions differed per screen. Use
     the same day-diff helper as app.js (round, local midnight). */
  const realDays = date => date ? Math.max(0, (typeof days === 'function' ? days(date) : Math.floor((new Date() - new Date(String(date).slice(0, 10) + 'T00:00:00')) / 86400000))) : 0;
  const datePlus = (date, n) => {
    /* [FIX 139] serialize with LOCAL date parts — toISOString() rendered in
       UTC and shifted every milestone date (Day-16 check, farrowing due)
       one day early for UTC+ farmers. */
    let d = new Date(String(date).slice(0, 10) + 'T00:00:00');
    d.setDate(d.getDate() + n);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  };
  const farrowingDue = s => {
    if (!s?.insemination) return 'Due date: not recorded';
    let left = 114 - realDays(s.insemination),
      due = fmtDate(datePlus(s.insemination, 114));
    return left > 0 ? `Due Date: ${due} (${left} days left)` : left === 0 ? `Due Date: ${due} (Due today)` : `Due Date: ${due} (${-left} days overdue)`
  };
  const age = dob => dob ? Math.max(0, Math.floor((new Date() - new Date(dob)) / 86400000)) : null;
  const fmtAge = n => n === null ? '—' : n < 365 ? `${Math.floor(n/30)}mo` : `${Math.floor(n/365)}y ${Math.floor(n%365/30)}mo`;
  /* [REBUILD FIX 48] fetch an animal's Vaccination Center summary (types + dates) */
  const vaxLine = (type, id, name) => (window.vaxSummaryText ? vaxSummaryText(type, id, name) : '');

  function sowState(s) {
    if (!s || typeof s !== 'object') return { label: 'OPEN', cls: 'open', detail: 'Ready for breeding' };
    if (s.culled || s.status === 'CULLED' || s.status === 'Culled') return {
      label: 'CULLED',
      cls: 'overdue',
      detail: `Culled: ${fmtDate(s.cullDate)} · ${s.cullReason||''}`
    };
    if (s.status === 'Reheat' || s.reheatDate || s.lifecycle === 'Reheat') return {
      label: 'REHEAT',
      cls: 'heat',
      detail: `${realDays(s.reheatDate || s.lastHeatDate)} days since reheat recorded`
    };
    if (s.status === 'Heat' || s.lifecycle === 'Heat') return {
      label: 'HEAT',
      cls: 'heat',
      detail: `${realDays(s.lastHeatDate)} days since heat recorded · Ready to breed`
    };
    if (s.lastHeatDate && (!s.insemination || realDays(s.lastHeatDate) <= realDays(s.insemination))) return {
      label: 'HEAT',
      cls: 'heat',
      detail: `${realDays(s.lastHeatDate)} days since heat recorded · Ready to breed`
    };
    if (s.status === 'Open' && s.lifecycle === 'Weaned') return {
      label: 'OPEN',
      cls: 'open',
      detail: 'Weaned · ready for next breeding cycle'
    };

    let linked = (F().piglets || []).filter(b => b && (b.dam_id === s.id || b.sow_id === s.id || b.sow === s.name || b.dam === s.name)),
      hasWeaned = linked.some(b => b.weanedAt || b.weaning_date || b.status === 'Weaned' || b.weaning),
      hasActive = linked.some(b => !b.weanedAt && !b.weaning_date && b.status !== 'Weaned' && !b.weaning && !b.archived);

    if ((s.lactationEndedAt || s.weanedAt || (!hasActive && hasWeaned)) && !s.insemination) return {
      label: 'OPEN',
      cls: 'open',
      detail: 'Weaned · ready for next breeding cycle'
    };

    let lactationDate = s.farrowingDate || s.lactationStart;
    if (lactationDate && !s.weanedAt && !s.lactationEndedAt && (hasActive || !hasWeaned)) {
      let lactationDays = realDays(lactationDate);
      return {
        label: 'LACTATING',
        cls: 'lact',
        detail: `Lactating Day ${Math.max(1, lactationDays + 1)}`
      };
    }

    if (!s.insemination) return {
      label: 'OPEN',
      cls: 'open',
      detail: 'No active insemination · ready for breeding'
    };

    let actual = realDays(s.insemination),
      check16 = fmtDate(datePlus(s.insemination, 16));
    if (actual < 33) return {
      label: 'GESTATING',
      cls: 'gestating',
      detail: `Inseminated ${fmtDate(s.insemination)} · Gestation day ${actual} · Day 16 check: ${check16}`
    };
    if (actual <= 114) return {
      label: 'PREGNANT',
      cls: actual >= 109 ? 'soon' : 'pregnant',
      detail: `Inseminated ${fmtDate(s.insemination)} · Gestation day ${actual} · expected farrowing ${fmtDate(datePlus(s.insemination,114))} · ${114-actual} days remaining`
    };
    return {
      label: 'OVERDUE',
      cls: 'overdue',
      detail: `Inseminated ${fmtDate(s.insemination)} · Gestation day ${actual} · ${actual-114} days overdue`
    };
  }

  window.sowState = sowState; /* [REBUILD FIX 50] shared: dashboard monitoring card uses the same state rules */

  function actionButtons(s, st, index) {
    if (st.label === 'OPEN') return `<button onclick="openHeatRecord(${index})">🔥 HEAT</button><button onclick="openBreedSow(${index})">💉 BREED</button>`;
    if (st.label === 'HEAT') return `<button onclick="openBreedSow(${index})">💉 BREED</button><button onclick="openHeatRecord(${index})">🔥 RECORD HEAT</button>`;
    if (st.label === 'REHEAT') return `<button onclick="openBreedSow(${index})">💉 BREED</button><button onclick="openReheatRecord(${index})">🔥 RECORD REHEAT</button>`;
    if (st.label === 'GESTATING') return `<button onclick="openSowProfile(${index})">VIEW GESTATION</button><button onclick="openReheatRecord(${index})">🔥 RECORD REHEAT</button>`;
    if (st.label === 'PREGNANT') return `<button onclick="openSowProfile(${index})">PREGNANCY STATUS</button><button onclick="farrowSowFromCard(${index})">🐷 FARROW</button><button onclick="openReheatRecord(${index})">🔥 RECORD REHEAT</button>`; /* [REBUILD FIX 39] pregnant sows may farrow any day (often before the exact 114-day due date) — never gate the farrow action on being overdue · [REBUILD FIX 56] index-based handler: a sow id containing a quote can no longer break this button */
    if (st.label === 'LACTATING') return `<button onclick="openWeanModal(${index})">WEAN</button><button onclick="openSowProfile(${index})">FARROWING RECORD</button>`;
    return `<button onclick="openSowProfile(${index})">⚠ ALERT</button><button onclick="farrowSowFromCard(${index})">🐷 FARROWING RECORD</button>` /* [REBUILD FIX 39] preset the dam here too · [REBUILD FIX 56] index-based — id-safe */
  }

  function items(kind) {
    let f = F();
    if (kind === 'sows') return (f.sows || []).filter(isActiveSow);
    if (kind === 'pregnant') return (f.sows || []).filter(x => ['PREGNANT', 'OVERDUE'].includes(sowState(x).label)) /* [REBUILD FIX 49] an overdue sow (past 114 days, not yet farrowed) is STILL pregnant — she stays listed here, shown with her red OVERDUE pill */
      .sort((a, b) => {
      let da = 114 - realDays(a.insemination),
        db = 114 - realDays(b.insemination);
      return Math.abs(da) - Math.abs(db) || da - db
    });
    if (kind === 'dueweek') return dueThisWeek(f).sort((a, b) => d(a.insemination) - d(b.insemination));
    if (kind === 'lactating') return (f.sows || []).filter(x => sowState(x).label === 'LACTATING');
    if (kind === 'boars') return (f.boars || []).filter(b => String(b.status || 'Active') === 'Active'); /* FIX 28: 'Active Boars' drilldown lists counted boars only (lineage references stay in the registry / pedigree) */
    if (kind === 'piglets') return f.piglets || [];
    if (kind === 'feed') return f.feed || [];
    if (kind === 'semen') return f.semen || [];
    if (kind === 'reminders') return (f.reminders || []).filter(x => x.is_active !== false);
    if (kind === 'sales') return f.transactions || [];
    return []
  }

  function title(kind) {
    return {
      sows: 'Total Sows',
      pregnant: 'Pregnant Sows',
      lactating: 'Lactating Sows',
      boars: 'Active Boars',
      piglets: 'Piglet Batches',
      feed: 'Feed Inventory',
      semen: 'Semen Inventory',
      reminders: 'Active Reminders',
      sales: 'Financial Summary',
      dueweek: 'Sows Due This Week'
    } [kind] || 'Records'
  }

  function productionHistory(s) {
    let batches = (F().piglets || []).filter(x => x.dam_id === s.id || x.sow_id === s.id || x.sow === s.name).sort((a, b) => String(b.weanedAt || b.birth).localeCompare(String(a.weanedAt || a.birth))).slice(0, 10);
    if (!batches.length) return '<div class="production-history"><b>📦 Production History</b><p class="muted">No completed production records yet.</p></div>';
    let record = batch => (F().breedingRecords || []).find(r => r.id === batch.breeding_record_id);
    let row = batch => {
      let r = record(batch),
        live = (+batch.males || 0) + (+batch.females || 0),
        still = +batch.stillborn || 0,
        mum = +batch.mummified || 0,
        total = live + still + mum;
      let mortNotes = (still > 0 || mum > 0) ? ` · <span style="color:#f59e0b">${still ? still + " stillborn" : ""}${still && mum ? ", " : ""}${mum ? mum + " mummified" : ""}</span>` : "";
      return `<div class="production-row"><b>Batch: ${batch.id}</b><span>${live} live born (${batch.males||0}♂ / ${batch.females||0}♀)${mortNotes} · Total: ${total}</span><small>Breed: ${batch.breed||s.breed||"—"} · Semen: ${batch.sire_name||batch.sire||"—"}<br>AI: ${fmtDate(r?.insemination_date)} · Farrowed: ${fmtDate(batch.birth)} · Weaned: ${fmtDate(batch.weanedAt||batch.weaning_date)}</small></div>`;
    };
    let id = 'prod-' + s.id.replace(/[^a-z0-9]/gi, '');
    return `<div class="production-history"><b>📦 Latest Production Summary</b>${row(batches[0])}${batches.length>1?`<button class="production-toggle" onclick="toggleProductionHistory('${id}')">▼ View Past Production History (${batches.length-1} records)</button><div id="${id}" class="production-past">${batches.slice(1).map(row).join('')}</div>`:''}</div>`
  }

  function toggleProductionHistory(id) {
    let e = document.getElementById(id);
    if (e) e.classList.toggle('open')
  }

  function activeLitter(s) {
    let batch = (F().piglets || []).filter(x => x.id === s.activeLitterId || (x.dam_id === s.id || x.sow_id === s.id || x.sow === s.name) && !x.weanedAt && !x.weaning_date).sort((a, b) => String(b.birth).localeCompare(String(a.birth)))[0];
    if (!batch) return '<div class="active-litter"><b>🐷 Active Litter Summary</b><p class="muted">No active farrowed batch is linked to this sow.</p></div>';
    let r = (F().breedingRecords || []).find(x => x.id === batch.breeding_record_id),
      total = (+batch.males || 0) + (+batch.females || 0);
    return `<div class="active-litter"><b>🐷 Active Litter Summary</b><div><strong>Batch: ${batch.id}</strong> · ${total} heads (${batch.males||0} Male / ${batch.females||0} Female)</div><div>Breed: ${batch.breed||s.breed||'—'} · Semen: ${batch.sire_name||batch.sire||'—'}</div><small>AI Date: ${fmtDate(r?.insemination_date||s.insemination)} · Farrowed: ${fmtDate(batch.birth)}</small></div>`
  }

  function heatSummary(s, st) {
    if (st.label !== 'HEAT' && st.label !== 'REHEAT') return '';
    let date = st.label === 'REHEAT' ? s.reheatDate : s.lastHeatDate,
      notes = st.label === 'REHEAT' ? (s.reheatNotes || s.lastHeatNotes) : (s.lastHeatNotes || '');
    return `<div class="heat-summary"><b>🔥 ${st.label==='REHEAT'?'Reheat':'Heat'} Detected: ${fmtDate(date)} (${realDays(date)} days ago)</b>${notes?`<span>Observations: ${notes}</span>`:''}</div>`
  }
  const treatmentDate = t => t.date || t.treatment_datetime || t.treatment_date || t.datetime || t.created_at || null;
  const treatmentStamp = t => {
    let v = treatmentDate(t),
      x = v ? new Date(v) : null;
    return x && !isNaN(x) ? x.toLocaleString() : 'Date not recorded'
  };

  /* A historical treatment's follow_up_datetime is not, by itself, an active
     alarm. The sow card must follow the linked reminder lifecycle: deleting or
     dismissing that reminder silences the banner without deleting or rewriting
     the treatment record. This also understands the legacy follow-up reminder
     shape created before source IDs were stored. */
  function reminderIsActiveForAlert(r) {
    return !!r && r.is_active !== false && r.active !== false && !r.completed_at;
  }
  function reminderTriggerDate(r) {
    if (!r) return null;
    const raw = r.next_trigger || (r.date
      ? (String(r.date).length <= 10 ? String(r.date) + 'T' + (r.time || '00:00') + ':00' : r.date)
      : null);
    if (!raw) return null;
    const x = new Date(raw);
    return isNaN(x.getTime()) ? null : x;
  }
  function hasActiveTreatmentReminder(t, sow, followUp) {
    const reminders = (F().reminders || []).filter(reminderIsActiveForAlert),
      treatmentId = String(t.id || ''),
      linkedReminderId = String(t.reminder_id || t.follow_up_reminder_id || ''),
      sourceMatch = r => {
        const sourceId = String(r.source_id || r.source_record_id || r.treatment_id || '');
        const sourceType = String(r.source_type || r.source_kind || '').toLowerCase();
        return !!treatmentId && sourceId === treatmentId && (!sourceType || /treat/.test(sourceType));
      };

    /* New records carry an exact reminder ID/source link. If that link is gone
       or inactive, do not fall back to a fuzzy match and resurrect the alert. */
    if (linkedReminderId) return reminders.some(r => String(r.id || '') === linkedReminderId || sourceMatch(r));
    if (reminders.some(sourceMatch)) return true;

    /* Legacy records had no source link. Match only the old generated
       Follow-up Injection title/description plus the same follow-up moment, so
       an unrelated farm reminder cannot turn this banner back on. */
    const medicine = String(t.medicine || t.medicine_name || t.name || '').trim().toLowerCase();
    const targetTokens = [sow && sow.name, sow && sow.id, t.sow_name, t.sow_id]
      .filter(Boolean).map(x => String(x).trim().toLowerCase()).filter(Boolean);
    const expected = new Date(followUp);
    if (!medicine || isNaN(expected.getTime())) return false;
    return reminders.some(r => {
      const title = String(r.title || '').toLowerCase(),
        description = String(r.description || '').toLowerCase(),
        generatedShape = String(r.id || '').toLowerCase().startsWith('follow-') || /follow[- ]up injection/.test(title),
        medicineMatches = title.includes(medicine) || description.includes(medicine),
        targetMatches = !targetTokens.length || targetTokens.some(token => title.includes(token) || description.includes(token)),
        actual = reminderTriggerDate(r);
      return generatedShape && medicineMatches && targetMatches && actual && Math.abs(actual.getTime() - expected.getTime()) <= 36 * 60 * 60 * 1000;
    });
  }

  let currentSowFilter = 'all';

  function sowCountSummaryHTML(activeFilter = 'all') {
    const f = F();
    const allSows = (f.sows || []).filter(isActiveSow);
    const reheatSows = allSows.filter(s => {
      const st = sowState(s);
      return st.label === 'REHEAT' || s.reheatDate;
    });
    const pregnantSows = allSows.filter(s => {
      const st = sowState(s);
      return ['PREGNANT', 'GESTATING', 'OVERDUE'].includes(st.label);
    });
    const openSows = allSows.filter(s => {
      const st = sowState(s);
      return ['OPEN', 'HEAT'].includes(st.label);
    });
    const needWeanSows = allSows.filter(s => {
      const st = sowState(s);
      if (st.label === 'LACTATING') return true;
      if (s.farrowingDate || s.lactationStart) {
        return realDays(s.farrowingDate || s.lactationStart) >= 28;
      }
      return false;
    });
    const farrowThisMonthSows = allSows.filter(s => {
      if (!s.insemination) return false;
      const daysLeft = 114 - realDays(s.insemination);
      return daysLeft >= 0 && daysLeft <= 31;
    });

    const items = [
      { key: 'all', label: 'All Sows', count: allSows.length, ico: '📋', cls: 'all' },
      { key: 'reheat', label: 'Reheat Record', count: reheatSows.length, ico: '🔥', cls: 'reheat' },
      { key: 'pregnant', label: 'Pregnant / Gestating', count: pregnantSows.length, ico: '🤰', cls: 'pregnant' },
      { key: 'open', label: 'Open / Ready', count: openSows.length, ico: '⭕', cls: 'open' },
      { key: 'wean', label: 'Need to Wean', count: needWeanSows.length, ico: '🍼', cls: 'wean' },
      { key: 'farrowMonth', label: 'Soon to Farrow (This Month)', count: farrowThisMonthSows.length, ico: '🐷', cls: 'farrow' }
    ];

    return `
      <div class="sow-summary-ribbon" id="sowSummaryRibbon">
        <div class="ribbon-scroll">
          ${items.map(item => `
            <button type="button"
                    class="sow-sum-chip ${item.cls} ${activeFilter === item.key ? 'active' : ''}"
                    onclick="window.filterSowSummary('${item.key}')">
              <span class="chip-ico">${item.ico}</span>
              <span class="chip-label">${item.label}</span>
              <b class="chip-count">${item.count}</b>
            </button>
          `).join('')}
        </div>
      </div>
    `;
  }
  window.sowCountSummaryHTML = sowCountSummaryHTML;

  function filterSowSummary(key) {
    currentSowFilter = key;
    const ribbon = document.getElementById('sowSummaryRibbon');
    if (ribbon) {
      ribbon.querySelectorAll('.sow-sum-chip').forEach(btn => {
        btn.classList.toggle('active', btn.classList.contains(key));
      });
    }

    const cards = document.querySelectorAll('#drillList .drill-sow');
    cards.forEach(card => {
      const idx = +card.dataset.sowIndex;
      const s = F().sows?.[idx];
      if (!s) return;
      const st = sowState(s);

      let show = true;
      if (key === 'reheat') show = st.label === 'REHEAT' || !!s.reheatDate;
      else if (key === 'pregnant') show = ['PREGNANT', 'GESTATING', 'OVERDUE'].includes(st.label);
      else if (key === 'open') show = ['OPEN', 'HEAT'].includes(st.label);
      else if (key === 'wean') {
        show = st.label === 'LACTATING' || (s.farrowingDate || s.lactationStart ? realDays(s.farrowingDate || s.lactationStart) >= 28 : false);
      } else if (key === 'farrowMonth') {
        const daysLeft = s.insemination ? 114 - realDays(s.insemination) : 999;
        show = daysLeft >= 0 && daysLeft <= 31;
      }
      card.style.display = show ? '' : 'none';
    });
  }
  window.filterSowSummary = filterSowSummary;

  function sowCard(s, index) {
    let st = sowState(s);
    let trs = (F().treatments || []).filter(x => x.sow_id === s.id || x.sow_name === s.name).sort((a, b) => String(b.date).localeCompare(String(a.date)));
    let breed = (F().breedingRecords || []).filter(x => x.sow_id === s.id && !x.deleted_at).sort((a, b) => String(b.insemination_date).localeCompare(String(a.insemination_date)))[0];

    // 1. Age Calculation
    const ageDetailed = window.calcAgeDetailed ? window.calcAgeDetailed(s.dob) : { summary: fmtAge(age(s.dob)), text: fmtAge(age(s.dob)) };

    // 2. Lineage & Ancestor Names Resolution
    const sireInfo = window.resolveAnimalLabel ? window.resolveAnimalLabel(s.sire || s.sireRef || s.sire_name) : { name: s.sire || 'Unknown', display: s.sire || 'Unknown' };
    const damInfo = window.resolveAnimalLabel ? window.resolveAnimalLabel(s.dam || s.damRef || s.dam_name) : { name: s.dam || 'Unknown', display: s.dam || 'Unknown' };

    const sireHit = sireInfo.hit || null;
    const damHit = damInfo.hit || null;

    const patGrandsireInfo = window.resolveAnimalLabel ? window.resolveAnimalLabel(sireHit ? (sireHit.sire || sireHit.sireRef || sireHit.sire_name) : null) : { name: '—', display: '—' };
    const patGranddamInfo = window.resolveAnimalLabel ? window.resolveAnimalLabel(sireHit ? (sireHit.dam || sireHit.damRef || sireHit.dam_name) : null) : { name: '—', display: '—' };
    const matGrandsireInfo = window.resolveAnimalLabel ? window.resolveAnimalLabel(damHit ? (damHit.sire || damHit.sireRef || damHit.sire_name) : null) : { name: '—', display: '—' };
    const matGranddamInfo = window.resolveAnimalLabel ? window.resolveAnimalLabel(damHit ? (damHit.dam || damHit.damRef || damHit.dam_name) : null) : { name: '—', display: '—' };

    // 3. Housing Location & Pen
    let sowHousing = { barnName: 'Unassigned Stall', penName: '—', zoneType: 'Stall' };
    (F().barns || []).forEach(b => {
      (b.pens || []).forEach(p => {
        const occ = String(p.occupant_id || '').toLowerCase();
        if (occ && (occ === String(s.id).toLowerCase() || occ === String(s.name).toLowerCase())) {
          sowHousing = {
            barnId: b.id,
            barnName: b.name,
            penId: p.id,
            penName: p.name || p.id,
            zoneType: p.type === 'crate' ? 'Farrowing Crate' : (b.type === 'Gestation' ? 'Gestation Stall' : 'Pen')
          };
        }
      });
    });

    // 4. Pending 2nd Treatment / Vaccine Follow-up & Blinking Alerts
    let alertFollowUps = [];
    let isMonitoring = false;
    let recentMedName = '';

    trs.forEach(t => {
      const fDate = t.follow_up_datetime || t.follow_date || t.next_due;
      if (fDate && hasActiveTreatmentReminder(t, s, fDate)) {
        const daysToFollow = Math.round((new Date(fDate) - new Date()) / 864e5);
        if (daysToFollow <= 1) {
          alertFollowUps.push({
            type: 'treatment',
            med: t.medicine || t.name || 'Treatment',
            date: fDate,
            label: daysToFollow < 0 ? `🚨 2ND DOSE OVERDUE: ${t.medicine || 'Injection'} (was due ${fmtDate(fDate)})` : (daysToFollow === 0 ? `⚠️ 2ND DOSE DUE TODAY: ${t.medicine || 'Injection'}` : `⏰ 2ND DOSE DUE TOMORROW: ${t.medicine || 'Injection'}`)
          });
        }
      }
      const tDate = t.date || t.created_at;
      if (tDate) {
        const tDays = realDays(tDate);
        if (tDays >= 0 && tDays <= 3) {
          isMonitoring = true;
          recentMedName = t.medicine || t.name || 'Medicine';
        }
      }
    });

    const sowVax = (F().vaccination_events || []).filter(v => v.target_type === 'sow' && (String(v.target_id).toLowerCase() === String(s.id).toLowerCase() || String(v.target_label || '').toLowerCase().includes(String(s.name).toLowerCase())));
    sowVax.forEach(v => {
      if (v.next_due) {
        const daysToVax = Math.round((new Date(v.next_due) - new Date()) / 864e5);
        if (daysToVax <= 1) {
          alertFollowUps.push({
            type: 'vaccine',
            med: v.vaccine,
            date: v.next_due,
            label: daysToVax < 0 ? `🚨 VACCINE BOOSTER OVERDUE: ${v.vaccine} (was due ${fmtDate(v.next_due)})` : (daysToVax === 0 ? `⚠️ VACCINE BOOSTER DUE TODAY: ${v.vaccine}` : `⏰ VACCINE BOOSTER DUE TOMORROW: ${v.vaccine}`)
          });
        }
      }
    });

    // 5. Visual Gestation / Lactation Progress
    let progressHtml = '';
    if (['GESTATING', 'PREGNANT', 'OVERDUE'].includes(st.label) && s.insemination) {
      const actual = realDays(s.insemination);
      const progressPct = Math.min(100, Math.round((actual / 114) * 100));
      const daysLeft = Math.max(0, 114 - actual);
      const dueDate = fmtDate(datePlus(s.insemination, 114));
      progressHtml = `
        <div style="margin:10px 0;background:rgba(0,0,0,0.25);padding:10px 12px;border-radius:10px;border:1px solid var(--line)">
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px">
            <span>🤰 Gestation Progress: <b>Day ${actual} of 114</b> (${progressPct}%)</span>
            <span style="color:var(--teal2);font-weight:700">${actual >= 114 ? '⚠️ DUE NOW' : daysLeft + 'd to farrowing'}</span>
          </div>
          <div class="progress-bar-wrap" style="height:8px;margin:6px 0">
            <div class="progress-bar-fill ${actual >= 109 ? 'gold' : ''}" style="width:${progressPct}%"></div>
          </div>
          <small class="muted" style="font-size:11px">Expected farrowing: <b>${dueDate}</b> · Day 16 check: ${fmtDate(datePlus(s.insemination, 16))}</small>
        </div>
      `;
    } else if (st.label === 'LACTATING') {
      const lactDays = realDays(s.farrowingDate || s.lactationStart || s.weanedAt || new Date().toISOString());
      const lactPct = Math.min(100, Math.round((lactDays / 30) * 100));
      progressHtml = `
        <div style="margin:10px 0;background:rgba(0,0,0,0.25);padding:10px 12px;border-radius:10px;border:1px solid var(--line)">
          <div style="display:flex;justify-content:space-between;align-items:center;font-size:12px">
            <span>🍼 Lactation Progress: <b>Day ${lactDays} of 30</b> (${lactPct}%)</span>
            <span style="color:#a78bfa;font-weight:700">${lactDays >= 28 ? '⚡ WEANING READY' : (30 - lactDays) + 'd to weaning'}</span>
          </div>
          <div class="progress-bar-wrap" style="height:8px;margin:6px 0">
            <div class="progress-bar-fill" style="background:#8b5cf6;width:${lactPct}%"></div>
          </div>
        </div>
      `;
    }

    let treatmentHtml = '<p class="muted">No treatments recorded.</p>';
    if (trs.length) {
      treatmentHtml = `<ul>${trs.slice(0, 3).map(t => `<li class="treatment-record" onclick="event.stopPropagation();openTreatmentActions('${t.id}')"><b>${esc(t.medicine || t.medicine_name || t.name || t.type || 'Treatment')}</b><span>${treatmentStamp(t)}${t.dosage_ml !== undefined ? ' · ' + t.dosage_ml + ' ml' : ''}</span></li>`).join('')}</ul>${trs.length > 3 ? `<button class="link-btn" onclick="event.stopPropagation();expandTreatments(this,'${s.id}')">+${trs.length - 3} More</button>` : ''}`;
    }

    let semen = (st.label === 'LACTATING') ? activeLitter(s) : (st.label === 'OPEN') ? productionHistory(s) : (breed ? '<div class="semen-summary"><b>💉 Semen: ' + (breed.boar_name || breed.boar || s.lastSemenBoarName || '—') + '</b><span>Batch: ' + (breed.semen_batch_no || '—') + ' · ' + farrowingDue(s) + '</span></div>' : '');

    return `
      <article data-sow-index="${index}" class="drill-sow ${st.cls}">
        <div class="drill-sow-top">
          <div>
            <h3>${esc(s.name)}</h3>
            <span class="status-pill ${st.cls}">${st.label}</span>
            <span class="parity-pill">P${s.parity || 0}</span>
            <span class="tag" style="margin-left:4px;font-size:11px;background:rgba(255,255,255,0.05)">🏠 ${esc(sowHousing.barnName)} · ${esc(sowHousing.penName)}</span>
          </div>
          <div class="drill-actions">
            ${actionButtons(s, st, index)}
            <button class="danger-btn" onclick="openCullModal(${index})" title="Cull sow (preserve historical records)">CULL</button>
            <button class="btn ghost delete-action" onclick="deleteRecord('sows',${index})" title="Permanently delete sow record" style="padding:6px 9px">🗑</button>
          </div>
        </div>

        <!-- [FIX 115] Registered sow photo (flows into the Pedigree Report) -->
        <div style="display:flex;align-items:center;gap:8px;margin-top:9px">
          ${s.photo ? `<img src="${s.photo}" alt="" style="width:46px;height:46px;border-radius:50%;object-fit:cover;border:2px solid var(--teal2)">` : `<span style="width:46px;height:46px;border-radius:50%;background:rgba(255,255,255,.07);display:inline-flex;align-items:center;justify-content:center;font-size:20px;filter:grayscale(1);opacity:.5">🐖</span>`}
          <button type="button" class="btn ghost small" onclick="event.stopPropagation();window.arsSowPhoto(${index})">📷 ${s.photo ? 'Change photo' : 'Add photo'}</button>
          ${s.photo ? `<button type="button" class="btn ghost small delete-action" onclick="event.stopPropagation();window.arsSowPhotoRemove(${index})" title="Remove photo" style="padding:6px 9px">🗑</button>` : ''}
        </div>

        <!-- Blinking 2nd Dose / Overdue Alert Banners -->
        ${alertFollowUps.map(a => `
          <div class="blinking-alert-banner">
            <span>${a.label}</span>
          </div>
        `).join('')}

        <!-- Monitoring Observation Badge -->
        ${isMonitoring ? `
          <div class="monitoring-alert-badge">
            <span>🩺 Observation Required: Treated with <b>${esc(recentMedName)}</b></span>
          </div>
        ` : ''}

        <!-- Quick 1-Tap Treatment, Vaccine & Movement Buttons -->
        <div class="sow-quick-actions">
          <button type="button" class="btn sow-quick-btn vax" onclick="event.stopPropagation();window.openQuickVaxForSow(${index})">💉 + Vaccine</button>
          <button type="button" class="btn sow-quick-btn treat" onclick="event.stopPropagation();openSowTreatmentModal(${index})">💊 + Treat</button>
          <button type="button" class="btn sow-quick-btn move" onclick="event.stopPropagation();window.openQuickMoveForSow(${index})">🚚 Move Stall</button>
          <button type="button" class="btn ghost small" onclick="event.stopPropagation();window.openQuickPedigreeForSow(${index})">🧬 Pedigree</button>
        </div>

        <!-- Sow Vitals Meta -->
        <div class="sow-meta" style="margin-top:10px">
          <span>🐾 ${esc(s.breed || 'Breed —')}</span>
          <span>🎂 Age: ${ageDetailed.summary}</span>
          <span>🏠 ${esc(sowHousing.zoneType)}: ${esc(sowHousing.penName)}</span>
          ${vaxLine('sow', s.id, s.name) ? `<span>💉 ${vaxLine('sow', s.id, s.name)}</span>` : ''}
        </div>

        <!-- 3-Generation Pedigree & Lineage Box -->
        <div class="sow-lineage-subcard">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <small style="color:var(--muted);font-weight:700;text-transform:uppercase;font-size:10.5px">🧬 Recorded Lineage (Sire &amp; Dam)</small>
            <button type="button" class="btn ghost mini" style="padding:2px 8px" onclick="event.stopPropagation();window.openQuickPedigreeForSow(${index})">View Tree →</button>
          </div>
          <div class="sow-lineage-grid">
            <div class="sow-lineage-col sire">
              <small>♂ SIRE (Father)</small>
              <b>${sireInfo.display}</b>
              <small>Grandsire: ${patGrandsireInfo.display} · Granddam: ${patGranddamInfo.display}</small>
            </div>
            <div class="sow-lineage-col dam">
              <small>♀ DAM (Mother)</small>
              <b>${damInfo.display}</b>
              <small>Grandsire: ${matGrandsireInfo.display} · Granddam: ${matGranddamInfo.display}</small>
            </div>
          </div>
        </div>

        <!-- Gestation / Lactation Lifecycle Progress Bar -->
        ${progressHtml}

        <div class="sow-state ${st.cls}">${st.detail}</div>
        ${heatSummary(s, st)}
        ${semen}

        <section class="treatment-box">
          <div>
            <b>💊 RECENT TREATMENTS</b>
            <button class="btn ghost" onclick="event.stopPropagation();openSowTreatmentModal(${index})">+ Add</button>
            <small>Last treated: ${trs[0] ? treatmentStamp(trs[0]) : 'No treatment record'}</small>
          </div>
          ${treatmentHtml}
        </section>
      </article>
    `;
  }

  function openQuickVaxForSow(index) {
    const f = (typeof F === 'function' && F()) ? F() : {};
    const s = (f.sows || [])[index];
    if (!s) return;
    const sId = s.id || s.name || `sow-${index}`;
    const sName = s.name || s.id || 'Sow';
    if (window.openRecordVaccination) {
      window.openRecordVaccination('sow', sId, sName);
    } else if (window.openVaxModal) {
      window.openVaxModal('sow', sId, sName);
    }
  }
  window.openQuickVaxForSow = openQuickVaxForSow;

  function openQuickMoveForSow(index) {
    const f = (typeof F === 'function' && F()) ? F() : {};
    const s = (f.sows || [])[index];
    if (!s) return;
    const sId = s.id || s.name || `sow-${index}`;
    if (window.openMovementWizard) {
      window.openMovementWizard(sId, 'sow');
    }
  }
  window.openQuickMoveForSow = openQuickMoveForSow;

  function openQuickPedigreeForSow(index) {
    const f = (typeof F === 'function' && F()) ? F() : {};
    const s = (f.sows || [])[index];
    if (!s) return;
    if (window.openPedigreeTreeModal) {
      window.openPedigreeTreeModal(s);
    } else if (window.openPedigreeTree) {
      window.openPedigreeTree(s);
    }
  }
  window.openQuickPedigreeForSow = openQuickPedigreeForSow;

  function openSowTreatmentModal(index) {
    const sow = F().sows[index];
    if (!sow) return;
    // Use the medicine-inventory treatment workflow so the sow treatment is
    // selected from stock, deducted in the correct unit, and written to the
    // shared recent-treatment history.
    if (window.openMedTreatment) {
      window.openMedTreatment('', 'sow', {
        ref: 'sow:' + (sow.id || sow.name),
        id: sow.id || sow.name,
        label: 'Sow · ' + (sow.name || sow.id)
      }, 1);
      return;
    }
    toast('Medicine inventory is still loading. Please try again.');
  }

  function saveSowTreatment(e, index) {
    e.preventDefault();
    const treatmentId = 'treat-' + Date.now(),
      reminderId = 'follow-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7),
      d = Object.fromEntries(new FormData(e.target)),
      sow = F().sows[index],
      t = {
        id: treatmentId,
        farm_id: farmId,
        sow_id: sow.id,
        sow_name: sow.name,
        medicine: d.medicine,
        dosage_ml: +d.dosage_ml,
        date: d.date,
        follow_up_datetime: d.follow_date || null,
        reminder_id: d.follow && d.follow_date ? reminderId : null
      };
    F().treatments = F().treatments || [];
    F().treatments.push(t);
    if (d.follow && d.follow_date) {
      F().reminders = F().reminders || [];
      F().reminders.push({
        id: reminderId,
        farm_id: farmId,
        title: `Follow-up Injection: ${d.medicine}`,
        description: `Sow: ${sow.name}`,
        reminder_type: 'one_time',
        next_trigger: new Date(d.follow_date).toISOString(),
        source_type: 'treatment',
        source_id: treatmentId,
        source_record_id: treatmentId,
        is_active: true,
        active: true
      })
    }
    save();
    document.getElementById('sowTreatmentModal').remove();
    renderAll();
    if (window.refreshOpenDrilldown) refreshOpenDrilldown();
    toast('Treatment saved')
  }

  function editSowTreatment(id) {
    let t = (F().treatments || []).find(x => x.id === id);
    if (!t) return;
    let med = prompt('Medicine name', t.medicine || t.medicine_name || ''),
      ml = prompt('ML injected', t.dosage_ml ?? '');
    if (med === null || ml === null) return;
    t.medicine = med;
    t.dosage_ml = +ml;
    t.updated_at = new Date().toISOString();
    save();
    renderAll();
    if (window.refreshOpenDrilldown) refreshOpenDrilldown()
  }

  function deleteSowTreatment(id) {
    if (!confirm('Delete this treatment record?')) return;
    F().treatments = (F().treatments || []).filter(x => x.id !== id);
    save();
    renderAll();
    if (window.refreshOpenDrilldown) refreshOpenDrilldown()
  }

  function openTreatmentActions(id) {
    let t = (F().treatments || []).find(x => x.id === id);
    if (!t) return;
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="treatAction"><div class="due-modal"><h2>Treatment Record</h2><p>${t.medicine||t.name||'Treatment'}</p><div class="due-actions"><button class="btn" onclick="editSowTreatment('${id}');document.getElementById('treatAction').remove()">✏️ Edit Treatment</button><button class="btn danger-btn" onclick="deleteSowTreatment('${id}');document.getElementById('treatAction').remove()">🗑 Delete Treatment</button><button class="btn ghost" onclick="document.getElementById('treatAction').remove()">Cancel</button></div></div></div>`)
  }

  /* [REBUILD FIX 16] Was never exported to window — the "+N More" button threw
     `expandTreatments is not defined` and did nothing on tap. It also expanded
     the FIRST card with a link instead of the clicked one; now scoped to the
     clicked card via the passed button element. */
  function expandTreatments(btn, sowId) {
    let card = btn ? btn.closest('.treatment-box') : [...document.querySelectorAll('.treatment-box')].find(x => x.querySelector('.link-btn'));
    if (!card) return;
    let sow = (F().sows || []).find(q => q.id === sowId),
      all = (F().treatments || []).filter(x => x.sow_id === sowId || x.sow_name === sow?.name);
    all.sort((a, b) => String(treatmentDate(b)).localeCompare(String(treatmentDate(a))));
    card.querySelector('ul').innerHTML = all.map(t => '<li class="treatment-record" onclick="event.stopPropagation();openTreatmentActions(\'' + t.id + '\')"><b>' + (t.medicine || t.name || 'Treatment') + '</b><span>' + treatmentStamp(t) + (t.dosage_ml !== undefined ? ' · ' + t.dosage_ml + ' ml' : '') + '</span></li>').join('');
    card.querySelector('.link-btn')?.remove()
  }

  function genericRow(kind, x, i) {
    /* [REBUILD FIX 19] Piglet batch rows open the full batch-details view
       (Batch health details format) instead of jumping straight into the
       management hub — hub is one more tap from inside the details. */
        if (kind === 'piglets') return window.pigletRowHTML ? pigletRowHTML(x) : `<button class="drill-row batch-drill-row drill-row-link" onclick="openBatchDetails('${x.id}')"><b>${x.id}</b><span>${x.dam_name||x.sow||'—'} → ${x.sire_name||x.sire||'—'}</span><small>${fmtAge(days(x.birth))} · ${(+x.males||0)+(+x.females||0)} heads · ${x.semen_batch_no||x.semen||''}</small><em class="drill-row-caret">›</em></button>`; /* FIX 30: live alert rows */
    if (kind === 'feed') {
      const fIndex = (F().feed || []).indexOf(x);
      const realIdx = fIndex >= 0 ? fIndex : i;
      const fType = x.type || x.feed_name || x.name || 'Feed Type';
      const bags = +x.bags || 0;
      const price = +x.price || 0;
      const totalVal = bags * price;
      return `
        <div class="drill-row" style="display:flex;justify-content:space-between;align-items:center;padding:12px 14px;gap:10px">
          <div style="flex:1">
            <b style="font-size:14.5px;color:var(--ink)">🌾 ${esc(fType)}</b>
            <span style="display:block;margin-top:2px;color:var(--teal2);font-weight:700">${bags} bag${bags === 1 ? '' : 's'} · ${peso(price)}/bag</span>
            <small class="muted" style="display:block;margin-top:1px">${peso(totalVal)} total inventory value</small>
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            <button type="button" class="btn ghost small" onclick="openModal('feed', ${realIdx})" title="Edit feed bags / price">✎ Edit</button>
            <button type="button" class="btn ghost small delete-action" onclick="deleteRecord('feed', ${realIdx})" title="Delete feed entry">🗑</button>
          </div>
        </div>
      `;
    }
    if (kind === 'semen') return `<button class="drill-row batch-drill-row drill-row-link" onclick="openSemenSell(${i})" title="Tap to sell this semen — POS sale modal"><b>${x.boar_name||x.boar}</b><span>${x.semen_batch_no||'Batch —'} · ${x.breed||''}</span><small>Collected ${fmtDate(x.collection_date||x.collection)} · Expires ${fmtDate(x.expiration_date||x.expiration)} · ${x.available_bottles??x.bottles??0} doses</small><em class="drill-row-caret">›</em></button>`; /* [REBUILD FIX 42] rows open the POS sale modal */
    if (kind === 'boars') {
      const realIndex = (F().boars || []).indexOf(x);
      const boarId = x.id || (x.code ? x.code : (x.name ? x.name : `boar-${realIndex >= 0 ? realIndex : i}`));
      if (!x.id) x.id = boarId;
      const _vx = vaxLine('boar', x.id, x.name);
      const _ag = window.calcAgeDetailed ? window.calcAgeDetailed(x.dob).summary : (window.boarAgeText ? boarAgeText(x.dob) : '');
      const sireLbl = window.resolveAnimalLabel ? window.resolveAnimalLabel(x.sire || x.sireRef || x.sire_name).name : (x.sire || x.sireRef || '—');
      const damLbl = window.resolveAnimalLabel ? window.resolveAnimalLabel(x.dam || x.damRef || x.dam_name).name : (x.dam || x.damRef || '—');
      return `<button type="button" class="drill-row batch-drill-row drill-row-link boar-drill-row" data-boar-id="${esc(boarId)}" data-boar-name="${esc(x.name || '')}" data-boar-index="${realIndex}" onclick="window.openBoarDetailModal(this.dataset.boarId || this.dataset.boarName || ${realIndex})" title="Tap to view full boar profile, lineage, collections, treatments &amp; pen details"><b>${esc(x.name)}</b><span>${esc(x.breed || '—')}</span><small>Sire: ${esc(sireLbl)} · Dam: ${esc(damLbl)}</small>${_ag && _ag !== '—' ? `<small>🎂 ${_ag}</small>` : ''}${_vx ? `<small>💉 ${_vx}</small>` : ''}<em class="drill-row-caret">›</em></button>`;
    }
    if (kind === 'reminders') return `<div class="drill-row"><b>${x.title}</b><span>${x.reminder_type||x.type}</span><small>Next: ${x.next_trigger?new Date(x.next_trigger).toLocaleString():(x.schedule||'—')}</small></div>`;
    return `<div class="drill-row"><b>${x.category||x.description||'Transaction'}</b><span>${x.type}</span><small>${peso(x.amount||0)} · ${fmtDate(x.date)}</small></div>`
  }

  function openWeanModal(index) {
    let sow = F().sows[index];
    if (sowState(sow).label !== 'LACTATING') {
      toast('Weaning is available only for an active lactating sow.');
      return
    }
    let batch = (F().piglets || []).filter(x => x.dam_id === sow.id || x.sow_id === sow.id || x.sow === sow.name).sort((a, b) => String(b.birth).localeCompare(String(a.birth)))[0];
    if (!batch) {
      document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="weanModal"><form class="due-modal sow-profile" onsubmit="saveWeaning(event,${index},'')"><div class="eyebrow">WEANING RECORD</div><h2>${sow.name}</h2><p class="muted">No linked batch was found. This will complete the sow lifecycle only; add/correct the litter record separately.</p><div class="field"><label>Weaning date *</label><input name="weanedAt" type="date" value="${(window.localToday ? window.localToday() : new Date().toISOString().slice(0,10))}" required></div><div class="due-actions" style="margin-top:17px"><button type="button" class="btn ghost" onclick="document.getElementById('weanModal').remove()">Cancel</button><button class="btn">Confirm weaning</button></div></form></div>`);
      return
    }
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="weanModal"><form class="due-modal sow-profile" onsubmit="saveWeaning(event,${index},'${batch.id}')"><div class="eyebrow">WEANING RECORD</div><h2>${sow.name}</h2><p class="muted">${batch.id} · ${batch.sire_name||batch.sire||'Sire not recorded'}</p><div class="reminder-fields"><div class="field"><label>Weaning date *</label><input name="weanedAt" type="date" value="${(window.localToday ? window.localToday() : new Date().toISOString().slice(0,10))}" required></div><div class="field"><label>Male count</label><input name="males" type="number" min="0" value="${batch.males||0}" required></div><div class="field"><label>Female count</label><input name="females" type="number" min="0" value="${batch.females||0}" required></div></div><div class="field" style="text-align:left;margin-top:10px"><label>Weaning notes / pre-weaning mortalities</label><textarea name="notes" placeholder="Optional mortality or weaning notes"></textarea></div><div class="notice" style="margin-top:12px">Saving updates the batch head count, marks it Weaned, and returns ${sow.name} to OPEN status.</div><div class="due-actions" style="margin-top:17px"><button type="button" class="btn ghost" onclick="document.getElementById('weanModal').remove()">Cancel</button><button class="btn">Confirm weaning</button></div></form></div>`)
  }

  function saveWeaning(e, index, batchId) {
    e.preventDefault();
    let d = Object.fromEntries(new FormData(e.target)),
      sow = F().sows[index],
      batch = (F().piglets || []).find(x => x.id === batchId);
    if (!batch) {
      sow.lactationEndedAt = d.weanedAt;
      sow.weanedAt = d.weanedAt;
      sow.lifecycle = 'Weaned';
      sow.status = 'Open';
      sow.activeLitterId = null;
      if (!sow.parityIncrementedAtWeaning) {
        sow.parity = (+sow.parity || 0) + 1;
        sow.parityIncrementedAtWeaning = true
      }
      save();
      document.getElementById('weanModal').remove();
      renderAll();
      if (window.refreshOpenDrilldown) refreshOpenDrilldown();
      toast('Weaning completed; sow is now Open.');
      return
    }
    let males = Math.max(0, +d.males || 0),
      females = Math.max(0, +d.females || 0),
      original = (+batch.males || 0) + (+batch.females || 0);
    if (sow.farrowingDate && d.weanedAt < sow.farrowingDate) {
      toast('Weaning date cannot be before the farrowing date.');
      return
    }
    if (males + females > original) {
      toast('Weaning count cannot exceed the recorded farrowed count.');
      return
    }
    batch.males = males;
    batch.females = females;
    /* [REBUILD] Book pre-weaning deaths and the born-alive litter size so the
       batch performance module (batch-performance.js) can compute the mortality
       rate and pre-weaning ADG context automatically. */
    if (original > males + females) batch.prewean_deaths = (+batch.prewean_deaths || 0) + (original - males - females);
    if (!batch.litter_size_born_alive) batch.litter_size_born_alive = original;
    batch.total_born = batch.males + batch.females;
    batch.weanedAt = d.weanedAt;
    batch.weaning_date = d.weanedAt;
    batch.weaning_notes = d.notes || '';
    batch.status = 'Weaned';
    batch.weaning = true;
    sow.lactationEndedAt = d.weanedAt;
    sow.weanedAt = d.weanedAt;
    sow.lifecycle = 'Weaned';
    sow.status = 'Open';
    sow.activeLitterId = null;
    sow.lastWeanedBatchId = batch.id;
    if (sow.lastParityIncrementBatchId !== batch.id) {
      sow.parity = (+sow.parity || 0) + 1;
      sow.lastParityIncrementBatchId = batch.id
    }
    sow.current_breeding_record_id = null;
    save();
    document.getElementById('weanModal').remove();
    renderAll();
    if (window.refreshOpenDrilldown) refreshOpenDrilldown();
    toast(`Weaning completed: ${batch.total_born} piglets`)
  }

  /* [REBUILD FIX 63] "Available Semen" quick-summary strip — rendered inside
     the Semen Inventory drill-down directly ABOVE the Search Records field.
     Lists ONLY records that have a valid collection date AND more than 0
     bottles left (quantity remaining is the source of truth — doses are
     untouched), computed live from F().semen so it is strictly farm-scoped
     and recomputed on every drill refresh / add / edit / sale / restock.
     Days-passed is derived from today's date, never stored. Each compact,
     colour-keyed card taps into the SAME POS record modal the list rows
     open — no duplicate records. */
  function semenAvailHTML() {
    const rows = (F().semen || []).map((x, i) => ({ x, i })).filter(({ x }) => {
      const cd = x.collection_date || x.collection;
      if (!cd || !isFinite(new Date(String(cd) + 'T00:00:00'))) return false;
      return +(x.available_bottles ?? x.bottles ?? 0) > 0;
    });
    const HUES = ['teal', 'sky', 'amber', 'plum', 'mint'];
    const cards = rows.map(({ x, i }, k) => {
      const cd = x.collection_date || x.collection,
        left = +(x.available_bottles ?? x.bottles ?? 0),
        n = realDays(cd),
        passed = n === 0 ? 'Collected today' : n === 1 ? '1 day passed' : n + ' days passed',
        bottles = left === 1 ? 'bottle left' : 'bottles left';
      return `<button type="button" class="sem-avail-card hue-${HUES[k % HUES.length]}" onclick="openSemenSell(${i})" title="Tap to sell / view this semen record"><span class="sac-top"><span class="sac-ico">🐷</span><span class="sac-id"><b>${x.boar_name || x.boar || 'Semen'}</b><small>${x.breed || 'Breed —'}</small></span><em class="drill-row-caret">›</em></span><span class="sac-line"><span>📅</span><span class="sac-when"><small>Collected</small>${fmtDate(cd)}</span></span><span class="sac-days">◷ ${passed}</span><span class="sac-rule"></span><span class="sac-bottles">🧪 <b>${left}</b><small>${bottles}</small></span></button>`;
    }).join('');
    return `<section class="sem-avail" id="semAvail"><div class="sem-avail-head"><div class="eyebrow sac-title">Available Semen</div><p class="muted">Currently available bottles</p></div>${rows.length ? `<div class="sem-avail-strip">${cards}</div>` : `<div class="sem-avail-empty"><b>No available semen</b><span>Add semen with a collection date and available bottles to see it here.</span></div>`}</section>`;
  }

  let isSemenHistoryExpanded = false;

  window.toggleSemenHistoryCollapse = function() {
    isSemenHistoryExpanded = !isSemenHistoryExpanded;
    const box = document.getElementById('olderSemenHistory');
    const btn = document.getElementById('btnToggleSemenHistory');
    if (!box || !btn) return;
    if (isSemenHistoryExpanded) {
      box.style.display = 'flex';
      box.style.flexDirection = 'column';
      box.style.gap = '8px';
      btn.innerHTML = '▲ Collapse older collection history';
    } else {
      box.style.display = 'none';
      const count = box.querySelectorAll('.drill-row').length;
      btn.innerHTML = `▼ Show ${count} older collection batches…`;
    }
  };

  function semenHistoryHTML(data) {
    if (!data || !data.length) return '';
    isSemenHistoryExpanded = false;

    // Index so the click handlers always map accurately to original item index in F().semen
    const rawSemen = F().semen || [];
    const indexed = data.map(item => ({ item, originalIdx: rawSemen.indexOf(item) }));

    if (indexed.length <= 3) {
      return `<div class="recent-semen-history" style="display:flex;flex-direction:column;gap:8px">${indexed.map(x => genericRow('semen', x.item, x.originalIdx >= 0 ? x.originalIdx : 0)).join('')}</div>`;
    }

    const recent = indexed.slice(0, 3);
    const older = indexed.slice(3);

    return `
      <div class="recent-semen-history" style="display:flex;flex-direction:column;gap:8px">
        ${recent.map(x => genericRow('semen', x.item, x.originalIdx >= 0 ? x.originalIdx : 0)).join('')}
      </div>
      <button type="button" class="btn ghost" id="btnToggleSemenHistory" onclick="window.toggleSemenHistoryCollapse()" style="width:100%;margin:10px 0 6px 0;padding:12px 14px;font-weight:750;background:rgba(13,141,145,0.09);color:var(--teal2);border:1.5px dashed var(--teal);border-radius:10px;display:flex;align-items:center;justify-content:center;gap:8px;cursor:pointer">
        ▼ Show ${older.length} older collection batches…
      </button>
      <div id="olderSemenHistory" style="display:none;flex-direction:column;gap:8px">
        ${older.map(x => genericRow('semen', x.item, x.originalIdx >= 0 ? x.originalIdx : 0)).join('')}
      </div>
    `;
  }

  function openDrilldown(kind) {
    let data = items(kind);
    let isSowList = ['sows', 'pregnant', 'lactating', 'dueweek'].includes(kind);
    currentSowFilter = 'all';

    document.body.insertAdjacentHTML('beforeend', `<div class="drill-bg" id="drillModal"><div class="drill-panel">
      <div class="drill-header">
        <div>
          <div class="eyebrow">FARM-SCOPED DRILL-DOWN</div>
          <h2>${title(kind)}</h2>
          <p>${data.length} records found</p>
        </div>
        <div>
          ${kind === 'sows' ? `<button type="button" class="btn ghost" onclick="cleanTestRecordsAction()" title="Clean all duplicate test records" style="margin-right:6px">🧹 Clean Test Data</button>` : ''}
          ${kind === 'semen' ? `<button type="button" class="btn ghost" onclick="window.openSemenResellerHub && window.openSemenResellerHub()" style="background:#0ea5e9;color:#fff;font-weight:800;margin-right:6px">👥 Resellers</button>` : ''}
          <button class="btn" onclick="drillQuickAdd('${kind}')">${['sows','dueweek'].includes(kind)?'+ Add Sow':kind==='feed'?'+ Add Feed':kind==='boars'?'+ Add Boar':'Quick action'}</button>
          ${kind==='feed' && window.feedOrdersBtn ? feedOrdersBtn() : ''}
          ${kind==='feed' && window.feedMovementsBtn ? feedMovementsBtn() : ''}
          <button class="close-reminder" onclick="closeDrilldown()">×</button>
        </div>
      </div>

      <!-- Quick Summary Count Ribbon for Sows -->
      ${isSowList ? sowCountSummaryHTML('all') : ''}
      ${kind === 'semen' ? semenAvailHTML() : ''}

      <div class="drill-controls">
        <input class="search" placeholder="${isSowList ? 'Search sow name, ID or ear tag' : 'Search records'}" oninput="filterDrilldown(this.value)">
        <select class="select" onchange="sortDrilldown('${kind}',this.value)">
          ${kind==='pregnant'?'<option value="range90" selected>Next 90 days</option><option value="range7">Next 7 days</option><option value="range14">Next 14 days</option><option value="range60">Next 60 days</option><option value="range30">Next 30 days</option>':(kind==='sows'||kind==='lactating'||kind==='dueweek')?'<option value="name">Alphabetical A–Z</option><option value="nearFarrow">Near to Farrow</option><option value="check16">16th Day Check</option><option value="check21">21st Day Check</option>':kind==='semen'?'<option value="recent" selected>Sort: Most recent</option><option value="name">Sort: Boar Name</option><option value="status">Sort: Available In-Stock</option>':'<option value="name">Sort: Name</option><option value="status">Sort: Status / priority</option>'}
        </select>
      </div>

      <div id="drillList">
        ${(isSowList ? data.map((x,i)=>sowCard(x,(F().sows||[]).indexOf(x))).join('') : (kind === 'semen' ? semenHistoryHTML(data) : data.map((x,i)=>genericRow(kind,x,i)).join(''))) || '<div class="empty">No records found in this farm.</div>'}
      </div>
    </div></div>`);

    if (kind === 'pregnant') setTimeout(() => sortDrilldown('pregnant', 'range90'), 0);
  }

  function refreshOpenDrilldown() {
    let modal = document.getElementById('drillModal');
    if (!modal) return;
    let heading = modal.querySelector('h2')?.textContent || '',
      kind = heading.includes('Total Sows') ? 'sows' : heading.includes('Pregnant') ? 'pregnant' : heading.includes('Lactating') ? 'lactating' : heading.includes('Boars') ? 'boars' : heading.includes('Piglet') ? 'piglets' : heading.includes('Feed') ? 'feed' : heading.includes('Semen') ? 'semen' : heading.includes('Reminder') ? 'reminders' : heading.includes('Financial') ? 'sales' : null;
    if (kind) {
      modal.remove();
      openDrilldown(kind)
    }
  }

  function closeDrilldown() {
    document.getElementById('drillModal')?.remove()
  }

  function filterDrilldown(q) {
    q = (q || '').toLowerCase();
    const olderBox = document.getElementById('olderSemenHistory');
    const toggleBtn = document.getElementById('btnToggleSemenHistory');
    if (q && olderBox) {
      olderBox.style.display = 'flex';
      olderBox.style.flexDirection = 'column';
      olderBox.style.gap = '8px';
      if (toggleBtn) toggleBtn.style.display = 'none';
    } else if (!q && olderBox) {
      olderBox.style.display = isSemenHistoryExpanded ? 'flex' : 'none';
      if (isSemenHistoryExpanded) {
        olderBox.style.flexDirection = 'column';
        olderBox.style.gap = '8px';
      }
      if (toggleBtn) {
        toggleBtn.style.display = 'flex';
        const count = olderBox.querySelectorAll('.drill-row').length;
        toggleBtn.innerHTML = isSemenHistoryExpanded ? '▲ Collapse older collection history' : `▼ Show ${count} older collection batches…`;
      }
    }
    document.querySelectorAll('#drillList .drill-sow,#drillList .drill-row').forEach(x => {
      // Sow searches use identity fields only. The rendered dossier contains
      // sire/dam/lineage/treatment text, so searching textContent made a query
      // for "Siete" return Rayka merely because Siete was Rayka's dam.
      const sowIndex = x.classList.contains('drill-sow') ? Number(x.dataset.sowIndex) : -1;
      const sow = sowIndex >= 0 ? F().sows?.[sowIndex] : null;
      const identity = sow
        ? [sow.name, sow.id, sow.tag, sow.tag_no, sow.ear_tag, sow.eid, sow.breed, sow.customBreed, sow.status, sow.lifecycle].filter(Boolean).join(' ').toLowerCase()
        : x.textContent.toLowerCase();
      x.style.display = identity.includes(q) ? '' : 'none';
    })
  }

  function sortDrilldown(kind, by) {
    let list = document.getElementById('drillList');
    if (!list) return;
    if (kind === 'semen') {
      let data = [...items('semen')];
      if (by === 'name') {
        data.sort((a, b) => String(a.boar_name || a.boar || '').localeCompare(String(b.boar_name || b.boar || '')));
      } else if (by === 'status') {
        data.sort((a, b) => (+(b.available_bottles ?? b.bottles ?? 0) > 0) - (+(a.available_bottles ?? a.bottles ?? 0) > 0));
      } else {
        data.sort((a, b) => String(b.collection_date || b.collection || '').localeCompare(String(a.collection_date || a.collection || '')));
      }
      list.innerHTML = semenHistoryHTML(data) || '<div class="empty">No records found in this farm.</div>';
      return;
    }
    let cards = [...list.children];
    if (['sows', 'pregnant', 'lactating', 'dueweek'].includes(kind)) {
      let getSow = card => F().sows?.[+card.dataset.sowIndex],
        milestone = sow => {
          if (!sow?.insemination) return Number.POSITIVE_INFINITY;
          let d = realDays(sow.insemination);
          if (by === 'nearFarrow') return Math.abs(114 - d);
          if (by === 'check16') return Math.abs(16 - d);
          if (by === 'check21') return Math.abs(21 - d);
          return 0
        };
      if (kind === 'pregnant' && by.startsWith('range')) {
        let horizon = +by.replace('range', '');
        cards.forEach(card => {
          let sow = getSow(card),
            daysToDue = sow?.insemination ? 114 - realDays(sow.insemination) : 999;
          card.style.display = daysToDue <= horizon ? '' : 'none'
        });
        cards.sort((a, b) => {
          let da = 114 - realDays(getSow(a).insemination),
            db = 114 - realDays(getSow(b).insemination);
          return Math.abs(da) - Math.abs(db) || da - db
        })
      } else cards.sort((a, b) => {
        let sa = getSow(a),
          sb = getSow(b);
        if (by === 'recent') return String(sb?.updatedAt || sb?.lastActivity || sb?.insemination || '').localeCompare(String(sa?.updatedAt || sa?.lastActivity || sa?.insemination || ''));
        if (['nearFarrow', 'check16', 'check21'].includes(by)) {
          let ma = milestone(sa),
            mb = milestone(sb);
          return ma - mb || String(sa?.name).localeCompare(String(sb?.name))
        }
        return String(sa?.name).localeCompare(String(sb?.name))
      })
    } else cards.sort((a, b) => by === 'status' ? (b.classList.contains('overdue') - a.classList.contains('overdue')) : a.textContent.localeCompare(b.textContent));
    cards.forEach(x => list.appendChild(x))
  }

  function drillQuickAdd(kind) {
    if (kind === 'pregnant') {
      openPregnantSowsReportModal();
    } else if (kind === 'sows' || kind === 'dueweek') {
      closeDrilldown();
      openModal('sows');
    } else if (kind === 'feed') {
      closeDrilldown();
      openModal('feed');
    } else if (kind === 'boars') {
      closeDrilldown();
      openBoarProfile();
    } else if (kind === 'semen') {
      openSemenStockMenu();
    } else if (kind === 'piglets') {
      if (window.openPigletQuickMenu) openPigletQuickMenu(); else toast('Use the relevant management page for this action.');
    } else toast('Use the relevant management page for this action.');
  }

  /* ═══════════════════════════════════════════════════════════════════════════
     PREGNANT SOWS PDF REPORT & PRINTABLE GESTATION SCHEDULE
     ═══════════════════════════════════════════════════════════════════════════ */
  function openPregnantSowsReportModal() {
    const f = (typeof F === 'function' && F()) ? F() : {};
    const allPregnant = (f.sows || []).filter(x => ['PREGNANT', 'GESTATING', 'OVERDUE'].includes(sowState(x).label));

    if (!allPregnant.length) {
      toast('No pregnant sows currently recorded on this farm.');
      return;
    }

    // Sort with overdue & nearest to farrowing first
    const list = allPregnant.slice().sort((a, b) => {
      const da = 114 - realDays(a.insemination);
      const db = 114 - realDays(b.insemination);
      return Math.abs(da) - Math.abs(db) || da - db;
    });

    const boarsList = f.boars || [];
    const semenList = f.semen || [];
    const barnsList = f.barns || [];
    const breedsRecords = f.breedingRecords || [];

    function resolveSemenAndBreed(s) {
      const breedRec = breedsRecords.filter(x => (x.sow_id === s.id || x.sow_name === s.name) && !x.deleted_at).sort((a, b) => String(b.insemination_date).localeCompare(String(a.insemination_date)))[0];
      
      let semenName = breedRec?.boar_name || breedRec?.boar || s.lastSemenBoarName || s.semen || s.sire || '—';
      let semenBreed = breedRec?.boar_breed || breedRec?.breed || s.semenBreed || s.sireBreed || '';

      if (!semenBreed || semenBreed === '—') {
        const bHit = boarsList.find(b => b.name === semenName || b.id === semenName || b.code === semenName);
        if (bHit && bHit.breed) semenBreed = bHit.breed;
      }
      if (!semenBreed || semenBreed === '—') {
        const sHit = semenList.find(sm => sm.boar === semenName || sm.id === semenName || sm.code === semenName);
        if (sHit && sHit.breed) semenBreed = sHit.breed;
      }
      if (!semenBreed) {
        if (semenName.includes('German') || semenName.includes('Katakuri')) semenBreed = 'German Pietrain';
        else if (semenName.includes('Cobra') || semenName.includes('Dumpty')) semenBreed = 'Cobra Pietrain';
        else if (semenName.includes('Hamruc')) semenBreed = 'Hamruc';
        else if (semenName.includes('Landrace') || semenName.includes('Atlas')) semenBreed = 'Landrace';
        else if (semenName.includes('Duroc') || semenName.includes('Thor')) semenBreed = 'Duroc';
        else if (semenName.includes('Yorkshire') || semenName.includes('Apollo')) semenBreed = 'Yorkshire';
        else if (semenName.includes('Large White')) semenBreed = 'Large White';
        else semenBreed = 'Purebred / Crossbred';
      }

      return { semenName, semenBreed };
    }

    function resolveHousing(s) {
      let barnName = 'Unassigned';
      let penName = '—';
      barnsList.forEach(b => {
        (b.pens || []).forEach(p => {
          const occ = String(p.occupant_id || '').toLowerCase();
          if (occ && (occ === String(s.id).toLowerCase() || occ === String(s.name).toLowerCase())) {
            barnName = b.name || 'Barn';
            penName = p.name || ('Pen ' + p.pen_number);
          }
        });
      });
      return { barnName, penName };
    }

    const now = new Date();
    const dateGen = now.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) + ' · ' + now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit' });
    const dueIn7 = list.filter(s => { const d = 114 - realDays(s.insemination); return d >= 0 && d <= 7; }).length;
    const dueIn30 = list.filter(s => { const d = 114 - realDays(s.insemination); return d >= 0 && d <= 30; }).length;
    const overdueCount = list.filter(s => realDays(s.insemination) > 114).length;

    const farmLogo = f.logo || f.logo_url || (window.STORE && STORE.getItem('ars-farm-logo-' + farmId)) || 'assets/arswinetech-logo.png';
    const farmName = f.name || "RM's Hog Farm";

    const modalHtml = `
      <div class="due-modal-bg open" id="pregnantReportModal" style="z-index:99999" onclick="if(event.target===this)this.remove()">
        <div class="due-modal pregnant-report-dialog" style="max-width:1180px;width:96%;max-height:92vh;overflow-y:auto;background:var(--card);color:var(--ink);border:1px solid var(--line);border-radius:14px;padding:18px;box-shadow:0 25px 80px rgba(0,0,0,0.45)">
          
          <!-- Action Toolbar -->
          <div class="no-print" style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;border-bottom:1px solid var(--line);padding-bottom:10px">
            <div style="display:flex;align-items:center;gap:8px">
              <span style="font-size:20px">📄</span>
              <div>
                <b style="font-size:15px;color:#4dd3c7">Pregnant Sows Report</b>
                <small class="muted" style="display:block">Printable official gestation ledger & due date schedule</small>
              </div>
            </div>
            <div style="display:flex;gap:8px;align-items:center">
              <button type="button" class="btn" onclick="window.print()" style="background:linear-gradient(135deg,#13b9ad,#07988f);color:#fff;display:flex;align-items:center;gap:6px;font-weight:750">
                🖨 Print / Save as PDF
              </button>
              <button type="button" class="btn ghost" onclick="window.exportPregnantSowsCSV()" style="font-weight:700">
                📥 Export CSV
              </button>
              <button type="button" class="close-reminder" onclick="document.getElementById('pregnantReportModal').remove()" style="margin-left:8px;font-size:22px;background:none;color:var(--muted);cursor:pointer">×</button>
            </div>
          </div>

          <!-- Printable Document Body -->
          <div class="pregnant-pdf-doc" id="pregnantPrintArea">
            <!-- Document Header -->
            <div class="pdf-header" style="display:flex;justify-content:space-between;align-items:center;border-bottom:2px solid #13b9ad;padding-bottom:8px;margin-bottom:10px">
              <div style="display:flex;align-items:center;gap:10px">
                <img src="${esc(farmLogo)}" alt="Farm Logo" style="height:44px;max-width:110px;object-fit:contain;border-radius:6px">
                <div>
                  <h1 style="margin:0;font-size:18px;color:var(--ink);letter-spacing:-0.3px">${esc(farmName)}</h1>
                  <h3 style="margin:2px 0 0 0;font-size:11.5px;color:#13b9ad;text-transform:uppercase;letter-spacing:0.8px;font-weight:800">Pregnant Sows Gestation & Due Date Report</h3>
                </div>
              </div>
              <div style="text-align:right;font-size:11.5px;color:var(--muted)">
                <div><b>Generated:</b> ${esc(dateGen)}</div>
                <div style="margin-top:2px"><b>Active Gestation:</b> <span class="tag" style="background:#13b9ad;color:#fff;font-weight:800;padding:2px 6px">${list.length} SOWS</span></div>
              </div>
            </div>

            <!-- Summary KPI Strip -->
            <div class="pdf-kpi-grid" style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:10px">
              <div style="background:rgba(19,185,173,0.08);border:1px solid rgba(19,185,173,0.25);border-radius:8px;padding:6px 8px;text-align:center">
                <small class="muted" style="font-size:10px">TOTAL PREGNANT</small>
                <b style="font-size:16px;display:block;color:#13b9ad;line-height:1.2">${list.length}</b>
              </div>
              <div style="background:rgba(240,182,75,0.08);border:1px solid rgba(240,182,75,0.25);border-radius:8px;padding:6px 8px;text-align:center">
                <small class="muted" style="font-size:10px">DUE IN NEXT 7 DAYS</small>
                <b style="font-size:16px;display:block;color:#f0b64b;line-height:1.2">${dueIn7}</b>
              </div>
              <div style="background:rgba(56,137,109,0.08);border:1px solid rgba(56,137,109,0.25);border-radius:8px;padding:6px 8px;text-align:center">
                <small class="muted" style="font-size:10px">DUE IN NEXT 30 DAYS</small>
                <b style="font-size:16px;display:block;color:#57d48d;line-height:1.2">${dueIn30}</b>
              </div>
              <div style="background:rgba(255,92,104,0.08);border:1px solid rgba(255,92,104,0.25);border-radius:8px;padding:6px 8px;text-align:center">
                <small class="muted" style="font-size:10px">OVERDUE (>114d)</small>
                <b style="font-size:16px;display:block;color:#ff5c68;line-height:1.2">${overdueCount}</b>
              </div>
            </div>

            <!-- Printable Table -->
            <div class="panel table-wrap" style="border:1px solid var(--line);border-radius:10px;overflow-x:auto">
              <table class="table pregnant-report-table" style="width:100%;border-collapse:collapse;font-size:11px;text-align:left">
                <thead>
                  <tr style="background:#0e2024;color:#85a19f;border-bottom:1.5px solid var(--line)">
                    <th style="padding:6px 6px;width:28px">#</th>
                    <th style="padding:6px 6px">Sow ID & Name</th>
                    <th style="padding:6px 6px">Sow Breed</th>
                    <th style="padding:6px 6px">Parity</th>
                    <th style="padding:6px 6px">Date Inseminated</th>
                    <th style="padding:6px 6px">Estimated Due Date</th>
                    <th style="padding:6px 6px">Gestation Progress</th>
                    <th style="padding:6px 6px">Semen / Boar Used</th>
                    <th style="padding:6px 6px">Semen Breed Used</th>
                    <th style="padding:6px 6px">Stall / Location</th>
                    <th style="padding:6px 6px;text-align:center">Status</th>
                  </tr>
                </thead>
                <tbody>
                  ${list.map((s, i) => {
                    const actual = realDays(s.insemination);
                    const progressPct = Math.min(100, Math.round((actual / 114) * 100));
                    const daysLeft = 114 - actual;
                    const isOverdue = actual > 114;
                    const isNearDue = daysLeft >= 0 && daysLeft <= 7;
                    const dueDate = fmtDate(datePlus(s.insemination, 114));
                    const insemDate = fmtDate(s.insemination);
                    const { semenName, semenBreed } = resolveSemenAndBreed(s);
                    const { barnName, penName } = resolveHousing(s);

                    return `
                      <tr style="border-bottom:1px solid var(--line);${isOverdue ? 'background:rgba(255,92,104,0.06);' : (isNearDue ? 'background:rgba(240,182,75,0.04);' : '')}">
                        <td style="padding:5px 6px;color:var(--muted)">${i + 1}</td>
                        <td style="padding:5px 6px">
                          <b>${esc(s.name || s.id)}</b>
                          ${s.id && s.id !== s.name ? `<small class="muted" style="margin-left:4px">(${esc(s.id)})</small>` : ''}
                        </td>
                        <td style="padding:5px 6px"><span class="tag" style="background:#0f2c31;color:#5ee2d6;padding:1px 5px;font-size:10px">${esc(s.breed || s.customBreed || 'Landrace')}</span></td>
                        <td style="padding:5px 6px"><b>P${s.parity || 0}</b></td>
                        <td style="padding:5px 6px;white-space:nowrap">${esc(insemDate)}</td>
                        <td style="padding:5px 6px;white-space:nowrap"><b style="color:${isOverdue ? '#ff5c68' : (isNearDue ? '#f0b64b' : 'var(--ink)')}">${esc(dueDate)}</b></td>
                        <td style="padding:5px 6px;white-space:nowrap">
                          <b>Day ${actual}/114</b>
                          <small style="color:${isOverdue ? '#ff5c68' : (isNearDue ? '#f0b64b' : 'var(--teal2)')};font-weight:600;margin-left:3px">
                            (${isOverdue ? `${actual - 114}d over` : (daysLeft === 0 ? 'Due Today' : `${daysLeft}d left`)})
                          </small>
                        </td>
                        <td style="padding:5px 6px"><b>${esc(semenName)}</b></td>
                        <td style="padding:5px 6px"><span class="tag" style="background:#14343a;color:#6ee4d9;padding:1px 5px;font-size:10px">${esc(semenBreed)}</span></td>
                        <td style="padding:5px 6px;font-size:10.5px;color:var(--muted)">${esc(barnName)} · ${esc(penName)}</td>
                        <td style="padding:5px 6px;text-align:center">
                          <span class="tag ${isOverdue ? 'danger' : (isNearDue ? 'warn' : '')}" style="font-size:9.5px;padding:1px 5px">
                            ${isOverdue ? 'OVERDUE' : (isNearDue ? 'DUE SOON' : 'PREGNANT')}
                          </span>
                        </td>
                      </tr>
                    `;
                  }).join('')}
                </tbody>
              </table>
            </div>

            <!-- Document Footer & Signature Area -->
            <div class="pdf-footer" style="display:flex;justify-content:space-between;align-items:flex-end;margin-top:14px;padding-top:10px;border-top:1px solid var(--line);font-size:11px;color:var(--muted)">
              <div>
                <p style="margin:0"><b>ARSwineTech Pro</b> · Swine Herd Management Platform</p>
                <small>Accurate gestation calculation based on standard 114-day swine reproductive cycle.</small>
              </div>
              <div style="text-align:center;width:200px">
                <div style="border-bottom:1px solid var(--muted);height:28px;margin-bottom:4px"></div>
                <span>Farm Manager / Herdsperson</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    `;

    document.querySelectorAll('#pregnantReportModal').forEach(m => m.remove());
    document.body.insertAdjacentHTML('beforeend', modalHtml);

    window.exportPregnantSowsCSV = function() {
      const headers = ['#', 'Sow Name', 'Sow ID', 'Sow Breed', 'Parity', 'Date Inseminated', 'Estimated Due Date', 'Gestation Days', 'Days Left', 'Semen Used', 'Semen Breed Used', 'Barn / Stall', 'Status'];
      const rows = list.map((s, i) => {
        const actual = realDays(s.insemination);
        const daysLeft = 114 - actual;
        const dueDate = fmtDate(datePlus(s.insemination, 114));
        const insemDate = fmtDate(s.insemination);
        const { semenName, semenBreed } = resolveSemenAndBreed(s);
        const { barnName, penName } = resolveHousing(s);
        const st = actual > 114 ? 'OVERDUE' : (daysLeft <= 7 ? 'DUE SOON' : 'PREGNANT');

        return [
          i + 1,
          `"${String(s.name || '').replace(/"/g, '""')}"`,
          `"${String(s.id || '').replace(/"/g, '""')}"`,
          `"${String(s.breed || s.customBreed || '').replace(/"/g, '""')}"`,
          s.parity || 0,
          `"${insemDate}"`,
          `"${dueDate}"`,
          actual,
          daysLeft,
          `"${String(semenName).replace(/"/g, '""')}"`,
          `"${String(semenBreed).replace(/"/g, '""')}"`,
          `"${String(barnName + ' ' + penName).replace(/"/g, '""')}"`,
          `"${st}"`
        ];
      });

      const csvContent = '\uFEFF' + [headers.join(','), ...rows.map(r => r.join(','))].join('\n');
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.setAttribute('href', url);
      link.setAttribute('download', `pregnant-sows-report-${new Date().toISOString().slice(0, 10)}.csv`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    };
  }
  window.openPregnantSowsReportModal = openPregnantSowsReportModal;

  function showAllTreatments(sowId) {
    let t = (F().treatments || []).filter(x => x.sow_id === sowId).map(x => `${x.medicine||x.name||x.type||'Treatment'} · ${fmtDate(x.date)} · ${x.administrator||''}`).join('\n');
    alert(t || 'No treatment history')
  }

  function decorate() {
    let root = document.getElementById('dashboard');
    if (!root) return;
    let map = [
      ['Total Sows', 'sows'],
      ['Pregnant Sows', 'pregnant'],
      ['Lactating Sows', 'lactating'],
      ['Boars', 'boars'],
      ['Piglets', 'piglets'],
      ['Feed', 'feed'],
      ['Semen', 'semen'],
      ['Gross Sales', 'sales'],
      ['Actual Collected', 'sales'],
      ['Outstanding', 'sales'],
      ['Net Profit', 'sales'],
      ['Active reminders', 'reminders'],
      ['Sows Due This Week', 'dueweek']
    ];
    root.querySelectorAll('.stat,.glance,.attention-item').forEach(card => {
      let text = card.textContent;
      let found = map.find(([label]) => text.includes(label));
      if (found && !card.dataset.drill) {
        card.dataset.drill = found[1];
        card.classList.add('drill-card');
        card.tabIndex = 0;
        card.onclick = () => openDrilldown(found[1]);
        card.onkeydown = e => {
          if (e.key === 'Enter') openDrilldown(found[1])
        }
      }
    });
    root.querySelector('.table-wrap')?.classList.add('watchlist-click');
    root.querySelector('.table-wrap')?.addEventListener('click', () => openDrilldown('pregnant'), {
      once: true
    })
  }

  function cancelHeat(index) {
    let sow = F().sows[index];
    if (!sow) return;
    sow.lastHeatDate = null;
    save();
    renderAll();
    toast('Heat status cancelled')
  }
  window.toggleProductionHistory = toggleProductionHistory;
  window.openSowTreatmentModal = openSowTreatmentModal;
  /* [REBUILD FIX 16] these were only clickable from rendered lists but were
     never exported — every tap silently failed. */
  window.expandTreatments = expandTreatments;
  window.openTreatmentActions = openTreatmentActions;
  window.editSowTreatment = editSowTreatment;
  window.deleteSowTreatment = deleteSowTreatment;
  window.saveSowTreatment = saveSowTreatment;
  window.openWeanModal = openWeanModal;
  window.saveWeaning = saveWeaning;
  window.cancelHeat = cancelHeat;
  window.refreshOpenDrilldown = refreshOpenDrilldown;
  window.decorateDashboard = decorate;
  window.openDrilldown = openDrilldown;
  window.closeDrilldown = closeDrilldown;
  window.filterDrilldown = filterDrilldown;
  window.sortDrilldown = sortDrilldown;
  window.drillQuickAdd = drillQuickAdd;
  window.showAllTreatments = showAllTreatments;
  const old = window.renderAll;
  window.renderAll = function() {
    (typeof old === 'function' && old());
    setTimeout(decorate, 0)
  };
  setTimeout(() => {
    decorate()
  }, 140);
})();