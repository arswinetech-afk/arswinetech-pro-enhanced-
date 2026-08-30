/* ═══════════════════════════════════════════════════════════════════════════
   [REBUILD FIX 64] js/invite-share.js — farm invitation code: view · copy ·
   share · rotate, plus platform-admin user deletion.

   INVITATION CODE VISIBILITY — strictly:
     • the OWNER of that farm (live membership role 'owner'), or
     • the platform developer (platform_admins → arswinetech@gmail.com).
   Staff / manager / viewer roles never see the button or the code; the same
   check is enforced again server-side (SQL RPCs, supabase/setup.sql).

   Where it lives:
     • farm OWNER → "🔑 Invitation code" button pinned under the active-farm
       box in the sidebar (reachable through the ☰ drawer on mobile);
     • platform developer → "🔑 Code" button per farm row on User Access.

   Regenerating rotates the code; the old one stops working immediately.

   USER DELETION — platform admin only: removes the user's cloud login + every
   farm membership (RPC platform_delete_user) then drops them from the
   on-device user registry. The signed-in admin cannot delete themselves.
   ═══════════════════════════════════════════════════════════════════════════ */
(function () {
  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  let inviteFarm = null, inviteCode = '';

  function canSeeInviteCode(id) {
    return (typeof isSuperAdmin === 'function' && isSuperAdmin()) ||
           (id === farmId && window.myFarmRole === 'owner');
  }

  /* sidebar button (owner path) — re-evaluated on every farm render/switch */
  function injectInviteBtn() {
    const box = document.querySelector('.farmbox');
    if (!box) return;
    let btn = document.getElementById('farmInviteBtn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'farmInviteBtn';
      btn.type = 'button';
      btn.className = 'invite-btn';
      btn.textContent = '🔑 Invitation code';
      btn.onclick = () => openInviteModal();
      box.appendChild(btn);
    }
    btn.style.display = canSeeInviteCode(farmId) ? 'block' : 'none';
  }
  const _priorSF = window.setFarmSelect;
  window.setFarmSelect = function () {
    const r = _priorSF ? _priorSF.apply(this, arguments) : undefined;
    injectInviteBtn();
    return r;
  };

  function inviteShell(farmLabel) {
    document.getElementById('inviteModal')?.remove();
    document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="inviteModal"><div class="due-modal invite-modal"><div class="modal-top"><div><div class="eyebrow">🔑 SECURE FARM INVITATION</div><h2>${esc(farmLabel)}</h2></div><button type="button" class="close-reminder" onclick="document.getElementById('inviteModal').remove()">×</button></div><div id="inviteBody"><p class="muted">Fetching the secure code…</p></div></div></div>`);
  }

  function inviteBodyHTML(inv, farmLabel, members = []) {
    members = Array.isArray(members) ? members : [];
    const uses = inv.max_uses ? `${inv.uses || 0} / ${inv.max_uses} used` : `${inv.uses || 0} joined so far`;
    const memberRows = members.map(m => `
      <tr>
        <td><b>${esc(m.email || m.name || "Staff User")}</b></td>
        <td><span class="tag ${m.role === "owner" ? "ok" : ""}">${esc(String(m.role || "staff").toUpperCase())}</span></td>
        <td><small class="muted">${m.created_at ? fmtDate(m.created_at.slice(0, 10)) : "Active"}</small></td>
        <td><span class="badge ok">● Active</span></td>
      </tr>
    `).join("");

    return `<p class="muted">Share this code with the staff, manager or viewer you want on <b>${esc(farmLabel)}</b>. They create their account, tap <b>“Join with invitation code”</b> on the welcome screen and paste it — they join the farm securely and all your farm records will sync to their device automatically.</p>
      <div class="invite-code-box"><b>${esc(inv.code)}</b><span>${esc(uses)} · new members join as ${esc(String(inv.role || "staff"))}</span></div>
      <div class="invite-actions"><button type="button" class="btn" onclick="copyInviteCode()">📋 Copy code</button><button type="button" class="btn ghost" onclick="shareInviteText()">📤 Copy invite message</button></div>
      <div class="invite-actions"><button type="button" class="btn ghost" onclick="regenInviteCode()">🔄 Regenerate — old code stops working</button></div>

      <!-- Live Registered Farm Members Table -->
      <div class="fc-subhead" style="margin-top:20px"><b>👥 Registered Farm Team Members (${members.length || 1})</b><small class="muted">Users who currently have access to this farm workspace</small></div>
      <div class="table-wrap" style="margin-top:8px;max-height:180px;overflow-y:auto">
        <table class="table">
          <thead>
            <tr>
              <th>User Email</th>
              <th>Role</th>
              <th>Joined Date</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            ${memberRows || `<tr><td><b>${esc(typeof currentEmail === "function" ? currentEmail() : "Owner")}</b></td><td><span class="tag ok">OWNER</span></td><td><small class="muted">Primary</small></td><td><span class="badge ok">● Active</span></td></tr>`}
          </tbody>
        </table>
      </div>

      <p class="invite-note" style="margin-top:14px">🔒 Only the farm owner and the ARSwineTech platform developer can view or regenerate this code. Keep it private — anyone holding it can join the farm.</p>`;
  }

  async function openInviteModal(id) {
    /* [FIX 108] trial farms are device-only & unauthenticated — explain kindly
       instead of showing backend errors to first-timers. */
    if (window.arsIsTrialFarm && window.arsIsTrialFarm()) {
      if (window.toast) window.toast('🎁 Trials live on this device only. Staff invitations unlock automatically when you subscribe.');
      return;
    }
    id = id || farmId;
    if (!canSeeInviteCode(id)) { toast("Only the farm owner or the ARSwineTech platform developer can view the invitation code."); return; }
    inviteFarm = id;
    const farmLabel = (DB[id] && DB[id].name) || id;
    inviteShell(farmLabel);
    try {
      const inv = await ARSCloud.ensureFarmInvitation(id, farmLabel);
      inviteCode = inv.code;
      const members = (await ARSCloud.getFarmMembers(id).catch(() => [])) || [];
      if (members.length) {
        const myEmail = typeof currentEmail === "function" ? currentEmail().toLowerCase() : "";
        const myMem = members.find(m => (m.email || "").toLowerCase() === myEmail);
        if (myMem && myMem.role) window.myFarmRole = myMem.role;
      }
      const b = document.getElementById("inviteBody");
      if (b) b.innerHTML = inviteBodyHTML(inv, farmLabel, members);
    } catch (ex) {
      const b = document.getElementById("inviteBody");
      const msg = (ex && ex.message) || "error";
      const hint = "The backend needs the latest update — paste the newest supabase/setup.sql into Supabase → SQL Editor → Run once.";
      if (b) b.innerHTML = `<div class="form-error show">Could not create the invitation code. ${esc(hint)}</div><p class="invite-err-detail">${esc(msg)}</p>`;
      else toast("Could not load the invitation code: " + msg);
    }
  }

  function copyText(t, doneMsg) {
    const fallback = () => {
      const ta = document.createElement('textarea');
      ta.value = t;
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); toast(doneMsg); } catch (e) { prompt('Copy it manually:', t); }
      ta.remove();
    };
    if (navigator.clipboard && navigator.clipboard.writeText)
      navigator.clipboard.writeText(t).then(() => toast(doneMsg)).catch(fallback);
    else fallback();
  }

  function copyInviteCode() {
    if (!inviteCode) return;
    copyText(inviteCode, `✔ Invitation code ${inviteCode} copied — send it to your new staff member.`);
  }

  function shareInviteText() {
    if (!inviteCode) return;
    const farmLabel = (DB[inviteFarm] && DB[inviteFarm].name) || 'our farm';
    copyText(`You're invited to join "${farmLabel}" on ARSwineTech Pro.\n\n1) Open the app and create your account (Sign up).\n2) On the welcome screen tap "Join with invitation code".\n3) Paste this code: ${inviteCode}\n\nAfter joining, the farm owner or admin can adjust your role (staff / manager / viewer).`, '✔ Invite message copied — paste it into Messenger / SMS.');
  }

  async function regenInviteCode() {
    if (!inviteFarm) return;
    if (!confirm('Regenerate the invitation code?\n\nThe current code stops working immediately. Anyone who has not joined yet will need the new code.')) return;
    try {
      const b = document.getElementById('inviteBody');
      if (b) b.innerHTML = '<p class="muted" style="text-align:center;padding:24px">🔄 Regenerating new invitation code…</p>';

      const inv = await ARSCloud.regenerateFarmInvitation(inviteFarm, (DB[inviteFarm] && DB[inviteFarm].name) || '');
      inviteCode = inv.code;
      const members = (await ARSCloud.getFarmMembers(inviteFarm).catch(() => [])) || [];
      if (members.length) {
        const myEmail = typeof currentEmail === "function" ? currentEmail().toLowerCase() : "";
        const myMem = members.find(m => (m.email || "").toLowerCase() === myEmail);
        if (myMem && myMem.role) window.myFarmRole = myMem.role;
      }
      const farmLabel = (DB[inviteFarm] && DB[inviteFarm].name) || inviteFarm;

      if (b) b.innerHTML = inviteBodyHTML(inv, farmLabel, members);
      toast('🔄 New invitation code active: ' + inv.code);
    } catch (ex) {
      console.warn('Regenerate error:', ex);
      toast('Could not regenerate: ' + ((ex && ex.message) || 'error'));
      openInviteModal(inviteFarm);
    }
  }

  /* ── platform admin: permanently delete a registered user ───────────────── */
  async function deleteUserComplete(email) {
    if (!(typeof isSuperAdmin === 'function' && isSuperAdmin())) { toast('Administrator access is required.'); return; }
    email = String(email || '').trim();
    if (!email) return;
    if (typeof currentEmail === 'function' && email.toLowerCase() === currentEmail()) {
      toast('You cannot delete the account you are signed in with.');
      return;
    }
    const typed = prompt(`PERMANENTLY DELETE user "${email}"?\n\nThis removes their sign-in and every farm membership — on this device AND in the cloud — and cannot be undone.\n\nType the email exactly to confirm:`);
    if (typed === null) return;
    if (typed.trim().toLowerCase() !== email.toLowerCase()) { toast('Email did not match — deletion cancelled.'); return; }
    try {
      await ARSCloud.deleteUser(email);
    } catch (ex) {
      const msg = (ex && ex.message) || 'error';
      toast('User deletion failed: ' + msg + (/not found|could not|404|does not exist/i.test(msg) ? ' — update the backend once via supabase/setup.sql.' : ''));
      return;
    }
    try { saveUsers(users().filter(u => u.email.toLowerCase() !== email.toLowerCase())); } catch (e) {}
    adminPage();
    toast(`✔ User "${email}" deleted — sign-in and farm memberships removed.`);
  }

  window.canSeeInviteCode = canSeeInviteCode;
  window.openInviteModal = openInviteModal;
  window.copyInviteCode = copyInviteCode;
  window.shareInviteText = shareInviteText;
  window.regenInviteCode = regenInviteCode;
  window.deleteUserComplete = deleteUserComplete;
})();
