/*
 * ARSwineTech Pro — isolated farm-logo engine.
 *
 * Scope rules:
 *   - The official ARSwineTech logo is immutable on login, recovery, and
 *     onboarding screens.
 *   - A custom logo is read only from the verified active farm bucket.
 *   - A farm logo is stored under that farm ID and synchronized as the
 *     farm_logo app_records entity; it is never used as the application logo.
 *   - Logo selection is blocked until the authenticated farm context is ready.
 */
(function () {
  'use strict';

  const officialLogo = () => window.ARS_OFFICIAL_LOGO || 'assets/arswinetech-logo.png';

  function getActiveFarmId() {
    if (window.__arsActiveFarmId && window.arsContextReady) return String(window.__arsActiveFarmId);
    if (window.arsContextReady && window.farmId) return String(window.farmId);
    return null;
  }

  function getFarmObj(id = getActiveFarmId()) {
    if (!id || !window.DB || typeof window.DB !== 'object') return null;
    return window.DB[id] || null;
  }

  function applyOfficialLogo() {
    const src = officialLogo();
    document.querySelectorAll('.login-screen .logo-img, .reset-screen .logo-img, .onboard-screen .logo-img').forEach(img => {
      img.dataset.logoScope = 'application';
      img.dataset.defaultSrc = src;
      img.removeAttribute('data-farm-id');
      img.src = src;
    });
  }

  function apply() {
    const id = getActiveFarmId();
    const farm = getFarmObj(id);
    const farmLogoSrc = id && farm
      ? (farm.logo || farm.logo_url || (window.STORE && STORE.getItem('ars-farm-logo-' + id)) || null)
      : null;
    const defaultSrc = officialLogo();

    // Only the authenticated workspace sidebar receives the farm logo.
    document.querySelectorAll('.sidebar .logo-img').forEach(img => {
      img.dataset.logoScope = 'farm';
      if (id) img.dataset.farmId = id;
      else img.removeAttribute('data-farm-id');
      img.dataset.defaultSrc = defaultSrc;
      img.src = farmLogoSrc || defaultSrc;
      img.alt = farm?.name ? `${farm.name} logo` : 'AR SwineTech farm workspace';
    });

    // Auth screens are always restored to the official app logo.
    applyOfficialLogo();
  }

  function choose() {
    const id = getActiveFarmId();
    const farm = getFarmObj(id);
    if (!id || !farm || !window.arsContextReady || !window.currentFarmAssigned) {
      toast('Sign in to a verified farm workspace before changing its logo.');
      return;
    }

    const farmName = farm.name || id;
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/png,image/jpeg,image/webp';
    input.onchange = () => {
      const file = input.files?.[0];
      if (!file) return;
      if (file.size > 2 * 1024 * 1024) {
        toast('Logo must be 2 MB or smaller.');
        return;
      }
      const reader = new FileReader();
      reader.onload = async () => {
        const dataUrl = String(reader.result || '');
        if (!dataUrl.startsWith('data:image/')) {
          toast('Please choose a valid image file.');
          return;
        }

        // Keep the official application logo untouched. This data belongs only
        // to the verified farm ID selected above.
        /* [FIX 86] downscale to ≤512px so the logo can't eat the localStorage
           quota (a raw 2 MB upload ≈ 2.7 MB of base64 in the offline DB). */
        let logoUrl = dataUrl;
        if (window.arsDownscaleImage) {
          try { logoUrl = await window.arsDownscaleImage(dataUrl, 512, 0.85, true); } catch (_) {}
        }
        farm.logo = logoUrl;
        farm.logo_url = logoUrl;
        if (window.STORE) { try { STORE.setItem('ars-farm-logo-' + id, logoUrl); } catch (_) {} }
        if (window.save) window.save();
        apply();

        // Perform an immediate, farm-scoped cloud write so a background pull
        // cannot replace the new logo before the generic save timer runs.
        if (window.ARSCloud?.saveFarmLogo) {
          const result = await ARSCloud.saveFarmLogo(id, logoUrl);
          if (!result || result.success === false) {
            toast(`⚠️ Logo kept locally; cloud upload blocked: ${result?.reason || 'try again while online'}`);
            return;
          }
        }
        apply();
        toast(`✓ Custom logo saved for ${farmName}.`);
      };
      reader.readAsDataURL(file);
    };
    input.click();
  }

  function bindSidebarBrand() {
    document.querySelectorAll('.sidebar .brand').forEach(brand => {
      brand.title = 'Tap to change this farm logo';
      brand.style.cursor = 'pointer';
      brand.onclick = choose;
    });
  }

  const oldSetFarmSelect = window.setFarmSelect;
  window.setFarmSelect = function () {
    if (typeof oldSetFarmSelect === 'function') oldSetFarmSelect();
    bindSidebarBrand();
    apply();
  };

  const oldRenderAll = window.renderAll;
  window.renderAll = function () {
    if (typeof oldRenderAll === 'function') oldRenderAll();
    bindSidebarBrand();
    apply();
  };

  bindSidebarBrand();
  apply();

  window.changeFarmLogo = choose;
  window.applyCustomLogo = apply;
})();
