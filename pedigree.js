/* Farm-scoped 3-generation pedigree and Wright-style compatibility screening. */
(function() {
  const risk = f => f === 0 ? ['SAFE', '#55d992'] : f <= 3.12 ? ['LOW RISK', '#55d992'] : f <= 6.25 ? ['MODERATE RISK', '#f0bf50'] : f <= 12.5 ? ['HIGH RISK', '#ff9c55'] : ['CRITICAL RISK', '#ff6873'];
  const escP = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  /* ── [REBUILD FIX 48] boar birthday → calendar-accurate age (yrs + mos + days) ── */
  const todayLocal = () => { const n = new Date(); return n.getFullYear() + '-' + String(n.getMonth() + 1).padStart(2, '0') + '-' + String(n.getDate()).padStart(2, '0'); };
  const fmtDP = s => { if (!s) return '—'; const d = new Date(String(s).slice(0, 10) + 'T00:00:00'); return d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }); };
  function ageYMD(dob) {
    if (!dob) return null;
    const b = new Date(String(dob).slice(0, 10) + 'T00:00:00');
    if (isNaN(b)) return null;
    const n = new Date(), t = new Date(n.getFullYear(), n.getMonth(), n.getDate());
    if (b > t) return null;
    let y = t.getFullYear() - b.getFullYear(), m = t.getMonth() - b.getMonth(), d = t.getDate() - b.getDate();
    if (d < 0) { m--; d += new Date(t.getFullYear(), t.getMonth(), 0).getDate(); }
    if (m < 0) { y--; m += 12; }
    return { y, m, d };
  }
  function ageText(dob) {
    const a = ageYMD(dob); if (!a) return '';
    const parts = [];
    if (a.y) parts.push(a.y + (a.y === 1 ? ' yr' : ' yrs'));
    if (a.m) parts.push(a.m + (a.m === 1 ? ' mo' : ' mos'));
    if (a.d || !parts.length) parts.push(a.d + (a.d === 1 ? ' day' : ' days'));
    return parts.join(', ');
  }
  window.boarAgeText = ageText; /* shared: boar rows in the drill-down too */
  window.updateBoarAgePreview = function () {
    const el = document.getElementById('boarAgePrev'); if (!el) return;
    const v = document.querySelector('#boarModal [name="dob"]')?.value, t = ageText(v);
    el.textContent = v ? (t ? 'Age today: ' + t + ' old' : 'Birthday is in the future — check the date.') : '';
  };

  /* ── [REBUILD FIX 48] vaccination typed in the boar profile → written into
     the Vaccination Center store (F().vaccinations), one program entry per
     vaccine; re-recording the same vaccine adds another dated dose. ── */
  function recordBoarVaccine(boar, vaccine, date) {
    const all = (F().vaccinations = Array.isArray(F().vaccinations) ? F().vaccinations : []),
      nm = String(boar.name || '').toLowerCase(),
      hit = all.find(e => e.target_type === 'boar' && (String(e.target_id) === String(boar.id) || (nm && String(e.target_label || '').toLowerCase().startsWith(nm))) && String(e.vaccine || '').toLowerCase() === vaccine.toLowerCase()),
      round = { date, dose_ml: null, heads: 1, total_ml: null, at: new Date().toISOString() };
    if (hit) { hit.rounds = (Array.isArray(hit.rounds) ? hit.rounds : []).concat([round]); }
    else all.push({ id: 'vax-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6), target_type: 'boar', target_id: boar.id, target_label: boar.name, vaccine, med_id: null, date, dose_ml: null, heads: 1, interval_days: null, next_due: null, time: null, rounds: [round], reminder_id: null, notes: 'Recorded from the boar profile', created_at: new Date().toISOString() });
  }

  /* [REBUILD FIX 47] lineage ancestors — names typed into the boar profile
     that are not registered animals are kept ON RECORD here (never counted
     as sows/boars anywhere), so the pedigree tree and the inbreeding
     coefficient can still traverse them. */
  const ancestors = () => (F().ancestors = Array.isArray(F().ancestors) ? F().ancestors : []);

  function animals() {
    let f = F();
    return [...(f.sows || []).map(x => ({
      ...x,
      kind: 'Sow'
    })), ...(f.boars || []).map(x => ({
      ...x,
      kind: 'Boar'
    })), ...ancestors().map(x => ({
      ...x,
      kind: 'Ancestor'
    }))]
  }

  function byId(id) {
    if (!id) return null;
    const clean = String(id).trim().toLowerCase();
    if (!clean || clean === '—' || clean === '-' || clean === 'unknown') return null;
    return animals().find(x =>
      (x.id && String(x.id).trim().toLowerCase() === clean) ||
      (x.name && String(x.name).trim().toLowerCase() === clean)
    );
  }

  function parentId(a, side) {
    if (!a) return null;
    let raw = side === 'sire' ? (a.geneticSireRef || a.biologicalSireRef || a.sireRef || a.sire_id || a.sireId || a.sire) : (a.geneticDamRef || a.biologicalDamRef || a.damRef || a.dam_id || a.damId || a.dam);
    let linked = (F().breedingRecords || []).find(r => r.id === a.current_breeding_record_id);
    if (side === 'sire' && ((linked && raw === linked.boar_id) || raw === a.lastSemenBoarId)) return null;
    if (!raw || raw === '—' || raw === '-' || String(raw).toLowerCase() === 'unknown') return null;
    let found = animals().find(x => (x.id && String(x.id).toLowerCase() === String(raw).toLowerCase()) || (x.name && String(x.name).toLowerCase() === String(raw).toLowerCase()));
    return found ? (found.id || found.name) : raw;
  }

  function parents(a) {
    return [parentId(a, 'sire'), parentId(a, 'dam')].filter(Boolean)
  }

  function grandparents(a) {
    return parents(a).flatMap(id => parents(byId(id))).filter(Boolean)
  }

  function sameSet(a, b) {
    return a.length === b.length && a.length > 0 && a.every(x => b.includes(x))
  }

  function paths(id, depth = 3, level = 0, out = {}) {
    if (!id || level >= depth) return out;
    let a = byId(id);
    if (!a) return out;
    for (const pid of parents(a)) {
      (out[pid] || (out[pid] = [])).push(level + 1);
      paths(pid, depth, level + 1, out)
    }
    return out
  }

  /* [REBUILD FIX 29] result() now carries an explicit `blocked` flag for the
     genetically prohibited crosses (parent-offspring, full siblings,
     grandparent cross). Callers must key off this flag instead of guessing
     from the relationship label text. */
  function result(riskLevel, relationship, percent, message, common = [], blocked = false) {
    return {
      r: riskLevel,
      risk: riskLevel,
      relationship,
      f: percent,
      common,
      message,
      blocked,
      recommendation: riskLevel === 'SAFE' || riskLevel === 'LOW RISK' ? 'Recommended only after reviewing full recorded pedigree.' : 'Breeding not recommended. Introduce unrelated genetics.'
    }
  }

  function compatibility(maleId, femaleId) {
    let boar = byId(maleId),
      sow = byId(femaleId);
    if (!boar || !sow) return result('SAFE', 'No pairing selected', 0, 'Select one boar and one sow.');
    let bp = parents(boar),
      sp = parents(sow);
    // Level 1: direct parent ↔ offspring; always runs before coefficient calculation.
    if (sp.includes(boar.id) || bp.includes(sow.id)) return result('CRITICAL RISK', 'Parent → Offspring', 25, 'Parent-offspring relationship detected. Breeding is blocked.', [], true);
    // Level 2: full siblings — both known parents must match.
    if (bp.length === 2 && sp.length === 2 && sameSet(bp, sp)) return result('CRITICAL RISK', 'Full Sibling Cross', 25, 'Same sire and dam detected. Breeding is blocked.', bp, true);
    // Level 3: half siblings — one known parent matches.
    let sharedParents = bp.filter(x => sp.includes(x));
    if (sharedParents.length) return result('HIGH RISK', 'Half Sibling Cross', 12.5, 'Same sire or dam detected. Breeding is not recommended.', sharedParents);
    // Level 4: grandparent ↔ grandchild in either direction.
    let bg = grandparents(boar),
      sg = grandparents(sow);
    if (sg.includes(boar.id) || bg.includes(sow.id)) return result('CRITICAL RISK', 'Grandparent Cross', 12.5, 'Grandparent-grandchild relationship detected. Breeding is blocked.', [], true);
    // Level 5: boar is sibling/half-sibling of either sow parent (or reverse): uncle/aunt cross.
    let parentOfSow = sp.map(byId).filter(Boolean),
      parentOfBoar = bp.map(byId).filter(Boolean);
    let auntUncle = [];
    for (const p of parentOfSow) {
      let shared = parents(boar).filter(x => parents(p).includes(x));
      if (shared.length) auntUncle.push(...shared)
    }
    for (const p of parentOfBoar) {
      let shared = parents(sow).filter(x => parents(p).includes(x));
      if (shared.length) auntUncle.push(...shared)
    }
    if (auntUncle.length) return result('HIGH RISK', 'Uncle/Aunt Cross', 6.25, 'Shared grandparent indicates an uncle/aunt relationship. Breeding is not recommended.', [...new Set(auntUncle)]);
    // Level 6: Wright coefficient from every recorded common-ancestor path, only after direct checks.
    let malePaths = paths(boar.id),
      femalePaths = paths(sow.id),
      common = Object.keys(malePaths).filter(id => femalePaths[id]);
    let coefficient = 0;
    common.forEach(id => malePaths[id].forEach(n1 => femalePaths[id].forEach(n2 => {
      let ancestor = byId(id),
        fa = +(ancestor?.inbreedingCoefficient || 0) / 100;
      coefficient += Math.pow(.5, n1 + n2 + 1) * (1 + fa)
    })));
    let f = Math.min(coefficient * 100, 100),
      [level] = risk(f);
    return result(level, common.length ? 'Common Ancestor Paths' : 'No Known Relationship', f, common.length ? `Common ancestor${common.length>1?'s':''}: ${common.map(id=>byId(id)?.name||id).join(', ')}.` : 'No shared ancestors found within the recorded three generations.', common)
  }

  let currentPedTreeData = null;

  /* Build one node in the shared animal/batch pedigree tree. The optional
     subjectOverride supplies parents for a piglet batch, whose own record is
     not part of the sow/boar registry but still has a real dam and sire. */
  function buildAnimalNode(rawRef, side = 'root', gen = 0, relLabel = 'Subject Animal', subjectOverride = null) {
    if (!rawRef || rawRef === '—' || rawRef === '-' || String(rawRef).toLowerCase() === 'unknown') {
      return {
        id: '',
        name: 'Unknown Ancestor',
        breed: '—',
        kind: side.includes('sire') || side === 'sire' ? 'Boar' : 'Sow',
        sex: side.includes('sire') || side === 'sire' ? 'M' : (side.includes('dam') || side === 'dam' ? 'F' : '—'),
        gen,
        relLabel,
        sireNode: null,
        damNode: null,
        exists: false
      };
    }

    const isSubjectOverride = !!subjectOverride && gen === 0;
    const resolved = isSubjectOverride
      ? { name: subjectOverride.name || String(rawRef), id: subjectOverride.id || String(rawRef), breed: subjectOverride.breed || '—' }
      : (window.resolveAnimalLabel ? window.resolveAnimalLabel(rawRef) : { name: String(rawRef), id: String(rawRef), breed: '' });
    const hit = isSubjectOverride ? null : (resolved.hit || (typeof byId === 'function' ? byId(rawRef) : null));

    let sireRef = isSubjectOverride
      ? (subjectOverride.sireRef || subjectOverride.sire_id || subjectOverride.sire || '')
      : (hit ? (hit.sire || hit.sireRef || hit.sire_name || hit.sire_id || '') : '');
    let damRef = isSubjectOverride
      ? (subjectOverride.damRef || subjectOverride.dam_id || subjectOverride.dam || '')
      : (hit ? (hit.dam || hit.damRef || hit.dam_name || hit.dam_id || '') : '');

    return {
      id: resolved.id || (hit ? (hit.id || hit.name) : String(rawRef)),
      name: resolved.name || (hit ? (hit.name || hit.id) : String(rawRef)),
      breed: (hit && hit.breed) ? hit.breed : (resolved.breed || '—'),
      kind: isSubjectOverride ? (subjectOverride.kind || 'Piglet Batch') : (hit ? (hit.kind || (hit.sex === 'M' ? 'Boar' : (hit.sex === 'F' ? 'Sow' : 'Ancestor'))) : 'Ancestor'),
      sex: isSubjectOverride ? (subjectOverride.sex || '—') : ((hit && hit.sex) ? hit.sex : (side.includes('sire') || side === 'sire' ? 'M' : 'F')),
      gen,
      relLabel,
      hit,
      exists: isSubjectOverride || !!hit || (resolved.name && resolved.name !== '—' && String(resolved.name).toLowerCase() !== 'unknown'),
      subjectType: isSubjectOverride ? (subjectOverride.subjectType || 'animal') : null,
      subjectLabel: isSubjectOverride ? (subjectOverride.subjectLabel || '👑 SUBJECT ANIMAL') : null,
      subjectIcon: isSubjectOverride ? (subjectOverride.subjectIcon || '👑') : null,
      subjectMeta: isSubjectOverride ? (subjectOverride.subjectMeta || '') : null,
      subjectDetails: isSubjectOverride ? (subjectOverride.subjectDetails || {}) : null,
      sireNode: gen < 2 ? buildAnimalNode(sireRef, 'sire', gen + 1, gen === 0 ? '♂ Sire (Father)' : (gen === 1 ? 'Paternal Grandsire' : 'Great-Grandsire')) : null,
      damNode: gen < 2 ? buildAnimalNode(damRef, 'dam', gen + 1, gen === 0 ? '♀ Dam (Mother)' : (gen === 1 ? 'Maternal Granddam' : 'Great-Granddam')) : null
    };
  }

  const PEDIGREE_EDGES = [
    { id: 'edge_root_sire', from: 'root', to: 'sire', tone: 'sire' },
    { id: 'edge_root_dam', from: 'root', to: 'dam', tone: 'dam' },
    { id: 'edge_sire_pgs', from: 'sire', to: 'pgs', tone: 'sire' },
    { id: 'edge_sire_pgd', from: 'sire', to: 'pgd', tone: 'sire' },
    { id: 'edge_dam_mgs', from: 'dam', to: 'mgs', tone: 'dam' },
    { id: 'edge_dam_mgd', from: 'dam', to: 'mgd', tone: 'dam' }
  ];
  let pedigreeResizeTimer = null;

  function cubicPoint(points, t) {
    const mt = 1 - t;
    return {
      x: (mt * mt * mt * points[0].x) + (3 * mt * mt * t * points[1].x) + (3 * mt * t * t * points[2].x) + (t * t * t * points[3].x),
      y: (mt * mt * mt * points[0].y) + (3 * mt * mt * t * points[1].y) + (3 * mt * t * t * points[2].y) + (t * t * t * points[3].y)
    };
  }

  function cubicPath(points) {
    return `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)} C ${points[1].x.toFixed(1)} ${points[1].y.toFixed(1)}, ${points[2].x.toFixed(1)} ${points[2].y.toFixed(1)}, ${points[3].x.toFixed(1)} ${points[3].y.toFixed(1)}`;
  }

  function offsetCurve(points, amount) {
    const dx = points[3].x - points[0].x,
      dy = points[3].y - points[0].y,
      length = Math.sqrt(dx * dx + dy * dy) || 1,
      normal = { x: (-dy / length) * amount, y: (dx / length) * amount };
    return points.map(p => ({ x: p.x + normal.x, y: p.y + normal.y }));
  }

  function connectorCurve(fromEl, toEl, stageRect) {
    const a = fromEl.getBoundingClientRect(),
      b = toEl.getBoundingClientRect(),
      ac = { x: a.left - stageRect.left + a.width / 2, y: a.top - stageRect.top + a.height / 2 },
      bc = { x: b.left - stageRect.left + b.width / 2, y: b.top - stageRect.top + b.height / 2 },
      horizontal = Math.abs(bc.x - ac.x) > Math.max(24, Math.abs(bc.y - ac.y) * 0.35);

    if (horizontal) {
      const direction = bc.x >= ac.x ? 1 : -1,
        p0 = { x: (direction > 0 ? a.right : a.left) - stageRect.left, y: ac.y },
        p3 = { x: (direction > 0 ? b.left : b.right) - stageRect.left, y: bc.y },
        bend = Math.max(24, Math.abs(p3.x - p0.x) * 0.42);
      return [p0, { x: p0.x + direction * bend, y: p0.y }, { x: p3.x - direction * bend, y: p3.y }, p3];
    }

    const direction = bc.y >= ac.y ? 1 : -1,
      p0 = { x: ac.x, y: (direction > 0 ? a.bottom : a.top) - stageRect.top },
      p3 = { x: bc.x, y: (direction > 0 ? b.top : b.bottom) - stageRect.top },
      bend = Math.max(24, Math.abs(p3.y - p0.y) * 0.42);
    return [p0, { x: p0.x, y: p0.y + direction * bend }, { x: p3.x, y: p3.y - direction * bend }, p3];
  }

  function dnaRungs(points) {
    const dx = points[3].x - points[0].x,
      dy = points[3].y - points[0].y,
      length = Math.sqrt(dx * dx + dy * dy) || 1,
      normal = { x: -dy / length, y: dx / length },
      width = 3.2;
    return [0.24, 0.5, 0.76].map(t => {
      const p = cubicPoint(points, t);
      return `<line class="ped-dna-rung" x1="${(p.x - normal.x * width).toFixed(1)}" y1="${(p.y - normal.y * width).toFixed(1)}" x2="${(p.x + normal.x * width).toFixed(1)}" y2="${(p.y + normal.y * width).toFixed(1)}"></line>`;
    }).join('');
  }

  function highlightPedigreeConnections(nodeKey = 'root') {
    document.querySelectorAll('#pedTreeConnectors .ped-dna-edge').forEach(edge => {
      const related = nodeKey === 'root' || edge.dataset.from === nodeKey || edge.dataset.to === nodeKey;
      edge.classList.toggle('is-selected', related);
    });
  }

  function drawPedigreeDNAConnections() {
    const stage = document.getElementById('pedTreeStage'),
      svg = document.getElementById('pedTreeConnectors');
    if (!stage || !svg) return;
    const stageRect = stage.getBoundingClientRect(),
      width = Math.max(stage.clientWidth, 1),
      height = Math.max(stage.clientHeight, 1);
    svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    svg.setAttribute('width', width);
    svg.setAttribute('height', height);

    const defs = `<defs>
      <linearGradient id="pedDnaSireGradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#60a5fa"></stop><stop offset="0.5" stop-color="#17cabe"></stop><stop offset="1" stop-color="#3b82f6"></stop></linearGradient>
      <linearGradient id="pedDnaDamGradient" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#f472b6"></stop><stop offset="0.5" stop-color="#17cabe"></stop><stop offset="1" stop-color="#ec4899"></stop></linearGradient>
      <filter id="pedDnaGlow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="2.1" result="blur"></feGaussianBlur><feMerge><feMergeNode in="blur"></feMergeNode><feMergeNode in="SourceGraphic"></feMergeNode></feMerge></filter>
    </defs>`;
    const edges = PEDIGREE_EDGES.map(edge => {
      const from = document.getElementById('node_' + edge.from),
        to = document.getElementById('node_' + edge.to);
      if (!from || !to) return '';
      const curve = connectorCurve(from, to, stageRect),
        strandA = offsetCurve(curve, 2.8),
        strandB = offsetCurve(curve, -2.8),
        path = cubicPath(curve),
        edgeTarget = edge.to;
      return `<g class="ped-dna-edge edge-${edge.tone}" id="${edge.id}" data-from="${edge.from}" data-to="${edge.to}" onclick="window.selectPedNode('${edgeTarget}')" role="button" aria-label="Trace ${edge.from} to ${edge.to}">
        <path class="ped-dna-hit" d="${path}"></path>
        <path class="ped-dna-glow" d="${path}"></path>
        <path class="ped-dna-strand strand-a" d="${cubicPath(strandA)}"></path>
        <path class="ped-dna-strand strand-b" d="${cubicPath(strandB)}"></path>
        ${dnaRungs(curve)}
        <circle class="ped-dna-pulse" r="3.2"><animateMotion dur="2.8s" repeatCount="indefinite" path="${path}"></animateMotion></circle>
      </g>`;
    }).join('');
    svg.innerHTML = defs + edges;
    const active = document.querySelector('#pedTreeCanvas .tree-card.active');
    highlightPedigreeConnections(active ? active.id.replace(/^node_/, '') : 'root');
  }

  function schedulePedigreeConnectorDraw() {
    clearTimeout(pedigreeResizeTimer);
    pedigreeResizeTimer = setTimeout(() => {
      if (document.getElementById('pedigreeTreeModal')) drawPedigreeDNAConnections();
    }, 40);
  }
  window.addEventListener('resize', schedulePedigreeConnectorDraw, { passive: true });

  function renderInteractiveTreeHTML(root) {
    const sNode = root.sireNode || buildAnimalNode('', 'sire', 1, '♂ Sire (Father)');
    const dNode = root.damNode || buildAnimalNode('', 'dam', 1, '♀ Dam (Mother)');

    const pgs = sNode.sireNode || buildAnimalNode('', 'sire', 2, 'Paternal Grandsire');
    const pgd = sNode.damNode || buildAnimalNode('', 'dam', 2, 'Paternal Granddam');
    const mgs = dNode.sireNode || buildAnimalNode('', 'sire', 2, 'Maternal Grandsire');
    const mgd = dNode.damNode || buildAnimalNode('', 'dam', 2, 'Maternal Granddam');

    const subjectLabel = root.subjectLabel || '👑 SUBJECT ANIMAL',
      subjectMeta = root.subjectMeta || '100% Target Herd Alleles',
      subjectSex = root.subjectType === 'batch' ? '🐖 Piglet Batch' : (root.sex === 'M' ? '♂ Male' : '♀ Female');

    return `
      <div class="ped-tree-stage" id="pedTreeStage">
        <svg class="ped-tree-connectors" id="pedTreeConnectors" aria-label="Animated DNA lineage connections" role="img"></svg>
        <div class="tree-hierarchy-layout">
        <!-- Generation 0: Subject -->
        <div class="tree-col col-subject">
          <div class="tree-card root-card active" id="node_root" onclick="window.selectPedNode('root')">
            <div class="tc-badge" style="color:var(--teal2)">${escP(subjectLabel)}</div>
            <div class="tc-name">${escP(root.name)}</div>
            <div class="tc-sub">${escP(root.breed || 'Breed —')} · ${escP(subjectSex)}</div>
            <div class="tc-gen">${escP(subjectMeta)}</div>
          </div>
        </div>

        <!-- Generation 1: Parents (50% Genetic Contribution) -->
        <div class="tree-col col-parents">
          <div class="tree-card parent-card sire-card" id="node_sire" onclick="window.selectPedNode('sire')">
            <div class="tc-badge sire">♂ SIRE (50% GENETICS)</div>
            <div class="tc-name">${escP(sNode.name)}</div>
            <div class="tc-sub">${escP(sNode.breed)}</div>
            ${sNode.id && sNode.id !== sNode.name ? `<div class="tc-sub" style="font-size:10.5px">Tag: ${escP(sNode.id)}</div>` : ''}
          </div>
          <div class="tree-card parent-card dam-card" id="node_dam" onclick="window.selectPedNode('dam')">
            <div class="tc-badge dam">♀ DAM (50% GENETICS)</div>
            <div class="tc-name">${escP(dNode.name)}</div>
            <div class="tc-sub">${escP(dNode.breed)}</div>
            ${dNode.id && dNode.id !== dNode.name ? `<div class="tc-sub" style="font-size:10.5px">Tag: ${escP(dNode.id)}</div>` : ''}
          </div>
        </div>

        <!-- Generation 2: Grandparents (25% Genetic Contribution) -->
        <div class="tree-col col-grandparents">
          <div class="tree-card grand-card" id="node_pgs" onclick="window.selectPedNode('pgs')">
            <div class="tc-badge sire">♂ PAT. GRANDSIRE (25%)</div>
            <div class="tc-name">${escP(pgs.name)}</div>
            <div class="tc-sub">${escP(pgs.breed)}</div>
          </div>
          <div class="tree-card grand-card" id="node_pgd" onclick="window.selectPedNode('pgd')">
            <div class="tc-badge dam">♀ PAT. GRANDDAM (25%)</div>
            <div class="tc-name">${escP(pgd.name)}</div>
            <div class="tc-sub">${escP(pgd.breed)}</div>
          </div>
          <div class="tree-card grand-card" id="node_mgs" onclick="window.selectPedNode('mgs')">
            <div class="tc-badge sire">♂ MAT. GRANDSIRE (25%)</div>
            <div class="tc-name">${escP(mgs.name)}</div>
            <div class="tc-sub">${escP(mgs.breed)}</div>
          </div>
          <div class="tree-card grand-card" id="node_mgd" onclick="window.selectPedNode('mgd')">
            <div class="tc-badge dam">♀ MAT. GRANDDAM (25%)</div>
            <div class="tc-name">${escP(mgd.name)}</div>
            <div class="tc-sub">${escP(mgd.breed)}</div>
          </div>
        </div>
        </div>
        <div class="ped-tree-hint">🧬 Animated DNA strands show the recorded inheritance path. Tap a card or glowing link to highlight that family line.</div>
      </div>
    `;
  }

  function renderDnaFlowHTML(root) {
    const sNode = root.sireNode || buildAnimalNode('', 'sire', 1, '♂ Sire (Father)');
    const dNode = root.damNode || buildAnimalNode('', 'dam', 1, '♀ Dam (Mother)');
    const pgs = sNode.sireNode || buildAnimalNode('', 'sire', 2, 'Paternal Grandsire');
    const pgd = sNode.damNode || buildAnimalNode('', 'dam', 2, 'Paternal Granddam');
    const mgs = dNode.sireNode || buildAnimalNode('', 'sire', 2, 'Maternal Grandsire');
    const mgd = dNode.damNode || buildAnimalNode('', 'dam', 2, 'Maternal Granddam');

    return `
      <div class="dna-flow-canvas">
        <div class="dna-flow-card" style="border-left:4px solid #3b82f6">
          <b style="color:#60a5fa">♂ Paternal Lineage (50% Genetic Inheritance)</b>
          <p style="margin:4px 0 8px 0;font-size:13px"><b>Sire:</b> ${escP(sNode.name)} (${escP(sNode.breed)})</p>
          <div class="progress-bar-wrap" style="height:6px"><div class="progress-bar-fill blue" style="width:50%"></div></div>
          <small class="muted">Grandparents: ♂ ${escP(pgs.name)} (25%) + ♀ ${escP(pgd.name)} (25%)</small>
        </div>

        <div class="dna-flow-card" style="border-left:4px solid #ec4899">
          <b style="color:#f472b6">♀ Maternal Lineage (50% Genetic Inheritance)</b>
          <p style="margin:4px 0 8px 0;font-size:13px"><b>Dam:</b> ${escP(dNode.name)} (${escP(dNode.breed)})</p>
          <div class="progress-bar-wrap" style="height:6px"><div class="progress-bar-fill" style="background:#ec4899;width:50%"></div></div>
          <small class="muted">Grandparents: ♂ ${escP(mgs.name)} (25%) + ♀ ${escP(mgd.name)} (25%)</small>
        </div>
      </div>
    `;
  }

  function switchPedigreeView(mode) {
    const btnTree = document.getElementById('btnTreeMode');
    const btnDna = document.getElementById('btnDnaMode');
    const canvasTree = document.getElementById('pedTreeCanvas');
    const canvasDna = document.getElementById('pedDnaFlow');

    if (btnTree) btnTree.classList.toggle('active', mode === 'tree');
    if (btnDna) btnDna.classList.toggle('active', mode === 'dna');
    if (canvasTree) canvasTree.style.display = mode === 'tree' ? 'block' : 'none';
    if (canvasDna) canvasDna.style.display = mode === 'dna' ? 'block' : 'none';
    if (mode === 'tree') schedulePedigreeConnectorDraw();
  }
  window.switchPedigreeView = switchPedigreeView;

  function selectPedNode(nodeKey) {
    if (!currentPedTreeData) return;
    document.querySelectorAll('.tree-card').forEach(c => c.classList.remove('active'));
    const clickedCard = document.getElementById('node_' + nodeKey);
    if (clickedCard) clickedCard.classList.add('active');
    highlightPedigreeConnections(nodeKey);

    const root = currentPedTreeData;
    const sNode = root.sireNode || buildAnimalNode('', 'sire', 1, '♂ Sire (Father)');
    const dNode = root.damNode || buildAnimalNode('', 'dam', 1, '♀ Dam (Mother)');
    const pgs = sNode.sireNode || buildAnimalNode('', 'sire', 2, 'Paternal Grandsire');
    const pgd = sNode.damNode || buildAnimalNode('', 'dam', 2, 'Paternal Granddam');
    const mgs = dNode.sireNode || buildAnimalNode('', 'sire', 2, 'Maternal Grandsire');
    const mgd = dNode.damNode || buildAnimalNode('', 'dam', 2, 'Maternal Granddam');

    let target = root;
    let pct = root.subjectType === 'batch' ? '100% Batch Genetic Record' : '100% Target Animal';
    let rel = root.subjectType === 'batch' ? 'Piglet Batch Genetic Lineage' : 'Subject Herd Animal';

    if (nodeKey === 'sire') { target = sNode; pct = '50.0% Direct Genetic Contribution'; rel = 'Biological Sire (Father)'; }
    else if (nodeKey === 'dam') { target = dNode; pct = '50.0% Direct Genetic Contribution'; rel = 'Biological Dam (Mother)'; }
    else if (nodeKey === 'pgs') { target = pgs; pct = '25.0% Grandparent Alleles'; rel = "Paternal Grandsire (Father's Sire)"; }
    else if (nodeKey === 'pgd') { target = pgd; pct = '25.0% Grandparent Alleles'; rel = "Paternal Granddam (Father's Dam)"; }
    else if (nodeKey === 'mgs') { target = mgs; pct = '25.0% Grandparent Alleles'; rel = "Maternal Grandsire (Mother's Sire)"; }
    else if (nodeKey === 'mgd') { target = mgd; pct = '25.0% Grandparent Alleles'; rel = "Maternal Granddam (Mother's Dam)"; }

    const drawer = document.getElementById('pedNodeDrawer');
    const titleEl = document.getElementById('drawerTitle');
    const bodyEl = document.getElementById('drawerBody');
    const targetIcon = target.subjectIcon || (target.sex === 'M' ? '♂' : target.sex === 'F' ? '♀' : '🐖');
    const detail = target.subjectDetails || {};
    const detailHtml = target === root && Object.keys(detail).length ? `
      <div class="ped-subject-details">
        ${Object.entries(detail).filter(([, value]) => value !== null && value !== undefined && String(value) !== '').map(([label, value]) => `<span><small>${escP(label)}</small><b>${escP(value)}</b></span>`).join('')}
      </div>` : '';

    if (titleEl) {
      titleEl.innerHTML = `<b>${targetIcon} ${escP(target.name)}</b> <span class="tag" style="font-size:11px;margin-left:6px">${escP(rel)}</span>`;
    }

    if (bodyEl) {
      bodyEl.innerHTML = `
        <div style="display:grid;grid-template-columns:repeat(auto-fit, minmax(180px, 1fr));gap:10px;margin-top:6px">
          <div><small class="muted">Breed / Classification</small><b style="display:block;font-size:13px">${escP(target.breed || '—')}</b></div>
          <div><small class="muted">Genetic Weight</small><b style="display:block;font-size:13px;color:var(--teal2)">${escP(pct)}</b></div>
          <div><small class="muted">Reference Identifier</small><b style="display:block;font-size:13px">${escP(target.id || 'On-farm record')}</b></div>
        </div>
        ${detailHtml}
      `;
    }

    if (drawer) drawer.classList.add('open');
  }
  window.selectPedNode = selectPedNode;

  function openPedigreeTreeModal(idOrAnimal) {
    if (!idOrAnimal) return;
    let a = null;
    if (typeof idOrAnimal === 'object' && idOrAnimal !== null) {
      a = idOrAnimal;
    } else {
      const clean = String(idOrAnimal).trim();
      let decoded = clean;
      try { decoded = decodeURIComponent(clean).trim(); } catch(_) {}

      const f = (typeof F === 'function' && F()) ? F() : {};
      const allList = [
        ...(f.sows || []),
        ...(f.boars || []),
        ...(f.ancestors || [])
      ];
      const keys = [clean, decoded, clean.toLowerCase(), decoded.toLowerCase()];

      a = allList.find(x => {
        const xId = String(x.id || '').trim();
        const xName = String(x.name || '').trim();
        return keys.includes(xId) || keys.includes(xId.toLowerCase()) ||
               keys.includes(xName) || keys.includes(xName.toLowerCase());
      }) || { id: clean, name: clean };
    }

    const isBatchSubject = a && a.__arsSubjectType === 'batch';
    const subjectOverride = isBatchSubject ? {
      id: a.id || a.name,
      name: a.name || a.id,
      breed: a.breed || 'Breed not recorded',
      kind: 'Piglet Batch',
      sex: '—',
      subjectType: 'batch',
      subjectLabel: '🐖 SUBJECT PIGLET BATCH',
      subjectIcon: '🐖',
      subjectMeta: a.subjectMeta || '100% Batch Genetic Record',
      subjectDetails: a.subjectDetails || {},
      sireRef: a.sireRef || a.sire_id || a.sire || a.sire_name,
      damRef: a.damRef || a.dam_id || a.dam || a.dam_name
    } : null;
    const treeRoot = buildAnimalNode(a.id || a.name, 'root', 0, isBatchSubject ? 'Subject Piglet Batch' : 'Subject Animal', subjectOverride);
    currentPedTreeData = treeRoot;

    const sireRef = a.sireRef || a.sire || a.sire_name || (treeRoot.sireNode ? treeRoot.sireNode.id : '');
    const damRef = a.damRef || a.dam || a.dam_name || (treeRoot.damNode ? treeRoot.damNode.id : '');

    let inbreedingRiskText = 'CLEAN LINEAGE (0.0% Risk)';
    if (sireRef && damRef && sireRef !== 'Unknown' && damRef !== 'Unknown' && sireRef !== '—' && damRef !== '—' && typeof compatibility === 'function') {
      try {
        const res = compatibility(sireRef, damRef);
        if (res && res.level) inbreedingRiskText = `${res.level} (${res.coefficient ? res.coefficient.toFixed(1) : '0.0'}% Risk)`;
      } catch(e) {}
    }

    const headerEyebrow = isBatchSubject ? '🐖 3-GENERATION PIGLET BATCH LINEAGE' : '🧬 3-GENERATION GENETIC PEDIGREE & ANCESTRY TREE';
    const headerTag = isBatchSubject ? `Piglet Batch · ${a.birth ? fmtDP(a.birth) : 'birth date not recorded'}` : `${a.breed || 'Pedigree Animal'} · ${a.parity ? 'P' + a.parity : (a.kind || 'Breeder')}`;
    const headerSub = isBatchSubject
      ? 'Animated DNA inheritance path · tap a parent or grandparent to inspect the linked animal record'
      : 'Interactive Ancestry Visualizer · Tap any ancestor node to trace genetics & relationships';
    const encodedSubjectId = encodeURIComponent(String(a.id || a.name || ''));
    const editLineageAction = isBatchSubject
      ? `<button type="button" class="btn" onclick="document.getElementById('pedigreeTreeModal').remove();window.openPigletEditor && window.openPigletEditor(decodeURIComponent('${encodedSubjectId}'));">✎ Edit Batch Lineage</button>`
      : `<button type="button" class="btn" onclick="document.getElementById('pedigreeTreeModal').remove();window.openBoarProfile && window.openBoarProfile();">✎ Edit Lineage Data</button>`;

    document.getElementById('pedigreeTreeModal')?.remove();

    document.body.insertAdjacentHTML('beforeend', `
      <div class="due-modal-bg" id="pedigreeTreeModal" style="z-index:999999!important;position:fixed!important;inset:0!important;display:grid!important;place-items:center!important">
        <div class="due-modal pedigree-tree-modal">
          <div class="modal-top">
            <div>
              <div class="eyebrow" style="color:var(--teal2);font-weight:700">${escP(headerEyebrow)}</div>
              <h2>${escP(a.name || a.id)} <span class="tag" style="background:#059669;color:#fff">${escP(headerTag)}</span></h2>
              <p class="perf-sub">${escP(headerSub)}</p>
            </div>
            <button type="button" class="close-reminder" onclick="document.getElementById('pedigreeTreeModal').remove()">×</button>
          </div>

          <!-- Animated DNA Helix Banner -->
          <div class="dna-helix-banner">
            <div class="dna-helix-anim">
              <span class="dna-node d1"></span><span class="dna-node d2"></span>
              <span class="dna-node d3"></span><span class="dna-node d4"></span>
              <span class="dna-node d5"></span><span class="dna-node d6"></span>
              <span class="dna-node d7"></span><span class="dna-node d8"></span>
            </div>
            <div class="dna-banner-copy">
              <b>🧬 Genetic Purity &amp; Lineage Traceability</b>
              <span>${escP(inbreedingRiskText)} · 3-Generation Verified Pedigree Record</span>
            </div>
          </div>

          <!-- View Mode Switcher -->
          <div class="ped-view-tabs">
            <button type="button" class="ped-tab-btn active" id="btnTreeMode" onclick="window.switchPedigreeView('tree')">🌿 Interactive Tree View</button>
            <button type="button" class="ped-tab-btn" id="btnDnaMode" onclick="window.switchPedigreeView('dna')">🧬 DNA Inheritance Flow</button>
          </div>

          <!-- 1. Interactive Hierarchical Tree View -->
          <div class="ped-canvas-wrap" id="pedTreeCanvas">
            ${renderInteractiveTreeHTML(treeRoot)}
          </div>

          <!-- 2. DNA Inheritance Flow View -->
          <div class="dna-flow-wrap" id="pedDnaFlow" style="display:none">
            ${renderDnaFlowHTML(treeRoot)}
          </div>

          <!-- Selected Node Detail Drawer (Reacts to Click / Touch) -->
          <div class="ped-node-drawer" id="pedNodeDrawer">
            <div class="drawer-head">
              <div id="drawerTitle"><b>Select any ancestor card</b> above to view detailed records</div>
              <button type="button" class="btn ghost mini" onclick="document.getElementById('pedNodeDrawer').classList.remove('open')">✕</button>
            </div>
            <div class="drawer-body" id="drawerBody">
              <span class="muted">Tap any father, mother, or grandparent node in the tree to inspect their tag ID, breed, genetic contribution %, and co-ancestry status.</span>
            </div>
          </div>

          <div class="due-actions" style="margin-top:16px;justify-content:space-between;flex-wrap:wrap;gap:8px">
            <div style="display:flex;gap:8px;flex-wrap:wrap">
              ${editLineageAction}
              <button type="button" class="btn ghost" onclick="window.print()">🖨 Export Pedigree PDF</button>
            </div>
            <button type="button" class="btn ghost" onclick="document.getElementById('pedigreeTreeModal').remove()">Close</button>
          </div>
        </div>
      </div>
    `);
    schedulePedigreeConnectorDraw();
  }

  /* Piglet batches inherit the same tree visualizer. A batch is not an animal
     registry row, so resolve its recorded dam/sire through the batch's
     breeding_record_id, sire/dam IDs, names, and semen lot before opening the
     shared three-generation view. No batch or parent record is changed here. */
  function findBatchForPedigree(value) {
    const f = (typeof F === 'function' && F()) ? F() : {},
      raw = typeof value === 'object' && value !== null ? (value.id || value.batch_id || value.name) : value,
      text = String(raw || '').trim();
    if (!text) return null;
    let decoded = text;
    try { decoded = decodeURIComponent(text).trim(); } catch (_) {}
    return (f.piglets || []).find(b => {
      const id = String(b.id || '').trim();
      return id === text || id === decoded || id.toLowerCase() === text.toLowerCase() || id.toLowerCase() === decoded.toLowerCase();
    }) || null;
  }

  function openBatchPedigreeTree(idOrBatch) {
    const b = findBatchForPedigree(idOrBatch);
    if (!b) {
      if (window.toast) toast('Piglet batch lineage record was not found.');
      return;
    }
    const f = F(),
      breeding = (f.breedingRecords || []).find(r => r.id === b.breeding_record_id && !r.deleted_at) || (f.breedingRecords || []).find(r => r.sow_id === (b.dam_id || b.sow_id) && !r.deleted_at),
      semen = (f.semen || []).find(s => (b.semen_id && s.id === b.semen_id) || (b.semen_batch_no && s.semen_batch_no === b.semen_batch_no) || (b.semen && s.semen_batch_no === b.semen)),
      dam = (f.sows || []).find(s => (b.dam_id || b.sow_id) && s.id === (b.dam_id || b.sow_id)) || (f.sows || []).find(s => String(s.name || '').toLowerCase() === String(b.dam_name || b.sow || '').toLowerCase()),
      boar = (f.boars || []).find(x => (b.sire_id || breeding?.boar_id || semen?.boar_id) && x.id === (b.sire_id || breeding?.boar_id || semen?.boar_id)) || (f.boars || []).find(x => String(x.name || '').toLowerCase() === String(b.sire_name || b.sire || breeding?.boar_name || semen?.boar_name || '').toLowerCase()),
      damRef = dam?.id || b.dam_name || b.sow || b.dam_id || b.sow_id || '',
      sireRef = boar?.id || b.sire_name || b.sire || breeding?.boar_name || semen?.boar_name || b.sire_id || breeding?.boar_id || semen?.boar_id || '',
      alive = Math.max(0, (+b.males || 0) + (+b.females || 0) - ((f.pigletLedger || []).filter(x => x.batch_id === b.id && x.type === 'mortality' && !['undone', 'deleted', 'voided'].includes(String(x.status || '').toLowerCase())).reduce((sum, x) => sum + (+x.quantity || 0), 0))),
      damLabel = dam ? `${dam.name || dam.id}${dam.id && dam.name !== dam.id ? ' (' + dam.id + ')' : ''}` : (b.dam_name || b.sow || 'Not linked'),
      sireLabel = boar ? `${boar.name || boar.id}${boar.id && boar.name !== boar.id ? ' (' + boar.id + ')' : ''}` : (b.sire_name || b.sire || breeding?.boar_name || semen?.boar_name || 'Not linked'),
      semenLabel = b.semen_batch_no || b.semen || breeding?.semen_batch_no || semen?.semen_batch_no || 'Not recorded';

    openPedigreeTreeModal({
      __arsSubjectType: 'batch',
      id: b.id,
      name: b.id,
      breed: b.breed || 'Breed not recorded',
      sireRef,
      damRef,
      birth: b.birth,
      subjectMeta: `${alive} live head${alive === 1 ? '' : 's'} · born ${b.birth ? fmtDP(b.birth) : 'date not recorded'}`,
      subjectDetails: {
        'Batch ID': b.id,
        'Birth date': b.birth ? fmtDP(b.birth) : 'Not recorded',
        'Dam': damLabel,
        'Sire': sireLabel,
        'Semen batch': semenLabel,
        'Breeding record': breeding?.id || b.breeding_record_id || 'Not linked'
      }
    });
  }

  window.openPedigreeTree = openPedigreeTreeModal;
  window.openPedigreeTreeModal = openPedigreeTreeModal;
  window.openBatchPedigreeTree = openBatchPedigreeTree;

  let cachedCompatBoars = [];
  let cachedCompatSows = [];

  function filterCompatMale(q) {
    const dropdown = document.getElementById("compatMaleDropdown");
    const clearBtn = document.getElementById("compatMaleClear");
    if (!dropdown) return;
    const f = F();
    const boars = (f.boars || []).concat(f.semen || []);
    const term = String(q || '').trim().toLowerCase();
    if (clearBtn) clearBtn.style.display = term ? 'block' : 'none';

    cachedCompatBoars = boars.filter(b => {
      const bId = b.id || b.name || b.boar || '';
      const bName = b.name || b.boar || bId;
      if (!term) return true;
      return (bName + ' ' + bId + ' ' + (b.breed || '')).toLowerCase().includes(term);
    });

    if (!cachedCompatBoars.length) {
      dropdown.innerHTML = `<div class="suggest-empty">No matching boars found.</div>`;
      dropdown.style.display = 'block';
      return;
    }

    dropdown.innerHTML = cachedCompatBoars.map((b, idx) => `
      <div class="suggest-item" onmousedown="selectCompatMaleByIndex(${idx})">
        <div class="suggest-ico boar">♂</div>
        <div class="suggest-meta">
          <b>${escP(b.name || b.boar || b.id)}</b>
          <small>${escP(b.breed || 'Boar Stud')} · ID: ${escP(b.id || b.boar || 'Stud')}</small>
        </div>
      </div>
    `).join("");

    dropdown.style.display = "block";
  }

  function selectCompatMaleByIndex(idx) {
    const b = cachedCompatBoars[idx];
    if (!b) return;
    const input = document.getElementById("compatMaleInput");
    const hidden = document.getElementById("compatMale");
    const clearBtn = document.getElementById("compatMaleClear");
    const dropdown = document.getElementById("compatMaleDropdown");

    const bId = b.id || b.name || b.boar;
    if (input) input.value = (b.name || b.boar || bId) + (b.breed ? ` · ${b.breed}` : '');
    if (hidden) hidden.value = bId;
    if (clearBtn) clearBtn.style.display = 'block';
    if (dropdown) dropdown.style.display = 'none';
    runCompatibility();
  }

  function clearCompatMale() {
    const input = document.getElementById("compatMaleInput");
    const hidden = document.getElementById("compatMale");
    const clearBtn = document.getElementById("compatMaleClear");
    if (input) { input.value = ''; input.focus(); }
    if (hidden) hidden.value = '';
    if (clearBtn) clearBtn.style.display = 'none';
    filterCompatMale('');
  }

  function filterCompatFemale(q) {
    const dropdown = document.getElementById("compatFemaleDropdown");
    const clearBtn = document.getElementById("compatFemaleClear");
    if (!dropdown) return;
    const f = F();
    const sows = (f.sows || []).filter(s => !s.culled);
    const term = String(q || '').trim().toLowerCase();
    if (clearBtn) clearBtn.style.display = term ? 'block' : 'none';

    cachedCompatSows = sows.filter(s => {
      const sId = s.id || s.name || '';
      const sName = s.name || s.id || '';
      if (!term) return true;
      return (sName + ' ' + sId + ' ' + (s.breed || '')).toLowerCase().includes(term);
    });

    if (!cachedCompatSows.length) {
      dropdown.innerHTML = `<div class="suggest-empty">No matching sows found.</div>`;
      dropdown.style.display = 'block';
      return;
    }

    dropdown.innerHTML = cachedCompatSows.map((s, idx) => `
      <div class="suggest-item" onmousedown="selectCompatFemaleByIndex(${idx})">
        <div class="suggest-ico sow">♀</div>
        <div class="suggest-meta">
          <b>${escP(s.name || s.id)}</b>
          <small>${escP(s.breed || 'Commercial')} · Parity ${s.parity || 0}</small>
        </div>
      </div>
    `).join("");

    dropdown.style.display = "block";
  }

  function selectCompatFemaleByIndex(idx) {
    const s = cachedCompatSows[idx];
    if (!s) return;
    const input = document.getElementById("compatFemaleInput");
    const hidden = document.getElementById("compatFemale");
    const clearBtn = document.getElementById("compatFemaleClear");
    const dropdown = document.getElementById("compatFemaleDropdown");

    const sId = s.id || s.name;
    if (input) input.value = (s.name || sId) + (s.breed ? ` · ${s.breed}` : '');
    if (hidden) hidden.value = sId;
    if (clearBtn) clearBtn.style.display = 'block';
    if (dropdown) dropdown.style.display = 'none';
    runCompatibility();
  }

  function clearCompatFemale() {
    const input = document.getElementById("compatFemaleInput");
    const hidden = document.getElementById("compatFemale");
    const clearBtn = document.getElementById("compatFemaleClear");
    if (input) { input.value = ''; input.focus(); }
    if (hidden) hidden.value = '';
    if (clearBtn) clearBtn.style.display = 'none';
    filterCompatFemale('');
  }

  window.filterCompatMale = filterCompatMale;
  window.selectCompatMaleByIndex = selectCompatMaleByIndex;
  window.clearCompatMale = clearCompatMale;
  window.filterCompatFemale = filterCompatFemale;
  window.selectCompatFemaleByIndex = selectCompatFemaleByIndex;
  window.clearCompatFemale = clearCompatFemale;

  function page() {
    let f = F();
    f.boars = f.boars || [];
    let all = animals(),
      sows = all.filter(x => x.kind === 'Sow'),
      boars = all.filter(x => x.kind === 'Boar');
    document.getElementById('pedigree').innerHTML = `<div class="section-head"><div><div class="eyebrow">GENETICS & BREEDING SAFETY</div><h2>Pedigree & compatibility planner</h2><p>Three-generation recorded lineage, farm-scoped relationship screening.</p></div><button class="btn" onclick="openBoarProfile()">+ Add boar profile</button></div><div class="metric-grid"><div class="panel metric"><span class="muted">Breeding animals</span><b>${all.filter(x => x.kind !== 'Ancestor').length}</b></div><div class="panel metric"><span class="muted">Boar profiles</span><b>${boars.length}</b></div><div class="panel metric"><span class="muted">Recorded sows</span><b>${sows.length}</b></div></div><div class="section panel pedigree-planner"><h2>Check mating compatibility</h2><div class="planner-grid"><div class="field suggest-field"><label>Boar / male *</label><div class="suggest-input-wrap"><input type="text" id="compatMaleInput" class="suggest-input" placeholder="Type boar name to search..." autocomplete="off" onfocus="filterCompatMale(this.value)" oninput="filterCompatMale(this.value)"><input type="hidden" id="compatMale"><button type="button" class="suggest-clear-btn" id="compatMaleClear" onclick="clearCompatMale()" style="display:none">✕</button><div class="suggest-dropdown" id="compatMaleDropdown" style="display:none"></div></div></div><div class="field suggest-field"><label>Sow / female *</label><div class="suggest-input-wrap"><input type="text" id="compatFemaleInput" class="suggest-input" placeholder="Type sow name to search..." autocomplete="off" onfocus="filterCompatFemale(this.value)" oninput="filterCompatFemale(this.value)"><input type="hidden" id="compatFemale"><button type="button" class="suggest-clear-btn" id="compatFemaleClear" onclick="clearCompatFemale()" style="display:none">✕</button><div class="suggest-dropdown" id="compatFemaleDropdown" style="display:none"></div></div></div></div><button class="btn" onclick="runCompatibility()">Check compatibility</button><div id="compatResult" class="compat-result"><span class="muted">Select a male and female to calculate recorded relationship risk.</span></div></div><div class="section panel table-wrap"><table class="table"><thead><tr><th>Boar profile</th><th>Breed</th><th>Parents recorded</th><th></th></tr></thead><tbody>${boars.map((b,i)=>{const _age=ageText(b.dob),_vx=(window.vaxSummaryText?vaxSummaryText('boar',b.id,b.name):'');return `<tr><td><b>${b.name}</b><br><small class="muted">${b.id}</small>${/* [REBUILD FIX 48] age + vaccine lines */''}${_age?`<br><small class="muted">🎂 ${_age} old</small>`:''}${_vx?`<br><small class="muted">💉 ${escP(_vx)}</small>`:''}</td><td>${b.breed||'—'}</td><td>${b.sireRef||b.damRef?'Yes':'No'}</td><td><button class="btn ghost" onclick="openBoarProfile(${i})">Edit</button> <button class="btn ghost delete-action" onclick="deleteBoarProfile(${i})">Delete</button></td></tr>`}).join('')||'<tr><td colspan="4" class="empty">Add boar profiles with their sire and dam to enable deep pedigree checks.</td></tr>'}</tbody></table></div>`
  }

  function runCompatibility() {
    let r = compatibility(document.getElementById('compatMale').value, document.getElementById('compatFemale').value),
      [label, color] = risk(r.f),
      box = document.getElementById('compatResult');
    box.innerHTML = `<b style="color:${color}">${label} · Estimated F = ${r.f.toFixed(2)}%</b><p><b>Relationship:</b> ${r.relationship}<br>${r.message}</p><small><b>Recommendation:</b> ${r.recommendation}</small>`
  }

  /* ── [REBUILD FIX 47] boar profile sire/dam pickers → auto-suggest ──
     The Sire/Dam dropdowns are now type-aheads: tap to list, type to narrow.
     Sire suggests registered BOARS (+ recorded male ancestors), Dam suggests
     registered SOWS (+ recorded female ancestors). If the typed name is not
     on record it is still accepted — it is stored as a lineage ANCESTOR
     record (F().ancestors, never counted as a sow/boar) and linked by id, so
     the pedigree tree and the inbreeding coefficient stay correct. */
  let curPedPools = { sire: [], dam: [] },
    curPedHits = { sire: [], dam: [] };

  function parentPool(side, excludeId) {
    let males = [...(F().boars || []).map(x => ({ id: x.id, name: x.name, breed: x.breed || '', anc: false })), ...ancestors().filter(a => a.sex !== 'F').map(a => ({ id: a.id, name: a.name, breed: a.breed || '', anc: true }))],
      females = [...(F().sows || []).map(x => ({ id: x.id, name: x.name, breed: x.breed || '', anc: false })), ...ancestors().filter(a => a.sex !== 'M').map(a => ({ id: a.id, name: a.name, breed: a.breed || '', anc: true }))];
    return (side === 'sire' ? males : females).filter(x => x.id !== excludeId);
  }

  function refLabel(ref) {
    if (!ref) return '';
    let hit = animals().find(x => x.id === ref || String(x.name || '').toLowerCase() === String(ref).toLowerCase());
    return hit ? `${hit.name} (${hit.id})` : String(ref);
  }

  function pedParentFilter(side, q) {
    let hid = document.getElementById('ped' + side + 'Ref'),
      box = document.getElementById('ped' + side + 'Sug');
    if (!box) return;
    if (hid) hid.value = ''; /* a re-type must be re-confirmed by a pick or matched on save */
    let term = String(q || '').trim().toLowerCase(),
      hits = curPedPools[side].filter(x => !term || (x.name + ' ' + x.breed + ' ' + x.id).toLowerCase().includes(term)).slice(0, 10);
    curPedHits[side] = hits;
    box.innerHTML = hits.map((x, i) => `<button type="button" onmousedown="pedParentPick('${side}',${i})"><b>${escP(x.name)}${x.anc ? ' 🧬' : ''}</b><span>${escP(x.breed || '—')} · ${escP(x.id)}${x.anc ? ' · recorded ancestor' : ''}</span></button>`).join('') +
      `<div class="suggestion-empty">${hits.length ? 'Pick a record above, or keep typing a new name — it will be saved on record.' : `No record named “${escP(String(q || '').trim())}” yet — save the profile and “${escP(String(q || '').trim())}” is kept on record for lineage checks.`}</div>`;
    box.classList.add('open');
    box.style.display = 'block';
  }

  function pedParentPick(side, i) {
    let x = curPedHits[side][i];
    if (!x) return;
    document.getElementById('ped' + side + 'Ref').value = x.id;
    document.getElementById('ped' + side + 'Input').value = `${x.name} (${x.id})`;
    pedParentClose(side);
  }

  function pedParentClose(side) {
    let box = document.getElementById('ped' + side + 'Sug');
    if (box) { box.classList.remove('open'); box.style.display = 'none'; }
  }

  /* FIX 47: tapping anywhere outside a picker (e.g. straight onto Save)
     closes both suggestion lists immediately, so they never swallow taps. */
  document.addEventListener('pointerdown', e => {
    if (!document.getElementById('boarModal')) return;
    /* [REBUILD FIX 47b] ignore non-element targets — document-level pointer events
       fire mid-modal-close in some browsers and would race the suggestion pick */
    if (!e.target || e.target === document || e.target === document.documentElement || e.target === document.body) return;
    if (!e.target.closest('.treat-typeahead')) { pedParentClose('sire'); pedParentClose('dam'); }
  }, true);

  function linkParentRef(side) {
    let typed = String(document.getElementById('ped' + side + 'Input')?.value || '').trim(),
      ref = String(document.getElementById('ped' + side + 'Ref')?.value || '').trim();
    if (!typed) return ''; /* left blank = Unknown */
    if (ref) return ref;   /* picked a record */
    let exact = curPedPools[side].find(x => `${x.name} (${x.id})`.toLowerCase() === typed.toLowerCase()) ||
      animals().find(x => x.id === typed || String(x.name || '').toLowerCase() === typed.toLowerCase());
    if (exact) return exact.id;
    /* free-typed and not on record → keep it on record as a lineage ancestor */
    let a = { id: 'ANC-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5), name: typed, sex: side === 'sire' ? 'M' : 'F', breed: '', notes: 'Recorded from a boar profile (lineage reference)', created_at: new Date().toISOString() };
    ancestors().push(a);
    return a.id;
  }

  function openBoarProfile(i = null) {
    let b = i === null ? {} : F().boars[i];
    curPedPools = { sire: parentPool('sire', b.id), dam: parentPool('dam', b.id) };
    curPedHits = { sire: [], dam: [] };
    /* [REBUILD FIX 48] vaccination: history fetched from the Vaccination Center + add inputs */
    const vaxRecs = (i !== null && window.vaxRecordsFor) ? vaxRecordsFor('boar', b.id, b.name) : [],
      vaxHistHtml = i !== null ? (vaxRecs.length
        ? vaxRecs.map(r => `<div class="boar-vax-row"><b>💉 ${escP(r.vaccine)}</b><span>${escP(fmtDP(r.last))}${r.doses > 1 ? ' · ' + r.doses + ' doses' : ''}</span></div>`).join('')
        : '<div class="empty boar-vax-none">No vaccination record in the Vaccination Center for this boar yet.</div>') : '',
      vaxBlock = `<div class="field full"><label>💉 Vaccination record <small class="muted">— from the Vaccination Center</small></label>${vaxHistHtml}<div class="boar-vax-add"><input id="boarVaxName" autocomplete="off" placeholder="Vaccine name (e.g. Hog Cholera)" onkeydown="if(event.key==='Enter')event.preventDefault()"><input id="boarVaxDate" type="date" value="${todayLocal()}" title="Date given"></div><small class="field-hint">Optional — type a vaccine + its date and it is saved into the Vaccination Center as a completed dose for this boar automatically. [FIX 48]</small></div>`;
    const ta = (side, label) => `<div class="field"><label>${label}</label><div class="treat-typeahead"><input id="ped${side}Input" autocomplete="off" placeholder="Type a name — records auto-suggest" value="${escP(refLabel(b[side + 'Ref']))}" oninput="pedParentFilter('${side}',this.value)" onfocus="pedParentFilter('${side}',this.value)" onblur="setTimeout(pedParentClose,180,'${side}')"><input type="hidden" name="${side}Ref" id="ped${side}Ref" value="${escP(b[side + 'Ref'] || '')}"><div id="ped${side}Sug" class="semen-suggestions treat-sug"></div></div><small class="field-hint">Not registered? Just type the name — it is saved on record so the lineage & inbreeding check stays correct. [FIX 47]</small></div>`;
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="boarModal"><form class="reminder-modal" onsubmit="saveBoarProfile(event,${i})"><div class="modal-top"><h2>${i===null?'Add boar profile':'Edit boar profile'}</h2><button type="button" class="close-reminder" onclick="document.getElementById('boarModal').remove()">×</button></div><div class="reminder-fields"><div class="field"><label>Boar ID *</label><input name="id" value="${escP(b.id||'B-'+Date.now())}" required></div><div class="field"><label>Boar name *</label><input name="name" value="${escP(b.name||'')}" required></div><div class="field"><label>Breed</label><input name="breed" value="${escP(b.breed||'')}"></div><div class="field"><label>Birthday</label><input name="dob" type="date" value="${escP(b.dob||'')}" onchange="updateBoarAgePreview()" oninput="updateBoarAgePreview()"><small class="field-hint" id="boarAgePrev">${b.dob && ageText(b.dob) ? 'Age today: ' + ageText(b.dob) + ' old' : ''}</small></div>${ta('sire', 'Sire record')}${ta('dam', 'Dam record')}${vaxBlock}</div><div class="actions"><button class="btn">Save boar profile</button></div></form></div>`)
  }

  function saveBoarProfile(e, i) {
    e.preventDefault();
    let x = Object.fromEntries(new FormData(e.target));
    x.sireRef = linkParentRef('sire'); /* [REBUILD FIX 47] */
    x.damRef = linkParentRef('dam');   /* [REBUILD FIX 47] */
    if (i === null) F().boars.push(x);
    else F().boars[i] = { ...F().boars[i], id: x.id, name: x.name, breed: x.breed, dob: x.dob || '', sireRef: x.sireRef, damRef: x.damRef, updated_at: new Date().toISOString() }; /* FIX 47: keep status/notes — editing used to wipe them */
    const savedBoar = i === null ? x : F().boars[i],
      vaxIn = (document.getElementById('boarVaxName')?.value || '').trim(); /* [REBUILD FIX 48] */
    if (vaxIn) recordBoarVaccine(savedBoar, vaxIn, document.getElementById('boarVaxDate')?.value || todayLocal());
    save();
    document.getElementById('boarModal').remove();
    page();
    toast(vaxIn ? 'Boar pedigree + vaccination saved to the Vaccination Center' : 'Boar pedigree saved')
  }

  function deleteBoarProfile(i) {
    if (!confirm('Delete this boar profile?')) return;
    F().boars.splice(i, 1);
    save();
    page();
    toast('Boar profile deleted')
  }
  window.openBoarProfile = openBoarProfile;
  window.saveBoarProfile = saveBoarProfile;
  window.pedParentFilter = pedParentFilter;
  window.pedParentPick = pedParentPick;
  window.pedParentClose = pedParentClose;
  window.deleteBoarProfile = deleteBoarProfile;
  window.runCompatibility = runCompatibility;
  window.openPedigreeTree = openPedigreeTreeModal;
  window.openPedigreeTreeModal = openPedigreeTreeModal;
  window.calculateCompatibility = compatibility;
  const old = window.renderAll;
  window.renderAll = function() {
    (typeof old === 'function' && old());
    page()
  };
})();