/*
 * Tenant guard and onboarding helpers.
 *
 * Authentication, session restoration, membership selection, and cloud-baseline
 * loading are owned by app.js. This file must never restore access from a local
 * ars-auth flag or replace the verified finishAuthenticated() implementation.
 */
(function() {
  'use strict';

  window.currentFarmAssigned = false;

  function setupMarkup(mode = 'create') {
    const el = document.getElementById('onboardScreen');
    if (!el) return;
    const content = mode === 'join'
      ? `<form class="onboard-card" onsubmit="joinExistingFarm(event)"><div class="eyebrow">SECURE FARM INVITATION</div><h2>Join an existing farm</h2><p>You can join a farm only with a valid invitation code from its owner or manager.</p><div class="onboard-form"><div class="field full"><label>Invitation code *</label><input name="invitation_code" required placeholder="e.g. ARS-A1B2C3" style="text-transform:uppercase"></div><div class="form-error" id="onboardError"></div></div><div class="actions"><button type="button" class="btn ghost" onclick="showFarmSetup('create')">Create new farm instead</button><button class="btn">Join securely</button></div></form>`
      : `<form class="onboard-card" onsubmit="secureCreateFarm(event)"><div class="eyebrow">FIRST-TIME FARM SETUP</div><h2>Create your private farm workspace</h2><p>This creates a new farm and makes you its Owner. No existing farm is selected or assigned.</p><div class="onboard-form"><div class="field"><label>First name *</label><input name="first_name" required></div><div class="field"><label>Last name *</label><input name="last_name" required></div><div class="field"><label>Farm name *</label><input name="farm_name" required placeholder="e.g. Riverside Hog Farm"></div><div class="field"><label>Farm owner name *</label><input name="owner_name" required placeholder="Owner / operator"></div><div class="field full"><label>Farm location (optional)</label><textarea name="farm_address" placeholder="Barangay, municipality/city, province"></textarea></div><div class="field"><label>Mobile number</label><input name="mobile_number" type="tel"></div><div class="field"><label>Province</label><input name="province"></div><div class="form-error" id="onboardError"></div></div><div class="actions"><button type="button" class="btn ghost" onclick="showFarmSetup('join')">Join with invitation code</button><button class="btn">Create secure farm</button></div></form>`;
    el.innerHTML = content;
    el.classList.add('open');
  }

  function showFarmSetup(mode = 'create') {
    if (!window.ARSCloud || !ARSCloud.sessionInfo?.()?.token_present) {
      document.getElementById('loginScreen')?.style && (document.getElementById('loginScreen').style.display = 'grid');
      showLoginError('Sign in securely before creating or joining a farm.');
      return;
    }
    setupMarkup(mode);
  }

  async function grantAccess(email, membership, farmName) {
    // Compatibility wrapper for older feature code. It deliberately ignores
    // caller-supplied membership data and reuses app.js's verified path.
    if (!membership?.farm_id || typeof window.finishAuthenticated !== 'function') {
      showFarmSetup('create');
      return false;
    }
    const user = await ARSCloud.getCurrentUser();
    return window.finishAuthenticated(user.email || email, user);
  }

  async function secureCreateFarm(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    const err = document.getElementById('onboardError');
    err.classList.remove('show');
    try {
      await ARSCloud.onboard({ ...data, barangay: '', municipality: '' });
      const user = await ARSCloud.getCurrentUser();
      const ok = await window.finishAuthenticated(user.email, user, { onboarding: true });
      if (!ok) throw new Error('Farm created, but the verified membership could not be loaded.');
    } catch (ex) {
      err.textContent = ex.message || 'Farm creation failed. No local data was uploaded.';
      err.classList.add('show');
    }
  }

  async function joinExistingFarm(e) {
    e.preventDefault();
    const data = Object.fromEntries(new FormData(e.target));
    const err = document.getElementById('onboardError');
    err.classList.remove('show');
    try {
      await ARSCloud.joinFarmWithInvitation(data.invitation_code);
      const user = await ARSCloud.getCurrentUser();
      const ok = await window.finishAuthenticated(user.email, user, { joined: true });
      if (!ok) throw new Error('Farm joined, but the verified membership could not be loaded.');
    } catch (ex) {
      err.textContent = ex.message || 'Access denied. A valid invitation code is required.';
      err.classList.add('show');
    }
  }

  const priorGo = window.go;
  window.go = function(page) {
    if (!window.currentFarmAssigned && !isSuperAdmin()) {
      document.getElementById('loginScreen')?.style && (document.getElementById('loginScreen').style.display = 'grid');
      showLoginError('Sign in securely to open the farm workspace.');
      return;
    }
    return typeof priorGo === 'function' ? priorGo(page) : undefined;
  };

  // Do not assign window.finishAuthenticated here: app.js owns the verified
  // implementation and must not be replaced by a local-storage fallback.
  window.grantAccess = grantAccess;
  window.showFarmSetup = showFarmSetup;
  window.secureCreateFarm = secureCreateFarm;
  window.joinExistingFarm = joinExistingFarm;
  // No boot-time access grant. app.js/startApp() verifies Supabase first.
})();
