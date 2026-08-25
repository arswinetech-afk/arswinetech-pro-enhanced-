/* Unified modal layer: body portal overlays, scroll lock, focus and stacking safety. */
(function() {
  const selector = '.modal-bg.open,.due-modal-bg,.reminder-modal-bg,.drill-bg,.onboard-screen.open,.reset-screen.open';

  function sync(shouldFocus = false) {
    let open = document.querySelector(selector);
    document.body.classList.toggle('app-modal-open', !!open);
    if (open && shouldFocus) {
      setTimeout(() => {
        let focus = open.querySelector('input,select,textarea,button:not(.close-reminder)');
        focus?.focus({
          preventScroll: true
        })
      }, 20)
    }
  }
  new MutationObserver(records => {
    const addedModal = records.some(r => r.type === 'childList' && [...r.addedNodes].some(n => n.nodeType === 1 && (n.matches?.(selector) || n.querySelector?.(selector))));
    sync(addedModal)
  }).observe(document.body, {
    childList: true,
    subtree: true,
    attributes: true,
    attributeFilter: ['class', 'style']
  });
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') {
      let top = [...document.querySelectorAll(selector)].at(-1);
      if (top?.id === 'drillModal') top.remove();
      else if (top?.id) top.remove();
      sync()
    }
  });
  sync();
})();