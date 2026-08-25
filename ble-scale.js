/* ═══════════════════════════════════════════════════════════════════════════
   ARSwineTech Pro — Bluetooth Livestock Weighing Scale Integration
   (js/ble-scale.js)

   Features:
   • Web Bluetooth API connection to standard livestock weighing scales:
     - Tru-Test (S3, EziWeigh 5/7i, XR5000, ID5000)
     - Gallagher (W-0, W-1, W-2, W-3 series)
     - Salter Brecknell, Ohaus Defender, Jadever, Yaohua livestock indicators
     - Standard GATT Weight Scale Service (0x181D / 0x2A98)
     - Nordic UART & Generic BLE Serial (0xFFE0 / 6E400001)
     - Custom ESP32 / Arduino / HX711 DIY scale indicators
   • Continuous live weight stream & automatic stability detection (STABLE lock)
   • 1-Click capture into Batch Birth, Weaning, and Release weight fields
   • Auto-Advance Roster Mode: Automatically logs piglet weights row-by-row
     as each piglet steps on the platform without touching the screen!
   • Built-in Hardware Simulator for testing on any device
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // State
  const scaleState = {
    device: null,
    server: null,
    characteristic: null,
    connected: false,
    deviceName: '',
    liveWeight: null,
    isStable: false,
    unit: 'kg',
    lastRaw: '',
    stabilityHistory: [],
    listeners: new Set(),
    autoSessionActive: false,
    autoCurrentIndex: 0
  };

  let bleBuffer = '';

  // Positive audio chime on stable weight lock
  function playWeightLockChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(587.33, ctx.currentTime); // D5
      osc.frequency.setValueAtTime(880.00, ctx.currentTime + 0.08); // A5
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.18);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.18);
    } catch (e) {}
  }

  // Notify registered UI components of live weight changes
  function notifyWeightChange() {
    scaleState.listeners.forEach(fn => {
      try { fn(scaleState); } catch (e) {}
    });

    // Update any live scale HUD widgets on active modals
    updateScaleWidgets();
  }

  /* ─────────────────────────────────────────────────────────────────────────
     1. WEB BLUETOOTH CONNECTION LOGIC
     ───────────────────────────────────────────────────────────────────────── */
  async function connectBluetoothScale() {
    if (!navigator.bluetooth) {
      alert('Web Bluetooth is not supported in this browser. Please use Chrome, Edge, or an Android browser with Bluetooth enabled.');
      return;
    }

    try {
      showToast('Searching for nearby Bluetooth Weighing Scales & Indicators…');

      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          '0000181d-0000-1000-8000-00805f9b34fb', // Standard Weight Scale Service (0x181D)
          '0000181b-0000-1000-8000-00805f9b34fb', // Body Composition (0x181B)
          '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART (Tru-Test, Gallagher, DIY, ESP32)
          '0000ffe0-0000-1000-8000-00805f9b34fb', // CC2541 / HM-10 Serial (TCS, Yaohua, Chinese BLE scales)
          '0000ffe5-0000-1000-8000-00805f9b34fb', // Alternate BLE Serial
          '0000ff00-0000-1000-8000-00805f9b34fb', // Custom Chinese electronic scale
          '0000fff0-0000-1000-8000-00805f9b34fb', // Generic platform scale
          '0000fee7-0000-1000-8000-00805f9b34fb', // Tencent / Microchip
          '49535343-fe7d-4ae5-8fa9-9fafd205e455', // ISSC Transparent UART
          '0000180a-0000-1000-8000-00805f9b34fb', // Device Information
          '00001800-0000-1000-8000-00805f9b34fb'  // Generic Access
        ]
      });

      device.addEventListener('gattserverdisconnected', onScaleDisconnected);
      const server = await device.gatt.connect();

      scaleState.device = device;
      scaleState.server = server;
      scaleState.deviceName = device.name || 'Livestock Scale';
      scaleState.connected = true;

      // Discover notification characteristics
      let charFound = false;
      const services = await server.getPrimaryServices().catch(() => []);

      for (const service of services) {
        try {
          const chars = await service.getCharacteristics();
          for (const char of chars) {
            if (char.properties.notify || char.properties.indicate) {
              await char.startNotifications();
              char.addEventListener('characteristicvaluechanged', onScaleDataReceived);
              scaleState.characteristic = char;
              charFound = true;
              break;
            }
          }
        } catch (e) {
          console.debug('Service inspect note:', e);
        }
        if (charFound) break;
      }

      showToast(`✓ Connected to Scale: ${scaleState.deviceName}`);
      notifyWeightChange();
    } catch (err) {
      console.warn('Bluetooth Scale connection error:', err);
      if (err.name !== 'NotFoundError') {
        showToast('Scale connection cancelled or timed out.');
      }
    }
  }

  function disconnectBluetoothScale() {
    if (scaleState.device && scaleState.device.gatt.connected) {
      scaleState.device.gatt.disconnect();
    }
    onScaleDisconnected();
  }

  function onScaleDisconnected() {
    scaleState.connected = false;
    scaleState.device = null;
    scaleState.server = null;
    scaleState.characteristic = null;
    scaleState.liveWeight = null;
    scaleState.isStable = false;
    showToast('Weighing Scale disconnected.');
    notifyWeightChange();
  }

  /* ─────────────────────────────────────────────────────────────────────────
     2. STREAM PARSER (ASCII & BINARY GATT GATT FORMATS)
     ───────────────────────────────────────────────────────────────────────── */
  function onScaleDataReceived(event) {
    const value = event.target.value;

    // Check if Standard GATT Weight Scale Measurement format (0x2A98)
    if (value.byteLength >= 2 && event.target.uuid.includes('2a98')) {
      const flags = value.getUint8(0);
      const isLbs = (flags & 0x01) !== 0;
      let rawWeight = value.getUint16(1, true); // Little endian
      let weightKg = isLbs ? (rawWeight * 0.453592) : (rawWeight * 0.005); // 0.005kg resolution
      updateWeight(parseFloat(weightKg.toFixed(2)), true);
      return;
    }

    // ASCII Stream parsing (Tru-Test, Gallagher, Yaohua, Ohaus, Arduino)
    const decoder = new TextDecoder('utf-8');
    const text = decoder.decode(value);
    bleBuffer += text;

    if (bleBuffer.includes('\n') || bleBuffer.includes('\r') || bleBuffer.length > 30) {
      parseAsciiWeight(bleBuffer);
      bleBuffer = '';
    }
  }

  function parseAsciiWeight(str) {
    scaleState.lastRaw = str;

    // Match numbers with optional decimal point (e.g., "ST,GS,  8.40kg", "WN: 8.42 kg", "12.5")
    const match = str.match(/([+-]?\s*\d+(?:\.\d+)?)/);
    if (!match) return;

    let numVal = parseFloat(match[1].replace(/\s+/g, ''));
    if (isNaN(numVal)) return;

    // Detect if stream indicates lbs
    if (/lb|lbs/i.test(str)) {
      numVal = parseFloat((numVal * 0.453592).toFixed(2));
    } else {
      numVal = parseFloat(numVal.toFixed(2));
    }

    // Detect if stream contains stability indicator (e.g., "ST", "STABLE", "OK")
    const stableFlag = /ST|STABLE|OK|S\b/i.test(str);
    updateWeight(numVal, stableFlag);
  }

  function updateWeight(val, explicitStable) {
    if (val < 0) val = 0;
    scaleState.liveWeight = val;

    // Sliding window for stability detection if scale doesn't send explicit flag
    scaleState.stabilityHistory.push({ val, time: Date.now() });
    if (scaleState.stabilityHistory.length > 6) scaleState.stabilityHistory.shift();

    let autoStable = false;
    if (scaleState.stabilityHistory.length >= 4) {
      const recent = scaleState.stabilityHistory.map(h => h.val);
      const min = Math.min(...recent);
      const max = Math.max(...recent);
      if (max - min <= 0.04 && val > 0.3) {
        autoStable = true;
      }
    }

    const wasStable = scaleState.isStable;
    scaleState.isStable = Boolean(explicitStable || autoStable);

    // If weight just stabilized, trigger audio chime & auto-advance
    if (!wasStable && scaleState.isStable && val > 0.4) {
      playWeightLockChime();
      if ('vibrate' in navigator) navigator.vibrate([60, 40, 60]);

      // If Auto-Advance Weighing Session is active, auto-fill the current piglet!
      if (scaleState.autoSessionActive) {
        autoFillCurrentRosterRow(val);
      }
    }

    notifyWeightChange();
  }

  /* ─────────────────────────────────────────────────────────────────────────
     3. LIVE WIDGETS & UI INTEGRATION IN WEIGH-IN MODALS
     ───────────────────────────────────────────────────────────────────────── */
  function updateScaleWidgets() {
    const bar = document.getElementById('bleScaleWidget');
    if (!bar) return;

    if (scaleState.connected) {
      const wText = scaleState.liveWeight !== null ? `${scaleState.liveWeight.toFixed(2)} kg` : '0.00 kg';
      const stClass = scaleState.isStable ? 'stable' : 'moving';
      const stText = scaleState.isStable ? '● STABLE LOCK' : '◌ SENSING WEIGHT…';

      bar.innerHTML = `
        <div class="scale-live-hud ${stClass}">
          <div class="hud-left">
            <div class="scale-device-chip">📶 ${esc(scaleState.deviceName)}</div>
            <div class="scale-reading-wrap">
              <span class="scale-number">${wText}</span>
              <span class="scale-lock-badge ${stClass}">${stText}</span>
            </div>
          </div>
          <div class="hud-right">
            <button type="button" class="btn ghost small" onclick="window.disconnectBluetoothScale()">Disconnect</button>
            <button type="button" class="btn small scale-auto-btn ${scaleState.autoSessionActive ? 'active' : ''}" onclick="window.toggleAutoWeighSession()">
              ${scaleState.autoSessionActive ? '⏹ Stop Auto-Weigh' : '🚀 Auto-Weigh Litter'}
            </button>
          </div>
        </div>
      `;
    } else {
      bar.innerHTML = `
        <div class="scale-connect-banner">
          <div class="banner-text">
            <span class="scale-ico">⚖️</span>
            <div>
              <b>Bluetooth Weighing Scale Integration</b>
              <small>Connect Tru-Test, Gallagher, Salter, or BLE scale to capture piglet weights directly</small>
            </div>
          </div>
          <div class="banner-btns">
            <button type="button" class="btn small scale-pair-btn" onclick="window.connectBluetoothScale()">
              📶 Connect Scale
            </button>
            <button type="button" class="btn ghost small" onclick="window.simulateScaleWeight()">
              🎲 Simulate +8.40kg
            </button>
          </div>
        </div>
      `;
    }
  }

  // 1-Click capture live scale weight into targeted form input
  function captureWeightIntoField(fieldName) {
    if (scaleState.liveWeight === null) {
      showToast('No scale reading available. Connect scale or enter manually.');
      return;
    }
    const input = document.querySelector(`input[name="${fieldName}"]`);
    if (input) {
      input.value = scaleState.liveWeight.toFixed(2);
      // Flash input green
      input.classList.add('captured-flash');
      setTimeout(() => input.classList.remove('captured-flash'), 600);
      showToast(`✓ Captured ${scaleState.liveWeight.toFixed(2)} kg into ${fieldName.replace('_', ' ')}`);
    }
  }

  // Auto-advance individual piglet weigh-in
  
  // Auto-advance individual piglet weigh-in (Handles Ear Notch Roster & Market Selling)
  function autoFillCurrentRosterRow(weightVal) {
    // 1. Check if Batch Performance modal Ear Notch table is open
    const notchTbody = document.getElementById("notchRows");
    if (notchTbody) {
      const rows = notchTbody.querySelectorAll("tr.notch-row");
      if (rows.length && scaleState.autoCurrentIndex < rows.length) {
        const currentRow = rows[scaleState.autoCurrentIndex];
        const weightInput = currentRow.querySelector('input[name="notch_weight"]');

        if (weightInput) {
          weightInput.value = weightVal.toFixed(2);
          currentRow.classList.add("auto-weighed-success");
          setTimeout(() => currentRow.classList.remove("auto-weighed-success"), 1200);

          const pigNo = currentRow.querySelector("td:first-child")?.textContent || `#${scaleState.autoCurrentIndex + 1}`;
          showToast(`✓ Logged ${weightVal.toFixed(2)} kg for Piglet ${pigNo}`);

          scaleState.autoCurrentIndex++;
          rows.forEach((r, idx) => r.classList.toggle("auto-weigh-target", idx === scaleState.autoCurrentIndex));

          if (scaleState.autoCurrentIndex >= rows.length) {
            scaleState.autoSessionActive = false;
            showToast("🎉 Whole litter weigh-in complete! Click Save Record.");
            updateScaleWidgets();
          }
        }
        return;
      }
    }

    // 2. Check if Market Selling tab (#fcWeights) is open
    const marketWrap = document.getElementById("fcWeights");
    if (marketWrap) {
      const rows = marketWrap.querySelectorAll(".fc-wrow");
      if (rows.length && scaleState.autoCurrentIndex < rows.length) {
        const currentRow = rows[scaleState.autoCurrentIndex];
        const weightInput = currentRow.querySelector("input[data-w-i]");

        if (weightInput) {
          weightInput.value = weightVal.toFixed(1);
          if (window.marketRecalc) window.marketRecalc();

          currentRow.classList.add("auto-weighed-success");
          setTimeout(() => currentRow.classList.remove("auto-weighed-success"), 1200);

          showToast(`✓ Logged ${weightVal.toFixed(1)} kg for Pig #${scaleState.autoCurrentIndex + 1}`);

          scaleState.autoCurrentIndex++;
          rows.forEach((r, idx) => r.classList.toggle("auto-weigh-target", idx === scaleState.autoCurrentIndex));

          if (scaleState.autoCurrentIndex >= rows.length) {
            scaleState.autoSessionActive = false;
            showToast("🎉 All market pigs weighed! Review total price & quote.");
            updateScaleWidgets();
          }
        }
      }
    }
  }

  function toggleAutoWeighSession() {
    scaleState.autoSessionActive = !scaleState.autoSessionActive;
    scaleState.autoCurrentIndex = 0;

    // Highlight row 0 in Ear Notch table if open
    const notchTbody = document.getElementById("notchRows");
    if (notchTbody) {
      const rows = notchTbody.querySelectorAll("tr.notch-row");
      rows.forEach((r, idx) => r.classList.toggle("auto-weigh-target", scaleState.autoSessionActive && idx === 0));
    }

    // Highlight row 0 in Market Selling if open
    const marketWrap = document.getElementById("fcWeights");
    if (marketWrap) {
      const rows = marketWrap.querySelectorAll(".fc-wrow");
      rows.forEach((r, idx) => r.classList.toggle("auto-weigh-target", scaleState.autoSessionActive && idx === 0));
    }

    if (scaleState.autoSessionActive) {
      showToast("🚀 Auto-Weigh Active: Place Pig #1 on the scale. Weight will log and advance automatically!");
    } else {
      showToast("Auto-Weigh session paused.");
    }
    updateScaleWidgets();
  }

  function updateScaleWidgets() {
    // 1. Update Top Scale Widget if present
    const bar = document.getElementById("bleScaleWidget");
    if (bar) {
      if (scaleState.connected) {
        const wText = scaleState.liveWeight !== null ? scaleState.liveWeight.toFixed(2) + " kg" : "0.00 kg";
        const stClass = scaleState.isStable ? "stable" : "moving";
        const stText = scaleState.isStable ? "● STABLE LOCK" : "◌ SENSING WEIGHT…";

        bar.innerHTML = `<div class="scale-live-hud ${stClass}"><div class="hud-left"><div class="scale-device-chip">📶 ${esc(scaleState.deviceName)}</div><div class="scale-reading-wrap"><span class="scale-number">${wText}</span><span class="scale-lock-badge ${stClass}">${stText}</span></div></div><div class="hud-right"><button type="button" class="btn ghost small" onclick="window.disconnectBluetoothScale()">Disconnect</button><button type="button" class="btn small scale-auto-btn ${scaleState.autoSessionActive ? "active" : ""}" onclick="window.toggleAutoWeighSession()">${scaleState.autoSessionActive ? "⏹ Stop Auto-Weigh" : "🚀 Auto-Weigh Pigs"}</button></div></div>`;
      } else {
        bar.innerHTML = `<div class="scale-connect-banner"><div class="banner-text"><span class="scale-ico">⚖️</span><div><b>Bluetooth Weighing Scale Integration</b><small>Connect Tru-Test, Gallagher, Salter, or BLE scale to capture weights directly</small></div></div><div class="banner-btns"><button type="button" class="btn small scale-pair-btn" onclick="window.connectBluetoothScale()">📶 Connect Scale</button><button type="button" class="btn ghost small" onclick="window.simulateScaleWeight()">🎲 Simulate +8.40kg</button></div></div>`;
      }
    }

    // 2. Update Ear Notch Registry Toolbar (#notchScaleBar)
    const notchBar = document.getElementById("notchScaleBar");
    if (notchBar) {
      renderScaleBar(notchBar, "Ear Notch Roster Scale");
    }

    // 3. Update Market Selling Toolbar (#marketScaleBar)
    const marketBar = document.getElementById("marketScaleBar");
    if (marketBar) {
      renderScaleBar(marketBar, "Market Scale");
    }
  }

  function renderScaleBar(el, label) {
    const isConn = scaleState.connected;
    const wVal = scaleState.liveWeight !== null ? scaleState.liveWeight.toFixed(2) + " kg" : "--.-- kg";
    const isStab = scaleState.isStable;

    el.className = `notch-scale-bar ${isConn ? (isStab ? "stable-lock" : "connected") : "disconnected"}`;
    el.innerHTML = `<div class="notch-scale-left"><span class="scale-dot ${isConn ? (isStab ? "dot-stable" : "dot-active") : "dot-off"}">●</span><div class="scale-meta"><b>${isConn ? esc(scaleState.deviceName) : label + ": Disconnected"}</b><small>${isConn ? (isStab ? "Weight Stable & Locked" : "Live Scale Reading…") : "Tap Connect Scale to pair Bluetooth weighing scale"}</small></div><span class="notch-live-pill ${isStab ? "stable" : ""}">${wVal}</span></div><div class="notch-scale-actions">${isConn ? `<button type="button" class="btn small scale-auto-act ${scaleState.autoSessionActive ? "auto-active" : ""}" onclick="window.toggleAutoWeighSession()">${scaleState.autoSessionActive ? "⏹ Stop Auto-Weigh" : "🚀 Auto-Weigh Pigs (Step-by-Step)"}</button><button type="button" class="btn ghost small" onclick="window.disconnectBluetoothScale()">Disconnect</button>` : `<button type="button" class="btn small scale-connect-btn" onclick="window.connectBluetoothScale()">📶 Connect Scale</button><button type="button" class="btn ghost small" onclick="window.simulateScaleWeight()" title="Test with simulated weight">🎲 Sim +8.40kg</button>`}</div>`;
  }


  function simulateScaleWeight() {
    const simWeights = [1.35, 1.42, 1.50, 7.80, 8.40, 8.95, 23.50, 24.80];
    const rand = simWeights[Math.floor(Math.random() * simWeights.length)];
    scaleState.connected = true;
    scaleState.deviceName = 'Demo Scale (Bluetooth BLE)';
    updateWeight(rand, true);
    showToast(`🎲 Simulated Scale reading: ${rand.toFixed(2)} kg`);
    updateScaleWidgets();
  }

  function showToast(msg) {
    if (window.toast && typeof window.toast === 'function') window.toast(msg);
    else console.log('[Scale Toast]:', msg);
  }

  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

  // Global Exports
  window.connectBluetoothScale = connectBluetoothScale;
  window.disconnectBluetoothScale = disconnectBluetoothScale;
  window.captureWeightIntoField = captureWeightIntoField;
  window.toggleAutoWeighSession = toggleAutoWeighSession;
  window.simulateScaleWeight = simulateScaleWeight;
  window.updateScaleWidgets = updateScaleWidgets;
  window.getScaleState = () => scaleState;

  console.info('%cARSwineTech Pro — Bluetooth Livestock Weighing Scale Module Loaded', 'color:#0d8d91;font-weight:bold');
})();
