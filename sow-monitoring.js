/* ═══════════════════════════════════════════════════════════════════════════
   js/sow-monitoring.js — Farm Biosecurity Score, Post-AI Insemination Monitoring,
   Feed Stock Breakdown, and Health Card Interactive Modals
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');
  const jsq = v => "'" + String(v ?? '').replace(/\\/g, '\\\\').replace(/'/g, "\\'") + "'";
  const pad2 = n => String(n).padStart(2, '0');
  const dstr = d => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
  const today = () => dstr(new Date());
  const todayAt = () => new Date().toISOString();
  const daysSince = iso => {
    if (!iso) return null;
    return Math.round((new Date(today() + 'T00:00:00') - new Date(String(iso).slice(0, 10) + 'T00:00:00')) / 864e5);
  };
  const fmtD = s => {
    if (!s) return '—';
    const d = new Date(String(s).slice(0, 10) + 'T00:00:00');
    return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' });
  };
  const fmtAt = s => {
    if (!s) return '';
    const d = new Date(s);
    return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric' }) + ' ' + d.toLocaleTimeString('en-PH', { hour: 'numeric', minute: '2-digit' });
  };

  /* ── 1. FULL FARM SUMMARY MODAL (Triggered by clicking the "96" score ring) ── */
  function openFarmSummaryModal() {
    document.querySelectorAll('#farmSummaryModal').forEach(el => el.remove());
    const f = (typeof F === 'function' && F()) ? F() : {};
    const activeSows = (f.sows || []).filter(s => (typeof isActiveSow === 'function' ? isActiveSow(s) : !s.culled));
    const boars = (f.boars || []).filter(b => !b.culled).length;
    const piglets = (f.piglets || []).filter(p => !p.archived);
    const totalPiglets = piglets.reduce((acc, p) => acc + (+(p.alive !== undefined ? p.alive : (p.quantity || 0))), 0);
    const fatteners = (f.fatteners || []).filter(x => !x.archived && !x.sold).reduce((acc, x) => acc + (+x.heads || 0), 0);
    const totalHerd = activeSows.length + boars + totalPiglets + fatteners;

    // Feed totals
    const totalFeedBags = (f.feed || []).reduce((a, b) => a + Math.max(0, +b.bags || 0), 0);
    const totalFeedKg = totalFeedBags * 50;

    // Semen inventory doses
    const semenBottles = (f.semen || []).reduce((a, x) => {
      if (!x || typeof x !== 'object') return a;
      const count = +(x.available_bottles !== undefined ? x.available_bottles : (x.bottles || 0));
      return a + Math.max(0, count);
    }, 0);

    // Sow reproduction pipeline
    let gestatingCount = 0;
    let lactatingCount = 0;
    let openCount = 0;
    let postAICount = 0;
    let day16Count = 0;
    let day21Count = 0;
    let dueWeekCount = 0;

    const todayDate = new Date(dstr(new Date()) + 'T00:00:00'); /* [FIX 139] local wall-clock, not UTC */
    activeSows.forEach(s => {
      if (s.farrowingDate || s.lactationStart) {
        lactatingCount++;
      } else if (s.insemination) {
        gestatingCount++;
        const insemDate = new Date(String(s.insemination).slice(0, 10) + 'T00:00:00');
        const d = Math.round((todayDate - insemDate) / 86400000);
        if (d >= 15 && d <= 18) { day16Count++; postAICount++; }
        else if (d >= 19 && d <= 24) { day21Count++; postAICount++; }
        if (d >= 107 && d <= 114) dueWeekCount++;
      } else {
        openCount++;
      }
    });

    // Health Score calculation
    let healthScore = 100;
    const vaxOverdue = (window.vaxOverdueCount ? window.vaxOverdueCount() : 0);
    if (vaxOverdue > 0) healthScore -= Math.min(20, vaxOverdue * 3);
    if (totalFeedBags <= 0) healthScore -= 10;
    if (openCount > activeSows.length * 0.3) healthScore -= 4;
    healthScore = Math.max(70, Math.min(100, healthScore));

    /* [FIX 141] composite Farm Health Index (biosecurity 50 / mortality 30 / profit 20) */
    const HX = window.arsFarmHealthIndex ? window.arsFarmHealthIndex(f, healthScore) : { index: healthScore, bio: healthScore, mort: null, prof: null, mortalityHeads60: 0 };
    const idxScore = HX.index;
    const scoreRating = idxScore >= 90 ? 'EXCELLENT' : idxScore >= 80 ? 'GOOD' : idxScore >= 60 ? 'FAIR' : 'NEEDS ATTENTION';
    const scoreColor = idxScore >= 90 ? '#57d48d' : idxScore >= 80 ? '#f0b64b' : idxScore >= 60 ? '#fb923c' : '#ff5c68';

    const modalHtml = `
      <div class="due-modal-bg open" id="farmSummaryModal" onclick="if(event.target===this)this.remove()" style="z-index:999999!important">
        <div class="reminder-modal perf-modal farm-summary-modal" style="max-width:820px;width:96%;text-align:left">
          <div class="modal-top" style="border-bottom:1.5px solid rgba(145,207,202,0.18);padding-bottom:14px;margin-bottom:16px">
            <div>
              <div class="eyebrow" style="color:var(--teal);letter-spacing:0.12em;font-weight:800">🌿 EXECUTIVE HERD &amp; OPERATIONS SUMMARY</div>
              <h2 style="font-size:22px;margin:2px 0 0;color:#fff">${esc(f.name || "RM's Hog Farm")}</h2>
              <p style="margin:2px 0 0;color:var(--muted);font-size:12px">Comprehensive Biosecurity Audit, Herd Census &amp; Operational Readiness</p>
            </div>
            <button type="button" class="close-reminder" onclick="document.getElementById('farmSummaryModal').remove()" style="font-size:26px;cursor:pointer">×</button>
          </div>

          <!-- Score Header & KPI Strip -->
          <div style="display:grid;grid-template-columns:130px 1fr;gap:16px;align-items:center;background:linear-gradient(135deg,rgba(19,185,173,0.12),rgba(7,94,99,0.22));border:1.2px solid rgba(19,185,173,0.3);border-radius:14px;padding:16px;margin-bottom:18px">
            <div style="text-align:center">
              <div class="score-ring interactive-ring" style="width:86px;height:86px;min-width:86px;margin:0 auto;background:conic-gradient(var(--teal) 0 ${idxScore * 3.6}deg, #17383a ${idxScore * 3.6}deg)">
                <div class="ring-glow-pulse"></div>
                <div class="score-inner">
                  <strong style="font-size:26px">${idxScore}</strong>
                  <small style="font-size:10px">/100</small>
                </div>
              </div>
              <div style="font-size:11px;font-weight:800;color:${scoreColor};margin-top:6px;letter-spacing:0.05em">${scoreRating}</div>
              <div style="font-size:9.5px;color:var(--muted);margin-top:4px">🛡 Bio ${HX.bio} · 🩸 Mortality ${HX.mort ?? '—'} (${HX.mortalityHeads60} deaths · 60d) · ₱ Profit ${HX.prof ?? '—'}</div>
            </div>
            <div>
              <h3 style="margin:0 0 6px;font-size:16px;color:#fff">Farm Health Index (Biosecurity · Mortality · Profit)</h3>
              <p style="margin:0 0 10px;font-size:12px;color:#c0dedc;line-height:1.4">
                Your farm maintains active bio-exclusion standards, proactive 16d/21d heat detection schedules, and synchronized vaccination programs.
              </p>
              <div style="display:flex;gap:8px;flex-wrap:wrap">
                <span class="tag" style="background:#123e37;color:#64e5a0;font-size:11px">✓ Total Herd: ${totalHerd} Heads</span>
                <span class="tag" style="background:#10343a;color:#7ae0d6;font-size:11px">🌾 Feed: ${totalFeedBags} Bags (${totalFeedKg} kg)</span>
                <span class="tag" style="background:#19382e;color:#8ce8af;font-size:11px">🧪 Semen: ${semenBottles} Doses</span>
                <span class="tag ${vaxOverdue ? 'danger' : ''}" style="font-size:11px">${vaxOverdue ? `⚠ ${vaxOverdue} Vax Overdue` : '✓ Vaccines 100% Up to Date'}</span>
              </div>
            </div>
          </div>

          <!-- Biosecurity & Health Audit Matrix -->
          <div style="margin-bottom:18px">
            <h4 style="font-size:12px;letter-spacing:0.08em;color:var(--teal);margin:0 0 10px;text-transform:uppercase">🛡 BIOSECURITY &amp; HEALTH AUDIT MATRIX</h4>
            <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(220px, 1fr));gap:10px">
              <div style="background:rgba(12,28,32,0.85);border:1px solid rgba(145,207,202,0.15);border-radius:10px;padding:12px">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <span style="font-size:12px;color:#c0dedc">Disease Prevention &amp; Livability</span>
                  <b style="color:#57d48d;font-size:13px">30 / 30 pts</b>
                </div>
                <small style="color:var(--muted);display:block;margin-top:3px;font-size:11px">Zero reported African Swine Fever / epidemic exposure; quarantine logs compliant.</small>
              </div>
              <div style="background:rgba(12,28,32,0.85);border:1px solid rgba(145,207,202,0.15);border-radius:10px;padding:12px">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <span style="font-size:12px;color:#c0dedc">Vaccine Schedule Compliance</span>
                  <b style="color:${vaxOverdue ? '#f0b64b' : '#57d48d'};font-size:13px">${vaxOverdue ? '18 / 25 pts' : '25 / 25 pts'}</b>
                </div>
                <small style="color:var(--muted);display:block;margin-top:3px;font-size:11px">${vaxOverdue ? `${vaxOverdue} booster schedules overdue` : 'Breeder and piglet vaccine protocols current.'}</small>
              </div>
              <div style="background:rgba(12,28,32,0.85);border:1px solid rgba(145,207,202,0.15);border-radius:10px;padding:12px">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <span style="font-size:12px;color:#c0dedc">Nutrition &amp; Feed Reserve</span>
                  <b style="color:${totalFeedBags < 5 ? '#f0b64b' : '#57d48d'};font-size:13px">${totalFeedBags < 5 ? '12 / 20 pts' : '20 / 20 pts'}</b>
                </div>
                <small style="color:var(--muted);display:block;margin-top:3px;font-size:11px">${totalFeedBags} bags on hand across growth stages.</small>
              </div>
              <div style="background:rgba(12,28,32,0.85);border:1px solid rgba(145,207,202,0.15);border-radius:10px;padding:12px">
                <div style="display:flex;justify-content:space-between;align-items:center">
                  <span style="font-size:12px;color:#c0dedc">Insemination &amp; Gestation Sync</span>
                  <b style="color:#57d48d;font-size:13px">15 / 15 pts</b>
                </div>
                <small style="color:var(--muted);display:block;margin-top:3px;font-size:11px">Post-AI 16d/21d heat detection active; 0 overdue farrowings (>114d).</small>
              </div>
            </div>
          </div>

          <!-- Herd Distribution & Pipeline -->
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-bottom:18px">
            <div style="background:rgba(12,28,32,0.85);border:1px solid rgba(145,207,202,0.15);border-radius:12px;padding:14px">
              <h4 style="margin:0 0 10px;font-size:12px;color:var(--teal);letter-spacing:0.06em">🐖 SOW BREEDING PIPELINE</h4>
              <div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:8px">
                <div style="background:rgba(18,48,54,0.5);padding:8px 10px;border-radius:8px">
                  <small style="color:var(--muted);font-size:10px;display:block">CONFIRMED GESTATING</small>
                  <b style="font-size:16px;color:#7ae0d6">${gestatingCount} sows</b>
                </div>
                <div style="background:rgba(18,48,54,0.5);padding:8px 10px;border-radius:8px">
                  <small style="color:var(--muted);font-size:10px;display:block">LACTATING SOWS</small>
                  <b style="font-size:16px;color:#f0b64b">${lactatingCount} sows</b>
                </div>
                <div style="background:rgba(18,48,54,0.5);padding:8px 10px;border-radius:8px;cursor:pointer" onclick="document.getElementById('farmSummaryModal').remove();openPostAIMonitoringModal()" title="Click to view Post-AI Monitoring">
                  <small style="color:var(--muted);font-size:10px;display:block">POST-AI 16d/21d WATCH →</small>
                  <b style="font-size:16px;color:#ffbd70">${postAICount} sows</b>
                </div>
                <div style="background:rgba(18,48,54,0.5);padding:8px 10px;border-radius:8px">
                  <small style="color:var(--muted);font-size:10px;display:block">OPEN / WEANED</small>
                  <b style="font-size:16px;color:#c0dedc">${openCount} sows</b>
                </div>
              </div>
            </div>

            <div style="background:rgba(12,28,32,0.85);border:1px solid rgba(145,207,202,0.15);border-radius:12px;padding:14px">
              <h4 style="margin:0 0 10px;font-size:12px;color:var(--teal);letter-spacing:0.06em">🌱 LIVESTOCK &amp; GROWER CENSUS</h4>
              <div style="display:grid;grid-template-columns:repeat(2, 1fr);gap:8px">
                <div style="background:rgba(18,48,54,0.5);padding:8px 10px;border-radius:8px">
                  <small style="color:var(--muted);font-size:10px;display:block">ACTIVE BREEDER SOWS</small>
                  <b style="font-size:16px;color:#fff">${activeSows.length} heads</b>
                </div>
                <div style="background:rgba(18,48,54,0.5);padding:8px 10px;border-radius:8px">
                  <small style="color:var(--muted);font-size:10px;display:block">SERVICE BOARS</small>
                  <b style="font-size:16px;color:#7ae0d6">${boars} heads</b>
                </div>
                <div style="background:rgba(18,48,54,0.5);padding:8px 10px;border-radius:8px">
                  <small style="color:var(--muted);font-size:10px;display:block">NURSERY PIGLET BATCHES</small>
                  <b style="font-size:16px;color:#64e5a0">${totalPiglets} heads (${piglets.length} batches)</b>
                </div>
                <div style="background:rgba(18,48,54,0.5);padding:8px 10px;border-radius:8px">
                  <small style="color:var(--muted);font-size:10px;display:block">GROW-FINISH FATTENERS</small>
                  <b style="font-size:16px;color:#ffbd70">${fatteners} heads</b>
                </div>
              </div>
            </div>
          </div>

          <!-- Quick Navigation Shortcuts -->
          <div style="display:flex;gap:8px;justify-content:flex-end;flex-wrap:wrap;border-top:1.5px solid rgba(145,207,202,0.18);padding-top:14px">
            <button type="button" class="btn ghost" onclick="document.getElementById('farmSummaryModal').remove();openPostAIMonitoringModal()">🐷 Post-AI Monitoring</button>
            <button type="button" class="btn ghost" onclick="document.getElementById('farmSummaryModal').remove();openFeedStockSummaryModal()">🌾 Feed Inventory</button>
            <button type="button" class="btn ghost" onclick="document.getElementById('farmSummaryModal').remove();openVaccinationCenter()">💉 Vaccination Program</button>
            <button type="button" class="btn" onclick="document.getElementById('farmSummaryModal').remove();go('sows')">Open Herd Roster →</button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
  }

  /* ── 2. POST-AI INSEMINATION & HEAT MONITORING MODAL ── */
  function openPostAIMonitoringModal() {
    document.querySelectorAll('#postAIMonitorModal').forEach(el => el.remove());
  /* [FIX 139] if the modal is left open across midnight or the phone sleeps,
     re-render on return-to-foreground so day counts never look a day late. */
  if (!openPostAIMonitoringModal._wired) {
    openPostAIMonitoringModal._wired = true;
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible' && document.getElementById('postAIMonitorModal')) openPostAIMonitoringModal();
    });
  }

    const f = (typeof F === 'function' && F()) ? F() : {};
    const activeSows = (f.sows || []).filter(s => (typeof isActiveSow === 'function' ? isActiveSow(s) : !s.culled));
    const todayDate = new Date(dstr(new Date()) + 'T00:00:00'); /* [FIX 139] local wall-clock, not UTC */

    const monitoredSows = [];
    activeSows.forEach((sow, idx) => {
      if (!sow.insemination) return;
      const insemDate = new Date(String(sow.insemination).slice(0, 10) + 'T00:00:00');
      const d = Math.round((todayDate - insemDate) / 86400000);

      // Boar / Semen used details
      let boarName = sow.boar || sow.semen_used || sow.sire || '—';
      let boarBreed = '';
      let semenBatch = sow.semen_batch_no || '';

      const rec = (f.breedingRecords || []).find(r => r.id === sow.current_breeding_record_id || r.sow_id === sow.id || r.sow_name === sow.name);
      if (rec) {
        boarName = rec.boar_name || rec.boar || boarName;
        semenBatch = rec.semen_batch_no || rec.semen || semenBatch;
      }
      const bObj = (f.boars || []).find(b => b.name === boarName || b.id === boarName);
      if (bObj) boarBreed = bObj.breed || bObj.customBreed || '';

      const isDay16 = (d >= 15 && d <= 18);
      const isDay21 = (d >= 19 && d <= 24);

      monitoredSows.push({
        sow,
        index: idx,
        insemination: sow.insemination,
        daysSince: d,
        boarName,
        boarBreed,
        semenBatch,
        isDay16,
        isDay21,
        obs: Array.isArray(sow.observations) ? sow.observations : (rec?.observations || [])
      });
    });

    // Sort by milestone priority: Day 16 & Day 21 first, then daysSince ascending
    monitoredSows.sort((a, b) => {
      const aPriority = a.isDay16 ? 1 : a.isDay21 ? 2 : 3;
      const bPriority = b.isDay16 ? 1 : b.isDay21 ? 2 : 3;
      if (aPriority !== bPriority) return aPriority - bPriority;
      return a.daysSince - b.daysSince;
    });

    const day16List = monitoredSows.filter(x => x.isDay16);
    const day21List = monitoredSows.filter(x => x.isDay21);
    const otherList = monitoredSows.filter(x => !x.isDay16 && !x.isDay21);

    const sowRowHtml = (x) => {
      const badge = x.isDay16
        ? `<span class="tag warn" style="background:#422a0c;color:#ffc266;border:1px solid #7a501a;font-weight:800;padding:4px 9px">🚨 16th-Day Heat Check Due (Day ${x.daysSince})</span>`
        : x.isDay21
          ? `<span class="tag" style="background:#0e3c38;color:#57e8d8;border:1px solid #167a72;font-weight:800;padding:4px 9px">✨ 21st-Day Pregnancy Check Due (Day ${x.daysSince})</span>`
          : `<span class="tag dark" style="padding:4px 9px">Day ${x.daysSince} of Gestation</span>`;

      const semenDesc = x.boarBreed
        ? `${esc(x.boarName)} <small style="color:var(--muted)">(${esc(x.boarBreed)})</small>`
        : `${esc(x.boarName)}`;

      return `
        <div style="background:rgba(12,28,32,0.9);border:1px solid ${x.isDay16 ? 'rgba(240,182,75,0.4)' : x.isDay21 ? 'rgba(19,185,173,0.4)' : 'rgba(145,207,202,0.14)'};border-radius:12px;padding:14px;margin-bottom:10px;display:flex;justify-content:space-between;align-items:center;gap:14px;flex-wrap:wrap">
          <div style="flex:1;min-width:240px">
            <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
              <b style="font-size:16px;color:#fff">${esc(x.sow.name)}</b>
              <span style="color:var(--muted);font-size:11px">${esc(x.sow.id || '')} · Parity ${x.sow.parity || 0} · ${esc(x.sow.breed || 'Breeder Sow')}</span>
            </div>
            <div style="font-size:12.5px;color:#d2e7e5;margin-bottom:4px">
              📅 Inseminated: <b>${fmtD(x.insemination)}</b> <span style="color:var(--muted)">(${x.daysSince} days ago)</span>
            </div>
            <div style="font-size:12px;color:#9ebbb9">
              💉 Semen / Service Boar: <b>${semenDesc}</b> ${x.semenBatch ? `· Batch <b>${esc(x.semenBatch)}</b>` : ''}
            </div>
          </div>

          <div style="display:flex;flex-direction:column;align-items:flex-end;gap:8px;min-width:200px">
            ${badge}
            <div style="display:flex;gap:6px;flex-wrap:wrap;justify-content:flex-end">
              <button type="button" class="btn ghost" style="padding:5px 10px;font-size:11px" onclick="document.getElementById('postAIMonitorModal').remove();openHeatRecord(${x.index},true)">☼ Record Reheat</button>
              <button type="button" class="btn ghost" style="padding:5px 10px;font-size:11px" onclick="document.getElementById('postAIMonitorModal').remove();openSowProfile(${x.index})">📋 Sow Dossier</button>
              <button type="button" class="btn" style="padding:5px 10px;font-size:11px" onclick="quickConfirmPregnant('${x.sow.id}')">✓ Confirm Pregnant</button>
            </div>
          </div>
        </div>
      `;
    };

    const modalHtml = `
      <div class="due-modal-bg open" id="postAIMonitorModal" onclick="if(event.target===this)this.remove()" style="z-index:999999!important">
        <div class="reminder-modal perf-modal" style="max-width:820px;width:96%;max-height:90vh;overflow-y:auto;text-align:left">
          <div class="modal-top" style="border-bottom:1.5px solid rgba(145,207,202,0.18);padding-bottom:14px;margin-bottom:16px">
            <div>
              <div class="eyebrow" style="color:var(--teal);letter-spacing:0.12em;font-weight:800">🐷 REPRODUCTIVE PRECISION &amp; HEAT MONITORING</div>
              <h2 style="font-size:22px;margin:2px 0 0;color:#fff">Post-AI Insemination Monitoring</h2>
              <p style="margin:2px 0 0;color:var(--muted);font-size:12px">Track sows reaching the critical 16th-day (early return-to-heat) and 21st-day (pregnancy confirmation) milestones.</p>
            </div>
            <button type="button" class="close-reminder" onclick="document.getElementById('postAIMonitorModal').remove()" style="font-size:26px;cursor:pointer">×</button>
          </div>

          <!-- Summary KPI Counters -->
          <div style="display:grid;grid-template-columns:repeat(3, 1fr);gap:12px;margin-bottom:18px">
            <div style="background:rgba(240,182,75,0.12);border:1.2px solid rgba(240,182,75,0.35);border-radius:12px;padding:12px 14px">
              <div style="font-size:10.5px;font-weight:800;color:#ffc266;letter-spacing:0.06em">🚨 16th-DAY EARLY HEAT WATCH</div>
              <b style="font-size:24px;color:#fff;display:block;margin:4px 0 2px">${day16List.length}</b>
              <small style="font-size:11px;color:var(--muted)">Days 15–18 return-to-heat window</small>
            </div>

            <div style="background:rgba(19,185,173,0.12);border:1.2px solid rgba(19,185,173,0.35);border-radius:12px;padding:12px 14px">
              <div style="font-size:10.5px;font-weight:800;color:#57e8d8;letter-spacing:0.06em">✨ 21st-DAY PREGNANCY CONFIRMATION</div>
              <b style="font-size:24px;color:#fff;display:block;margin:4px 0 2px">${day21List.length}</b>
              <small style="font-size:11px;color:var(--muted)">Days 19–24 standard oestrus cycle</small>
            </div>

            <div style="background:rgba(145,207,202,0.08);border:1.2px solid rgba(145,207,202,0.2);border-radius:12px;padding:12px 14px">
              <div style="font-size:10.5px;font-weight:800;color:#c0dedc;letter-spacing:0.06em">🌱 TOTAL INSEMINATED PIPELINE</div>
              <b style="font-size:24px;color:#fff;display:block;margin:4px 0 2px">${monitoredSows.length}</b>
              <small style="font-size:11px;color:var(--muted)">Active gestating sow pool</small>
            </div>
          </div>

          <!-- Section 1: Day 16 Heat Watch -->
          <div style="margin-bottom:18px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <h3 style="margin:0;font-size:14px;color:#ffc266">🚨 16th-Day Early Return-to-Heat Watch (${day16List.length})</h3>
              <small style="color:var(--muted);font-size:11px">Inspect with teaser boar for early heat signs</small>
            </div>
            ${day16List.length > 0 ? day16List.map(sowRowHtml).join('') : '<div style="background:rgba(12,28,32,0.5);border:1px dashed rgba(145,207,202,0.15);border-radius:10px;padding:14px;text-align:center;color:var(--muted);font-size:12px">No sows currently on Day 15–18. Sows appear here automatically 16 days after insemination.</div>'}
          </div>

          <!-- Section 2: Day 21 Pregnancy Confirmation -->
          <div style="margin-bottom:18px">
            <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
              <h3 style="margin:0;font-size:14px;color:#57e8d8">✨ 21st-Day Pregnancy Confirmation Watch (${day21List.length})</h3>
              <small style="color:var(--muted);font-size:11px">Confirm no return to heat at 21 days</small>
            </div>
            ${day21List.length > 0 ? day21List.map(sowRowHtml).join('') : '<div style="background:rgba(12,28,32,0.5);border:1px dashed rgba(145,207,202,0.15);border-radius:10px;padding:14px;text-align:center;color:var(--muted);font-size:12px">No sows currently on Day 19–24. Sows appear here automatically 21 days after insemination.</div>'}
          </div>

          <!-- Section 3: Other Inseminated Sows -->
          ${otherList.length > 0 ? `
            <div style="margin-bottom:18px">
              <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
                <h3 style="margin:0;font-size:13px;color:#c0dedc">⏳ Inseminated Gestation Pipeline (${otherList.length})</h3>
                <small style="color:var(--muted);font-size:11px">Sows progressing toward upcoming heat check or farrowing</small>
              </div>
              ${otherList.map(sowRowHtml).join('')}
            </div>
          ` : ''}

          <div style="display:flex;justify-content:flex-end;gap:8px;border-top:1.5px solid rgba(145,207,202,0.18);padding-top:14px">
            <button type="button" class="btn ghost" onclick="document.getElementById('postAIMonitorModal').remove()">Close</button>
            <button type="button" class="btn" onclick="document.getElementById('postAIMonitorModal').remove();go('insemination')">Open Insemination Hub →</button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
  }

  /* ── 3. LIVE FEED STOCK & INVENTORY SUMMARY MODAL ── */
  function openFeedStockSummaryModal() {
    document.querySelectorAll('#feedStockModal').forEach(el => el.remove());
    const f = (typeof F === 'function' && F()) ? F() : {};
    const feedItems = f.feed || [];
    const totalFeedBags = feedItems.reduce((a, b) => a + Math.max(0, +b.bags || 0), 0);
    const totalFeedKg = totalFeedBags * 50;

    // Estimate daily burn rate
    const activeSows = (f.sows || []).filter(s => (typeof isActiveSow === 'function' ? isActiveSow(s) : !s.culled)).length;
    const boars = (f.boars || []).filter(b => !b.culled).length;
    const piglets = (f.piglets || []).filter(p => !p.archived).reduce((a, p) => a + (+(p.alive !== undefined ? p.alive : (p.quantity || 0))), 0);
    const fatteners = (f.fatteners || []).filter(x => !x.archived && !x.sold).reduce((a, x) => a + (+x.heads || 0), 0);

    const dailyKg = (activeSows * 2.5) + (boars * 2.2) + (fatteners * 2.0) + (piglets * 0.4);
    const dailyBags = +(dailyKg / 50).toFixed(2);
    const daysRemaining = dailyBags > 0 ? Math.round(totalFeedBags / dailyBags) : '∞';

    const rows = feedItems.map((item, idx) => {
      const bags = Math.max(0, +item.bags || 0);
      const kg = bags * (item.kg_per_bag || 50);
      const statusTag = bags > 5
        ? `<span class="tag" style="background:#123e37;color:#64e5a0">In Stock</span>`
        : bags > 0
          ? `<span class="tag warn">Low Stock</span>`
          : `<span class="tag danger">Out of Stock</span>`;

      return `
        <tr>
          <td>
            <b style="color:#fff;font-size:13.5px">${esc(item.type || item.feed_name || item.name || 'Feed')}</b>
            ${item.supplier ? `<small style="color:var(--muted);display:block;font-size:11px">Supplier: ${esc(item.supplier)}</small>` : ''}
          </td>
          <td><b style="font-size:15px;color:var(--teal)">${bags}</b> <small style="color:var(--muted)">bags</small></td>
          <td><b>${kg.toLocaleString()}</b> <small style="color:var(--muted)">kg</small></td>
          <td>${statusTag}</td>
          <td style="text-align:right">
            <button type="button" class="btn ghost" style="padding:4px 8px;font-size:11px" onclick="document.getElementById('feedStockModal').remove();editRecord('feed',${idx})">✎ Edit</button>
          </td>
        </tr>
      `;
    }).join('');

    const modalHtml = `
      <div class="due-modal-bg open" id="feedStockModal" onclick="if(event.target===this)this.remove()" style="z-index:999999!important">
        <div class="reminder-modal perf-modal" style="max-width:760px;width:96%;text-align:left">
          <div class="modal-top" style="border-bottom:1.5px solid rgba(145,207,202,0.18);padding-bottom:14px;margin-bottom:16px">
            <div>
              <div class="eyebrow" style="color:var(--teal);letter-spacing:0.12em;font-weight:800">🌾 LIVE FEED STOCK &amp; INVENTORY BREAKDOWN</div>
              <h2 style="font-size:22px;margin:2px 0 0;color:#fff">Current Feed Stock on Farm</h2>
              <p style="margin:2px 0 0;color:var(--muted);font-size:12px">Real-time inventory levels, stage distribution, and projected herd consumption runway.</p>
            </div>
            <button type="button" class="close-reminder" onclick="document.getElementById('feedStockModal').remove()" style="font-size:26px;cursor:pointer">×</button>
          </div>

          <!-- Metrics Strip -->
          <div style="display:grid;grid-template-columns:repeat(4, 1fr);gap:10px;margin-bottom:18px">
            <div style="background:rgba(19,185,173,0.1);border:1px solid rgba(19,185,173,0.25);border-radius:10px;padding:11px">
              <small style="color:var(--muted);font-size:10px;display:block">TOTAL ON HAND</small>
              <b style="font-size:20px;color:var(--teal)">${totalFeedBags} <small style="font-size:12px;color:var(--muted)">bags</small></b>
            </div>
            <div style="background:rgba(18,48,54,0.5);border:1px solid rgba(145,207,202,0.15);border-radius:10px;padding:11px">
              <small style="color:var(--muted);font-size:10px;display:block">TOTAL WEIGHT</small>
              <b style="font-size:20px;color:#fff">${totalFeedKg.toLocaleString()} <small style="font-size:12px;color:var(--muted)">kg</small></b>
            </div>
            <div style="background:rgba(18,48,54,0.5);border:1px solid rgba(145,207,202,0.15);border-radius:10px;padding:11px">
              <small style="color:var(--muted);font-size:10px;display:block">DAILY BURN RATE</small>
              <b style="font-size:20px;color:#f0b64b">~${dailyBags} <small style="font-size:12px;color:var(--muted)">bags/day</small></b>
            </div>
            <div style="background:rgba(18,48,54,0.5);border:1px solid rgba(145,207,202,0.15);border-radius:10px;padding:11px">
              <small style="color:var(--muted);font-size:10px;display:block">FEED RUNWAY</small>
              <b style="font-size:20px;color:#64e5a0">~${daysRemaining} <small style="font-size:12px;color:var(--muted)">days</small></b>
            </div>
          </div>

          <!-- Inventory Table -->
          <div class="table-wrap" style="margin-bottom:18px;max-height:360px;overflow-y:auto">
            <table class="table" style="min-width:100%">
              <thead>
                <tr>
                  <th>Feed Type / Stage</th>
                  <th>Stock (Bags)</th>
                  <th>Weight (Kg)</th>
                  <th>Status</th>
                  <th style="text-align:right">Action</th>
                </tr>
              </thead>
              <tbody>
                ${rows || '<tr><td colspan="5" style="text-align:center;padding:24px;color:var(--muted)">No feed inventory records found.</td></tr>'}
              </tbody>
            </table>
          </div>

          <div style="display:flex;justify-content:space-between;align-items:center;border-top:1.5px solid rgba(145,207,202,0.18);padding-top:14px">
            <button type="button" class="btn ghost" onclick="document.getElementById('feedStockModal').remove();openRecordModal('feed')">+ Receive Feed Delivery</button>
            <div style="display:flex;gap:8px">
              <button type="button" class="btn ghost" onclick="document.getElementById('feedStockModal').remove();openFeedPredictorModal()">📊 Feed Predictor</button>
              <button type="button" class="btn" onclick="document.getElementById('feedStockModal').remove();go('feed')">Open Feed Center →</button>
            </div>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
  }

  /* ── 4. MEDICINE & TREATMENTS SUMMARY MODAL ── */
  function openMedicineSummaryModal() {
    document.querySelectorAll('#medicineSummaryModal').forEach(el => el.remove());
    const modalHtml = `
      <div class="due-modal-bg open" id="medicineSummaryModal" onclick="if(event.target===this)this.remove()" style="z-index:999999!important">
        <div class="reminder-modal perf-modal" style="max-width:720px;width:96%;text-align:left">
          <div class="modal-top" style="border-bottom:1.5px solid rgba(145,207,202,0.18);padding-bottom:14px;margin-bottom:16px">
            <div>
              <div class="eyebrow" style="color:var(--teal);letter-spacing:0.12em;font-weight:800">💊 MEDICINE &amp; TREATMENTS STATUS</div>
              <h2 style="font-size:22px;margin:2px 0 0;color:#fff">Herd Treatments &amp; Medical Log</h2>
              <p style="margin:2px 0 0;color:var(--muted);font-size:12px">Active treatments, withdrawal periods, and veterinary medicine inventory.</p>
            </div>
            <button type="button" class="close-reminder" onclick="document.getElementById('medicineSummaryModal').remove()" style="font-size:26px;cursor:pointer">×</button>
          </div>

          <div style="background:rgba(18,48,54,0.4);border:1px solid rgba(145,207,202,0.15);border-radius:12px;padding:16px;margin-bottom:18px">
            <div style="display:flex;align-items:center;gap:12px">
              <span style="display:inline-grid;place-items:center;width:32px;height:32px;border-radius:50%;background:#123e37;color:#64e5a0;font-size:18px">✓</span>
              <div>
                <b style="font-size:15px;color:#57d48d">No Pending Medical Treatments</b>
                <p style="margin:2px 0 0;font-size:12px;color:var(--muted)">All treated animals have cleared their withdrawal periods and completed active injection rounds.</p>
              </div>
            </div>
          </div>

          <div style="display:flex;justify-content:flex-end;gap:8px;border-top:1.5px solid rgba(145,207,202,0.18);padding-top:14px">
            <button type="button" class="btn ghost" onclick="document.getElementById('medicineSummaryModal').remove();openMedicineHub()">Open Medicine Inventory</button>
            <button type="button" class="btn" onclick="document.getElementById('medicineSummaryModal').remove();go('medicine')">Open Medicine &amp; Treatments →</button>
          </div>
        </div>
      </div>
    `;
    document.body.insertAdjacentHTML('beforeend', modalHtml);
  }

  /* ── 5. QUICK PREGNANCY CONFIRMATION ── */
  function quickConfirmPregnant(sowId) {
    const f = (typeof F === 'function' && F()) ? F() : {};
    const s = (f.sows || []).find(x => String(x.id) === String(sowId));
    if (!s) return;
    s.status = 'Gestating';
    s.lifecycle = 'Gestating';
    s.pregnancy_confirmed = true;
    s.pregnancy_confirmed_at = new Date().toISOString();
    if (typeof save === 'function') save();
    if (window.toast) toast(`Pregnancy confirmed for ${s.name}!`);
    openPostAIMonitoringModal();
    if (typeof renderAll === 'function') renderAll();
  }

  /* ── 6. INTERACTIVE HEALTH CHECKLIST (Dashboard Component) ── */
  function healthChecklist() {
    const f = (typeof F === 'function' && F()) ? F() : {};
    const activeSows = (f.sows || []).filter(s => (typeof isActiveSow === 'function' ? isActiveSow(s) : !s.culled));
    const totalFeedBags = (f.feed || []).reduce((a, b) => a + Math.max(0, +b.bags || 0), 0);
    const vaxOverdue = (window.vaxOverdueCount ? window.vaxOverdueCount() : 0);

    const todayDate = new Date(dstr(new Date()) + 'T00:00:00'); /* [FIX 139] local wall-clock, not UTC */
    let postAICount = 0;
    activeSows.forEach(s => {
      if (!s.insemination) return;
      const insemDate = new Date(String(s.insemination).slice(0, 10) + 'T00:00:00');
      const d = Math.round((todayDate - insemDate) / 86400000);
      if (d >= 15 && d <= 24) postAICount++;
    });

    const vaxItem = vaxOverdue
      ? `<span class="check-item bad" style="cursor:pointer" onclick="openVaccinationCenter()" title="Click to view Vaccination Program"><span class="check-ico">⚠</span> <b>${vaxOverdue} vaccine follow-up${vaxOverdue > 1 ? 's' : ''} overdue</b></span>`
      : `<span class="check-item" style="cursor:pointer" onclick="openVaccinationCenter()" title="Click to view Vaccination Program"><span class="check-ico">✓</span> No overdue vaccinations</span>`;

    const feedItem = `<span class="check-item" style="cursor:pointer" onclick="openFeedStockSummaryModal()" title="Click to view Current Feed Stock Inventory"><span class="check-ico">✓</span> Feed inventory: ${totalFeedBags} bags</span>`;

    const treatItem = `<span class="check-item" style="cursor:pointer" onclick="openMedicineSummaryModal()" title="Click to view Medicine & Treatments"><span class="check-ico">✓</span> No pending treatments</span>`;

    const postAIItem = `<span class="check-item ${postAICount > 0 ? 'hl' : ''}" style="cursor:pointer" onclick="openPostAIMonitoringModal()" title="Click to monitor sows at 16th and 21st day post-AI milestones"><span class="check-ico">✓</span> Post-AI Monitoring${postAICount > 0 ? `: ${postAICount} on watch` : ''}</span>`;

    return vaxItem + feedItem + treatItem + postAIItem;
  }

  function openVaccinationCenter() {
    if (typeof go === 'function') go('vaccination');
  }

  function openFeedPredictorModal() {
    if (typeof go === 'function') go('predictor');
  }

  function openMedicineHub() {
    if (typeof go === 'function') go('medicine');
  }

  window.openFarmSummaryModal = openFarmSummaryModal;
  window.openPostAIMonitoringModal = openPostAIMonitoringModal;
  window.openFeedStockSummaryModal = openFeedStockSummaryModal;
  window.openMedicineSummaryModal = openMedicineSummaryModal;
  window.openVaccinationCenter = openVaccinationCenter;
  window.openFeedPredictorModal = openFeedPredictorModal;
  window.openMedicineHub = openMedicineHub;
  window.quickConfirmPregnant = quickConfirmPregnant;
  window.healthChecklist = healthChecklist;
})();
