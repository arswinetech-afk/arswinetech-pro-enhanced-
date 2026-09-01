/* ═══════════════════════════════════════════════════════════════════════════
   ARSwineTech Pro — Multi-Barn Batch Movements & Facilities CRUD Center
   (js/barn-movements.js)

   Features:
   • Complete Barn & Facility CRUD Management:
     - Add Custom Barns / Sheds / Houses
     - Edit Barn names, types, descriptions, and pen capacities
     - Delete Barns (with occupancy safety guard)
     - Reset to Sample Guide Barns for first-time users
   • Complete Pen & Stall CRUD Management:
     - Add new pens / crates / stalls to any barn with custom IDs
     - Edit pen names, capacities, housing types, and statuses
     - Delete vacant pens / stalls
   • Spatial Facilities Mapping:
     - Breeding Stud, Gestation Stalls, Farrowing Crates, Nursery, Grow-Finish, Quarantine
   • Real-Time Pen Sanitation & Biosecurity Downtime Tracker
   • Multi-Step Movement Wizard with RFID Tag Detection & Audit Trail
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // Helper formatting
  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtDate = d => {
    if (!d) return '—';
    try {
      const dt = new Date(d + (d.includes('T') ? '' : 'T00:00:00'));
      return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return d; }
  };
  const daysBetween = (a, b) => {
    if (!a) return 0;
    const d1 = new Date(a + 'T00:00:00');
    const d2 = b ? new Date(b + 'T00:00:00') : new Date();
    return Math.max(0, Math.floor((d2 - d1) / 86400000));
  };

  // State
  let activeBarnId = 'barn-gest';

  // Safe farm accessor
  function getFarm() {
    try {
      if (typeof F === 'function') return F();
      if (window.F && typeof window.F === 'function') return window.F();
      if (window.DB && (window.farmId || typeof farmId !== 'undefined')) {
        const id = window.farmId || (typeof farmId !== 'undefined' ? farmId : 'farm-ars');
        return window.DB[id] || Object.values(window.DB)[0] || {};
      }
    } catch (e) {
      console.warn('[Barns] getFarm fallback', e);
    }
    return {};
  }

  // Standard sample guide barns for first-time users
  function getSampleGuideBarns() {
    return [
      {
        id: 'barn-breed',
        name: 'Breeding & AI Stud',
        type: 'Breeding',
        capacity_desc: '6 Individual Boar & Insemination Stalls',
        pens: [
          { id: 'BR-01', name: 'Boar Pen 1 (Thor)', type: 'stall', status: 'occupied', occupant_type: 'boar', occupant_id: 'Thor', occupied_since: '2026-01-10' },
          { id: 'BR-02', name: 'Boar Pen 2 (Atlas)', type: 'stall', status: 'occupied', occupant_type: 'boar', occupant_id: 'Atlas', occupied_since: '2026-02-15' },
          { id: 'BR-03', name: 'Boar Pen 3', type: 'stall', status: 'ready', occupant_type: null, occupant_id: null },
          { id: 'BR-04', name: 'AI Service Stall A', type: 'stall', status: 'ready', occupant_type: null, occupant_id: null },
          { id: 'BR-05', name: 'AI Service Stall B', type: 'stall', status: 'ready', occupant_type: null, occupant_id: null },
          { id: 'BR-06', name: 'Breeding Pen C', type: 'stall', status: 'ready', occupant_type: null, occupant_id: null }
        ]
      },
      {
        id: 'barn-gest',
        name: 'Gestation Barn A',
        type: 'Gestation',
        capacity_desc: '16 Individual Gestation Stalls',
        pens: [
          { id: 'G-01', name: 'Stall G-01 (Bella)', type: 'stall', status: 'occupied', occupant_type: 'sow', occupant_id: 'S-001', occupied_since: '2026-04-13' },
          { id: 'G-02', name: 'Stall G-02 (Maya)', type: 'stall', status: 'occupied', occupant_type: 'sow', occupant_id: 'S-002', occupied_since: '2026-04-20' },
          { id: 'G-03', name: 'Stall G-03 (Luna)', type: 'stall', status: 'occupied', occupant_type: 'sow', occupant_id: 'S-003', occupied_since: '2026-05-04' },
          { id: 'G-04', name: 'Stall G-04 (Ginger)', type: 'stall', status: 'occupied', occupant_type: 'sow', occupant_id: 'S-005', occupied_since: '2026-06-01' },
          { id: 'G-05', name: 'Stall G-05', type: 'stall', status: 'resting', rest_started: '2026-08-06', rest_days_required: 5 },
          { id: 'G-06', name: 'Stall G-06', type: 'stall', status: 'ready', occupant_type: null, occupant_id: null },
          { id: 'G-07', name: 'Stall G-07', type: 'stall', status: 'ready', occupant_type: null, occupant_id: null },
          { id: 'G-08', name: 'Stall G-08', type: 'stall', status: 'dirty', needs_cleaning: true },
          { id: 'G-09', name: 'Stall G-09', type: 'stall', status: 'ready', occupant_type: null, occupant_id: null },
          { id: 'G-10', name: 'Stall G-10', type: 'stall', status: 'ready', occupant_type: null, occupant_id: null },
          { id: 'G-11', name: 'Stall G-11', type: 'stall', status: 'ready', occupant_type: null, occupant_id: null },
          { id: 'G-12', name: 'Stall G-12', type: 'stall', status: 'ready', occupant_type: null, occupant_id: null },
          { id: 'G-13', name: 'Stall G-13', type: 'stall', status: 'ready', occupant_type: null, occupant_id: null },
          { id: 'G-14', name: 'Stall G-14', type: 'stall', status: 'ready', occupant_type: null, occupant_id: null },
          { id: 'G-15', name: 'Stall G-15', type: 'stall', status: 'ready', occupant_type: null, occupant_id: null },
          { id: 'G-16', name: 'Stall G-16', type: 'stall', status: 'ready', occupant_type: null, occupant_id: null }
        ]
      },
      {
        id: 'barn-farrow',
        name: 'Farrowing House 1',
        type: 'Farrowing',
        capacity_desc: '10 Heated Farrowing Crates',
        pens: [
          { id: 'FC-01', name: 'Crate FC-01 (Daisy & B-2518)', type: 'crate', status: 'occupied', occupant_type: 'sow', occupant_id: 'S-004', batch_id: 'B-2518', occupied_since: '2026-05-25' },
          { id: 'FC-02', name: 'Crate FC-02 (Batch B-2601)', type: 'crate', status: 'occupied', occupant_type: 'batch', batch_id: 'B-2601', occupied_since: '2026-06-16' },
          { id: 'FC-03', name: 'Crate FC-03 (Batch B-2602)', type: 'crate', status: 'occupied', occupant_type: 'batch', batch_id: 'B-2602', occupied_since: '2026-07-02' },
          { id: 'FC-04', name: 'Crate FC-04', type: 'crate', status: 'resting', rest_started: '2026-08-07', rest_days_required: 7 },
          { id: 'FC-05', name: 'Crate FC-05', type: 'crate', status: 'ready', occupant_type: null, occupant_id: null },
          { id: 'FC-06', name: 'Crate FC-06', type: 'crate', status: 'ready', occupant_type: null, occupant_id: null },
          { id: 'FC-07', name: 'Crate FC-07', type: 'crate', status: 'ready', occupant_type: null, occupant_id: null },
          { id: 'FC-08', name: 'Crate FC-08', type: 'crate', status: 'ready', occupant_type: null, occupant_id: null },
          { id: 'FC-09', name: 'Crate FC-09', type: 'crate', status: 'ready', occupant_type: null, occupant_id: null },
          { id: 'FC-10', name: 'Crate FC-10', type: 'crate', status: 'ready', occupant_type: null, occupant_id: null }
        ]
      },
      {
        id: 'barn-nursery',
        name: 'Nursery & Weaner House',
        type: 'Nursery',
        capacity_desc: '8 Climate-Controlled Weaner Pens (Up to 25 heads/pen)',
        pens: [
          { id: 'NP-01', name: 'Nursery Pen 1', type: 'group_pen', status: 'ready', capacity: 25, occupant_type: null, occupant_id: null },
          { id: 'NP-02', name: 'Nursery Pen 2', type: 'group_pen', status: 'ready', capacity: 25, occupant_type: null, occupant_id: null },
          { id: 'NP-03', name: 'Nursery Pen 3', type: 'group_pen', status: 'ready', capacity: 25, occupant_type: null, occupant_id: null },
          { id: 'NP-04', name: 'Nursery Pen 4', type: 'group_pen', status: 'resting', capacity: 25, rest_started: '2026-08-05', rest_days_required: 7 },
          { id: 'NP-05', name: 'Nursery Pen 5', type: 'group_pen', status: 'ready', capacity: 25, occupant_type: null, occupant_id: null },
          { id: 'NP-06', name: 'Nursery Pen 6', type: 'group_pen', status: 'ready', capacity: 25, occupant_type: null, occupant_id: null },
          { id: 'NP-07', name: 'Nursery Pen 7', type: 'group_pen', status: 'ready', capacity: 25, occupant_type: null, occupant_id: null },
          { id: 'NP-08', name: 'Nursery Pen 8', type: 'group_pen', status: 'ready', capacity: 25, occupant_type: null, occupant_id: null }
        ]
      },
      {
        id: 'barn-grower',
        name: 'Grow-Finish Barn 1',
        type: 'Grow-Finish',
        capacity_desc: '6 Heavy Finisher Pens (Up to 30 heads/pen)',
        pens: [
          { id: 'GF1-01', name: 'Grower Pen 1', type: 'group_pen', status: 'ready', capacity: 30, occupant_type: null, occupant_id: null },
          { id: 'GF1-02', name: 'Grower Pen 2', type: 'group_pen', status: 'ready', capacity: 30, occupant_type: null, occupant_id: null },
          { id: 'GF1-03', name: 'Grower Pen 3', type: 'group_pen', status: 'ready', capacity: 30, occupant_type: null, occupant_id: null },
          { id: 'GF1-04', name: 'Finisher Pen 4', type: 'group_pen', status: 'ready', capacity: 30, occupant_type: null, occupant_id: null },
          { id: 'GF1-05', name: 'Finisher Pen 5', type: 'group_pen', status: 'ready', capacity: 30, occupant_type: null, occupant_id: null },
          { id: 'GF1-06', name: 'Finisher Pen 6', type: 'group_pen', status: 'ready', capacity: 30, occupant_type: null, occupant_id: null }
        ]
      },
      {
        id: 'barn-quarantine',
        name: 'Biosecurity Quarantine & Hospital',
        type: 'Quarantine',
        capacity_desc: '4 Isolated Recovery / Biosecurity Pens',
        pens: [
          { id: 'Q-01', name: 'Quarantine Pen 1', type: 'isolation', status: 'ready', occupant_type: null, occupant_id: null },
          { id: 'Q-02', name: 'Quarantine Pen 2', type: 'isolation', status: 'ready', occupant_type: null, occupant_id: null },
          { id: 'Q-03', name: 'Hospital Treatment Pen 3', type: 'isolation', status: 'ready', occupant_type: null, occupant_id: null },
          { id: 'Q-04', name: 'Hospital Treatment Pen 4', type: 'isolation', status: 'ready', occupant_type: null, occupant_id: null }
        ]
      }
    ];
  }

  // Ensure Barns exist on active farm
  function ensureBarnsSeed() {
    const f = getFarm();
    if (!f) return;

    if (!Array.isArray(f.barns) || f.barns.length === 0) {
      f.barns = getSampleGuideBarns();
    }

    if (!Array.isArray(f.movements)) {
      f.movements = [];
    }
  }

  function resetDefaultBarns() {
    if (!confirm('Reset your farm housing layout to the default sample guide barns? (Any custom pens will be replaced with standard guide templates).')) return;
    const f = getFarm();
    f.barns = getSampleGuideBarns();
    if (window.save && typeof window.save === 'function') window.save();
    showToast('✓ Housing facilities reset to sample guide layout.');
    renderBarnsPage();
  }

  // Get occupant summary for a pen
  function getOccupantInfo(pen) {
    const f = getFarm();
    if (!pen || pen.status !== 'occupied') return null;

    if (pen.occupant_type === 'sow') {
      const sow = (f.sows || []).find(s => s.id === pen.occupant_id);
      return {
        title: sow ? `${sow.name} (${sow.id})` : pen.occupant_id,
        subtitle: sow ? `${sow.breed} · Parity ${sow.parity || 1}` : 'Sow',
        rfid: sow?.rfid || null,
        days: daysBetween(pen.occupied_since),
        type: 'sow'
      };
    }
    if (pen.occupant_type === 'boar') {
      const boar = (f.boars || f.semen || []).find(b => (b.id || b.boar) === pen.occupant_id);
      return {
        title: boar ? `${boar.name || boar.boar} (Stud)` : pen.occupant_id,
        subtitle: boar ? `${boar.breed} Boar` : 'Boar',
        rfid: boar?.rfid || null,
        days: daysBetween(pen.occupied_since),
        type: 'boar'
      };
    }
    if (pen.occupant_type === 'batch') {
      const batch = (f.piglets || []).find(b => b.id === (pen.batch_id || pen.occupant_id));
      const heads = batch ? (Number(batch.males || 0) + Number(batch.females || 0)) : 'Litter';
      return {
        title: `Batch ${batch?.id || pen.occupant_id}`,
        subtitle: batch ? `${heads} heads (${batch.sow} × ${batch.sire})` : 'Piglet Batch',
        rfid: batch?.rfid || null,
        days: daysBetween(pen.occupied_since),
        type: 'batch'
      };
    }
    return { title: pen.occupant_id || 'Occupied', subtitle: 'Animal', days: daysBetween(pen.occupied_since), type: 'animal' };
  }

  /* ─────────────────────────────────────────────────────────────────────────
     1. RENDER BARNS & MOVEMENTS CENTER (`#barns`)
     ───────────────────────────────────────────────────────────────────────── */
  function renderBarnsPage() {
    const container = document.getElementById('barns');
    if (!container) return;
    ensureBarnsSeed();
    const f = getFarm();

    let currentBarn = Array.isArray(f.barns) && f.barns.length > 0
      ? (f.barns.find(b => b.id === activeBarnId) || f.barns[0])
      : null;

    if (!currentBarn) {
      ensureBarnsSeed();
      currentBarn = (Array.isArray(f.barns) && f.barns.length > 0) ? (f.barns.find(b => b.id === activeBarnId) || f.barns[0]) : null;
      if (!currentBarn) return;
    }

    activeBarnId = currentBarn.id;

    // Farm-wide counts
    let totalPens = 0, totalOccupied = 0, totalResting = 0, totalDirty = 0, totalReady = 0;
    (f.barns || []).forEach(b => {
      (b.pens || []).forEach(p => {
        totalPens++;
        if (p.status === 'occupied') totalOccupied++;
        else if (p.status === 'resting') totalResting++;
        else if (p.status === 'dirty') totalDirty++;
        else totalReady++;
      });
    });

    const occupancyRate = totalPens ? Math.round((totalOccupied / totalPens) * 100) : 0;

    container.innerHTML = `
      <div class="barns-container">
        <!-- Top Summary Header -->
        <div class="barns-hero-card">
          <div class="hero-left">
            <div class="eyebrow">FACILITIES &amp; BIOSECURITY PROTOCOL</div>
            <h2>Multi-Barn Batch Movements</h2>
            <p>Customise your farm barns and pens, track animal movements, and manage sanitation downtime between batches.</p>
          </div>
          <div class="hero-right">
            <button type="button" class="btn ghost-light" onclick="window.openAddBarnModal()" style="margin-right:8px">
              + Add New Barn
            </button>
            <button type="button" class="btn" onclick="window.openMovementWizard()">
              <span class="btn-ico">🔄</span> Move Animal / Batch →
            </button>
          </div>
        </div>

        <!-- Biosecurity & Capacity Summary Metric Strip -->
        <div class="barns-metrics-strip">
          <div class="barn-stat-card">
            <div class="stat-num">${totalOccupied} / ${totalPens}</div>
            <div class="stat-lbl">Occupied Pens (${occupancyRate}%)</div>
            <div class="stat-sub">${(f.barns || []).length} active farm barns</div>
          </div>
          <div class="barn-stat-card ok">
            <div class="stat-num">${totalReady}</div>
            <div class="stat-lbl">Sanitized &amp; Ready</div>
            <div class="stat-sub">Cleaned &amp; cleared for entry</div>
          </div>
          <div class="barn-stat-card resting">
            <div class="stat-num">${totalResting}</div>
            <div class="stat-lbl">In Biosecurity Rest</div>
            <div class="stat-sub">Pathogen break downtime</div>
          </div>
          <div class="barn-stat-card warn">
            <div class="stat-num">${totalDirty}</div>
            <div class="stat-lbl">Pending Wash/Disinfect</div>
            <div class="stat-sub">Needs power-wash &amp; lime</div>
          </div>
        </div>

        <!-- Barn Selector Tabs & Controls -->
        <div class="barn-tabs-nav">
          ${(f.barns || []).map(b => `
            <button type="button" class="barn-tab-btn ${b.id === activeBarnId ? 'active' : ''}" onclick="window.switchActiveBarn('${b.id}')">
              <span class="barn-tab-ico">${getBarnIcon(b.type)}</span>
              <span class="barn-tab-title">${esc(b.name)}</span>
              <span class="barn-tab-badge">${(b.pens || []).filter(p => p.status === 'occupied').length}/${(b.pens || []).length}</span>
            </button>
          `).join('')}
          <button type="button" class="barn-tab-btn add-barn-tab" onclick="window.openAddBarnModal()" title="Create a new barn or facility">
            <span>+ Add Barn</span>
          </button>
          <button type="button" class="barn-tab-btn guide-tab" onclick="window.resetDefaultBarns()" title="Restore the standard guide template with 6 sample barns">
            <span>↻ Sample Guide</span>
          </button>
        </div>

        <!-- Active Barn Header & Pen Grid -->
        <div class="active-barn-panel">
          <div class="active-barn-header">
            <div>
              <h3>${esc(currentBarn.name)} <span class="barn-type-pill">${esc(currentBarn.type)}</span></h3>
              <p class="muted">${esc(currentBarn.capacity_desc || 'Housing zone')}</p>
            </div>
            <div class="barn-actions">
              <button type="button" class="btn ghost small" onclick="window.openEditBarnModal('${currentBarn.id}')" title="Edit this barn's name and details">✏️ Edit Barn</button>
              <button type="button" class="btn ghost small" onclick="window.openAddPenModal('${currentBarn.id}')" title="Add a new stall, crate or pen">+ Add Pen / Stall</button>
              <button type="button" class="btn ghost small" onclick="window.cleanAllBarnPens('${currentBarn.id}')" title="Disinfect all empty pens">✨ Disinfect All Vacant</button>
              <button type="button" class="btn small" onclick="window.openMovementWizard(null, null, '${currentBarn.id}')">+ Move Animal Here</button>
              ${(f.barns || []).length > 1 ? `
                <button type="button" class="btn ghost small danger-btn" onclick="window.deleteBarn('${currentBarn.id}')" title="Delete this entire barn">🗑️ Delete Barn</button>
              ` : ''}
            </div>
          </div>

          <!-- Pen Occupancy Matrix Grid -->
          <div class="pen-grid">
            ${(currentBarn.pens || []).length > 0 ? (currentBarn.pens || []).map(p => renderPenCard(currentBarn, p)).join('') : `
              <div class="empty-pen-box">
                <p>No pens or stalls created in this barn yet.</p>
                <button type="button" class="btn small" onclick="window.openAddPenModal('${currentBarn.id}')">+ Add First Pen</button>
              </div>
            `}
          </div>
        </div>

        <!-- Movement Audit Trail & Manifest Section -->
        <div class="movements-audit-section">
          <div class="audit-header">
            <div>
              <h3>📋 Animal Movement Audit Trail &amp; Biosecurity Log</h3>
              <p class="muted">Immutable record of all barn and pen relocations with RFID verification</p>
            </div>
            <div>
              <button type="button" class="btn ghost small" onclick="window.printMovementManifest()">🖨️ Print Movement Manifest</button>
            </div>
          </div>

          <div class="movements-table-wrap">
            <table class="movements-table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Animal / Batch</th>
                  <th>Origin Housing</th>
                  <th>Destination Housing</th>
                  <th>Relocation Purpose</th>
                  <th>Operator</th>
                  <th>RFID Status</th>
                </tr>
              </thead>
              <tbody>
                ${(f.movements || []).slice(0, 15).map(m => `
                  <tr>
                    <td><b>${fmtDate(m.date)}</b></td>
                    <td>
                      <b>${esc(m.animal_name || m.animal_id)}</b>
                      <br><small class="muted">${esc(m.animal_type?.toUpperCase() || 'ANIMAL')}</small>
                    </td>
                    <td><span class="loc-tag from">${esc(m.from_barn)} · ${esc(m.from_pen)}</span></td>
                    <td><span class="loc-tag to">➔ ${esc(m.to_barn)} · ${esc(m.to_pen)}</span></td>
                    <td><span class="reason-pill">${esc(m.reason)}</span></td>
                    <td><small>${esc(m.operator || 'Farm Staff')}</small></td>
                    <td>
                      ${m.rfid_verified ? `
                        <span class="rfid-tag-badge verified">✓ RFID Verified</span>
                      ` : `
                        <span class="rfid-tag-badge manual">Manual Move</span>
                      `}
                    </td>
                  </tr>
                `).join('') || `<tr><td colspan="7" class="empty-msg">No animal movements recorded yet.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  function getBarnIcon(type) {
    switch (String(type).toLowerCase()) {
      case 'breeding': return '♂';
      case 'gestation': return '♀';
      case 'farrowing': return '🍼';
      case 'nursery': return '🐷';
      case 'grow-finish': return '🌾';
      case 'quarantine': return '🛡️';
      default: return '🏢';
    }
  }

  function renderPenCard(barn, pen) {
    const status = pen.status || 'ready';
    const occ = getOccupantInfo(pen);

    let statusLabel = 'Ready for Next Batch';
    let statusClass = 'ready';
    let bodyContent = '';

    if (status === 'occupied' && occ) {
      statusLabel = 'Occupied';
      statusClass = 'occupied';
      bodyContent = `
        <div class="pen-occupant-box">
          <div class="occ-avatar ${occ.type}">${occ.type === 'sow' ? '♀' : occ.type === 'boar' ? '♂' : '●'}</div>
          <div class="occ-meta">
            <b>${esc(occ.title)}</b>
            <small>${esc(occ.subtitle)}</small>
            ${occ.rfid ? `<div class="pen-rfid-chip">📡 ${esc(occ.rfid)}</div>` : ''}
          </div>
        </div>
        <div class="pen-duration-pill">⏱️ ${occ.days} days in this pen</div>
      `;
    } else if (status === 'resting') {
      statusLabel = 'In Biosecurity Rest';
      statusClass = 'resting';
      const daysResting = daysBetween(pen.rest_started);
      const reqDays = pen.rest_days_required || 5;
      const progress = Math.min(100, Math.round((daysResting / reqDays) * 100));
      bodyContent = `
        <div class="pen-rest-box">
          <div class="rest-title">🛡️ Sanitation Downtime</div>
          <div class="rest-sub">Day ${daysResting} of ${reqDays} days rest required</div>
          <div class="rest-progress-bar"><div class="rest-fill" style="width:${progress}%"></div></div>
        </div>
      `;
    } else if (status === 'dirty') {
      statusLabel = 'Needs Disinfection';
      statusClass = 'dirty';
      bodyContent = `
        <div class="pen-dirty-box">
          <div class="dirty-icon">⚠️</div>
          <b>Empty · Unsanitized</b>
          <small>Needs power-wash &amp; chemical spray before housing animals</small>
        </div>
      `;
    } else {
      statusLabel = 'Ready / Cleared';
      statusClass = 'ready';
      bodyContent = `
        <div class="pen-ready-box">
          <div class="ready-icon">✓</div>
          <b>Sanitized &amp; Clear</b>
          <small>Biosecurity downtime completed</small>
        </div>
      `;
    }

    return `
      <div class="pen-card ${statusClass}">
        <div class="pen-card-head">
          <div class="pen-name-tag"><b>${esc(pen.id)}</b> <small>${esc(pen.name || pen.id)}</small></div>
          <span class="pen-status-badge ${statusClass}">● ${statusLabel}</span>
        </div>
        <div class="pen-card-body">
          ${bodyContent}
        </div>
        <div class="pen-card-foot">
          ${status === 'occupied' ? `
            <button type="button" class="btn ghost small" onclick="window.openMovementWizard('${escJS(pen.occupant_id)}', '${escJS(pen.occupant_type)}')">Transfer →</button>
            <button type="button" class="btn ghost small" onclick="window.vacatePen('${barn.id}', '${pen.id}')">Vacate</button>
            <button type="button" class="btn ghost small pen-edit-btn" onclick="window.openEditPenModal('${barn.id}', '${pen.id}')" title="Edit pen">✏️</button>
          ` : status === 'dirty' ? `
            <button type="button" class="btn small" onclick="window.startPenRest('${barn.id}', '${pen.id}')">🧼 Disinfect &amp; Rest</button>
            <button type="button" class="btn ghost small pen-edit-btn" onclick="window.openEditPenModal('${barn.id}', '${pen.id}')" title="Edit pen">✏️</button>
            <button type="button" class="btn ghost small danger-btn" onclick="window.deletePen('${barn.id}', '${pen.id}')" title="Delete pen">🗑️</button>
          ` : status === 'resting' ? `
            <button type="button" class="btn small ok" onclick="window.clearPenRest('${barn.id}', '${pen.id}')">✓ Clear for Entry</button>
            <button type="button" class="btn ghost small pen-edit-btn" onclick="window.openEditPenModal('${barn.id}', '${pen.id}')" title="Edit pen">✏️</button>
            <button type="button" class="btn ghost small danger-btn" onclick="window.deletePen('${barn.id}', '${pen.id}')" title="Delete pen">🗑️</button>
          ` : `
            <button type="button" class="btn small" onclick="window.openMovementWizard(null, null, '${barn.id}', '${pen.id}')">+ Assign</button>
            <button type="button" class="btn ghost small pen-edit-btn" onclick="window.openEditPenModal('${barn.id}', '${pen.id}')" title="Edit pen">✏️</button>
            <button type="button" class="btn ghost small danger-btn" onclick="window.deletePen('${barn.id}', '${pen.id}')" title="Delete pen">🗑️</button>
          `}
        </div>
      </div>
    `;
  }

  /* ─────────────────────────────────────────────────────────────────────────
     2. BARN CRUD MODALS & ACTIONS
     ───────────────────────────────────────────────────────────────────────── */
  function openAddBarnModal(editBarnId) {
    closeBarnCrudModal();
    const f = getFarm();
    const isEdit = Boolean(editBarnId);
    const barn = isEdit ? (f.barns || []).find(b => b.id === editBarnId) : null;

    const modal = document.createElement('div');
    modal.id = 'barnCrudModal';
    modal.className = 'rfid-modal-backdrop';

    modal.innerHTML = `
      <div class="movement-wizard-card">
        <div class="wizard-header">
          <div class="eyebrow">${isEdit ? 'EDIT HOUSING FACILITY' : 'ADD NEW BARN / BUILDING'}</div>
          <h3>${isEdit ? 'Edit ' + esc(barn.name) : 'Create New Farm Barn'}</h3>
          <button class="rfid-close-btn" onclick="window.closeBarnCrudModal()">×</button>
        </div>

        <form onsubmit="window.saveBarnModal(event, '${isEdit ? editBarnId : ''}')">
          <div class="wizard-body">
            <div class="field">
              <label>Barn Name *</label>
              <input name="barn_name" required value="${esc(barn?.name || '')}" placeholder="e.g. Gestation Barn B, Weaner House 2...">
            </div>

            <div class="form-grid-2">
              <div class="field">
                <label>Facility Type *</label>
                <select name="barn_type" required>
                  ${['Gestation', 'Farrowing', 'Nursery', 'Grow-Finish', 'Breeding', 'Quarantine', 'Custom'].map(t => `
                    <option value="${t}" ${barn?.type === t ? 'selected' : ''}>${t}</option>
                  `).join('')}
                </select>
              </div>

              <div class="field">
                <label>Capacity / Structure Description</label>
                <input name="capacity_desc" value="${esc(barn?.capacity_desc || '')}" placeholder="e.g. 12 Heated farrowing crates">
              </div>
            </div>

            ${!isEdit ? `
              <div class="field full auto-gen-box">
                <label><b>⚡ Auto-Generate Initial Pens / Stalls:</b></label>
                <div class="form-grid-2" style="margin-top:6px">
                  <div>
                    <small class="muted">Pen ID Prefix (e.g. G, FC, NP, P):</small>
                    <input name="pen_prefix" placeholder="e.g. P" value="P">
                  </div>
                  <div>
                    <small class="muted">Number of Pens / Stalls to create:</small>
                    <input name="initial_pen_count" type="number" min="0" max="100" value="8">
                  </div>
                </div>
              </div>
            ` : ''}
          </div>

          <div class="wizard-footer">
            <button type="button" class="btn ghost" onclick="window.closeBarnCrudModal()">Cancel</button>
            <button type="submit" class="btn">${isEdit ? '✓ Update Barn' : '✓ Create Barn'}</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);
  }

  function saveBarnModal(event, editBarnId) {
    event.preventDefault();
    const form = event.target;
    const name = form.barn_name.value.trim();
    const type = form.barn_type.value;
    const capacity_desc = form.capacity_desc.value.trim();

    const f = getFarm();
    ensureBarnsSeed();

    if (editBarnId) {
      // Edit existing barn
      const barn = (f.barns || []).find(b => b.id === editBarnId);
      if (barn) {
        barn.name = name;
        barn.type = type;
        barn.capacity_desc = capacity_desc;
        showToast(`✓ Updated ${name}`);
      }
    } else {
      // Create new barn
      const prefix = (form.pen_prefix?.value || 'P').trim().toUpperCase();
      const count = parseInt(form.initial_pen_count?.value || '0', 10);
      const newBarnId = 'barn-' + Date.now().toString(36);

      const newPens = [];
      for (let i = 1; i <= count; i++) {
        const penId = `${prefix}-${String(i).padStart(2, '0')}`;
        newPens.push({
          id: penId,
          name: `Stall / Pen ${penId}`,
          type: type === 'Farrowing' ? 'crate' : type === 'Gestation' ? 'stall' : 'group_pen',
          status: 'ready',
          occupant_type: null,
          occupant_id: null
        });
      }

      const newBarn = {
        id: newBarnId,
        name,
        type,
        capacity_desc: capacity_desc || `${count} ${type} Pens`,
        pens: newPens
      };

      f.barns.push(newBarn);
      activeBarnId = newBarnId;
      showToast(`✓ Created new barn: ${name} with ${count} pens`);
    }

    if (window.save && typeof window.save === 'function') window.save();
    closeBarnCrudModal();
    renderBarnsPage();
  }

  function deleteBarn(barnId) {
    const f = getFarm();
    const barn = (f.barns || []).find(b => b.id === barnId);
    if (!barn) return;

    // Check if barn has active animals
    const occupiedCount = (barn.pens || []).filter(p => p.status === 'occupied').length;
    if (occupiedCount > 0) {
      alert(`Cannot delete ${barn.name}: There are currently ${occupiedCount} animals housed in this barn. Please transfer or vacate the animals first.`);
      return;
    }

    if (!confirm(`Are you sure you want to delete "${barn.name}" and its ${(barn.pens || []).length} pens?`)) return;

    f.barns = f.barns.filter(b => b.id !== barnId);
    if (activeBarnId === barnId) {
      activeBarnId = f.barns[0]?.id || 'barn-gest';
    }

    if (window.save && typeof window.save === 'function') window.save();
    showToast(`🗑️ Deleted barn: ${barn.name}`);
    renderBarnsPage();
  }

  /* ─────────────────────────────────────────────────────────────────────────
     3. PEN / STALL CRUD MODALS & ACTIONS
     ───────────────────────────────────────────────────────────────────────── */
  function openAddPenModal(barnId, editPenId) {
    closeBarnCrudModal();
    const f = getFarm();
    const barn = (f.barns || []).find(b => b.id === barnId);
    if (!barn) return;

    const isEdit = Boolean(editPenId);
    const pen = isEdit ? (barn.pens || []).find(p => p.id === editPenId) : null;

    // Default next pen ID
    const nextNum = (barn.pens || []).length + 1;
    const defaultPrefix = barn.type === 'Farrowing' ? 'FC' : barn.type === 'Gestation' ? 'G' : barn.type === 'Nursery' ? 'NP' : 'P';
    const defaultId = `${defaultPrefix}-${String(nextNum).padStart(2, '0')}`;

    const modal = document.createElement('div');
    modal.id = 'barnCrudModal';
    modal.className = 'rfid-modal-backdrop';

    modal.innerHTML = `
      <div class="movement-wizard-card">
        <div class="wizard-header">
          <div class="eyebrow">${isEdit ? 'EDIT STALL / PEN' : 'ADD PEN TO ' + esc(barn.name).toUpperCase()}</div>
          <h3>${isEdit ? 'Edit ' + esc(pen.id) : 'Add New Stall / Pen'}</h3>
          <button class="rfid-close-btn" onclick="window.closeBarnCrudModal()">×</button>
        </div>

        <form onsubmit="window.savePenModal(event, '${barnId}', '${isEdit ? editPenId : ''}')">
          <div class="wizard-body">
            <div class="form-grid-2">
              <div class="field">
                <label>Stall / Pen ID *</label>
                <input name="pen_id" required value="${esc(pen?.id || defaultId)}" placeholder="e.g. G-17, FC-11" ${isEdit ? 'readonly' : ''}>
              </div>

              <div class="field">
                <label>Pen Display Name</label>
                <input name="pen_name" value="${esc(pen?.name || '')}" placeholder="e.g. Crate 11, Gestation Stall 17">
              </div>
            </div>

            <div class="form-grid-2">
              <div class="field">
                <label>Housing Type</label>
                <select name="pen_type">
                  ${['stall', 'crate', 'group_pen', 'isolation'].map(t => `
                    <option value="${t}" ${pen?.type === t ? 'selected' : ''}>${t.replace('_', ' ').toUpperCase()}</option>
                  `).join('')}
                </select>
              </div>

              <div class="field">
                <label>Capacity (Headcount)</label>
                <input name="capacity" type="number" min="1" value="${pen?.capacity || (barn.type === 'Nursery' ? 25 : barn.type === 'Grow-Finish' ? 30 : 1)}">
              </div>
            </div>

            <div class="field">
              <label>Initial Status</label>
              <select name="pen_status" ${pen?.status === 'occupied' ? 'disabled' : ''}>
                <option value="ready" ${pen?.status === 'ready' ? 'selected' : ''}>🟢 Ready / Cleared for Entry</option>
                <option value="resting" ${pen?.status === 'resting' ? 'selected' : ''}>🔵 In Biosecurity Rest</option>
                <option value="dirty" ${pen?.status === 'dirty' ? 'selected' : ''}>🟡 Needs Cleaning &amp; Disinfection</option>
                ${pen?.status === 'occupied' ? '<option value="occupied" selected>Occupied (Active Animal Inside)</option>' : ''}
              </select>
            </div>
          </div>

          <div class="wizard-footer">
            <button type="button" class="btn ghost" onclick="window.closeBarnCrudModal()">Cancel</button>
            <button type="submit" class="btn">${isEdit ? '✓ Update Pen' : '✓ Add Pen'}</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(modal);
  }

  function savePenModal(event, barnId, editPenId) {
    event.preventDefault();
    const form = event.target;
    const penId = form.pen_id.value.trim().toUpperCase();
    const penName = form.pen_name.value.trim() || `Stall / Pen ${penId}`;
    const penType = form.pen_type.value;
    const capacity = parseInt(form.capacity.value || '1', 10);
    const penStatus = form.pen_status.value;

    const f = getFarm();
    const barn = (f.barns || []).find(b => b.id === barnId);
    if (!barn) return;

    if (!Array.isArray(barn.pens)) barn.pens = [];

    if (editPenId) {
      // Edit existing pen
      const pen = barn.pens.find(p => p.id === editPenId);
      if (pen) {
        pen.name = penName;
        pen.type = penType;
        pen.capacity = capacity;
        if (pen.status !== 'occupied') pen.status = penStatus;
        showToast(`✓ Updated pen ${pen.id}`);
      }
    } else {
      // Check ID uniqueness in barn
      if (barn.pens.some(p => p.id === penId)) {
        alert(`Pen ID "${penId}" already exists in ${barn.name}. Use a unique ID.`);
        return;
      }

      barn.pens.push({
        id: penId,
        name: penName,
        type: penType,
        capacity,
        status: penStatus,
        occupant_type: null,
        occupant_id: null
      });
      showToast(`✓ Added pen ${penId} to ${barn.name}`);
    }

    if (window.save && typeof window.save === 'function') window.save();
    closeBarnCrudModal();
    renderBarnsPage();
  }

  function deletePen(barnId, penId) {
    const f = getFarm();
    const barn = (f.barns || []).find(b => b.id === barnId);
    if (!barn) return;

    const pen = (barn.pens || []).find(p => p.id === penId);
    if (!pen) return;

    if (pen.status === 'occupied') {
      alert(`Cannot delete ${penId}: There is currently an animal inside this pen. Relocate the animal first.`);
      return;
    }

    if (!confirm(`Delete pen "${penId}" from ${barn.name}?`)) return;

    barn.pens = barn.pens.filter(p => p.id !== penId);
    if (window.save && typeof window.save === 'function') window.save();
    showToast(`🗑️ Deleted pen ${penId}`);
    renderBarnsPage();
  }

  function closeBarnCrudModal() {
    const el = document.getElementById('barnCrudModal');
    if (el) el.remove();
  }

  /* ─────────────────────────────────────────────────────────────────────────
     4. MOVEMENT WIZARD — SEARCHABLE AUTO-SUGGEST ENGINE
     ───────────────────────────────────────────────────────────────────────── */
  
  function closeMovementWizard() {
    const el = document.getElementById("movementWizardModal");
    if (el) el.remove();
    if (document.removeEventListener) document.removeEventListener("click", onDocumentWizardClick);
  }

  function openMovementWizard(preAnimalId, preAnimalType, targetBarnId, targetPenId) {
    closeMovementWizard();
    ensureBarnsSeed();
    const f = getFarm();

    const wizard = document.createElement("div");
    wizard.id = "movementWizardModal";
    wizard.className = "rfid-modal-backdrop";

    wizard.innerHTML = `
      <div class="movement-wizard-card">
        <div class="wizard-header">
          <div class="eyebrow">FACILITIES &amp; BIOSECURITY PROTOCOL · MULTI-BARN BATCH MOVEMENTS</div>
          <h3>Relocate Animal or Batch</h3>
          <button class="rfid-close-btn" onclick="window.closeMovementWizard()">×</button>
        </div>

        <form id="movementWizardForm" onsubmit="window.executeMovement(event)">
          <div class="wizard-body">
            <!-- 1. Animal Auto-Suggest Field -->
            <div class="field suggest-field" id="movAnimalSuggestWrap">
              <label>1. Select Animal or Piglet Batch *</label>
              <div class="animal-picker-row">
                <div class="suggest-input-wrap">
                  <input type="text" id="movAnimalInput" class="suggest-input" placeholder="Type name, ID, breed, ear-notch..." autocomplete="off" onfocus="window.filterAnimalSuggest(this.value)" oninput="window.filterAnimalSuggest(this.value)">
                  <input type="hidden" id="movAnimalSelect" name="animal_val" required>
                  <button type="button" class="suggest-clear-btn" id="movAnimalClear" onclick="window.clearAnimalSuggest()" style="display:none">✕</button>
                  <div class="suggest-dropdown" id="movAnimalDropdown" style="display:none"></div>
                </div>
                <button type="button" class="btn ghost scan-btn-mini" onclick="window.openScannerModal()" title="Scan RFID Tag to Auto-Fill">📡 Scan Tag</button>
              </div>
            </div>

            <!-- Origin Housing Preview -->
            <div class="field full">
              <label>Current Origin Housing Location:</label>
              <div id="originLocationText" class="loc-origin-preview">
                Search or select an animal above to load its current pen location.
              </div>
            </div>

            <!-- Destination Barn & Pen Auto-Suggest Row -->
            <div class="form-grid-2">
              <!-- 2. Destination Barn Auto-Suggest -->
              <div class="field suggest-field" id="movBarnSuggestWrap">
                <label>2. Destination Barn *</label>
                <div class="suggest-input-wrap">
                  <input type="text" id="movBarnInput" class="suggest-input" placeholder="Type barn name or type..." autocomplete="off" onfocus="window.filterBarnSuggest(this.value)" oninput="window.filterBarnSuggest(this.value)">
                  <input type="hidden" id="movTargetBarn" name="target_barn_id" required>
                  <button type="button" class="suggest-clear-btn" id="movBarnClear" onclick="window.clearBarnSuggest()" style="display:none">✕</button>
                  <div class="suggest-dropdown" id="movBarnDropdown" style="display:none"></div>
                </div>
              </div>

              <!-- 3. Destination Stall / Pen Auto-Suggest -->
              <div class="field suggest-field" id="movPenSuggestWrap">
                <label>3. Destination Stall / Pen *</label>
                <div class="suggest-input-wrap">
                  <input type="text" id="movPenInput" class="suggest-input" placeholder="Type pen ID, name, or status..." autocomplete="off" onfocus="window.filterPenSuggest(this.value)" oninput="window.filterPenSuggest(this.value)">
                  <input type="hidden" id="movTargetPen" name="target_pen_id" required>
                  <button type="button" class="suggest-clear-btn" id="movPenClear" onclick="window.clearPenSuggest()" style="display:none">✕</button>
                  <div class="suggest-dropdown" id="movPenDropdown" style="display:none"></div>
                </div>
              </div>
            </div>

            <!-- Movement Purpose & Date Row -->
            <div class="form-grid-2">
              <!-- 4. Purpose Auto-Suggest -->
              <div class="field suggest-field" id="movReasonSuggestWrap">
                <label>4. Movement Purpose / Stage *</label>
                <div class="suggest-input-wrap">
                  <input type="text" id="movReasonInput" class="suggest-input" placeholder="Select or type reason..." value="Pre-Farrowing Crate Relocation (Day 110)" autocomplete="off" onfocus="window.filterReasonSuggest(this.value)" oninput="window.filterReasonSuggest(this.value)">
                  <input type="hidden" id="movReason" name="movement_reason" required value="Pre-Farrowing Crate Relocation (Day 110)">
                  <div class="suggest-dropdown" id="movReasonDropdown" style="display:none"></div>
                </div>
              </div>

              <div class="field">
                <label>5. Relocation Date *</label>
                <input type="date" id="movDate" value="${new Date().toISOString().slice(0, 10)}" required>
              </div>
            </div>

            <div class="field full">
              <label>Operator / Notes</label>
              <input type="text" id="movNotes" placeholder="e.g. Relocated by Farm Manager, checked body condition...">
            </div>
          </div>

          <div class="wizard-footer">
            <button type="button" class="btn ghost" onclick="window.closeMovementWizard()">Cancel</button>
            <button type="submit" class="btn">✓ Confirm &amp; Log Relocation</button>
          </div>
        </form>
      </div>
    `;

    document.body.appendChild(wizard);

    // If preselected animal or barn was passed, pre-fill them
    if (preAnimalId) {
      preSelectAnimal(preAnimalId, preAnimalType);
    }
    if (targetBarnId) {
      preSelectBarn(targetBarnId, targetPenId);
    }

    // Close dropdowns on outside click
    document.addEventListener("click", onDocumentWizardClick);
  }

  function onDocumentWizardClick(e) {
    if (!e.target.closest("#movementWizardModal")) return;
    if (!e.target.closest(".suggest-input-wrap")) {
      closeAllWizardDropdowns();
    }
  }

  function closeAllWizardDropdowns() {
    document.querySelectorAll(".suggest-dropdown").forEach(d => d.style.display = "none");
  }

  /* ── 1. Animal Auto-Suggest Logic ── */
  let cachedAnimalSuggestHits = [];
  let cachedBarnSuggestHits = [];
  let cachedPenSuggestHits = [];
  let cachedReasonSuggestHits = [];

  window.filterAnimalSuggest = function(query) {
    const dropdown = document.getElementById("movAnimalDropdown");
    const clearBtn = document.getElementById("movAnimalClear");
    if (!dropdown) return;

    const q = String(query || "").trim().toLowerCase();
    if (clearBtn) clearBtn.style.display = q ? "block" : "none";

    const f = getFarm();
    const list = [];

    // Sows
    (f.sows || []).filter(s => !s.culled).forEach(s => {
      const barnName = (f.barns || []).find(b => b.id === s.barn_id)?.name || s.barn_id || "Gestation Barn A";
      const penName = s.pen_id || "G-01";
      const sId = s.id || s.name;
      list.push({
        type: "sow",
        id: sId,
        val: `sow:${sId}`,
        name: s.name || sId,
        title: `${s.name || sId} (${sId})`,
        sub: `${s.breed || "Sow"} · Parity ${s.parity || 1}`,
        loc: `${barnName} — ${penName}`,
        ico: "♀",
        tag: s.rfid || ""
      });
    });

    // Boars
    (f.boars || f.semen || []).forEach(b => {
      const bId = b.id || b.name || b.boar;
      const barnName = (f.barns || []).find(x => x.id === b.barn_id)?.name || b.barn_id || "Breeding Stud";
      const penName = b.pen_id || "BR-01";
      list.push({
        type: "boar",
        id: bId,
        val: `boar:${bId}`,
        name: b.name || b.boar || bId,
        title: `${b.name || b.boar || bId} (${bId})`,
        sub: `${b.breed || "Boar"} Stud`,
        loc: `${barnName} — ${penName}`,
        ico: "♂",
        tag: b.rfid || ""
      });
    });

    // Piglet Batches
    (f.piglets || []).forEach(b => {
      const barnName = (f.barns || []).find(x => x.id === b.barn_id)?.name || b.barn_id || "Farrowing House 1";
      const penName = b.pen_id || "FC-01";
      const heads = (Number(b.males || 0) + Number(b.females || 0)) || "Litter";
      list.push({
        type: "batch",
        id: b.id,
        val: `batch:${b.id}`,
        name: `Batch ${b.id}`,
        title: `Batch ${b.id} (${b.sow || "Sow"} × ${b.sire || "Sire"})`,
        sub: `${heads} heads · Born ${fmtDate(b.birth)}`,
        loc: `${barnName} — ${penName}`,
        ico: "●",
        tag: b.rfid || ""
      });
    });

    // Filter
    cachedAnimalSuggestHits = list.filter(item => {
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.sub.toLowerCase().includes(q) ||
        item.loc.toLowerCase().includes(q) ||
        item.tag.toLowerCase().includes(q)
      );
    });

    if (!cachedAnimalSuggestHits.length) {
      dropdown.innerHTML = `<div class="suggest-empty">No matching sows, boars, or piglet batches found.</div>`;
      dropdown.style.display = "block";
      return;
    }

    dropdown.innerHTML = cachedAnimalSuggestHits.map((item, idx) => `
      <div class="suggest-item" onmousedown="window.selectAnimalSuggestByIndex(${idx})" ontouchstart="window.selectAnimalSuggestByIndex(${idx})">
        <div class="suggest-ico ${item.type}">${item.ico}</div>
        <div class="suggest-meta">
          <b>${esc(item.title)}</b>
          <small>${esc(item.sub)} · <span class="suggest-loc-tag">[${esc(item.loc)}]</span></small>
        </div>
      </div>
    `).join("");

    dropdown.style.display = "block";
  };

  window.selectAnimalSuggestByIndex = function(idx) {
    const item = cachedAnimalSuggestHits[idx];
    if (!item) return;

    const input = document.getElementById("movAnimalInput");
    const hidden = document.getElementById("movAnimalSelect");
    const preview = document.getElementById("originLocationText");
    const clearBtn = document.getElementById("movAnimalClear");

    if (input) input.value = item.title;
    if (hidden) hidden.value = item.val;
    if (clearBtn) clearBtn.style.display = "block";
    if (preview) preview.innerHTML = `<b>Current Origin Housing:</b> <span class="loc-tag from">${esc(item.loc)}</span>`;

    closeAllWizardDropdowns();
  };

  window.selectAnimalSuggest = function(val, label, loc) {
    const input = document.getElementById("movAnimalInput");
    const hidden = document.getElementById("movAnimalSelect");
    const preview = document.getElementById("originLocationText");
    const clearBtn = document.getElementById("movAnimalClear");

    if (input) input.value = label;
    if (hidden) hidden.value = val;
    if (clearBtn) clearBtn.style.display = "block";
    if (preview) preview.innerHTML = `<b>Current Origin Housing:</b> <span class="loc-tag from">${esc(loc)}</span>`;

    closeAllWizardDropdowns();
  };

  window.clearAnimalSuggest = function() {
    const input = document.getElementById("movAnimalInput");
    const hidden = document.getElementById("movAnimalSelect");
    const preview = document.getElementById("originLocationText");
    const clearBtn = document.getElementById("movAnimalClear");

    if (input) { input.value = ""; input.focus(); }
    if (hidden) hidden.value = "";
    if (clearBtn) clearBtn.style.display = "none";
    if (preview) preview.innerHTML = "Search or select an animal above to load its current pen location.";
    window.filterAnimalSuggest("");
  };

  function preSelectAnimal(animalId, animalType) {
    const f = getFarm();
    let found = null;
    const cleanTarget = String(animalId || "").trim().toLowerCase();

    if (animalType === "sow") {
      const sow = (f.sows || []).find(s =>
        (s.id && String(s.id).trim().toLowerCase() === cleanTarget) ||
        (s.name && String(s.name).trim().toLowerCase() === cleanTarget) ||
        (cleanTarget && String(s.id || s.name || "").toLowerCase().includes(cleanTarget))
      ) || (f.sows && f.sows[0]);

      if (sow) {
        const sId = sow.id || sow.name || "sow";
        const barnName = (f.barns || []).find(b => b.id === sow.barn_id)?.name || sow.barn_id || "Gestation Barn A";
        found = { val: `sow:${sId}`, title: `${sow.name || sow.id || 'Sow'} (${sId})`, loc: `${barnName} — ${sow.pen_id || "Unassigned Stall"}` };
      }
    } else if (animalType === "boar") {
      const boar = (f.boars || f.semen || []).find(b =>
        (b.id && String(b.id).trim().toLowerCase() === cleanTarget) ||
        (b.name && String(b.name).trim().toLowerCase() === cleanTarget) ||
        (b.boar && String(b.boar).trim().toLowerCase() === cleanTarget)
      );
      if (boar) {
        const bId = boar.id || boar.name || boar.boar;
        const barnName = (f.barns || []).find(b => b.id === boar.barn_id)?.name || boar.barn_id || "Breeding Stud";
        found = { val: `boar:${bId}`, title: `${boar.name || boar.boar || bId} (${bId})`, loc: `${barnName} — ${boar.pen_id || "BR-01"}` };
      }
    } else if (animalType === "batch" || animalType === "piglet_batch") {
      const batch = (f.piglets || []).find(b =>
        String(b.id).trim().toLowerCase() === cleanTarget ||
        (cleanTarget && String(b.id).toLowerCase().includes(cleanTarget))
      );
      if (batch) {
        const barnName = (f.barns || []).find(b => b.id === batch.barn_id)?.name || batch.barn_id || "Farrowing House 1";
        found = { val: `batch:${batch.id}`, title: `Batch ${batch.id} (${batch.sow || 'Sow'} × ${batch.sire || 'Sire'})`, loc: `${barnName} — ${batch.pen_id || "FC-01"}` };
      }
    }

    if (found) {
      window.selectAnimalSuggest(found.val, found.title, found.loc);
    }
  }

  /* ── 2. Destination Barn Auto-Suggest Logic ── */
  window.filterBarnSuggest = function(query) {
    const dropdown = document.getElementById("movBarnDropdown");
    const clearBtn = document.getElementById("movBarnClear");
    if (!dropdown) return;

    const q = String(query || "").trim().toLowerCase();
    if (clearBtn) clearBtn.style.display = q ? "block" : "none";

    const f = getFarm();
    const barns = f.barns || [];

    cachedBarnSuggestHits = barns.filter(b => {
      if (!q) return true;
      return (
        (b.name || "").toLowerCase().includes(q) ||
        (b.type || "").toLowerCase().includes(q) ||
        (b.capacity_desc || "").toLowerCase().includes(q)
      );
    });

    if (!cachedBarnSuggestHits.length) {
      dropdown.innerHTML = `<div class="suggest-empty">No matching barns found.</div>`;
      dropdown.style.display = "block";
      return;
    }

    dropdown.innerHTML = cachedBarnSuggestHits.map((b, idx) => {
      const totalP = (b.pens || []).length;
      const occP = (b.pens || []).filter(p => p.status === "occupied").length;
      return `
        <div class="suggest-item" onmousedown="window.selectBarnSuggestByIndex(${idx})" ontouchstart="window.selectBarnSuggestByIndex(${idx})">
          <div class="suggest-ico barn">${getBarnIcon(b.type)}</div>
          <div class="suggest-meta">
            <b>${esc(b.name)}</b>
            <small>${esc(b.type)} · <span class="suggest-badge">${occP}/${totalP} occupied</span></small>
          </div>
        </div>
      `;
    }).join("");

    dropdown.style.display = "block";
  };

  window.selectBarnSuggestByIndex = function(idx) {
    const b = cachedBarnSuggestHits[idx];
    if (!b) return;
    window.selectBarnSuggest(b.id, `${b.name} (${b.type})`);
  };

  window.selectBarnSuggest = function(barnId, label) {
    const input = document.getElementById("movBarnInput");
    const hidden = document.getElementById("movTargetBarn");
    const clearBtn = document.getElementById("movBarnClear");

    if (input) input.value = label;
    if (hidden) hidden.value = barnId;
    if (clearBtn) clearBtn.style.display = "block";

    // Clear and prompt Destination Pen selection
    window.clearPenSuggest();
    closeAllWizardDropdowns();

    // Auto-focus and open the Pen dropdown
    const penInput = document.getElementById("movPenInput");
    if (penInput) {
      penInput.focus();
      window.filterPenSuggest("");
    }
  };

  window.clearBarnSuggest = function() {
    const input = document.getElementById("movBarnInput");
    const hidden = document.getElementById("movTargetBarn");
    const clearBtn = document.getElementById("movBarnClear");

    if (input) { input.value = ""; input.focus(); }
    if (hidden) hidden.value = "";
    if (clearBtn) clearBtn.style.display = "none";
    window.clearPenSuggest();
    window.filterBarnSuggest("");
  };

  function preSelectBarn(barnId, penId) {
    const f = getFarm();
    const barn = (f.barns || []).find(b => b.id === barnId);
    if (barn) {
      window.selectBarnSuggest(barn.id, `${barn.name} (${barn.type})`);
      if (penId) {
        const pen = (barn.pens || []).find(p => p.id === penId);
        if (pen) {
          window.selectPenSuggest(pen.id, `${pen.id} · ${pen.name || pen.id} [${pen.status?.toUpperCase()}]`);
        }
      }
    }
  }

  /* ── 3. Destination Pen Auto-Suggest Logic ── */
  window.filterPenSuggest = function(query) {
    const dropdown = document.getElementById("movPenDropdown");
    const clearBtn = document.getElementById("movPenClear");
    const barnHidden = document.getElementById("movTargetBarn");
    if (!dropdown) return;

    if (!barnHidden || !barnHidden.value) {
      dropdown.innerHTML = `<div class="suggest-empty">Please choose a Destination Barn in Step 2 first.</div>`;
      dropdown.style.display = "block";
      return;
    }

    const q = String(query || "").trim().toLowerCase();
    if (clearBtn) clearBtn.style.display = q ? "block" : "none";

    const f = getFarm();
    const barn = (f.barns || []).find(b => b.id === barnHidden.value);
    if (!barn || !(barn.pens || []).length) {
      dropdown.innerHTML = `<div class="suggest-empty">No pens in this barn yet. Click + Add Pen to create one.</div>`;
      dropdown.style.display = "block";
      return;
    }

    cachedPenSuggestHits = (barn.pens || []).filter(p => {
      if (!q) return true;
      return (
        p.id.toLowerCase().includes(q) ||
        (p.name || "").toLowerCase().includes(q) ||
        (p.status || "").toLowerCase().includes(q) ||
        (p.type || "").toLowerCase().includes(q)
      );
    });

    if (!cachedPenSuggestHits.length) {
      dropdown.innerHTML = `<div class="suggest-empty">No matching pens or stalls in ${esc(barn.name)}.</div>`;
      dropdown.style.display = "block";
      return;
    }

    dropdown.innerHTML = cachedPenSuggestHits.map((p, idx) => {
      const isResting = p.status === "resting";
      const isDirty = p.status === "dirty";
      const isOccupied = p.status === "occupied";
      const statusClass = isOccupied ? "occupied" : isResting ? "resting" : isDirty ? "dirty" : "ready";
      const statusText = isOccupied ? "OCCUPIED" : isResting ? "IN BIOSECURITY REST" : isDirty ? "NEEDS CLEANING" : "READY / CLEARED";

      return `
        <div class="suggest-item ${statusClass}" onmousedown="window.selectPenSuggestByIndex(${idx})" ontouchstart="window.selectPenSuggestByIndex(${idx})">
          <div class="suggest-ico pen ${statusClass}">●</div>
          <div class="suggest-meta">
            <b>${esc(p.id)} <small class="muted">· ${esc(p.name || p.id)}</small></b>
            <small><span class="pen-status-badge ${statusClass}">● ${statusText}</span> · Capacity: ${p.capacity || 1}</small>
          </div>
        </div>
      `;
    }).join("");

    dropdown.style.display = "block";
  };

  window.selectPenSuggestByIndex = function(idx) {
    const p = cachedPenSuggestHits[idx];
    if (!p) return;
    const isResting = p.status === "resting";
    const isDirty = p.status === "dirty";
    const isOccupied = p.status === "occupied";
    const statusText = isOccupied ? "OCCUPIED" : isResting ? "IN BIOSECURITY REST" : isDirty ? "NEEDS CLEANING" : "READY / CLEARED";
    window.selectPenSuggest(p.id, `${p.id} (${p.name || p.id}) [${statusText}]`);
  };

  window.selectPenSuggest = function(penId, label) {
    const input = document.getElementById("movPenInput");
    const hidden = document.getElementById("movTargetPen");
    const clearBtn = document.getElementById("movPenClear");

    if (input) input.value = label;
    if (hidden) hidden.value = penId;
    if (clearBtn) clearBtn.style.display = "block";

    closeAllWizardDropdowns();
  };

  window.clearPenSuggest = function() {
    const input = document.getElementById("movPenInput");
    const hidden = document.getElementById("movTargetPen");
    const clearBtn = document.getElementById("movPenClear");

    if (input) { input.value = ""; }
    if (hidden) hidden.value = "";
    if (clearBtn) clearBtn.style.display = "none";
  };

  /* ── 4. Movement Purpose Auto-Suggest Logic ── */
  window.filterReasonSuggest = function(query) {
    const dropdown = document.getElementById("movReasonDropdown");
    if (!dropdown) return;

    const q = String(query || "").trim().toLowerCase();
    const presets = [
      "Pre-Farrowing Crate Relocation (Day 110)",
      "Weaning & Nursery Transfer",
      "Grow-Out Pen Transition",
      "Post-AI Gestation Housing",
      "Hospital / Quarantine Isolation",
      "Routine Pen Regrouping",
      "Breeding Stud Assignment",
      "Cull / Dispatch Staging"
    ];

    cachedReasonSuggestHits = presets.filter(p => !q || p.toLowerCase().includes(q));

    dropdown.innerHTML = cachedReasonSuggestHits.map((p, idx) => `
      <div class="suggest-item" onmousedown="window.selectReasonSuggestByIndex(${idx})" ontouchstart="window.selectReasonSuggestByIndex(${idx})">
        <div class="suggest-ico reason">🔄</div>
        <div class="suggest-meta">
          <b>${esc(p)}</b>
        </div>
      </div>
    `).join("");

    dropdown.style.display = "block";
  };

  window.selectReasonSuggestByIndex = function(idx) {
    const p = cachedReasonSuggestHits[idx];
    if (!p) return;
    window.selectReasonSuggest(p);
  };

  window.selectReasonSuggest = function(text) {
    const input = document.getElementById("movReasonInput");
    const hidden = document.getElementById("movReason");
    if (input) input.value = text;
    if (hidden) hidden.value = text;
    closeAllWizardDropdowns();
  };

  /* ── Execute Movement ── */
  function executeMovement(e) {
    e.preventDefault();
    const animalVal = document.getElementById("movAnimalSelect")?.value;
    const targetBarnId = document.getElementById("movTargetBarn")?.value;
    const targetPenId = document.getElementById("movTargetPen")?.value;
    const reason = document.getElementById("movReasonInput")?.value || document.getElementById("movReason")?.value || "Relocation";
    const dateInput = document.getElementById("movDate")?.value || new Date().toISOString().slice(0, 10);
    const notesInput = document.getElementById("movNotes")?.value || "";

    if (!animalVal) {
      alert("Please select an animal or piglet batch to move.");
      document.getElementById("movAnimalInput")?.focus();
      return;
    }
    if (!targetBarnId) {
      alert("Please select a Destination Barn.");
      document.getElementById("movBarnInput")?.focus();
      return;
    }
    if (!targetPenId) {
      alert("Please select a Destination Stall or Pen.");
      document.getElementById("movPenInput")?.focus();
      return;
    }

    const [type, id] = animalVal.split(":");
    const f = getFarm();
    ensureBarnsSeed();

    const targetBarn = (f.barns || []).find(b => b.id === targetBarnId);
    const targetPen = (targetBarn?.pens || []).find(p => p.id === targetPenId);

    let animalName = id;
    let oldBarnId = "", oldPenId = "";

    // Update Animal Record
    if (type === "sow") {
      const sow = (f.sows || []).find(s => s.id === id);
      if (sow) {
        animalName = `${sow.name} (${sow.id})`;
        oldBarnId = sow.barn_id || "Gestation Barn A";
        oldPenId = sow.pen_id || "G-01";
        sow.barn_id = targetBarnId;
        sow.pen_id = targetPenId;
      }
    } else if (type === "boar") {
      const boar = (f.boars || f.semen || []).find(b => (b.id || b.boar) === id);
      if (boar) {
        animalName = `${boar.name || boar.boar} (Stud)`;
        oldBarnId = boar.barn_id || "Breeding Stud";
        oldPenId = boar.pen_id || "BR-01";
        boar.barn_id = targetBarnId;
        boar.pen_id = targetPenId;
      }
    } else if (type === "batch") {
      const batch = (f.piglets || []).find(b => b.id === id);
      if (batch) {
        animalName = `Batch ${batch.id} (${batch.sow} × ${batch.sire})`;
        oldBarnId = batch.barn_id || "Farrowing House 1";
        oldPenId = batch.pen_id || "FC-01";
        batch.barn_id = targetBarnId;
        batch.pen_id = targetPenId;
      }
    }

    // Vacate Old Pen (Mark as dirty / needing cleaning)
    (f.barns || []).forEach(b => {
      (b.pens || []).forEach(p => {
        if (p.occupant_id === id) {
          p.status = "dirty";
          p.occupant_type = null;
          p.occupant_id = null;
        }
      });
    });

    // Populate New Pen
    if (targetPen) {
      targetPen.status = "occupied";
      targetPen.occupant_type = type;
      targetPen.occupant_id = id;
      targetPen.occupied_since = dateInput;
    }

    // Log Movement Event
    const movementEvent = {
      id: "mov-" + Date.now(),
      date: dateInput,
      animal_type: type,
      animal_id: id,
      animal_name: animalName,
      from_barn: (f.barns || []).find(b => b.id === oldBarnId)?.name || oldBarnId,
      from_pen: oldPenId,
      to_barn: targetBarn?.name || targetBarnId,
      to_pen: targetPenId,
      reason: reason,
      operator: notesInput || "Farm Manager",
      rfid_verified: true
    };

    if (!Array.isArray(f.movements)) f.movements = [];
    f.movements.unshift(movementEvent);

    if (window.save && typeof window.save === "function") window.save();
    showToast(`✓ Relocated ${animalName} to ${targetBarn?.name} (${targetPenId})`);
    closeMovementWizard();
    renderBarnsPage();
  }


  /* ─────────────────────────────────────────────────────────────────────────
     5. PEN SANITATION WORKFLOWS
     ───────────────────────────────────────────────────────────────────────── */
  function startPenRest(barnId, penId) {
    const f = getFarm();
    const barn = (f.barns || []).find(b => b.id === barnId);
    const pen = (barn?.pens || []).find(p => p.id === penId);
    if (!pen) return;

    pen.status = 'resting';
    pen.rest_started = new Date().toISOString().slice(0, 10);
    pen.rest_days_required = 5;

    if (window.save && typeof window.save === 'function') window.save();
    showToast(`🧼 Pen ${penId} disinfected. 5-day biosecurity rest period initiated.`);
    renderBarnsPage();
  }

  function clearPenRest(barnId, penId) {
    const f = getFarm();
    const barn = (f.barns || []).find(b => b.id === barnId);
    const pen = (barn?.pens || []).find(p => p.id === penId);
    if (!pen) return;

    pen.status = 'ready';
    pen.rest_started = null;

    if (window.save && typeof window.save === 'function') window.save();
    showToast(`✓ Pen ${penId} biosecurity clearance complete. Ready for new animals!`);
    renderBarnsPage();
  }

  function vacatePen(barnId, penId) {
    const f = getFarm();
    const barn = (f.barns || []).find(b => b.id === barnId);
    const pen = (barn?.pens || []).find(p => p.id === penId);
    if (!pen) return;

    pen.status = 'dirty';
    pen.occupant_id = null;
    pen.occupant_type = null;

    if (window.save && typeof window.save === 'function') window.save();
    showToast(`Pen ${penId} vacated. Marked as needing wash/disinfection.`);
    renderBarnsPage();
  }

  function cleanAllBarnPens(barnId) {
    const f = getFarm();
    const barn = (f.barns || []).find(b => b.id === barnId);
    if (!barn) return;

    let count = 0;
    (barn.pens || []).forEach(p => {
      if (p.status === 'dirty') {
        p.status = 'resting';
        p.rest_started = new Date().toISOString().slice(0, 10);
        p.rest_days_required = 5;
        count++;
      }
    });

    if (window.save && typeof window.save === 'function') window.save();
    showToast(`✨ ${count} pens in ${barn.name} placed into biosecurity rest.`);
    renderBarnsPage();
  }

  function printMovementManifest() {
    window.print();
  }

  function showToast(msg) {
    if (window.toast && typeof window.toast === 'function') window.toast(msg);
    else console.log('[Barn Toast]:', msg);
  }

  // Global Exports
  window.switchActiveBarn = function (bId) {
    activeBarnId = bId;
    renderBarnsPage();
  };
  window.renderBarns = renderBarnsPage;
  window.openMovementWizard = openMovementWizard;
  window.closeMovementWizard = closeMovementWizard;
  window.filterAnimalSuggest = filterAnimalSuggest;
  window.selectAnimalSuggest = selectAnimalSuggest;
  window.selectAnimalSuggestByIndex = selectAnimalSuggestByIndex;
  window.clearAnimalSuggest = clearAnimalSuggest;
  window.filterBarnSuggest = filterBarnSuggest;
  window.selectBarnSuggest = selectBarnSuggest;
  window.selectBarnSuggestByIndex = selectBarnSuggestByIndex;
  window.clearBarnSuggest = clearBarnSuggest;
  window.filterPenSuggest = filterPenSuggest;
  window.selectPenSuggest = selectPenSuggest;
  window.selectPenSuggestByIndex = selectPenSuggestByIndex;
  window.clearPenSuggest = clearPenSuggest;
  window.filterReasonSuggest = filterReasonSuggest;
  window.selectReasonSuggest = selectReasonSuggest;
  window.selectReasonSuggestByIndex = selectReasonSuggestByIndex;
  window.executeMovement = executeMovement;
  window.startPenRest = startPenRest;
  window.clearPenRest = clearPenRest;
  window.vacatePen = vacatePen;
  window.cleanAllBarnPens = cleanAllBarnPens;
  window.printMovementManifest = printMovementManifest;

  // New CRUD exports
  window.openAddBarnModal = openAddBarnModal;
  window.openEditBarnModal = openAddBarnModal;
  window.saveBarnModal = saveBarnModal;
  window.deleteBarn = deleteBarn;
  window.openAddPenModal = openAddPenModal;
  window.openEditPenModal = openAddPenModal;
  window.savePenModal = savePenModal;
  window.deletePen = deletePen;
  window.closeBarnCrudModal = closeBarnCrudModal;
  window.resetDefaultBarns = resetDefaultBarns;

  // Extend renderAll
  const prevRender = window.renderAll;
  window.renderAll = function () {
    if (typeof prevRender === 'function') prevRender();
    if (document.getElementById('barns')) renderBarnsPage();
  };

  console.info('%cARSwineTech Pro — Multi-Barn Facility CRUD & Movements Center Loaded', 'color:#0d8d91;font-weight:bold');
})();
