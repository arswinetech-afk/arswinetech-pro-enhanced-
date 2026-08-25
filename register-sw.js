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
  });
}