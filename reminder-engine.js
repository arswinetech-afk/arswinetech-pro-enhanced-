/* ARSwineTech Pro — tenant-scoped recurring reminder engine.
   Browser notifications are delivered while the PWA is running. For guaranteed alerts after
   Android app termination, package this PWA with Capacitor and use its Local Notifications plugin. */
(function() {
    const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
    const DAY_LABELS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    let dueModalOpen = false,
      scheduler = null,
      audioCtx = null,
      activeOscillators = [],
      activeAlarmTimer = null,
      activeAlarmVibration = null,
      activeAlarmId = null;
    const DEFAULT_SOUND_REPEAT_MINUTES = 5;
    const toIso = d => d.toISOString();
    const parseDate = s => s ? new Date(s) : null;
    const fmtDateTime = s => {
      const x = parseDate(s);
      return x ? x.toLocaleString('en-PH', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit'
      }) : 'Not scheduled'
    };
    const cleanType = t => ({
      'One Time': 'one_time',
      Daily: 'daily',
      Weekly: 'weekly',
      Monthly: 'monthly',
      Interval: 'interval',
      one_time: 'one_time',
      daily: 'daily',
      weekly: 'weekly',
      monthly: 'monthly',
      interval: 'interval'
    })[t] || 'one_time';

    function normalize(r) {
      r.reminder_type = cleanType(r.reminder_type || r.type);
      /* [REBUILD FIX] Seed/legacy reminders carry no `id`, but Snooze / Dismiss /
         Edit / Delete all look records up BY id — so the due-alert buttons silently
         no-op'd (find(x.id === 'undefined') → nothing found → early return).
         Assign a stable id derived from title + type; deterministic so it is
         identical on every boot even before the next save. */
      if (!r.id) {
        let slug = String(r.title || 'task').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 32);
        r.id = 'rem-' + (slug || 'task') + '-' + r.reminder_type;
      }
      r.description = r.description || '';
      r.is_active = r.is_active !== false && r.active !== false;
      if (!r.created_date) r.created_date = new Date().toISOString();
      if (!r.time) r.time = '08:00';
      if (!r.weekly_days) r.weekly_days = [];
      /* [REBUILD FIX] Legacy seed reminders only carry a human-readable `schedule`
         string ("Every 12 hours", "Every Monday", "2026-07-23"). Import it into the
         structured fields the engine uses, otherwise scheduleText() renders
         "Every undefined undefined" / "Weekly · · 08:00". Runs once per record. */
      if (!r._seedImported) {
        let s = String(r.schedule || '');
        if (r.reminder_type === 'interval' && (!r.interval_value || !r.interval_unit)) {
          let m = /every\s+(\d+)\s*(minute|hour|day)s?/i.exec(s);
          if (m) { r.interval_value = +m[1]; r.interval_unit = m[2].toLowerCase() + 's'; }
        }
        if (r.reminder_type === 'weekly' && !(r.weekly_days || []).length) {
          let days = WEEKDAYS.filter(d => new RegExp(d, 'i').test(s));
          if (days.length) r.weekly_days = days;
        }
        if (r.reminder_type === 'one_time' && !r.date && /\d{4}-\d{2}-\d{2}/.test(s)) r.date = s;
        r._seedImported = true;
      }
      return r;
    }

    function withTime(base, time) {
      let d = new Date(base);
      let [h, m] = (time || '08:00').split(':').map(Number);
      d.setHours(h || 0, m || 0, 0, 0);
      return d
    }

    function nextOccurrence(r, from = new Date()) {
      r = normalize(r);
      if (r.snoozed_until && parseDate(r.snoozed_until) > from) return r.snoozed_until;
      const type = r.reminder_type,
        now = new Date(from);
      if (type === 'one_time') {
        let x = withTime(r.date || now.toISOString().slice(0, 10), r.time);
        return x > now ? toIso(x) : null
      }
      if (type === 'daily') {
        let x = withTime(now, r.time);
        if (x <= now) x.setDate(x.getDate() + 1);
        return toIso(x)
      }
      if (type === 'weekly') {
        let days = r.weekly_days || [];
        for (let i = 0; i < 8; i++) {
          let x = withTime(new Date(now.getFullYear(), now.getMonth(), now.getDate() + i), r.time);
          if (days.includes(WEEKDAYS[x.getDay()]) && x > now) return toIso(x)
        }
        return null
      }
      if (type === 'monthly') {
        let day = Math.max(1, Math.min(31, +r.day_of_month || 1));
        let x = new Date(now.getFullYear(), now.getMonth(), Math.min(day, new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate()));
        x = withTime(x, r.time);
        if (x <= now) {
          x = new Date(now.getFullYear(), now.getMonth() + 1, Math.min(day, new Date(now.getFullYear(), now.getMonth() + 2, 0).getDate()));
          x = withTime(x, r.time)
        }
        return toIso(x)
      }
      let amount = Math.max(1, +r.interval_value || 1),
        ms = amount * ({
          minutes: 60000,
          hours: 3600000,
          days: 86400000
        } [r.interval_unit || 'hours']);
      let anchor = parseDate(r.last_trigger) || parseDate(r.created_date) || now;
      let x = new Date(+anchor + ms);
      /* [FIX M5] missed occurrences used to restart from "now + interval", so
         lateness accumulated every cycle. Anchor to the schedule instead: if the
         occurrence is already past, jump to the next whole multiple. */
      if (x <= now) {
        const behind = Math.max(1, Math.floor((+now - +anchor) / ms));
        x = new Date(+anchor + (behind + 1) * ms);
      }
      return toIso(x);
    }

    function reminderItems() {
      let f = F();
      return (f.reminders || []).map(normalize)
    }

    function ensureSchedule(r) {
      /* [REBUILD FIX] Boot-crash fix. Legacy seed reminders ({title, type, schedule, active})
         carry no `is_active` / `reminder_type`, so the old guard `if (r.is_active && ...)`
         skipped normalize() and the next line evaluated `undefined[0]`, throwing
         "Cannot read properties of undefined (reading '0')" on every fresh page load.
         Normalize first so reminder_type is always a string before it is indexed. */
      normalize(r);
      if (r.is_active && !r.next_trigger) r.next_trigger = nextOccurrence(r);
      r.type = r.reminder_type === 'one_time' ? 'One Time' : r.reminder_type[0].toUpperCase() + r.reminder_type.slice(1);
      r.schedule = scheduleText(r);
      return r
    }

    function classes(next) {
      let now = new Date(),
        x = parseDate(next);
      if (!x) return 'dark';
      let diff = x - now;
      if (diff < 0) return 'danger';
      if (diff < 86400000) return diff < 3600000 ? 'warn' : 'warn';
      return ''
    }

    function statusOf(r) {
      let x = parseDate(r.next_trigger),
        n = new Date();
      if (!r.is_active) return 'Completed';
      if (!x) return 'Unscheduled';
      if (x < n) return 'Overdue';
      if (x - n < 86400000) return 'Due today';
      return 'Upcoming'
    }

    function reminderPage() {
      let f = F();
      f.reminders = (f.reminders || []).map(ensureSchedule);
      let rows = reminderItems();
      document.getElementById('reminders').innerHTML = `<div class="reminder-toolbar"><div><div class="eyebrow">INTELLIGENT FARM SCHEDULER</div><p class="muted">Recurring farm tasks remain scoped to this farm only.</p></div><button class="btn ghost" onclick="enableReminderNotifications()">◉ Enable notifications</button><button class="btn ghost" onclick="enableReminderSound()">🔊 Enable sound</button></div><div class="toolbar"><input class="search" placeholder="Search reminders" oninput="filterReminderRows(this.value)"><button class="btn" onclick="openReminderModal()">+ Add reminder</button></div><div class="reminder-summary">${['Overdue','Due today','Upcoming'].map(label=>{let n=rows.filter(r=>statusOf(r)===label).length;return `<div class="panel reminder-summary-card ${label==='Overdue'?'red':label==='Due today'?'orange':'teal'}"><small>${label}</small><b>${n}</b><span>active reminders</span></div>`}).join('')}</div><div class="panel table-wrap"><table class="table" id="reminderTable"><thead><tr><th>Reminder</th><th>Schedule</th><th>Next trigger</th><th>Status</th><th></th></tr></thead><tbody>${rows.map((r,i)=>`<tr class="${statusOf(r)==='Overdue'?'overdue-row':''}" data-reminder-search="${(r.title+' '+r.description+' '+r.reminder_type).toLowerCase()}"><td><b>${r.title}</b><br><small class="muted">${r.description||'No description'}</small></td><td data-label="Schedule"><span class="tag">${r.reminder_type.replace('_',' ')}</span><br><small class="muted">${scheduleText(r)}</small></td><td data-label="Next trigger">${fmtDateTime(r.next_trigger)}</td><td data-label="Status"><span class="tag ${classes(r.next_trigger)}">${statusOf(r)}</span></td><td class="right rem-actions"><button class="btn ghost" onclick="openReminderModal(${i})">Edit</button><button class="btn ghost danger-btn rem-del" onclick="deleteReminder('${r.id}')" title="Delete this reminder">Delete</button></td></tr>`).join('')||'<tr><td colspan="5" class="empty">No reminders in this farm yet.</td></tr>'}</tbody></table></div>`;
      injectDashboardReminders()
    }

    function scheduleText(r) {
      /* [REBUILD] Show proper weekday labels (Mon, Tue…) instead of lowercase slices. */
      if (r.reminder_type === 'weekly') return (r.weekly_days || []).map(x => DAY_LABELS[WEEKDAYS.indexOf(x)] ?? x.slice(0, 3)).join(', ') + ' · ' + r.time;
      if (r.reminder_type === 'monthly') return 'Day ' + r.day_of_month + ' · ' + r.time;
      if (r.reminder_type === 'interval') return 'Every ' + r.interval_value + ' ' + r.interval_unit;
      return r.reminder_type === 'one_time' ? `${r.date||''} · ${r.time||''}` : r.time
    }

    function filterReminderRows(v) {
      let q = v.toLowerCase();
      document.querySelectorAll('#reminderTable tbody tr').forEach(row => row.style.display = (row.dataset.reminderSearch || '').includes(q) ? '' : 'none')
    }

    function openReminderModal(index = null) {
      let r = index === null ? {
        reminder_type: 'one_time',
        time: '08:00',
        is_active: true
      } : normalize(F().reminders[index]);
      let html = `<div class="reminder-modal-bg" id="reminderModal"><form class="reminder-modal"><div class="modal-top"><div><div class="eyebrow">FARM-SCOPED REMINDER</div><h2>${index===null?'New reminder':'Edit reminder'}</h2></div><button type="button" class="close-reminder" onclick="closeReminderModal()">×</button></div><div class="reminder-fields"><div class="field full"><label>Reminder title *</label><input name="title" required value="${r.title||''}" placeholder="e.g. Farm disinfection"></div><div class="field full"><label>Description</label><textarea name="description" placeholder="Optional task details">${r.description||''}</textarea></div><div class="field full"><label>Reminder type *</label><select name="reminder_type" onchange="toggleReminderFields(this.value)">${['one_time','daily','weekly','monthly','interval'].map(x=>`<option value="${x}" ${r.reminder_type===x?'selected':''}>${x==='one_time'?'One Time':x[0].toUpperCase()+x.slice(1)}</option>`).join('')}</select></div><div class="reminder-conditional" data-type="one_time"><div class="field"><label>Date *</label><input name="date" type="date" value="${r.date||(window.localToday ? window.localToday() : new Date().toISOString().slice(0,10))}"></div><div class="field"><label>Time *</label><input name="time" type="time" value="${r.time||'08:00'}"></div></div><div class="reminder-conditional" data-type="daily"><div class="field full"><label>Time *</label><input name="time_daily" type="time" value="${r.time||'08:00'}"></div></div><div class="reminder-conditional" data-type="weekly"><div class="field full"><label>Select one or more weekdays *</label><div class="weekday-chips">${WEEKDAYS.map((day,i)=>`<button type="button" class="weekday-chip ${(r.weekly_days||[]).includes(day)?'selected':''}" data-day="${day}" onclick="toggleWeekday(this)">${DAY_LABELS[i]}</button>`).join('')}</div><div class="field"><label>Time *</label><input name="time_weekly" type="time" value="${r.time||'08:00'}"></div></div></div><div class="reminder-conditional" data-type="monthly"><div class="field"><label>Day of month *</label><select name="day_of_month">${Array.from({length:31},(_,i)=>`<option value=\"${i+1}\" ${+r.day_of_month===i+1?'selected':''}>${i+1}</option>`).join('')}</select></div><div class=\"field\"><label>Time *</label><input name=\"time_monthly\" type=\"time\" value=\"${r.time||'08:00'}\"></div></div><div class=\"reminder-conditional\" data-type=\"interval\"><div class=\"field\"><label>Interval value *</label><input name=\"interval_value\" type=\"number\" min=\"1\" step=\"1\" value=\"${r.interval_value||1}\"></div><div class=\"field\"><label>Interval unit *</label><select name=\"interval_unit\"><option value=\"minutes\" ${r.interval_unit==='minutes'?'selected':''}>Minutes</option><option value=\"hours\" ${(!r.interval_unit||r.interval_unit==='hours')?'selected':''}>Hours</option><option value=\"days\" ${r.interval_unit==='days'?'selected':''}>Days</option></select></div></div><div class=\"form-error\" id=\"reminderFormError\"></div></div><div class=\"actions\"><button type=\"button\" class=\"btn ghost\" onclick=\"closeReminderModal()\">Cancel</button><button class=\"btn\">Save reminder</button></div></form></div>`;document.body.insertAdjacentHTML('beforeend',html);let form=document.querySelector('#reminderModal form');form.onsubmit=e=>saveReminder(e,index);toggleReminderFields(r.reminder_type)}
  function closeReminderModal(){document.getElementById('reminderModal')?.remove()}
  function toggleReminderFields(type){document.querySelectorAll('.reminder-conditional').forEach(x=>x.style.display=x.dataset.type===type?'grid':'none')}
  function toggleWeekday(button){button.classList.toggle('selected')}
  function saveReminder(e,index){e.preventDefault();let form=e.currentTarget,data=Object.fromEntries(new FormData(form)),type=data.reminder_type,err=document.getElementById('reminderFormError');let prior=index===null?{}:F().reminders[index];data.id=prior.id||'rem-'+Date.now();data.reminder_type=type;data.type=type;data.is_active=true;data.active=true;data.created_date=prior.created_date||new Date().toISOString();data.updated_date=new Date().toISOString();data.last_trigger=prior.last_trigger||null;data.snoozed_until=null;if(type==='daily')data.time=data.time_daily;if(type==='weekly'){data.time=data.time_weekly;data.weekly_days=[...form.querySelectorAll('.weekday-chip.selected')].map(x=>x.dataset.day);if(!data.weekly_days.length){err.textContent='Please select at least one weekday.';err.classList.add('show');return}}if(type==='monthly')data.time=data.time_monthly;if(type==='interval'){data.interval_value=+data.interval_value;if(data.interval_value<1){err.textContent='Interval value must be at least 1.';err.classList.add('show');return}}data.next_trigger=nextOccurrence(data);if(type==='one_time'&&!data.next_trigger){err.textContent='Choose a future date and time for this one-time reminder.';err.classList.add('show');return}if(index===null)F().reminders.push(data);else F().reminders[index]=data;save();closeReminderModal();reminderPage();toast('Reminder saved')}
  function isOverdue(r,now=new Date()){return normalize(r).is_active&&!!r.next_trigger&&parseDate(r.next_trigger)<now&&!r.completed_at}
  function soundSettings(){let f=F();f.reminderSettings=f.reminderSettings||{sound_enabled:false,sound_repeat_minutes:DEFAULT_SOUND_REPEAT_MINUTES};return f.reminderSettings}
  function isCriticalFarmAlert(r){return isOverdue(r)||/vaccin|treat|medicine|insemin|breed|farrow|inventory|feed shortage/i.test(`${r.title} ${r.description||''}`)}
  async function enableReminderSound(){try{audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();await audioCtx.resume();soundSettings().sound_enabled=true;save();playAlertTone('critical');toast('Maximum permitted reminder sound enabled')}catch(e){toast('Browser blocked sound. Tap again after interacting with the page.')}}
  function stopAlertSounds(){if(activeAlarmTimer)clearInterval(activeAlarmTimer);if(activeAlarmVibration)clearInterval(activeAlarmVibration);activeAlarmTimer=activeAlarmVibration=null;activeAlarmId=null;activeOscillators.forEach(x=>{try{x.stop()}catch(e){}});activeOscillators=[];navigator.vibrate?.(0);if(audioCtx?.state==='running')audioCtx.suspend().catch(()=>{})}
  function playAlertTone(level='critical'){let setting=soundSettings();if(!setting.sound_enabled)return;try{audioCtx=audioCtx||new (window.AudioContext||window.webkitAudioContext)();if(audioCtx.state==='suspended')audioCtx.resume();let now=audioCtx.currentTime, pattern=level==='critical'?[0,.22,.44]:level==='due'?[0,.35]:[0];pattern.forEach((offset,i)=>{let o=audioCtx.createOscillator(),g=audioCtx.createGain();o.type=level==='critical'?'square':'sawtooth';o.frequency.value=level==='critical'?(i%2?940:610):(i?720:520);g.gain.setValueAtTime(.0001,now+offset);g.gain.exponentialRampToValueAtTime(1,now+offset+.015);g.gain.exponentialRampToValueAtTime(.0001,now+offset+.18);o.connect(g).connect(audioCtx.destination);o.start(now+offset);o.stop(now+offset+.2);activeOscillators.push(o);o.onended=()=>activeOscillators=activeOscillators.filter(x=>x!==o)})}catch(e){/* browser autoplay policy; visual alert remains */}}
  function startPersistentAlarm(r){if(activeAlarmId===r.id)return;stopAlertSounds();activeAlarmId=r.id;let critical=isCriticalFarmAlert(r),level=critical?'critical':'due';playAlertTone(level);if(critical)navigator.vibrate?.([500,150,500,150,700]);activeAlarmTimer=setInterval(()=>playAlertTone(level),critical?4000:12000);if(critical)activeAlarmVibration=setInterval(()=>navigator.vibrate?.([500,150,500,150,700]),4000)}
  function processOverdueAlerts(){let now=new Date();reminderItems().filter(r=>isOverdue(r,now)).forEach(r=>{startPersistentAlarm(r);r.last_alert_sound_at=toIso(now)});if(!dueReminders().length)stopAlertSounds()}
   function dueReminders(){return reminderItems().filter(r=>r.is_active&&r.next_trigger&&parseDate(r.next_trigger)<=new Date())}
  function closeDueReminderAlert() {
    stopAlertSounds();
    document.getElementById('dueReminderModal')?.remove();
    dueModalOpen = false
  }

  function checkDueReminders() {
    /* [REBUILD FIX] Alerts must never fire over the login screen. The scheduler used
       to pop the due modal (and alarm/vibration) even before sign-in — and in that
       state the alert was effectively dead UI. Only alert with an active farm
       session; tear down any strays otherwise. */
    if (!document.body.classList.contains('farm-access-granted')) {
      closeDueReminderAlert();
      return
    }
    processOverdueAlerts();
    let due = dueReminders();
    if (due.length && !dueModalOpen) showDueReminder(due[0])
  }
  /* [REBUILD FIX] The due-reminder modal markup was mangled by the decompiler
       (spaces inside `${}` and HTML tags), so it printed as raw text on the page.
       Rebuilt from the original production bundle. */
      
    function sendSystemNotification(title, options) {
      try {
        if (!("Notification" in window) || Notification.permission !== "granted") return;
        if ("serviceWorker" in navigator && navigator.serviceWorker.ready) {
          navigator.serviceWorker.ready.then(reg => {
            if (reg && typeof reg.showNotification === "function") {
              reg.showNotification(title, {
                icon: "icons/icon-192.png",
                badge: "icons/icon-192.png",
                ...options
              });
            }
          }).catch(() => {});
          return;
        }
        try {
          new Notification(title, { icon: "icons/icon-192.png", ...options });
        } catch (e) {
          /* Android Chrome / mobile constructor restriction safely ignored */
        }
      } catch (e) {
        console.debug("[Notification safe caught]:", e);
      }
    }

    function printReminderReference(id) {
      const raw = (F().reminders || []).find(x => x.id === id);
      if (!raw) return;
      const r = normalize(raw);
      const farm = F();
      const popup = window.open('', '_blank');
      if (!popup) { toast('Please allow pop-ups to print the veterinary reference sheet.'); return; }
      const safe = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
      popup.document.write(`<!doctype html><html><head><title>Farm Program Reference</title><style>body{font-family:Arial,sans-serif;color:#172327;margin:28px}header{display:flex;justify-content:space-between;border-bottom:2px solid #0a8d84;padding-bottom:12px;margin-bottom:18px}h1{font-size:24px;margin:4px 0}h2{font-size:18px;margin:0 0 10px}.eyebrow{color:#0a8d84;font-size:11px;font-weight:800;letter-spacing:.12em;text-transform:uppercase}.meta{display:grid;grid-template-columns:1fr 1fr;gap:10px;margin:15px 0}.box{border:1px solid #cdd9d9;border-radius:8px;padding:12px}.label{font-size:10px;color:#687779;text-transform:uppercase}.value{font-weight:700;margin-top:4px}.check{border-bottom:1px solid #dce5e5;padding:12px 0}.sign{display:grid;grid-template-columns:1fr 1fr;gap:45px;margin-top:50px}.line{border-top:1px solid #172327;padding-top:6px;font-size:11px}@media print{body{margin:16mm}}</style></head><body><header><div><div class="eyebrow">ARSwineTech Pro · Veterinary/Farm Program</div><h1>${safe(farm.name || 'Farm')}</h1><div>Program reference sheet</div></div><div style="text-align:right"><b>${safe(r.title || 'Scheduled program')}</b><br><small>Printed ${new Date().toLocaleString('en-PH')}</small></div></header><div class="meta"><div class="box"><div class="label">Task</div><div class="value">${safe(r.title || 'Scheduled program')}</div></div><div class="box"><div class="label">Next trigger</div><div class="value">${safe(fmtDateTime(r.next_trigger))}</div></div><div class="box"><div class="label">Target</div><div class="value">${safe(r.description || 'See program details')}</div></div><div class="box"><div class="label">Status</div><div class="value">${safe(statusOf(r))}</div></div></div><div class="box"><div class="label">Instructions / notes</div><p>${safe(r.description || 'Administer according to the approved farm/veterinary protocol and product label.')}</p></div><div class="check">☐ Completed by: ________________________________ &nbsp; Date/time: __________________</div><div class="check">☐ Stock / dose recorded in Medicine Inventory</div><div class="check">☐ Follow-up or observation note recorded</div><div class="sign"><div class="line">Veterinary staff / handler</div><div class="line">Farm owner / representative</div></div></body></html>`);
      popup.document.close();
      popup.focus();
      setTimeout(() => popup.print(), 350);
    }

    function showDueReminder(r) {
      dueModalOpen = true;
      let critical = isCriticalFarmAlert(r);
      if (isOverdue(r)) {
        sendSystemNotification("ARSwineTech Pro · Reminder Overdue", {
          body: (r.title || "") + (r.description ? " — " + r.description : "")
        });
      }
      document.body.insertAdjacentHTML(
        "beforeend",
        `<div class="due-modal-bg ${critical ? "critical-due" : ""}" id="dueReminderModal"><div class="due-modal"><div class="eyebrow">${critical ? "CRITICAL FARM ALERT" : "REMINDER DUE"}</div><h2>${r.title}</h2><p>${r.description || "This scheduled farm task is due now."}</p><div class="due-time">Next trigger: ${fmtDateTime(r.next_trigger)}</div><div class="due-actions"><button class="btn ghost" onclick="printReminderReference('${r.id}')">🖨 PRINT PDF</button><button class="btn ghost" onclick="snoozeReminder('${r.id}')">SNOOZE · 10 MIN</button><button class="btn" onclick="dismissReminder('${r.id}')">GOT IT · DISMISS</button></div></div></div>`
      );
    }


      function snoozeReminder(id) {
        stopAlertSounds();
        let r = F().reminders.find(x => x.id === id);
        if (!r) return;
        r.snoozed_until = toIso(new Date(Date.now() + 600000));
        r.next_trigger = r.snoozed_until;
        r.updated_date = toIso(new Date());
        save();
        closeDue();
        reminderPage();
        toast('Reminder snoozed for 10 minutes')
      }

      function dismissReminder(id) {
        stopAlertSounds();
        let r = F().reminders.find(x => x.id === id);
        if (!r) return;
        r.last_trigger = toIso(new Date());
        r.snoozed_until = null;
        if (normalize(r).reminder_type === 'one_time') {
          r.is_active = false;
          r.active = false;
          r.next_trigger = null
        } else r.next_trigger = nextOccurrence(r, new Date());
        r.updated_date = toIso(new Date());
        save();
        closeDue();
        reminderPage();
        window.refreshOpenDrilldown?.();
        toast('Reminder occurrence completed')
      }

      function closeDue() {
        document.getElementById('dueReminderModal')?.remove();
        dueModalOpen = false
      }
      async function enableReminderNotifications() {
        if (!('Notification' in window)) {
          toast('Browser notifications are not supported on this device.');
          return
        }
        let p = await Notification.requestPermission();
        toast(p === 'granted' ? 'Farm reminder alerts enabled' : 'Notification permission was not granted')
      }

      function openReminderActions(id) {
        let r = F().reminders.find(x => x.id === id);
        if (!r) return;
        document.body.insertAdjacentHTML('beforeend', `<div class="due-modal-bg" id="reminderActions"><div class="due-modal"><div class="eyebrow">REMINDER OPTIONS</div><h2>${r.title}</h2><p>${r.description||scheduleText(normalize(r))}</p><div class="due-actions"><button class="btn ghost" onclick="printReminderReference('${r.id}')">🖨 PRINT PDF</button><button class="btn ghost" onclick="dismissReminder('${r.id}');document.getElementById('reminderActions')?.remove()">GOT IT · DISMISS</button><button class="btn danger-btn" onclick="deleteReminder('${r.id}')">DELETE</button></div></div></div>`)
      }

      async function deleteReminder(id) {
        stopAlertSounds();
        let r = F().reminders.find(x => x.id === id);
        if (!r) return;
        if (!confirm(`Delete reminder “${r.title}”? This cannot be undone.`)) return;
        const farmIdForDelete = window.__arsActiveFarmId || window.farmId;
        const cloudLocalId = r._ars_cloud_local_id || r.id;
        try {
          // Delete cloud-first. A local-only delete would be restored by the
          // next background pull, which is why reminders previously reappeared.
          if (!farmIdForDelete || !window.ARSCloud?.deleteAppRecord) throw new Error('Verified cloud deletion is unavailable.');
          await ARSCloud.deleteAppRecord(farmIdForDelete, 'reminder', cloudLocalId);
        } catch (error) {
          toast(`⚠️ Reminder was not removed: cloud deletion failed — ${error.message || error}`);
          return;
        }
        F().reminders = F().reminders.filter(x => (x._ars_cloud_local_id || x.id) !== cloudLocalId);
        save();
        document.getElementById('reminderActions')?.remove();
        closeDue();
        reminderPage();
        window.refreshOpenDrilldown?.();
        toast('Reminder deleted from the cloud and this device');
      }

      function injectDashboardReminders() {
        let host = document.getElementById('dashboard');
        if (!host) return;
        document.getElementById('dashboardReminderWidget')?.remove();
        let active = reminderItems().filter(r => r.is_active).sort((a, b) => String(a.next_trigger).localeCompare(String(b.next_trigger))),
          rows = [...active.filter(r => statusOf(r) === 'Overdue').slice(0, 2), ...active.filter(r => statusOf(r) === 'Due today').slice(0, 2)];
        
        // Ensure full dashboard is rendered before prepending reminders widget
        if (!host.querySelector('.dash-hero') && window.dashboard) {
          window.dashboard();
        }

        let box = document.createElement('div');
        box.id = 'dashboardReminderWidget';
        box.className = 'section';
        box.innerHTML = `<div class="section-head"><div><h2>Reminder center</h2><p>Farm-only schedule · due, overdue and next 24 hours.</p></div><button class="btn ghost" onclick="go('reminders')">Manage reminders</button></div><div class="dashboard-reminders panel">${rows.map(r=>`<button class="dashboard-reminder ${statusOf(r)==='Overdue'?'overdue-blink':''}" onclick="openReminderActions('${r.id}')"><span class="tag ${classes(r.next_trigger)}">${statusOf(r)}</span><b>${r.title}</b><small>${r.reminder_type.replace('_',' ')} · ${fmtDateTime(r.next_trigger)}</small></button>`).join('')||'<div class="empty">No active reminders for this farm.</div>'}</div>`;
        host.prepend(box);
      }
      const originalCrud = window.crudPage;
      window.crudPage = function(k) {
        if (k === 'reminders') return reminderPage();
        return originalCrud(k)
      };
      const originalRender = window.renderAll;
      window.renderAll = function() {
        (F().reminders || []).forEach(ensureSchedule);
        (typeof originalRender === 'function' && originalRender());
        reminderPage();
        injectDashboardReminders();
        /* [REBUILD] Re-evaluate due alerts after every render — this is also how the
           alert appears immediately after sign-in instead of waiting for the 30s tick. */
        checkDueReminders()
      };
      window.enableReminderSound = enableReminderSound;
      window.stopAlertSounds = stopAlertSounds;
      window.stopAlertSounds = stopAlertSounds;
      window.closeDueReminderAlert = closeDueReminderAlert;
      window.openReminderModal = openReminderModal;
      window.closeReminderModal = closeReminderModal;
      window.toggleReminderFields = toggleReminderFields;
      window.toggleWeekday = toggleWeekday;
      window.saveReminder = saveReminder;
      window.snoozeReminder = snoozeReminder;
      window.dismissReminder = dismissReminder;
      window.enableReminderNotifications = enableReminderNotifications;
      window.filterReminderRows = filterReminderRows;
      window.openReminderActions = openReminderActions;
      window.printReminderReference = printReminderReference;
      window.deleteReminder = deleteReminder;
      setTimeout(() => {
        window.renderAll();
        scheduler = setInterval(checkDueReminders, 30000);
        document.addEventListener('visibilitychange', () => {
          if (!document.hidden) checkDueReminders()
        });
        checkDueReminders()
      }, 50);
    })();