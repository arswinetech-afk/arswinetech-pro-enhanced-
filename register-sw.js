// Register ARSwineTech Pro service worker after page load.
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js', {
        scope: './',
        updateViaCache: 'none'
      })
      .then((registration) => {
        registration.update().catch(() => {});
        console.info('ARSwineTech service worker registered:', registration.scope);
      })
      .catch((error) => console.error('ARSwineTech service worker registration failed:', error));

    /* [FIX 109] when a newer service worker takes control (after a deploy),
       reload once so open tabs run the new code immediately — farmers never
       need to manually refresh to get updates. */
    let swRefreshed = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (swRefreshed) return;
      swRefreshed = true;
      window.location.reload();
    });
  });
}
