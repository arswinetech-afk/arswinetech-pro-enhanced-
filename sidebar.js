/* Persistent desktop pin/unpin navigation and mobile off-canvas drawer. */
(function() {
  const sidebar = document.getElementById('appSidebar');
  if (!sidebar) return;

  function storage() {
    try {
      return STORE
    } catch (e) {
      return localStorage
    }
  }

  function labels() {
    sidebar.querySelectorAll('.nav button').forEach(btn => {
      if (btn.dataset.label) return;
      let text = Array.from(btn.childNodes || []).filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim();
      if (text) {
        btn.dataset.label = text;
        Array.from(btn.childNodes || []).filter(n => n.nodeType === 3 && n.textContent.trim()).forEach(n => n.remove());
        let span = document.createElement('span');
        span.className = 'nav-label';
        span.textContent = text;
        btn.appendChild(span)
      }
    })
  }

  function applyCollapsed(collapsed) {
    document.body.classList.toggle('sidebar-collapsed', collapsed);
    sidebar.classList.toggle('sidebar-unpinned', collapsed);
    let b = document.getElementById('sidebarToggle');
    if (b) {
      b.textContent = collapsed ? '›' : '‹';
      b.title = collapsed ? 'Pin expanded sidebar' : 'Collapse to icon navigation';
      b.setAttribute('aria-label', b.title)
    }
  }

  function toggleSidebar() {
    let next = !document.body.classList.contains('sidebar-collapsed');
    applyCollapsed(next);
    storage().setItem('ars-sidebar-collapsed', next ? '1' : '0');
    storage().setItem('sidebarCollapsed', next ? 'true' : 'false')
  }

  function toggleMobileSidebar() {
    let open = sidebar.classList.toggle('mobile-open');
    let back = document.getElementById('sidebarBackdrop');
    back?.classList.toggle('show', open)
  }
  labels();
  // Group growing navigation into collapsible, memorable categories without changing page routes.
  const groups = [
    ['Operations', ['reservations', 'dashboard', 'sows', 'piglets', 'vaccination', 'medicine', 'barns', 'rfid']],
    ['Breeding & Genetics', ['pedigree', 'semen', 'production']],
    ['Feed & Inventory', ['feed', 'predictor']],
    ['Finance & Sales', ['financials', 'pos']],
    ['Administration', ['reminders', 'subscription', 'useradmin']]
  ];
  const nav = sidebar ? sidebar.querySelector('.nav') : null;
  if (!sidebar || !nav) return;
  const savedGroups = JSON.parse(storage().getItem('ars-sidebar-groups') || '{}');
  groups.forEach(([name, pages], idx) => {
    const members = pages.map(page => nav.querySelector(`[data-page="${page}"]`)).filter(Boolean);
    if (!members.length) return;
    const group = document.createElement('div');
    group.className = 'nav-group';
    group.dataset.group = name;
    const header = document.createElement('button');
    header.type = 'button';
    header.className = 'nav-group-header';
    header.innerHTML = `<span class="group-arrow">▾</span><span class="group-title">${name}</span>`;
    const content = document.createElement('div');
    content.className = 'nav-group-content';
    members.forEach(x => content.appendChild(x));
    let open = savedGroups[name] ?? (idx === 0);
    group.classList.toggle('closed', !open);
    header.onclick = () => {
      group.classList.toggle('closed');
      savedGroups[name] = !group.classList.contains('closed');
      storage().setItem('ars-sidebar-groups', JSON.stringify(savedGroups))
    };
    group.appendChild(header); group.appendChild(content);
    nav.appendChild(group)
  });
  let toggle = document.createElement('button');
  toggle.id = 'sidebarToggle';
  toggle.className = 'sidebar-toggle';
  toggle.onclick = toggleSidebar;
  sidebar.appendChild(toggle);
  let backdrop = document.createElement('div');
  backdrop.id = 'sidebarBackdrop';
  backdrop.className = 'sidebar-drawer-backdrop';
  backdrop.onclick = toggleMobileSidebar;
  document.body.appendChild(backdrop);
  applyCollapsed(storage().getItem('sidebarCollapsed') === 'true' || storage().getItem('ars-sidebar-collapsed') === '1');
  window.toggleMobileSidebar = toggleMobileSidebar;
})();