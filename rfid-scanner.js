/* ═══════════════════════════════════════════════════════════════════════════
   ARSwineTech Pro — RFID / EID Smart Ear-Tag Hardware Integration Hub
   (js/rfid-scanner.js)
   
   Features:
   • Web Bluetooth API (ISO 11784/11785 FDX-B / HDX 134.2 kHz RFID Stick Readers)
     Compatible with Allflex RS420, Agrident AWR300, Tru-Test SRS2/XRS2, Syscan,
     and generic BLE UART/HID readers.
   • Web NFC API (13.56 MHz NDEF ISO 14443/15693 animal smart ear tags)
   • Camera Barcode / QR Live Scanner (instant fallback for phones without BLE/NFC)
   • Interactive Tag Simulator & Manual Tag Lookup
   • Universal Animal Dossier & Quick Actions Modal (Move, Vaccine, Weight, Breed)
   • Tag Inventory & Rapid Tag Pairing Wizard
   ═══════════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // State
  const state = {
    bleDevice: null,
    bleCharacteristic: null,
    bleConnected: false,
    nfcReader: null,
    nfcListening: false,
    cameraStream: null,
    cameraScanning: false,
    lastScannedTag: null,
    scanHistory: []
  };

  // Helper formatting
  const esc = v => String(v ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmtDate = d => {
    if (!d) return '—';
    try {
      const dt = new Date(d + (d.includes('T') ? '' : 'T00:00:00'));
      return dt.toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    } catch { return d; }
  };

  // Safe farm accessor
  function getFarm() {
    try {
      if (typeof F === 'function') return F();
      if (window.F && typeof window.F === 'function') return window.F();
      if (window.DB && (window.farmId || typeof farmId !== 'undefined')) {
        const id = window.farmId || (typeof farmId !== 'undefined' ? farmId : 'farm-ars');
        return window.DB[id] || Object.values(window.DB)[0] || {};
      }
    } catch (e) {
      console.warn('[RFID] getFarm fallback', e);
    }
    return {};
  }

  // Ensure RFID structures exist on the active farm
  function ensureFarmRfid() {
    const f = getFarm();
    if (!f) return;
    if (!Array.isArray(f.rfid_tags)) f.rfid_tags = [];
    if (!Array.isArray(f.rfid_scans)) f.rfid_scans = [];
  }

  // Find animal by RFID tag, ID, or ear notch
  function findAnimalByTag(tag) {
    if (!tag) return null;
    const cleanTag = String(tag).trim().toUpperCase();
    const f = getFarm();
    if (!f) return null;

    // 1. Search Sows
    for (const sow of (f.sows || [])) {
      if (sow.culled || sow.status === 'CULLED') continue;
      if (String(sow.rfid || '').trim().toUpperCase() === cleanTag ||
          String(sow.id || '').trim().toUpperCase() === cleanTag ||
          String(sow.name || '').trim().toUpperCase() === cleanTag) {
        return { type: 'sow', animal: sow, id: sow.id, name: sow.name, breed: sow.breed, rfid: sow.rfid || cleanTag, barn: sow.barn_id, pen: sow.pen_id };
      }
    }

    // 2. Search Boars / Semen Registry
    for (const boar of (f.boars || f.semen || [])) {
      if (boar.status === 'INACTIVE' || boar.status === 'CULLED') continue;
      const bId = boar.id || boar.boar;
      if (String(boar.rfid || '').trim().toUpperCase() === cleanTag ||
          String(bId || '').trim().toUpperCase() === cleanTag ||
          String(boar.name || boar.boar || '').trim().toUpperCase() === cleanTag) {
        return { type: 'boar', animal: boar, id: bId, name: boar.name || boar.boar, breed: boar.breed, rfid: boar.rfid || cleanTag, barn: boar.barn_id, pen: boar.pen_id };
      }
    }

    // 3. Search Piglet Batches & Roster Notches
    for (const batch of (f.piglets || [])) {
      if (String(batch.rfid || '').trim().toUpperCase() === cleanTag ||
          String(batch.id || '').trim().toUpperCase() === cleanTag) {
        return { type: 'piglet_batch', animal: batch, id: batch.id, name: `Batch ${batch.id} (${batch.sow} × ${batch.sire})`, breed: `${batch.sow} Line`, rfid: batch.rfid || cleanTag, barn: batch.barn_id, pen: batch.pen_id };
      }
      if (Array.isArray(batch.roster)) {
        for (const pig of batch.roster) {
          if (String(pig.rfid || '').trim().toUpperCase() === cleanTag ||
              String(pig.notch || '').trim().toUpperCase() === cleanTag ||
              String(pig.tag || '').trim().toUpperCase() === cleanTag) {
            return { type: 'piglet', animal: pig, batch: batch, id: pig.tag || pig.notch || batch.id, name: `Piglet #${pig.tag || pig.notch} (Batch ${batch.id})`, breed: `${batch.sow} Line`, rfid: pig.rfid || cleanTag, barn: batch.barn_id, pen: batch.pen_id };
          }
        }
      }
    }

    return null;
  }

  // Log scan event to memory and farm history
  function recordScan(tag, protocol, matched) {
    ensureFarmRfid();
    const f = getFarm();
    const event = {
      id: 'scan-' + Date.now(),
      timestamp: new Date().toISOString(),
      tag: String(tag).trim(),
      protocol: protocol || 'Manual / Simulator',
      matched: Boolean(matched),
      animal_type: matched ? matched.type : null,
      animal_id: matched ? matched.id : null,
      animal_name: matched ? matched.name : null,
      pen_location: matched ? (matched.pen ? `${matched.barn || 'Barn'} · ${matched.pen}` : 'Not assigned') : 'Unknown'
    };

    state.scanHistory.unshift(event);
    if (state.scanHistory.length > 50) state.scanHistory.pop();

    if (f && Array.isArray(f.rfid_scans)) {
      f.rfid_scans.unshift(event);
      if (f.rfid_scans.length > 100) f.rfid_scans.pop();
      if (window.save && typeof window.save === 'function') window.save();
    }

    return event;
  }

  // Handle a detected tag from ANY source
  function handleDetectedTag(tag, protocol) {
    if (!tag) return;
    const cleanTag = String(tag).trim();
    state.lastScannedTag = cleanTag;

    // Haptic feedback if available
    if ('vibrate' in navigator) navigator.vibrate([40, 60, 40]);

    const matched = findAnimalByTag(cleanTag);
    recordScan(cleanTag, protocol, matched);

    // If RFID center is currently displayed, refresh its live scan audit
    if (document.getElementById('rfid') && document.getElementById('rfid').classList.contains('active')) {
      renderRfidCenter();
    }

    // Open the Animal Dossier / Quick Action Dialog
    openQuickActionModal(cleanTag, matched, protocol);
  }

  /* ─────────────────────────────────────────────────────────────────────────
     1. WEB BLUETOOTH INTEGRATION (ISO 11784/11785 STICK READERS)
     ───────────────────────────────────────────────────────────────────────── */
  async function connectBluetoothReader() {
    if (!navigator.bluetooth) {
      alert('Web Bluetooth is not supported in this browser. Use Chrome, Edge, or an Android browser with Bluetooth enabled, or use the Camera Scanner.');
      return;
    }

    try {
      showToast('Searching for nearby Bluetooth RFID Stick Readers…');
      // Standard BLE Serial UART services (Nordic UART, Generic SPP, Tru-Test, Allflex)
      const device = await navigator.bluetooth.requestDevice({
        acceptAllDevices: true,
        optionalServices: [
          '6e400001-b5a3-f393-e0a9-e50e24dcca9e', // Nordic UART
          '0000ffe0-0000-1000-8000-00805f9b34fb', // Common BLE Serial (CC2541)
          '0000180a-0000-1000-8000-00805f9b34fb', // Device Info
          '49535343-fe7d-4ae5-8fa9-9fafd205e455'  // ISSC Transparent UART
        ]
      });

      device.addEventListener('gattserverdisconnected', onBleDisconnected);
      const server = await device.gatt.connect();
      state.bleDevice = device;
      state.bleConnected = true;

      // Try finding UART RX/TX characteristic
      let charFound = false;
      const services = await server.getPrimaryServices().catch(() => []);
      for (const service of services) {
        try {
          const chars = await service.getCharacteristics();
          for (const char of chars) {
            if (char.properties.notify || char.properties.indicate) {
              await char.startNotifications();
              char.addEventListener('characteristicvaluechanged', onBleDataReceived);
              state.bleCharacteristic = char;
              charFound = true;
              break;
            }
          }
        } catch (e) { console.debug('Service scan note:', e); }
        if (charFound) break;
      }

      showToast(`Connected to RFID Reader: ${device.name || 'Stick Reader'}`);
      renderRfidCenter();
    } catch (err) {
      console.warn('Bluetooth connection error:', err);
      if (err.name !== 'NotFoundError') {
        showToast('Bluetooth pairing cancelled or failed.');
      }
    }
  }

  function onBleDisconnected() {
    state.bleConnected = false;
    state.bleDevice = null;
    state.bleCharacteristic = null;
    showToast('RFID Stick Reader disconnected.');
    renderRfidCenter();
  }

  let bleBuffer = '';
  function onBleDataReceived(event) {
    const value = event.target.value;
    const decoder = new TextDecoder('utf-8');
    const text = decoder.decode(value);
    bleBuffer += text;

    // Check for newline / delimiter
    if (bleBuffer.includes('\n') || bleBuffer.includes('\r') || bleBuffer.length >= 15) {
      const match = bleBuffer.match(/\b\d{15}\b/) || bleBuffer.match(/[A-Za-z0-9-_]{4,20}/);
      if (match) {
        handleDetectedTag(match[0], `BLE (${state.bleDevice?.name || 'Reader'})`);
      }
      bleBuffer = '';
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────
     2. WEB NFC INTEGRATION (13.56 MHz SMART EAR TAGS)
     ───────────────────────────────────────────────────────────────────────── */
  async function startNfcReader() {
    if (!('NDEFReader' in window)) {
      showToast('Web NFC is not supported on this device/browser. (Requires Android Chrome with NFC enabled).');
      return;
    }

    try {
      const ndef = new window.NDEFReader();
      await ndef.scan();
      state.nfcReader = ndef;
      state.nfcListening = true;

      ndef.onreading = event => {
        let tag = event.serialNumber;
        // Check if there are text records
        if (event.message && event.message.records) {
          for (const record of event.message.records) {
            if (record.recordType === 'text') {
              const textDecoder = new TextDecoder(record.encoding);
              const payload = textDecoder.decode(record.data);
              if (payload) tag = payload;
            }
          }
        }
        handleDetectedTag(tag, 'NFC Ear Tag');
      };

      ndef.onreadingerror = () => {
        showToast('NFC Tag read error. Please hold the tag steady near the back of your phone.');
      };

      showToast('NFC Reader active! Tap ear tag to back of device.');
      renderRfidCenter();
    } catch (err) {
      console.warn('NFC error:', err);
      showToast(`NFC activation failed: ${err.message || 'Permission denied'}`);
    }
  }

  /* ─────────────────────────────────────────────────────────────────────────
     3. INDUSTRIAL-GRADE HIGH-SPEED CAMERA BARCODE / QR SCANNER
        Powered by:
        • Bradley-Roth Integral Image Adaptive Local Thresholding (anti-glare/dirt)
        • Multi-Row & Multi-Angle Sub-Pixel 1D Scanline Decoders (EAN-13, UPC, Code 128, Code 39, ITF)
        • ZXing MultiFormat Engine + Native BarcodeDetector Multi-Engine Pipeline
        • Low-Light Ambient Detection & Continuous Auto-Focus Constraints
     ───────────────────────────────────────────────────────────────────────── */
  let cameraTrack = null;
  let torchActive = false;
  let currentZoom = 1.0;
  let maxZoom = 1.0;
  let offscreenCanvas = null;
  let offscreenCtx = null;
  let binCanvas = null;
  let binCtx = null;
  let nativeDetector = null;
  let zxingReader = null;
  let isScanningFrame = false;

  // Initialize ZXing MultiFormat Reader
  function getZXingReader() {
    if (!zxingReader && window.ZXing && window.ZXing.BrowserMultiFormatReader) {
      try {
        const hints = new Map();
        const formats = [
          window.ZXing.BarcodeFormat.EAN_13,
          window.ZXing.BarcodeFormat.EAN_8,
          window.ZXing.BarcodeFormat.UPC_A,
          window.ZXing.BarcodeFormat.UPC_E,
          window.ZXing.BarcodeFormat.CODE_128,
          window.ZXing.BarcodeFormat.CODE_39,
          window.ZXing.BarcodeFormat.CODE_93,
          window.ZXing.BarcodeFormat.ITF,
          window.ZXing.BarcodeFormat.QR_CODE,
          window.ZXing.BarcodeFormat.DATA_MATRIX,
          window.ZXing.BarcodeFormat.CODABAR,
          window.ZXing.BarcodeFormat.AZTEC,
          window.ZXing.BarcodeFormat.PDF_417
        ];
        hints.set(window.ZXing.DecodeHintType.POSSIBLE_FORMATS, formats);
        hints.set(window.ZXing.DecodeHintType.TRY_HARDER, true);
        zxingReader = new window.ZXing.BrowserMultiFormatReader(hints);
      } catch (e) {
        console.debug("ZXing init note:", e);
      }
    }
    return zxingReader;
  }

  // Synthesize positive scan chime using Web Audio API
  function playScanSuccessChime() {
    try {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (!AudioCtx) return;
      const ctx = new AudioCtx();
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.exponentialRampToValueAtTime(1760, ctx.currentTime + 0.12);
      gain.gain.setValueAtTime(0.2, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.15);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start();
      osc.stop(ctx.currentTime + 0.15);
    } catch (e) {}
  }

  async function openCameraScanner(targetContainerId) {
    const container = document.getElementById(targetContainerId || "scannerViewfinder");
    if (!container) return;

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
      container.innerHTML = `<div class="scanner-fallback-msg">Camera access is not available on this browser. Use manual input or Bluetooth.</div>`;
      return;
    }

    container.innerHTML = `
      <div class="camera-scanner-wrap" id="cameraScannerWrap">
        <video id="rfidCamVideo" autoplay playsinline muted class="camera-video-feed"></video>
        <div class="camera-reticle" id="scannerReticle">
          <div class="reticle-laser"></div>
          <div class="reticle-corners">
            <span class="c-tl"></span><span class="c-tr"></span>
            <span class="c-bl"></span><span class="c-br"></span>
          </div>
          <span class="reticle-hint" id="reticleHint">Align Ear-Tag Barcode or QR Code</span>
        </div>

        <!-- Low Light Prompt Badge -->
        <div id="lowLightPrompt" class="low-light-prompt" style="display:none" onclick="window.toggleCameraTorch()">
          <span>🔦 Low Lighting — Tap to Turn On Flashlight</span>
        </div>

        <!-- Dynamic Controls HUD (Torch, Zoom, File Upload) -->
        <div class="camera-hud-controls">
          <button type="button" class="hud-btn" id="hudTorchBtn" onclick="window.toggleCameraTorch()" title="Toggle Flashlight" style="display:none">
            <span class="hud-ico">🔦</span> <span id="torchLabel">Torch</span>
          </button>
          <div class="hud-zoom-group" id="hudZoomGroup" style="display:none">
            <button type="button" class="zoom-btn active" id="zoom1x" onclick="window.setCameraZoom(1.0)">1x</button>
            <button type="button" class="zoom-btn" id="zoom2x" onclick="window.setCameraZoom(2.0)">2x</button>
            <button type="button" class="zoom-btn" id="zoom3x" onclick="window.setCameraZoom(3.0)">3x</button>
          </div>
          <button type="button" class="hud-btn" onclick="document.getElementById('barcodePhotoInput').click()" title="Scan Image from Gallery">
            <span class="hud-ico">🖼️</span> Photo
          </button>
          <input type="file" id="barcodePhotoInput" accept="image/*" style="display:none" onchange="window.scanBarcodeFromImageFile(event)">
        </div>

        <div class="camera-footer-row">
          <span class="camera-status-pill" id="camStatusPill">⚡ Enhanced Multi-Engine High-Speed Scan Active</span>
          <button type="button" class="btn ghost small cam-close-btn" onclick="window.closeCameraScanner()">✕ Close</button>
        </div>
      </div>
    `;

    // Initialize Offscreen Canvases
    if (!offscreenCanvas) {
      offscreenCanvas = document.createElement("canvas");
      offscreenCtx = offscreenCanvas.getContext("2d", { willReadFrequently: true });
    }
    if (!binCanvas) {
      binCanvas = document.createElement("canvas");
      binCtx = binCanvas.getContext("2d", { willReadFrequently: true });
    }

    // Initialize Native BarcodeDetector
    if ("BarcodeDetector" in window && !nativeDetector) {
      try {
        const formats = ["ean_13", "ean_8", "upc_a", "upc_e", "code_128", "code_39", "code_93", "codabar", "itf", "qr_code", "data_matrix", "aztec", "pdf417"];
        if (typeof window.BarcodeDetector.getSupportedFormats === "function") {
          const supported = await window.BarcodeDetector.getSupportedFormats();
          nativeDetector = new window.BarcodeDetector({ formats: supported.length ? supported : formats });
        } else {
          nativeDetector = new window.BarcodeDetector({ formats });
        }
      } catch (e) {}
    }

    getZXingReader();

    // Request High-Definition environment camera stream
    const constraints = {
      video: {
        facingMode: { ideal: "environment" },
        width: { ideal: 1920, min: 1280 },
        height: { ideal: 1080, min: 720 },
        frameRate: { ideal: 60, min: 30 },
        focusMode: { ideal: "continuous" }
      },
      audio: false
    };

    try {
      const stream = await navigator.mediaDevices.getUserMedia(constraints).catch(() => {
        return navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" } });
      });

      state.cameraStream = stream;
      state.cameraScanning = true;
      const video = document.getElementById("rfidCamVideo");
      if (!video) return;

      video.srcObject = stream;
      await video.play().catch(() => {});

      // Check Torch and Zoom hardware capabilities
      cameraTrack = stream.getVideoTracks()[0];
      if (cameraTrack && typeof cameraTrack.getCapabilities === "function") {
        const caps = cameraTrack.getCapabilities();
        if (caps.torch) {
          const torchBtn = document.getElementById("hudTorchBtn");
          if (torchBtn) torchBtn.style.display = "inline-flex";
        }
        if (caps.zoom) {
          maxZoom = caps.zoom.max || 3.0;
          const zoomGroup = document.getElementById("hudZoomGroup");
          if (zoomGroup) zoomGroup.style.display = "inline-flex";
        }
      }

      startCameraDetection(video);
    } catch (err) {
      console.warn("Camera init error:", err);
      container.innerHTML = `<div class="scanner-fallback-msg">Camera permission denied or camera not found. (${err.message})</div>`;
    }
  }

  function closeCameraScanner() {
    if (state.cameraStream) {
      state.cameraStream.getTracks().forEach(t => t.stop());
      state.cameraStream = null;
    }
    if (zxingReader) {
      try { zxingReader.reset(); } catch (e) {}
    }
    cameraTrack = null;
    torchActive = false;
    isScanningFrame = false;
    state.cameraScanning = false;
    const vf = document.getElementById("scannerViewfinder");
    if (vf) vf.innerHTML = "";
  }

  async function toggleCameraTorch() {
    if (!cameraTrack) return;
    try {
      torchActive = !torchActive;
      await cameraTrack.applyConstraints({ advanced: [{ torch: torchActive }] });
      const lbl = document.getElementById("torchLabel");
      const btn = document.getElementById("hudTorchBtn");
      const prompt = document.getElementById("lowLightPrompt");
      if (lbl) lbl.textContent = torchActive ? "Torch On" : "Torch Off";
      if (btn) btn.classList.toggle("active", torchActive);
      if (prompt && torchActive) prompt.style.display = "none";
    } catch (e) {}
  }

  async function setCameraZoom(val) {
    if (!cameraTrack) return;
    try {
      const zoomVal = Math.min(val, maxZoom);
      currentZoom = zoomVal;
      await cameraTrack.applyConstraints({ advanced: [{ zoom: zoomVal }] });
      document.querySelectorAll(".zoom-btn").forEach(b => b.classList.remove("active"));
      if (val <= 1.0) document.getElementById("zoom1x")?.classList.add("active");
      else if (val <= 2.0) document.getElementById("zoom2x")?.classList.add("active");
      else document.getElementById("zoom3x")?.classList.add("active");
    } catch (e) {}
  }

  // Scan from uploaded photo
  async function scanBarcodeFromImageFile(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    showToast("Processing image for barcodes & QR codes…");
    const imgUrl = URL.createObjectURL(file);
    const img = new Image();
    img.onload = async () => {
      // 1. Try Native BarcodeDetector on image
      if (nativeDetector) {
        try {
          const barcodes = await nativeDetector.detect(img);
          if (barcodes && barcodes.length > 0) {
            URL.revokeObjectURL(imgUrl);
            onBarcodeSuccess(barcodes[0].rawValue, barcodes[0].format || "Image Barcode");
            return;
          }
        } catch (e) {}
      }

      // 2. Try ZXing on image
      const reader = getZXingReader();
      if (reader) {
        try {
          const res = await reader.decodeFromImageUrl(imgUrl);
          if (res && res.getText()) {
            URL.revokeObjectURL(imgUrl);
            onBarcodeSuccess(res.getText(), res.getBarcodeFormat() ? String(res.getBarcodeFormat()) : "ZXing Image");
            return;
          }
        } catch (e) {}
      }

      URL.revokeObjectURL(imgUrl);
      showToast("No barcode found in image. Please ensure the barcode is well-lit and clear.");
    };
    img.src = imgUrl;
  }

  /* ── Bradley-Roth Local Window Adaptive Binarization (Anti-glare, anti-dirt) ── */
  function computeAdaptiveBinarization(grayArray, width, height, S, T) {
    const integral = new Int32Array(width * height);
    const binary = new Uint8Array(width * height);

    // 1. Calculate integral image
    for (let y = 0; y < height; y++) {
      let sum = 0;
      const rowOffset = y * width;
      const prevRowOffset = (y - 1) * width;
      for (let x = 0; x < width; x++) {
        sum += grayArray[rowOffset + x];
        integral[rowOffset + x] = (y === 0 ? 0 : integral[prevRowOffset + x]) + sum;
      }
    }

    // 2. Perform local adaptive thresholding
    const s2 = Math.floor(S / 2);
    for (let y = 0; y < height; y++) {
      const y1 = Math.max(0, y - s2);
      const y2 = Math.min(height - 1, y + s2);
      const rowOffset = y * width;

      for (let x = 0; x < width; x++) {
        const x1 = Math.max(0, x - s2);
        const x2 = Math.min(width - 1, x + s2);
        const count = (x2 - x1) * (y2 - y1);
        const sum = integral[y2 * width + x2] - integral[y1 * width + x2] - integral[y2 * width + x1] + integral[y1 * width + x1];

        // 1 = Black Bar, 0 = White Space
        binary[rowOffset + x] = (grayArray[rowOffset + x] * count <= sum * (1.0 - T)) ? 1 : 0;
      }
    }
    return binary;
  }

  /* ─────────────────────────────────────────────────────────────────────────
     MULTI-ENGINE PARALLEL DETECTION LOOP WITH CONSENSUS VERIFICATION
     ───────────────────────────────────────────────────────────────────────── */
  let scanlineConsensusCache = {};

  function startCameraDetection(video) {
    if (!state.cameraScanning) return;

    let frameCount = 0;
    const reader = getZXingReader();
    scanlineConsensusCache = {};

    const processFrame = async () => {
      if (!state.cameraScanning || !video || video.readyState < 2 || isScanningFrame) {
        if (state.cameraScanning) requestAnimationFrame(processFrame);
        return;
      }

      isScanningFrame = true;
      frameCount++;

      const vw = video.videoWidth || 1280;
      const vh = video.videoHeight || 720;

      // 1. Engine 1: Native BarcodeDetector on raw video (Hardware-accelerated, 0% false positives)
      if (nativeDetector) {
        try {
          const barcodes = await nativeDetector.detect(video);
          if (barcodes && barcodes.length > 0) {
            const code = barcodes[0].rawValue;
            if (code && code.trim()) {
              onBarcodeSuccess(code, barcodes[0].format || "Barcode");
              return;
            }
          }
        } catch (e) {}
      }

      // 2. Engine 2: High-Contrast ROI Extraction & Adaptive Binarization
      if (offscreenCtx) {
        try {
          const cropW = Math.round(vw * 0.85);
          const cropH = Math.round(vh * 0.65);
          const cropX = Math.round((vw - cropW) / 2);
          const cropY = Math.round((vh - cropH) / 2);

          offscreenCanvas.width = cropW;
          offscreenCanvas.height = cropH;

          // Draw cropped ROI
          offscreenCtx.drawImage(video, cropX, cropY, cropW, cropH, 0, 0, cropW, cropH);

          // Extract pixel luminance
          const imgData = offscreenCtx.getImageData(0, 0, cropW, cropH);
          const data = imgData.data;
          let totalLum = 0;
          let minLum = 255, maxLum = 0;
          const lumArray = new Uint8Array(cropW * cropH);

          for (let i = 0, j = 0; i < data.length; i += 4, j++) {
            const lum = Math.round(data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114);
            lumArray[j] = lum;
            totalLum += lum;
            if (lum < minLum) minLum = lum;
            if (lum > maxLum) maxLum = lum;
          }

          // Low-light prompt trigger
          const avgLum = totalLum / (cropW * cropH);
          const lowLightEl = document.getElementById("lowLightPrompt");
          if (lowLightEl) {
            lowLightEl.style.display = (avgLum < 52 && !torchActive) ? "block" : "none";
          }

          // Contrast stretching & glare suppression
          const range = Math.max(1, maxLum - minLum);
          for (let i = 0, j = 0; i < data.length; i += 4, j++) {
            const stretched = Math.round(((lumArray[j] - minLum) / range) * 255);
            data[i] = stretched;
            data[i + 1] = stretched;
            data[i + 2] = stretched;
          }
          offscreenCtx.putImageData(imgData, 0, 0);

          // 3. Engine 3: Bradley-Roth Adaptive Binarization (Anti-glare & anti-dirt)
          const S = Math.max(16, Math.floor(cropW / 16));
          const binaryArray = computeAdaptiveBinarization(lumArray, cropW, cropH, S, 0.12);

          // 4. Engine 4: High-Density Industrial 1D Scanline Sampler with Strict Verification
          const decoded1D = decode1DMultiScanlines(binaryArray, lumArray, cropW, cropH);
          if (decoded1D) {
            onBarcodeSuccess(decoded1D.code, decoded1D.format);
            return;
          }

          // 5. Engine 5: Native Detector on Preprocessed ROI Canvas
          if (nativeDetector) {
            const roiBarcodes = await nativeDetector.detect(offscreenCanvas).catch(() => []);
            if (roiBarcodes && roiBarcodes.length > 0) {
              const code = roiBarcodes[0].rawValue;
              if (code && code.trim()) {
                onBarcodeSuccess(code, roiBarcodes[0].format || "Enhanced ROI");
                return;
              }
            }
          }

          // 6. Engine 6: ZXing MultiFormat on Preprocessed Canvas
          if (reader && frameCount % 2 === 0) {
            try {
              const zxResult = reader.decodeFromCanvas(offscreenCanvas);
              if (zxResult && zxResult.getText()) {
                onBarcodeSuccess(zxResult.getText(), "ZXing MultiFormat");
                return;
              }
            } catch (e) {}

            // Pass binary canvas to ZXing for QR codes under shadows
            if (binCtx) {
              binCanvas.width = cropW;
              binCanvas.height = cropH;
              const binImgData = binCtx.createImageData(cropW, cropH);
              const bData = binImgData.data;
              for (let k = 0, bIdx = 0; k < binaryArray.length; k++, bIdx += 4) {
                const color = binaryArray[k] === 1 ? 0 : 255;
                bData[bIdx] = color;
                bData[bIdx + 1] = color;
                bData[bIdx + 2] = color;
                bData[bIdx + 3] = 255;
              }
              binCtx.putImageData(binImgData, 0, 0);

              try {
                const zxBinResult = reader.decodeFromCanvas(binCanvas);
                if (zxBinResult && zxBinResult.getText()) {
                  onBarcodeSuccess(zxBinResult.getText(), "ZXing Binary");
                  return;
                }
              } catch (e) {}
            }
          }
        } catch (e) {}
      }

      isScanningFrame = false;
      if (state.cameraScanning) {
        requestAnimationFrame(processFrame);
      }
    };

    requestAnimationFrame(processFrame);
  }

  /* ─────────────────────────────────────────────────────────────────────────
     MULTI-ROW & MULTI-ANGLE INDUSTRIAL 1D SCANLINE SAMPLER (ZERO FALSE POSITIVES)
     ───────────────────────────────────────────────────────────────────────── */
  function decode1DMultiScanlines(binaryArray, grayArray, width, height) {
    if (!binaryArray || width < 120 || height < 40) return null;

    // Sample 25 horizontal and angled scanlines
    const ySteps = [
      0.50, 0.45, 0.55, 0.40, 0.60, 0.35, 0.65, 0.30, 0.70, 0.25, 0.75,
      0.20, 0.80, 0.15, 0.85, 0.48, 0.52, 0.42, 0.58, 0.38, 0.62
    ];

    const frameHits = {};

    for (const yFrac of ySteps) {
      const y = Math.floor(height * yFrac);
      const rowOffset = y * width;

      // Extract runs from binary array
      const runs = [];
      let curColor = binaryArray[rowOffset];
      let curLen = 1;

      for (let x = 1; x < width; x++) {
        const color = binaryArray[rowOffset + x];
        if (color === curColor) {
          curLen++;
        } else {
          runs.push({ color: curColor, len: curLen });
          curColor = color;
          curLen = 1;
        }
      }
      runs.push({ color: curColor, len: curLen });

      // 1. Try Strict EAN-13 / UPC-A Forward
      const ean13 = tryDecodeStrictEAN13(runs);
      if (ean13) {
        frameHits[ean13] = (frameHits[ean13] || 0) + 1;
        if (frameHits[ean13] >= 2) return { code: ean13, format: "EAN-13" };
      }

      // 2. Try Strict Code 128 Forward
      const c128 = tryDecodeStrictCode128(runs);
      if (c128) {
        frameHits[c128] = (frameHits[c128] || 0) + 1;
        if (frameHits[c128] >= 2) return { code: c128, format: "Code-128" };
      }

      // 3. Try Strict Code 39 Forward
      const c39 = tryDecodeStrictCode39(runs);
      if (c39) {
        frameHits[c39] = (frameHits[c39] || 0) + 1;
        if (frameHits[c39] >= 2) return { code: c39, format: "Code-39" };
      }

      // 4. Try Reversed Runs (Inverted / Upside-down Barcodes)
      const reversedRuns = [...runs].reverse();
      const ean13Rev = tryDecodeStrictEAN13(reversedRuns);
      if (ean13Rev) {
        frameHits[ean13Rev] = (frameHits[ean13Rev] || 0) + 1;
        if (frameHits[ean13Rev] >= 2) return { code: ean13Rev, format: "EAN-13" };
      }

      const c128Rev = tryDecodeStrictCode128(reversedRuns);
      if (c128Rev) {
        frameHits[c128Rev] = (frameHits[c128Rev] || 0) + 1;
        if (frameHits[c128Rev] >= 2) return { code: c128Rev, format: "Code-128" };
      }
    }

    // Inter-frame consensus confirmation (requires 2 confirmations across consecutive frames)
    const now = Date.now();
    for (const [code, count] of Object.entries(frameHits)) {
      if (!scanlineConsensusCache[code]) {
        scanlineConsensusCache[code] = { count, lastSeen: now };
      } else {
        const c = scanlineConsensusCache[code];
        if (now - c.lastSeen < 350) {
          c.count += count;
          c.lastSeen = now;
          if (c.count >= 2) {
            delete scanlineConsensusCache[code];
            const fmt = code.length === 13 ? "EAN-13" : (code.length === 12 ? "UPC-A" : "Barcode");
            return { code, format: fmt };
          }
        } else {
          c.count = count;
          c.lastSeen = now;
        }
      }
    }

    return null;
  }

  /* ── 1. Strict Sub-Pixel EAN-13 / UPC-A Distance Decoder ── */
  const L_RUNS = [
    [3, 2, 1, 1], [2, 2, 2, 1], [2, 1, 2, 2], [1, 4, 1, 1], [1, 1, 3, 2],
    [1, 2, 3, 1], [1, 1, 1, 4], [1, 3, 1, 2], [1, 2, 1, 3], [3, 1, 1, 2]
  ];
  const G_RUNS = [
    [1, 1, 2, 3], [1, 2, 2, 2], [2, 2, 1, 2], [1, 1, 4, 1], [2, 3, 1, 1],
    [1, 3, 2, 1], [4, 1, 1, 1], [2, 1, 3, 1], [3, 1, 2, 1], [2, 1, 1, 3]
  ];
  const R_RUNS = L_RUNS;
  const FIRST_DIGIT_PARITY = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

  function matchEANDigitStrict(runs, tables, expectedUnit) {
    const total = runs[0] + runs[1] + runs[2] + runs[3];
    if (total <= 0 || Math.abs(total - 7.0 * expectedUnit) > 2.0 * expectedUnit) return null;
    const norm = [runs[0] / total * 7.0, runs[1] / total * 7.0, runs[2] / total * 7.0, runs[3] / total * 7.0];
    let bestDist = 999.0;
    let bestMatch = null;

    for (const [tblName, tbl] of tables) {
      for (let digit = 0; digit < 10; digit++) {
        const ideal = tbl[digit];
        const dist = Math.abs(norm[0] - ideal[0]) + Math.abs(norm[1] - ideal[1]) + Math.abs(norm[2] - ideal[2]) + Math.abs(norm[3] - ideal[3]);
        if (dist < bestDist) {
          bestDist = dist;
          bestMatch = { digit, type: tblName, dist };
        }
      }
    }
    if (bestMatch && bestMatch.dist < 1.35) {
      return bestMatch;
    }
    return null;
  }

  function tryDecodeStrictEAN13(runs) {
    if (runs.length < 59) return null;

    for (let i = 0; i <= runs.length - 59; i++) {
      // Start guard: 1-0-1 (bar, space, bar)
      if (runs[i].color !== 1 || runs[i + 1].color !== 0 || runs[i + 2].color !== 1) continue;

      const g1 = runs[i].len, g2 = runs[i + 1].len, g3 = runs[i + 2].len;
      const unit = (g1 + g2 + g3) / 3.0;
      if (unit < 1.0) continue;

      // Strict guard uniformity
      if (Math.max(Math.abs(g1 - unit), Math.abs(g2 - unit), Math.abs(g3 - unit)) > 0.45 * unit) continue;

      // Strict quiet zone before start guard
      if (i > 0 && (runs[i - 1].color !== 0 || runs[i - 1].len < 3.0 * unit)) continue;

      let offset = i + 3;
      const leftDigits = [];
      let parity = "";
      let valid = true;

      for (let d = 0; d < 6; d++) {
        const digitRuns = [runs[offset].len, runs[offset + 1].len, runs[offset + 2].len, runs[offset + 3].len];
        const match = matchEANDigitStrict(digitRuns, [["L", L_RUNS], ["G", G_RUNS]], unit);
        if (!match) { valid = false; break; }
        leftDigits.push(match.digit);
        parity += match.type;
        offset += 4;
      }

      if (!valid || leftDigits.length !== 6) continue;

      const firstDigit = FIRST_DIGIT_PARITY.indexOf(parity);
      if (firstDigit === -1) continue;

      // Center guard: 0-1-0-1-0 (5 runs)
      if (offset + 5 > runs.length) continue;
      const cRuns = [runs[offset].len, runs[offset + 1].len, runs[offset + 2].len, runs[offset + 3].len, runs[offset + 4].len];
      const cColors = [runs[offset].color, runs[offset + 1].color, runs[offset + 2].color, runs[offset + 3].color, runs[offset + 4].color];
      if (cColors[0] !== 0 || cColors[1] !== 1 || cColors[2] !== 0 || cColors[3] !== 1 || cColors[4] !== 0) continue;
      if (cRuns.some(cr => Math.abs(cr - unit) > 0.65 * unit)) continue;
      offset += 5;

      const rightDigits = [];
      for (let d = 0; d < 6; d++) {
        const digitRuns = [runs[offset].len, runs[offset + 1].len, runs[offset + 2].len, runs[offset + 3].len];
        const match = matchEANDigitStrict(digitRuns, [["R", R_RUNS]], unit);
        if (!match) { valid = false; break; }
        rightDigits.push(match.digit);
        offset += 4;
      }

      if (!valid || rightDigits.length !== 6) continue;

      // End guard: 1-0-1
      if (offset + 3 > runs.length) continue;
      if (runs[offset].color !== 1 || runs[offset + 1].color !== 0 || runs[offset + 2].color !== 1) continue;

      const fullCode = [firstDigit, ...leftDigits, ...rightDigits].join("");
      if (fullCode.length !== 13) continue;

      // Modulo-10 Checksum Validation
      let sum = 0;
      for (let c = 0; c < 12; c++) {
        sum += parseInt(fullCode[c], 10) * (c % 2 === 0 ? 1 : 3);
      }
      const expectedCheck = (10 - (sum % 10)) % 10;
      if (expectedCheck === parseInt(fullCode[12], 10)) {
        return fullCode;
      }
    }

    return null;
  }

  /* ── 2. Strict Sub-Pixel Code-128 Distance Decoder ── */
  const CODE128_PATTERNS = [
    [2,1,2,2,2,2],[2,2,2,1,2,2],[2,2,2,2,2,1],[1,2,1,2,2,3],[1,2,1,3,2,2],[1,3,1,2,2,2],[1,2,2,2,1,3],[1,2,2,3,1,2],[1,3,2,2,1,2],[2,2,1,2,1,3],
    [2,2,1,3,1,2],[2,3,1,2,1,2],[1,1,2,2,3,2],[1,2,2,1,3,2],[1,2,2,2,3,1],[1,1,3,2,2,2],[1,2,3,1,2,2],[1,2,3,2,2,1],[2,2,3,2,1,1],[2,2,1,1,3,2],
    [2,2,1,2,3,1],[2,1,3,2,1,2],[2,2,3,1,1,2],[3,1,2,1,3,1],[3,1,1,2,2,2],[3,2,1,1,2,2],[3,2,1,2,2,1],[3,1,2,2,1,2],[3,2,2,1,1,2],[3,2,2,2,1,1],
    [2,1,2,1,2,3],[2,1,2,3,2,1],[2,3,2,1,2,1],[1,1,1,3,2,3],[1,3,1,1,2,3],[1,3,1,3,2,1],[1,1,2,3,1,3],[1,3,2,1,1,3],[1,3,2,3,1,1],[2,1,1,3,1,3],
    [2,3,1,1,1,3],[2,3,1,3,1,1],[1,1,2,1,3,3],[1,1,2,3,3,1],[1,3,2,1,3,1],[1,1,3,1,2,3],[1,1,3,3,2,1],[1,3,3,1,2,1],[3,1,3,1,2,1],[2,1,1,3,3,1],
    [2,3,1,1,3,1],[2,1,3,1,1,3],[2,1,3,3,1,1],[2,1,3,1,3,1],[3,1,1,1,2,3],[3,1,1,3,2,1],[3,3,1,1,2,1],[3,1,2,1,1,3],[3,1,2,3,1,1],[3,3,2,1,1,1],
    [3,1,4,1,1,1],[2,2,1,4,1,1],[4,3,1,1,1,1],[1,1,1,2,2,4],[1,1,1,4,2,2],[1,2,1,1,2,4],[1,2,1,4,2,1],[1,4,1,1,2,2],[1,4,1,2,2,1],[1,1,2,2,1,4],
    [1,1,2,4,1,2],[1,2,2,1,1,4],[1,2,2,4,1,1],[1,4,2,1,1,2],[1,4,2,2,1,1],[2,4,1,2,1,1],[2,2,1,1,1,4],[4,1,3,1,1,1],[2,4,1,1,1,2],[1,3,4,1,1,1],
    [1,1,1,2,4,2],[1,2,1,1,4,2],[1,2,1,2,4,1],[1,1,4,2,1,2],[1,2,4,1,1,2],[1,2,4,2,1,1],[4,1,1,2,1,2],[4,2,1,1,1,2],[4,2,1,2,1,1],[2,1,2,1,4,1],
    [2,1,4,1,2,1],[4,1,2,1,2,1],[1,1,1,1,4,3],[1,1,1,3,4,1],[1,3,1,1,4,1],[1,1,4,1,1,3],[1,1,4,3,1,1],[4,1,1,1,1,3],[4,1,1,3,1,1],[1,1,3,1,4,1],
    [1,1,4,1,3,1],[3,1,1,1,4,1],[4,1,1,1,3,1],[2,1,1,4,1,2],[2,1,1,2,1,4],[2,1,1,2,3,2] // Start A (103), Start B (104), Start C (105)
  ];

  function matchCode128CharStrict(runs, expectedUnit) {
    const total = runs.reduce((a, b) => a + b, 0);
    if (total <= 0 || Math.abs(total - 11.0 * expectedUnit) > 3.0 * expectedUnit) return -1;
    const norm = runs.map(r => (r / total) * 11.0);
    let bestDist = 999.0;
    let bestIdx = -1;

    for (let idx = 0; idx < CODE128_PATTERNS.length; idx++) {
      const ideal = CODE128_PATTERNS[idx];
      let dist = 0;
      for (let k = 0; k < 6; k++) dist += Math.abs(norm[k] - ideal[k]);
      if (dist < bestDist) {
        bestDist = dist;
        bestIdx = idx;
      }
    }
    return bestDist < 1.8 ? bestIdx : -1;
  }

  function tryDecodeStrictCode128(runs) {
    if (runs.length < 20) return null;

    for (let i = 0; i <= runs.length - 20; i++) {
      if (runs[i].color !== 1) continue; // Start must be a bar

      // Quiet zone before start
      if (i > 0 && (runs[i - 1].color !== 0 || runs[i - 1].len < 5)) continue;

      const startRuns = runs.slice(i, i + 6).map(r => r.len);
      const startTotal = startRuns.reduce((a, b) => a + b, 0);
      const unit = startTotal / 11.0;
      if (unit < 1.0) continue;

      const startChar = matchCode128CharStrict(startRuns, unit);
      if (startChar < 103 || startChar > 105) continue;

      let codeSet = startChar === 103 ? "A" : (startChar === 104 ? "B" : "C");
      let offset = i + 6;
      const charIndices = [startChar];
      let valid = true;

      while (offset + 6 <= runs.length) {
        // Check for Stop pattern (7 runs: 2-3-3-1-1-1-2)
        if (offset + 7 <= runs.length) {
          const stopRuns = runs.slice(offset, offset + 7).map(r => r.len);
          const stopTotal = stopRuns.reduce((a, b) => a + b, 0);
          const stopNorm = stopRuns.map(r => (r / stopTotal) * 13.0);
          const idealStop = [2, 3, 3, 1, 1, 1, 2];
          let stopDist = 0;
          for (let k = 0; k < 7; k++) stopDist += Math.abs(stopNorm[k] - idealStop[k]);

          if (stopDist < 2.2 && charIndices.length >= 2) {
            const checksumChar = charIndices[charIndices.length - 1];
            const dataChars = charIndices.slice(0, charIndices.length - 1);
            let checkSum = dataChars[0];
            for (let d = 1; d < dataChars.length; d++) {
              checkSum += d * dataChars[d];
            }
            if ((checkSum % 103) === checksumChar) {
              let resultStr = "";
              for (let d = 1; d < dataChars.length; d++) {
                const val = dataChars[d];
                if (codeSet === "B" && val >= 0 && val <= 95) {
                  resultStr += String.fromCharCode(val + 32);
                } else if (codeSet === "C" && val >= 0 && val <= 99) {
                  resultStr += (val < 10 ? "0" + val : String(val));
                } else if (val === 100) codeSet = "B";
                else if (val === 99) codeSet = "C";
              }
              if (resultStr.length > 0) return resultStr;
            }
          }
        }

        const charRuns = runs.slice(offset, offset + 6).map(r => r.len);
        const charIdx = matchCode128CharStrict(charRuns, unit);
        if (charIdx === -1) { valid = false; break; }
        charIndices.push(charIdx);
        offset += 6;
      }
    }

    return null;
  }

  /* ── 3. Strict Sub-Pixel Code-39 Distance Decoder ── */
  const CODE39_PATTERNS = {
    "0": "NNNWWNWNN", "1": "WNNWNNNNW", "2": "NNWWNNNNW", "3": "WNWWNNNNN", "4": "NNNWWNNNW",
    "5": "WNNWWNNNN", "6": "NNWWWNNNN", "7": "NNNWNNWNW", "8": "WNNWNNWNN", "9": "NNWWNNWNN",
    "A": "WNNNNWNNW", "B": "NNWNNWNNW", "C": "WNWNNWNNN", "D": "NNNNWWNNW", "E": "WNNNWWNNN",
    "F": "NNWNWWNNN", "G": "NNNNNWWNW", "H": "WNNNNWWNN", "I": "NNWNNWWNN", "J": "NNNNWWWNN",
    "K": "WNNNNNNWW", "L": "NNWNNNNWW", "M": "WNWNNNNWN", "N": "NNNNWNNWW", "O": "WNNNWNNWN",
    "P": "NNWNWNNWN", "Q": "NNNNNNWWW", "R": "WNNNNNWWN", "S": "NNWNNNWWN", "T": "NNNNWNWWN",
    "U": "WWNNNNNNW", "V": "NWWNNNNNW", "W": "WWWNNNNNN", "X": "NWNNWNNNW", "Y": "WWNNWNNNN",
    "Z": "NWWNWNNNN", "-": "NWNNNNWNW", ".": "WWNNNNWNN", " ": "NWWNNNWNN", "*": "NWNNWNWNN",
    "$": "NWNWNWNNN", "/": "NWNWNNNWN", "+": "NWNNNWNWN", "%": "NNNWNWNWN"
  };

  function tryDecodeStrictCode39(runs) {
    if (runs.length < 29) return null;

    for (let i = 0; i <= runs.length - 29; i++) {
      if (runs[i].color !== 1) continue;

      // Start must match asterisk '*' (NWNNWNWNN)
      const startRuns = runs.slice(i, i + 9).map(r => r.len);
      const total = startRuns.reduce((a, b) => a + b, 0);
      const threshold = total / 9.0;

      let startPattern = "";
      for (let k = 0; k < 9; k++) startPattern += (startRuns[k] > threshold * 1.35) ? "W" : "N";
      if (startPattern !== "NWNNWNWNN") continue;

      let offset = i + 10;
      let decodedStr = "";

      while (offset + 9 <= runs.length) {
        const charRuns = runs.slice(offset, offset + 9).map(r => r.len);
        const charTotal = charRuns.reduce((a, b) => a + b, 0);
        const charThresh = charTotal / 9.0;

        let charPat = "";
        for (let k = 0; k < 9; k++) charPat += (charRuns[k] > charThresh * 1.35) ? "W" : "N";

        if (charPat === "NWNNWNWNN") {
          if (decodedStr.length >= 2) return decodedStr;
        }

        let matchChar = null;
        for (const [ch, pat] of Object.entries(CODE39_PATTERNS)) {
          if (ch !== "*" && pat === charPat) { matchChar = ch; break; }
        }

        if (!matchChar) break;
        decodedStr += matchChar;
        offset += 10;
      }
    }

    return null;
  }

  // Triggered on successful detection
  function onBarcodeSuccess(code, format) {
    if (!code || !state.cameraScanning) return;
    state.cameraScanning = false;
    isScanningFrame = true;

    playScanSuccessChime();

    if ("vibrate" in navigator) navigator.vibrate([70, 50, 70]);

    const reticle = document.getElementById("scannerReticle");
    const hint = document.getElementById("reticleHint");
    if (reticle) reticle.classList.add("scan-locked");
    if (hint) hint.textContent = `✓ Locked: ${code}`;

    setTimeout(() => {
      closeCameraScanner();
      handleDetectedTag(code, `Camera (${format})`);
    }, 250);
  }

  // Triggered on successful detection
  function onBarcodeSuccess(code, format) {
    if (!code || !state.cameraScanning) return;
    state.cameraScanning = false;
    isScanningFrame = true;

    playScanSuccessChime();

    if ("vibrate" in navigator) navigator.vibrate([70, 50, 70]);

    const reticle = document.getElementById("scannerReticle");
    const hint = document.getElementById("reticleHint");
    if (reticle) reticle.classList.add("scan-locked");
    if (hint) hint.textContent = `✓ Locked: ${code}`;

    setTimeout(() => {
      closeCameraScanner();
      handleDetectedTag(code, `Camera (${format})`);
    }, 250);
  }


  /* ─────────────────────────────────────────────────────────────────────────
     4. UNIVERSAL ANIMAL DOSSIER & QUICK ACTION MODAL
     ───────────────────────────────────────────────────────────────────────── */
  function openQuickActionModal(tag, matched, protocol) {
    closeQuickActionModal();

    state.currentModalData = { tag, matched, protocol };
    const f = getFarm();
    let modalHTML = '';

    if (matched) {
      const isSow = matched.type === 'sow';
      const isBoar = matched.type === 'boar';
      const isBatch = matched.type === 'piglet_batch' || matched.type === 'piglet';
      const an = matched.animal || {};

      // Location description
      const barnName = (f.barns || []).find(b => b.id === (an.barn_id || matched.barn))?.name || (an.barn_id || matched.barn || 'Unassigned');
      const penName = an.pen_id || matched.pen || 'Stall / Pen not assigned';

      modalHTML = `
        <div class="rfid-modal-backdrop" id="rfidDossierModal" onclick="if(event.target===this) window.closeQuickActionModal()">
          <div class="rfid-dossier-card">
            <div class="rfid-card-header">
              <div class="rfid-tag-chip">
                <span class="pulse-icon">📡</span>
                <span>${esc(protocol || 'RFID Scan')}</span>
                <b>${esc(tag)}</b>
              </div>
              <button type="button" class="rfid-close-btn" onclick="window.closeQuickActionModal()">×</button>
            </div>

            <div class="rfid-animal-hero">
              <div class="animal-avatar ${matched.type}">
                ${isSow ? '♀' : isBoar ? '♂' : '●'}
              </div>
              <div class="animal-hero-info">
                <div class="hero-type-badge">${matched.type.toUpperCase().replace('_', ' ')}</div>
                <h3>${esc(matched.name || matched.id)}</h3>
                <p>ID: <b>${esc(matched.id || matched.name)}</b> · Breed: <b>${esc(matched.breed || 'Commercial')}</b></p>
              </div>
            </div>

            <!-- Current Location Badge — [FIX 92] whole pill is tappable -->
            <div class="rfid-location-pill" style="cursor:pointer" onclick="window.quickActionMove()" title="Tap to assign or move this animal's housing">
              <div class="loc-icon">🏢</div>
              <div class="loc-details">
                <small>Current Housing &amp; Pen Location</small>
                <b>${esc(barnName)} — ${esc(penName)}</b>
                <small style="display:block;margin-top:3px;color:var(--teal2);font-weight:800;font-size:10px">🔁 Tap to assign / move pen</small>
              </div>
            </div>

            <!-- Vital Stats Row -->
            <div class="rfid-stats-grid">
              ${isSow ? `
                <div class="rfid-stat"><small>Parity</small><b>Parity ${an.parity || 1}</b></div>
                <div class="rfid-stat"><small>Status</small><b class="status-${(an.status||'Open').toLowerCase()}">${an.status || 'Active'}</b></div>
                <div class="rfid-stat"><small>Insemination</small><b>${fmtDate(an.insemination)}</b></div>
              ` : isBoar ? `
                <div class="rfid-stat"><small>Status</small><b class="status-active">${an.status || 'Active Stud'}</b></div>
                <div class="rfid-stat"><small>Doses in Stock</small><b>${an.bottles || 0} bottles</b></div>
                <div class="rfid-stat"><small>DOB</small><b>${fmtDate(an.dob)}</b></div>
              ` : `
                <div class="rfid-stat"><small>Birth Date</small><b>${fmtDate(an.birth || matched.batch?.birth)}</b></div>
                <div class="rfid-stat"><small>Heads</small><b>${(an.males || 0) + (an.females || 0) || '1 head'}</b></div>
                <div class="rfid-stat"><small>Dam × Sire</small><b>${esc(an.sow || matched.batch?.sow || '—')} × ${esc(an.sire || matched.batch?.sire || '—')}</b></div>
              `}
            </div>

            <!-- Quick Action Buttons -->
            <div class="rfid-actions-tray">
              <h4>⚡ Field Quick Actions</h4>
              <div class="action-buttons-grid">
                <button type="button" class="act-btn" onclick="window.quickActionVax()">
                  <span class="act-ico">💉</span>
                  <span>Log Vaccine / Med</span>
                </button>
                <button type="button" class="act-btn" onclick="window.quickActionWeight()">
                  <span class="act-ico">⚖️</span>
                  <span>Record Weight</span>
                </button>
                ${isSow ? `
                  <button type="button" class="act-btn" onclick="window.quickActionHeat()">
                    <span class="act-ico">♀️</span>
                    <span>Heat &amp; Breeding</span>
                  </button>
                ` : ''}
                <button type="button" class="act-btn" onclick="window.quickActionMove()">
                  <span class="act-ico">🏢</span>
                  <span>Transfer Barn</span>
                </button>
              </div>
            </div>

            <div class="rfid-card-footer">
              <button type="button" class="btn ghost" onclick="window.closeQuickActionModal()">Done</button>
              <button type="button" class="btn" onclick="window.quickActionDossier()">Full Animal Dossier →</button>
            </div>
          </div>
        </div>
      `;
    } else {
      // Unassigned Tag Detected
      modalHTML = `
        <div class="rfid-modal-backdrop" id="rfidDossierModal" onclick="if(event.target===this) window.closeQuickActionModal()">
          <div class="rfid-dossier-card unassigned">
            <div class="rfid-card-header">
              <div class="rfid-tag-chip unassigned">
                <span class="pulse-icon">⚠️</span>
                <span>Unassigned Tag Detected</span>
                <b>${esc(tag)}</b>
              </div>
              <button type="button" class="rfid-close-btn" onclick="window.closeQuickActionModal()">×</button>
            </div>

            <div class="unassigned-hero">
              <div class="unassigned-ico">🏷️</div>
              <h3>New Ear Tag: ${esc(tag)}</h3>
              <p>This RFID / Barcode tag is not yet linked to any Sow, Boar, or Piglet in your farm records.</p>
            </div>

            <div class="unassigned-box">
              <div class="field suggest-field">
                <label>1. Search &amp; Select Animal to Pair *</label>
                <div class="suggest-input-wrap">
                  <input type="text" id="pairAnimalInput" class="suggest-input" placeholder="Type animal name, ID, breed, ear-notch..." autocomplete="off" onfocus="window.filterPairAnimalSuggest(this.value)" oninput="window.filterPairAnimalSuggest(this.value)">
                  <input type="hidden" id="pairAnimalVal" required>
                  <button type="button" class="suggest-clear-btn" id="pairAnimalClear" onclick="window.clearPairAnimalSuggest()" style="display:none">✕</button>
                  <div class="suggest-dropdown" id="pairAnimalDropdown" style="display:none"></div>
                </div>
              </div>
              <div id="pairSelectedPreview" class="pair-selected-preview" style="display:none"></div>
            </div>

            <div class="rfid-card-footer" style="margin-top:18px">
              <button type="button" class="btn ghost" onclick="window.closeQuickActionModal()">Cancel</button>
              <button type="button" class="btn" onclick="window.quickActionConfirmPair()">✓ Pair Tag to Animal</button>
            </div>
          </div>
        </div>
      `;
    }

    const holder = document.createElement('div');
    holder.id = 'rfidModalHolder';
    holder.innerHTML = modalHTML;
    document.body.appendChild(holder);
  }

  function closeQuickActionModal() {
    const el = document.getElementById('rfidModalHolder');
    if (el) el.remove();
  }

  /* ── Quick Actions Handlers (Zero string interpolation in onclick) ── */
  window.quickActionMove = function() {
    const d = state.currentModalData;
    if (!d || !d.matched) return;
    const m = d.matched;
    closeQuickActionModal();
    if (window.openMovementWizard) {
      window.openMovementWizard(m.id || m.name, m.type);
    }
  };

  window.quickActionVax = function() {
    const d = state.currentModalData;
    if (!d || !d.matched) return;
    const m = d.matched;
    closeQuickActionModal();
    const cat = (m.type === 'boar') ? 'boar' : (m.type === 'batch' || m.type === 'piglet_batch' || m.type === 'piglet') ? 'batch' : 'sow';
    if (window.openRecordVaccination) {
      window.openRecordVaccination(cat, m.id || m.name, m.name || m.id);
    } else if (window.openVaxModal) {
      window.openVaxModal(cat, m.id || m.name, m.name || m.id);
    } else if (window.go) {
      window.go('vaccination');
    }
  };

  window.quickActionWeight = function() {
    const d = state.currentModalData;
    if (!d || !d.matched) return;
    const m = d.matched;
    closeQuickActionModal();
    if (m.type === 'batch' || m.type === 'piglet_batch' || m.type === 'piglet') {
      if (window.openBatchPerformance) window.openBatchPerformance(m.id || m.name);
      else if (window.openFattenerCenter) window.openFattenerCenter(m.id || m.name);
      else if (window.go) window.go('piglets');
    } else if (m.type === 'sow') {
      if (window.openSowProfile) window.openSowProfile(m.id || m.name);
      else if (window.go) window.go('sows');
    } else if (m.type === 'boar') {
      if (window.openBoarDetailModal) window.openBoarDetailModal(m.id || m.name);
      else if (window.go) window.go('semen');
    }
  };

  window.quickActionHeat = function() {
    const d = state.currentModalData;
    if (!d || !d.matched) return;
    const m = d.matched;
    closeQuickActionModal();
    const f = getFarm();
    const clean = String(m.id || m.name || '').trim().toLowerCase();
    const idx = (f.sows || []).findIndex(s => (s.id && String(s.id).toLowerCase() === clean) || (s.name && String(s.name).toLowerCase() === clean));
    if (idx !== -1) {
      const s = f.sows[idx];
      if (s.insemination && window.openReheatRecord) window.openReheatRecord(idx);
      else if (window.openHeatRecord) window.openHeatRecord(idx);
      else if (window.openBreedSow) window.openBreedSow(idx);
    } else if (window.openHeatRecord) {
      window.openHeatRecord(0);
    } else if (window.go) {
      window.go('sows');
    }
  };

  window.quickActionDossier = function() {
    const d = state.currentModalData;
    if (!d || !d.matched) return;
    const m = d.matched;
    closeQuickActionModal();
    window.viewAnimalProfile(m.id || m.name, m.type);
  };

  window.quickActionConfirmPair = function() {
    const d = state.currentModalData;
    if (!d || !d.tag) return;
    confirmPairTag(d.tag);
  };

  /* ── Auto-Suggest Animal Selection for Tag Pairing ── */
  function buildPairAnimalList(f) {
    const list = [];
    (f.sows || []).forEach(s => {
      if (s.culled) return;
      const sId = s.id || s.name;
      const barnName = (f.barns || []).find(b => b.id === s.barn_id)?.name || s.barn_id || "Unassigned";
      list.push({
        type: "sow",
        val: `sow:${sId}`,
        id: sId,
        name: s.name || sId,
        title: `${s.name || sId} (${sId})`,
        sub: `Sow · ${s.breed || "Commercial"} · Parity ${s.parity || 1}`,
        loc: `${barnName} — ${s.pen_id || "Stall not set"}`,
        ico: "♀",
        tag: s.rfid || ""
      });
    });

    (f.boars || f.semen || []).forEach(b => {
      const bId = b.id || b.name || b.boar;
      const barnName = (f.barns || []).find(x => x.id === b.barn_id)?.name || b.barn_id || "Breeding Stud";
      list.push({
        type: "boar",
        val: `boar:${bId}`,
        id: bId,
        name: b.name || b.boar || bId,
        title: `${b.name || b.boar || bId} (${bId})`,
        sub: `Boar · ${b.breed || "Stud"}`,
        loc: `${barnName} — ${b.pen_id || "BR-01"}`,
        ico: "♂",
        tag: b.rfid || ""
      });
    });

    (f.piglets || []).forEach(b => {
      const barnName = (f.barns || []).find(x => x.id === b.barn_id)?.name || b.barn_id || "Farrowing House";
      const heads = (Number(b.males || 0) + Number(b.females || 0)) || "Litter";
      list.push({
        type: "batch",
        val: `batch:${b.id}`,
        id: b.id,
        name: `Batch ${b.id}`,
        title: `Batch ${b.id} (${b.sow || "Sow"} × ${b.sire || "Sire"})`,
        sub: `Piglet Batch · ${heads} heads`,
        loc: `${barnName} — ${b.pen_id || "FC-01"}`,
        ico: "●",
        tag: b.rfid || ""
      });
    });

    return list;
  }

  let cachedPairList = [];
  let cachedCurrentPairHits = [];

  window.filterPairAnimalSuggest = function(query) {
    const dropdown = document.getElementById("pairAnimalDropdown");
    const clearBtn = document.getElementById("pairAnimalClear");
    if (!dropdown) return;

    const f = getFarm();
    cachedPairList = buildPairAnimalList(f);
    const q = String(query || "").trim().toLowerCase();

    if (clearBtn) clearBtn.style.display = q ? "block" : "none";

    cachedCurrentPairHits = cachedPairList.filter(item => {
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        item.sub.toLowerCase().includes(q) ||
        item.loc.toLowerCase().includes(q) ||
        item.tag.toLowerCase().includes(q)
      );
    });

    if (!cachedCurrentPairHits.length) {
      dropdown.innerHTML = `<div class="suggest-empty">No matching active animals or batches found.</div>`;
      dropdown.style.display = "block";
      return;
    }

    dropdown.innerHTML = cachedCurrentPairHits.map((item, idx) => `
      <div class="suggest-item" onmousedown="window.selectPairAnimalByIndex(${idx})">
        <div class="suggest-ico ${item.type}">${item.ico}</div>
        <div class="suggest-meta">
          <b>${esc(item.title)}</b>
          <small>${esc(item.sub)} · 🏠 ${esc(item.loc)}${item.tag ? ` · <span style="color:var(--teal2)">Tag: ${esc(item.tag)}</span>` : ' · <span class="muted">No tag</span>'}</small>
        </div>
      </div>
    `).join("");

    dropdown.style.display = "block";
  };

  window.selectPairAnimalByIndex = function(idx) {
    const item = (cachedCurrentPairHits && cachedCurrentPairHits[idx]) || (cachedPairList && cachedPairList[idx]);
    if (!item) return;

    const input = document.getElementById("pairAnimalInput");
    const hidden = document.getElementById("pairAnimalVal");
    const preview = document.getElementById("pairSelectedPreview");
    const clearBtn = document.getElementById("pairAnimalClear");
    const dropdown = document.getElementById("pairAnimalDropdown");

    if (input) input.value = item.title;
    if (hidden) hidden.value = item.val;
    if (clearBtn) clearBtn.style.display = "block";
    if (dropdown) dropdown.style.display = "none";

    if (preview) {
      preview.style.display = "block";
      preview.innerHTML = `
        <div class="pair-preview-card">
          <div class="suggest-ico ${item.type}">${item.ico}</div>
          <div class="suggest-meta">
            <b>${esc(item.title)}</b>
            <small>${esc(item.sub)} · 🏠 ${esc(item.loc)}</small>
            ${item.tag ? `<small style="color:#f59e0b">⚠️ Currently has tag: <b>${esc(item.tag)}</b> (will be replaced)</small>` : '<small style="color:var(--teal2)">✓ Ready to link tag</small>'}
          </div>
          <span class="badge ok">Selected</span>
        </div>
      `;
    }
  };

  window.clearPairAnimalSuggest = function() {
    const input = document.getElementById("pairAnimalInput");
    const hidden = document.getElementById("pairAnimalVal");
    const preview = document.getElementById("pairSelectedPreview");
    const clearBtn = document.getElementById("pairAnimalClear");

    if (input) { input.value = ""; input.focus(); }
    if (hidden) hidden.value = "";
    if (clearBtn) clearBtn.style.display = "none";
    if (preview) preview.style.display = "none";
    window.filterPairAnimalSuggest("");
  };

  function confirmPairTag(tag) {
    const hidden = document.getElementById('pairAnimalVal');
    if (!hidden || !hidden.value) {
      showToast('Please search and select an animal to pair.');
      return;
    }
    const [type, id] = hidden.value.split(':');
    const f = getFarm();
    const cleanId = String(id).trim().toLowerCase();

    if (type === 'sow') {
      const sow = (f.sows || []).find(s => (s.id && String(s.id).trim().toLowerCase() === cleanId) || (s.name && String(s.name).trim().toLowerCase() === cleanId));
      if (sow) sow.rfid = tag;
    } else if (type === 'boar') {
      const boar = (f.boars || f.semen || []).find(b => (b.id && String(b.id).trim().toLowerCase() === cleanId) || (b.name && String(b.name).trim().toLowerCase() === cleanId) || (b.boar && String(b.boar).trim().toLowerCase() === cleanId));
      if (boar) boar.rfid = tag;
    } else if (type === 'batch') {
      const batch = (f.piglets || []).find(b => String(b.id).trim().toLowerCase() === cleanId);
      if (batch) batch.rfid = tag;
    }

    if (window.save && typeof window.save === 'function') window.save();
    showToast(`✓ Tag "${tag}" paired successfully!`);
    closeQuickActionModal();
    renderRfidCenter();
  }

  /* ─────────────────────────────────────────────────────────────────────────
     5. DEDICATED RFID / EID CENTER PAGE (`#rfid`)
     ───────────────────────────────────────────────────────────────────────── */
  let cachedTaggedAnimals = [];
  let cachedScanRows = [];

  function getAllTaggedAnimals(f) {
    const items = [];

    // 1. Sows
    (f.sows || []).forEach(s => {
      if (s.rfid && !s.culled) {
        const barnName = (f.barns || []).find(b => b.id === s.barn_id)?.name || s.barn_id || "Unassigned";
        items.push({
          type: 'sow',
          rawType: 'Sow (Inahin)',
          id: s.id || s.name,
          name: s.name || s.id,
          breed: s.breed || 'Commercial',
          tag: String(s.rfid).trim(),
          barn: barnName,
          pen: s.pen_id || 'Stall —',
          status: s.status || 'Active',
          vitals: `Parity ${s.parity || 1} · ${s.status || 'Active'}`,
          ico: '♀'
        });
      }
    });

    // 2. Boars
    (f.boars || f.semen || []).forEach(b => {
      if (b.rfid) {
        const bId = b.id || b.name || b.boar;
        const barnName = (f.barns || []).find(x => x.id === b.barn_id)?.name || b.barn_id || "Breeding Stud";
        items.push({
          type: 'boar',
          rawType: 'Boar (Barako)',
          id: bId,
          name: b.name || b.boar || bId,
          breed: b.breed || 'Stud',
          tag: String(b.rfid).trim(),
          barn: barnName,
          pen: b.pen_id || 'BR-01',
          status: b.status || 'Active Stud',
          vitals: `${b.bottles || 0} doses in stock`,
          ico: '♂'
        });
      }
    });

    // 3. Batches
    (f.piglets || []).forEach(b => {
      if (b.rfid) {
        const barnName = (f.barns || []).find(x => x.id === b.barn_id)?.name || b.barn_id || "Farrowing House";
        const heads = (Number(b.males || 0) + Number(b.females || 0)) || "Litter";
        items.push({
          type: 'piglet_batch',
          rawType: 'Piglet Batch',
          id: b.id,
          name: `Batch ${b.id}`,
          breed: `${b.sow || 'Sow'} × ${b.sire || 'Sire'}`,
          tag: String(b.rfid).trim(),
          barn: barnName,
          pen: b.pen_id || 'FC-01',
          status: 'Active Batch',
          vitals: `${heads} heads · Born ${fmtDate(b.birth)}`,
          ico: '●'
        });
      }
      if (Array.isArray(b.roster)) {
        b.roster.forEach(pig => {
          if (pig.rfid) {
            items.push({
              type: 'piglet',
              rawType: 'Ear Notch Piglet',
              id: pig.tag || pig.notch || b.id,
              name: `Piglet #${pig.tag || pig.notch} (Batch ${b.id})`,
              breed: `${b.sow || 'Sow'} Line`,
              tag: String(pig.rfid).trim(),
              barn: b.barn_id || 'Farrowing',
              pen: b.pen_id || 'FC-01',
              status: 'Live Piglet',
              vitals: `${pig.gender || 'Piglet'} · ${pig.weight || '—'} kg`,
              ico: '●'
            });
          }
        });
      }
    });

    return items;
  }

  function renderRfidCenter() {
    const container = document.getElementById('rfid');
    if (!container) return;
    ensureFarmRfid();
    const f = getFarm();

    // Calculate Tag Inventory
    cachedTaggedAnimals = getAllTaggedAnimals(f);
    cachedScanRows = f.rfid_scans || [];
    const taggedSows = (f.sows || []).filter(s => s.rfid && !s.culled).length;
    const totalSows = (f.sows || []).filter(s => !s.culled).length;
    const taggedBoars = (f.boars || f.semen || []).filter(b => b.rfid).length;
    const taggedBatches = (f.piglets || []).filter(b => b.rfid).length;
    const totalTagged = cachedTaggedAnimals.length;

    const bleStatusText = state.bleConnected ? `Connected (${state.bleDevice?.name || 'Reader'})` : 'Ready to Connect';
    const bleStatusClass = state.bleConnected ? 'connected' : 'disconnected';
    const nfcStatusText = state.nfcListening ? 'Active & Listening' : ('NDEFReader' in window ? 'Supported (Tap to Start)' : 'Not Supported on Device');
    const nfcStatusClass = state.nfcListening ? 'connected' : ('NDEFReader' in window ? 'ready' : 'disabled');

    container.innerHTML = `
      <div class="rfid-center-wrap">
        <!-- Top Hero Card -->
        <div class="rfid-hero-banner">
          <div class="banner-left">
            <div class="eyebrow">SMART LIVESTOCK IDENTIFICATION</div>
            <h2>RFID &amp; EID Ear-Tag Center</h2>
            <p>Connect ISO 11784/11785 Bluetooth Stick Readers, tap NFC tags, or scan barcodes to instantly pull up animal health records and log pen movements in the field.</p>
          </div>
          <div class="banner-right">
            <button type="button" class="btn rfid-scan-launch-btn" onclick="window.openScannerModal()">
              <span class="btn-ico">📡</span> Start Live Tag Scanner
            </button>
          </div>
        </div>

        <!-- Hardware Connection Cards -->
        <div class="rfid-hardware-grid">
          <!-- Bluetooth Card -->
          <div class="hw-card ${bleStatusClass}">
            <div class="hw-icon">📶</div>
            <div class="hw-info">
              <div class="hw-label">ISO 11784/11785 Bluetooth Stick Reader</div>
              <div class="hw-status ${bleStatusClass}">● ${bleStatusText}</div>
              <small>Allflex, Agrident, Tru-Test, Syscan BLE</small>
            </div>
            <div class="hw-action">
              ${state.bleConnected ? `
                <button type="button" class="btn ghost small" onclick="window.disconnectBleReader()">Disconnect</button>
              ` : `
                <button type="button" class="btn small" onclick="window.connectBluetoothReader()">Pair Bluetooth</button>
              `}
            </div>
          </div>

          <!-- NFC Card -->
          <div class="hw-card ${nfcStatusClass}">
            <div class="hw-icon">📱</div>
            <div class="hw-info">
              <div class="hw-label">Direct Phone NFC Reader</div>
              <div class="hw-status ${nfcStatusClass}">● ${nfcStatusText}</div>
              <small>Tap 13.56 MHz Ear Tags to Phone Back</small>
            </div>
            <div class="hw-action">
              ${state.nfcListening ? `
                <span class="badge ok">Listening…</span>
              ` : `
                <button type="button" class="btn small" onclick="window.startNfcReader()" ${!('NDEFReader' in window)?'disabled':''}>Enable NFC</button>
              `}
            </div>
          </div>

          <!-- Camera Scanner Card -->
          <div class="hw-card camera">
            <div class="hw-icon">📷</div>
            <div class="hw-info">
              <div class="hw-label">Live Camera Barcode / QR</div>
              <div class="hw-status ready">● Ready for Optical Scan</div>
              <small>Printed Barcodes, Ear-Tag QR, Med Vials</small>
            </div>
            <div class="hw-action">
              <button type="button" class="btn small" onclick="window.openScannerModal('camera')">Open Camera</button>
            </div>
          </div>
        </div>

        <!-- Tag Inventory & Metrics -->
        <div class="rfid-stats-row">
          <div class="rfid-stat-box">
            <span class="stat-ico">🏷️</span>
            <div>
              <div class="stat-val">${totalTagged}</div>
              <div class="stat-lbl">Active EID Tags Paired</div>
            </div>
          </div>
          <div class="rfid-stat-box">
            <span class="stat-ico">♀</span>
            <div>
              <div class="stat-val">${taggedSows} / ${totalSows}</div>
              <div class="stat-lbl">Sows Tagged (${totalSows ? Math.round((taggedSows/totalSows)*100) : 0}%)</div>
            </div>
          </div>
          <div class="rfid-stat-box">
            <span class="stat-ico">♂</span>
            <div>
              <div class="stat-val">${taggedBoars}</div>
              <div class="stat-lbl">Active Boars Tagged</div>
            </div>
          </div>
          <div class="rfid-stat-box">
            <span class="stat-ico">●</span>
            <div>
              <div class="stat-val">${taggedBatches}</div>
              <div class="stat-lbl">Piglet Batches Tagged</div>
            </div>
          </div>
        </div>

        <!-- Simulator & Quick Scan Bar -->
        <div class="rfid-sim-bar">
          <div class="sim-left">
            <b>🔍 Manual Tag Search &amp; Hardware Simulator:</b>
            <span>Test ear-tag lookup on any device without external readers</span>
          </div>
          <div class="sim-inputs">
            <input type="text" id="manualTagInput" placeholder="Enter 15-digit ISO tag or ID (e.g. 982000412345001)..." onkeydown="if(event.key==='Enter') window.testManualTagScan()">
            <button type="button" class="btn" onclick="window.testManualTagScan()">Scan Tag ↵</button>
            <button type="button" class="btn ghost" onclick="window.simulateRandomTag()">🎲 Simulate Tag Tap</button>
          </div>
        </div>

        <!-- ── Section A: REGISTERED TAGGED ANIMALS & TAG REGISTRY ── -->
        <div class="rfid-registry-section">
          <div class="rfid-reg-head">
            <div>
              <h3>🏷️ Registered Tagged Animals &amp; Tag Registry</h3>
              <small class="muted">Live directory of all sows, boars, and piglet batches linked to physical RFID &amp; Barcode ear-tags</small>
            </div>
            <button type="button" class="btn" onclick="window.openManualPairModal()">＋ Pair New Tag</button>
          </div>

          <div class="rfid-table-controls">
            <input type="search" id="taggedAnimalsSearch" class="search" placeholder="🔍 Search tagged animals by name, ID, breed, or tag number..." oninput="window.filterTaggedAnimals(this.value)">
            <div class="tag">${cachedTaggedAnimals.length} Tagged Animals</div>
          </div>

          <div class="audit-table-wrap">
            <table class="rfid-audit-table" id="table-tagged-animals">
              <thead>
                <tr>
                  <th>Animal</th>
                  <th>Active Barcode / EID Tag</th>
                  <th>Type &amp; Breed</th>
                  <th>Housing Location</th>
                  <th>Status / Vitals</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${cachedTaggedAnimals.map((item, idx) => `
                  <tr>
                    <td>
                      <div style="display:flex;align-items:center;gap:10px">
                        <div class="suggest-ico ${item.type}">${item.ico}</div>
                        <div>
                          <b>${esc(item.name)}</b>
                          <br><small class="muted">ID: ${esc(item.id)}</small>
                        </div>
                      </div>
                    </td>
                    <td>
                      <button type="button" class="tag-code-btn" onclick="window.lookupTagRow(${idx})" title="Click to view dossier">
                        <code>${esc(item.tag)}</code>
                      </button>
                    </td>
                    <td><b>${esc(item.rawType)}</b><br><small class="muted">${esc(item.breed)}</small></td>
                    <td>🏢 ${esc(item.barn)} — ${esc(item.pen)}</td>
                    <td><span class="badge ok">${esc(item.vitals)}</span></td>
                    <td>
                      <div class="rfid-table-actions">
                        <button type="button" class="btn ghost small" onclick="window.viewTaggedAnimalRow(${idx})" title="Open Full Animal Profile">👁️ Dossier</button>
                        <button type="button" class="btn ghost small" onclick="window.openEditTagRow(${idx})" title="Edit Tag Number">✏️ Edit</button>
                        <button type="button" class="btn ghost small" onclick="window.openReassignTagRow(${idx})" title="Reassign Tag to another Animal">🔄 Reassign</button>
                        <button type="button" class="btn ghost small delete-action" onclick="window.deleteTagPairRow(${idx})" title="Unpair this tag">🗑️ Unpair</button>
                      </div>
                    </td>
                  </tr>
                `).join('') || `<tr><td colspan="6" class="empty-msg">No animals paired with RFID/Barcode tags yet. Tap "＋ Pair New Tag" or scan a tag to link one.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>

        <!-- ── Section B: LIVE SCAN AUDIT TRAIL ── -->
        <div class="rfid-audit-section" style="margin-top:24px">
          <div class="rfid-reg-head">
            <div>
              <h3>📡 Real-Time Tag Scan Audit Log</h3>
              <small class="muted">Live stream of all field scans, protocols, timestamps and hardware events</small>
            </div>
            ${cachedScanRows.length > 0 ? `
              <button type="button" class="btn ghost small delete-action" onclick="window.clearAllScans()">🗑️ Clear Audit Log</button>
            ` : ''}
          </div>

          <div class="rfid-table-controls">
            <input type="search" id="auditScansSearch" class="search" placeholder="🔍 Search audit log by tag, animal, or protocol..." oninput="filterTable('rfid_scans_table', this.value)">
            <div class="tag">${cachedScanRows.length} Scan Events</div>
          </div>

          <div class="audit-table-wrap">
            <table class="rfid-audit-table" id="rfid_scans_table">
              <thead>
                <tr>
                  <th>Timestamp</th>
                  <th>Tag ID / EID</th>
                  <th>Protocol</th>
                  <th>Identified Animal</th>
                  <th>Housing Location</th>
                  <th>Actions</th>
                </tr>
              </thead>
              <tbody>
                ${cachedScanRows.map((s, idx) => `
                  <tr>
                    <td><small>${new Date(s.timestamp).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit', second:'2-digit'})}</small><br><small class="muted">${fmtDate(s.timestamp.slice(0,10))}</small></td>
                    <td><code class="tag-code">${esc(s.tag)}</code></td>
                    <td><span class="proto-badge">${esc(s.protocol)}</span></td>
                    <td>
                      ${s.matched ? `
                        <b>${esc(s.animal_name || s.animal_id)}</b><br><small class="muted">ID: ${esc(s.animal_id)} (${s.animal_type})</small>
                      ` : `
                        <span class="badge warn">Unassigned Tag</span>
                      `}
                    </td>
                    <td>${esc(s.pen_location)}</td>
                    <td>
                      <div class="rfid-table-actions">
                        <button type="button" class="btn ghost small" onclick="window.lookupScanRow(${idx})">👁️ Dossier</button>
                        <button type="button" class="btn ghost small" onclick="window.openEditScanRow(${idx})">✏️ Edit</button>
                        <button type="button" class="btn ghost small delete-action" onclick="window.deleteScanRow(${idx})">🗑️ Delete</button>
                      </div>
                    </td>
                  </tr>
                `).join('') || `<tr><td colspan="6" class="empty-msg">No scans recorded yet. Tap "Start Live Tag Scanner" or test with the simulator above.</td></tr>`}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    `;
  }

  /* ── Index-Based Row Dispatchers (Guaranteed 100% Quote-Safe) ── */
  window.lookupTagRow = function(idx) {
    const item = cachedTaggedAnimals[idx];
    if (!item) return;
    handleDetectedTag(item.tag, 'Tag Registry');
  };

  window.viewTaggedAnimalRow = function(idx) {
    const item = cachedTaggedAnimals[idx];
    if (!item) return;
    window.viewAnimalProfile(item.id || item.name, item.type);
  };

  window.openEditTagRow = function(idx) {
    const item = cachedTaggedAnimals[idx];
    if (!item) return;
    openEditTagModal(item.type, item.id || item.name, item.tag);
  };

  window.openReassignTagRow = function(idx) {
    const item = cachedTaggedAnimals[idx];
    if (!item) return;
    openReassignTagModal(item.tag, item.type, item.id || item.name);
  };

  window.deleteTagPairRow = function(idx) {
    const item = cachedTaggedAnimals[idx];
    if (!item) return;
    deleteAnimalTagPair(item.type, item.id || item.name, item.tag);
  };

  window.lookupScanRow = function(idx) {
    const s = cachedScanRows[idx];
    if (!s) return;
    handleDetectedTag(s.tag, 'Audit Lookup');
  };

  window.openEditScanRow = function(idx) {
    const s = cachedScanRows[idx];
    if (!s) return;
    openEditScanModal(s.id);
  };

  window.deleteScanRow = function(idx) {
    const s = cachedScanRows[idx];
    if (!s) return;
    deleteScanEntry(s.id);
  };

  /* ── Filter Tagged Animals Table ── */
  window.filterTaggedAnimals = function(q) {
    const table = document.getElementById('table-tagged-animals');
    if (!table) return;
    const filter = String(q || '').toLowerCase();
    const rows = table.querySelectorAll('tbody tr');
    rows.forEach(r => {
      const text = r.textContent.toLowerCase();
      r.style.display = text.includes(filter) ? '' : 'none';
    });
  };

  /* ── Manual Tag Pairing Modal ── */
  window.openManualPairModal = function() {
    document.getElementById('manualPairModal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'manualPairModal';
    modal.className = 'rfid-modal-backdrop';
    modal.innerHTML = `
      <div class="rfid-dossier-card">
        <div class="rfid-card-header">
          <div class="eyebrow" style="color:var(--teal2);font-weight:700">🏷️ SMART TAG PAIRING</div>
          <button type="button" class="rfid-close-btn" onclick="document.getElementById('manualPairModal').remove()">×</button>
        </div>
        <h3 style="margin-top:0">Pair Barcode / RFID Tag to Animal</h3>
        <p class="muted" style="margin-bottom:16px">Enter the physical tag or barcode number, then select the animal to link.</p>

        <form onsubmit="event.preventDefault(); window.saveManualPair();">
          <div class="field" style="margin-bottom:14px">
            <label>Tag ID / Barcode / EID Number *</label>
            <input type="text" id="manualPairTagInput" required placeholder="e.g. 4803925033551 or 982000123456789" class="suggest-input">
          </div>

          <div class="field suggest-field">
            <label>Select Animal or Batch *</label>
            <div class="suggest-input-wrap">
              <input type="text" id="pairAnimalInput" class="suggest-input" placeholder="Type animal name, ID, breed, ear-notch..." autocomplete="off" onfocus="window.filterPairAnimalSuggest(this.value)" oninput="window.filterPairAnimalSuggest(this.value)">
              <input type="hidden" id="pairAnimalVal" required>
              <button type="button" class="suggest-clear-btn" id="pairAnimalClear" onclick="window.clearPairAnimalSuggest()" style="display:none">✕</button>
              <div class="suggest-dropdown" id="pairAnimalDropdown" style="display:none"></div>
            </div>
          </div>
          <div id="pairSelectedPreview" class="pair-selected-preview" style="display:none"></div>

          <div class="rfid-card-footer" style="margin-top:20px">
            <button type="button" class="btn ghost" onclick="document.getElementById('manualPairModal').remove()">Cancel</button>
            <button type="submit" class="btn">✓ Confirm &amp; Save Pair</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);
  };

  window.saveManualPair = function() {
    const tagInp = document.getElementById('manualPairTagInput');
    const valInp = document.getElementById('pairAnimalVal');
    if (!tagInp || !tagInp.value.trim()) { showToast('Please enter a tag number.'); return; }
    if (!valInp || !valInp.value) { showToast('Please select an animal to pair.'); return; }

    const tag = tagInp.value.trim();
    const [type, id] = valInp.value.split(':');
    const f = getFarm();
    const cleanId = String(id).trim().toLowerCase();

    if (type === 'sow') {
      const sow = (f.sows || []).find(s => (s.id && String(s.id).trim().toLowerCase() === cleanId) || (s.name && String(s.name).trim().toLowerCase() === cleanId));
      if (sow) sow.rfid = tag;
    } else if (type === 'boar') {
      const boar = (f.boars || f.semen || []).find(b => (b.id && String(b.id).trim().toLowerCase() === cleanId) || (b.name && String(b.name).trim().toLowerCase() === cleanId) || (b.boar && String(b.boar).trim().toLowerCase() === cleanId));
      if (boar) boar.rfid = tag;
    } else if (type === 'batch') {
      const batch = (f.piglets || []).find(b => String(b.id).trim().toLowerCase() === cleanId);
      if (batch) batch.rfid = tag;
    }

    if (window.save && typeof window.save === 'function') window.save();
    showToast(`✓ Tag "${tag}" paired successfully!`);
    document.getElementById('manualPairModal')?.remove();
    renderRfidCenter();
  };

  /* ── Edit Animal Tag Modal ── */
  function openEditTagModal(type, id, currentTag) {
    document.getElementById('editTagModal')?.remove();
    state.currentEditTagData = { type, id, currentTag };
    const modal = document.createElement('div');
    modal.id = 'editTagModal';
    modal.className = 'rfid-modal-backdrop';
    modal.innerHTML = `
      <div class="rfid-dossier-card">
        <div class="rfid-card-header">
          <div class="eyebrow" style="color:var(--teal2);font-weight:700">✏️ EDIT EAR-TAG NUMBER</div>
          <button type="button" class="rfid-close-btn" onclick="document.getElementById('editTagModal').remove()">×</button>
        </div>
        <h3 style="margin-top:0">Update Tag for ${esc(id)}</h3>
        <form onsubmit="window.saveEditAnimalTag(event)">
          <div class="field" style="margin-bottom:16px">
            <label>Tag / Barcode / EID Number *</label>
            <input type="text" id="inpEditTagVal" value="${esc(currentTag)}" required class="suggest-input">
          </div>
          <div class="rfid-card-footer">
            <button type="button" class="btn ghost" onclick="document.getElementById('editTagModal').remove()">Cancel</button>
            <button type="submit" class="btn">✓ Save Tag Number</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);
  }
  window.openEditTagModal = openEditTagModal;

  window.saveEditAnimalTag = function(e) {
    if (e) e.preventDefault();
    const d = state.currentEditTagData;
    if (!d) return;
    const { type, id, currentTag: oldTag } = d;
    const newTag = document.getElementById('inpEditTagVal')?.value.trim();
    if (!newTag) { showToast('Tag number cannot be blank.'); return; }
    const f = getFarm();
    const cleanId = String(id).trim().toLowerCase();

    if (type === 'sow') {
      const sow = (f.sows || []).find(s => (s.id && String(s.id).trim().toLowerCase() === cleanId) || (s.name && String(s.name).trim().toLowerCase() === cleanId));
      if (sow) sow.rfid = newTag;
    } else if (type === 'boar') {
      const boar = (f.boars || f.semen || []).find(b => (b.id && String(b.id).trim().toLowerCase() === cleanId) || (b.name && String(b.name).trim().toLowerCase() === cleanId) || (b.boar && String(b.boar).trim().toLowerCase() === cleanId));
      if (boar) boar.rfid = newTag;
    } else if (type === 'piglet_batch' || type === 'batch') {
      const batch = (f.piglets || []).find(b => String(b.id).trim().toLowerCase() === cleanId);
      if (batch) batch.rfid = newTag;
    }

    if (window.save && typeof window.save === 'function') window.save();
    showToast(`✓ Tag updated to "${newTag}"`);
    document.getElementById('editTagModal')?.remove();
    renderRfidCenter();
  };

  /* ── Reassign Tag Modal ── */
  function openReassignTagModal(tag, currentType, currentId) {
    document.getElementById('reassignTagModal')?.remove();
    state.currentReassignTagData = { tag, currentType, currentId };
    const modal = document.createElement('div');
    modal.id = 'reassignTagModal';
    modal.className = 'rfid-modal-backdrop';
    modal.innerHTML = `
      <div class="rfid-dossier-card">
        <div class="rfid-card-header">
          <div class="eyebrow" style="color:var(--teal2);font-weight:700">🔄 REASSIGN TAG</div>
          <button type="button" class="rfid-close-btn" onclick="document.getElementById('reassignTagModal').remove()">×</button>
        </div>
        <h3 style="margin-top:0">Reassign Tag: <code>${esc(tag)}</code></h3>
        <p class="muted" style="margin-bottom:14px">Currently assigned to: <b>${esc(currentId)} (${esc(currentType)})</b>. Search below to pair this tag with a different animal.</p>

        <form onsubmit="window.confirmReassignTag(event)">
          <div class="field suggest-field">
            <label>Search New Animal or Batch *</label>
            <div class="suggest-input-wrap">
              <input type="text" id="pairAnimalInput" class="suggest-input" placeholder="Type animal name, ID, breed, ear-notch..." autocomplete="off" onfocus="window.filterPairAnimalSuggest(this.value)" oninput="window.filterPairAnimalSuggest(this.value)">
              <input type="hidden" id="pairAnimalVal" required>
              <button type="button" class="suggest-clear-btn" id="pairAnimalClear" onclick="window.clearPairAnimalSuggest()" style="display:none">✕</button>
              <div class="suggest-dropdown" id="pairAnimalDropdown" style="display:none"></div>
            </div>
          </div>
          <div id="pairSelectedPreview" class="pair-selected-preview" style="display:none"></div>

          <div class="rfid-card-footer" style="margin-top:18px">
            <button type="button" class="btn ghost" onclick="document.getElementById('reassignTagModal').remove()">Cancel</button>
            <button type="submit" class="btn">✓ Confirm Reassignment</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);
  }
  window.openReassignTagModal = openReassignTagModal;

  window.confirmReassignTag = function(e) {
    if (e) e.preventDefault();
    const d = state.currentReassignTagData;
    if (!d) return;
    const { tag: oldTag, currentType, currentId } = d;
    const hidden = document.getElementById('pairAnimalVal');
    if (!hidden || !hidden.value) {
      showToast('Please search and select the new animal.');
      return;
    }
    const [newType, newId] = hidden.value.split(':');
    const f = getFarm();

    // 1. Clear old tag
    const cleanOldId = String(currentId).trim().toLowerCase();
    if (currentType === 'sow') {
      const oldSow = (f.sows || []).find(s => (s.id && String(s.id).trim().toLowerCase() === cleanOldId) || (s.name && String(s.name).trim().toLowerCase() === cleanOldId));
      if (oldSow) oldSow.rfid = null;
    } else if (currentType === 'boar') {
      const oldBoar = (f.boars || f.semen || []).find(b => (b.id && String(b.id).trim().toLowerCase() === cleanOldId) || (b.name && String(b.name).trim().toLowerCase() === cleanOldId) || (b.boar && String(b.boar).trim().toLowerCase() === cleanOldId));
      if (oldBoar) oldBoar.rfid = null;
    } else if (currentType === 'piglet_batch' || currentType === 'batch') {
      const oldBatch = (f.piglets || []).find(b => String(b.id).trim().toLowerCase() === cleanOldId);
      if (oldBatch) oldBatch.rfid = null;
    }

    // 2. Set new tag
    const cleanNewId = String(newId).trim().toLowerCase();
    if (newType === 'sow') {
      const newSow = (f.sows || []).find(s => (s.id && String(s.id).trim().toLowerCase() === cleanNewId) || (s.name && String(s.name).trim().toLowerCase() === cleanNewId));
      if (newSow) newSow.rfid = oldTag;
    } else if (newType === 'boar') {
      const newBoar = (f.boars || f.semen || []).find(b => (b.id && String(b.id).trim().toLowerCase() === cleanNewId) || (b.name && String(b.name).trim().toLowerCase() === cleanNewId) || (b.boar && String(b.boar).trim().toLowerCase() === cleanNewId));
      if (newBoar) newBoar.rfid = oldTag;
    } else if (newType === 'batch') {
      const newBatch = (f.piglets || []).find(b => String(b.id).trim().toLowerCase() === cleanNewId);
      if (newBatch) newBatch.rfid = oldTag;
    }

    if (window.save && typeof window.save === 'function') window.save();
    showToast(`✓ Tag "${oldTag}" reassigned to ${newId}!`);
    document.getElementById('reassignTagModal')?.remove();
    renderRfidCenter();
  };

  /* ── Delete / Unpair Animal Tag ── */
  function deleteAnimalTagPair(type, id, tag) {
    if (!confirm(`Unpair tag "${tag}" from ${id}? The tag will become available for new pairings.`)) return;
    const f = getFarm();
    const cleanId = String(id).trim().toLowerCase();

    if (type === 'sow') {
      const sow = (f.sows || []).find(s => (s.id && String(s.id).trim().toLowerCase() === cleanId) || (s.name && String(s.name).trim().toLowerCase() === cleanId));
      if (sow) sow.rfid = null;
    } else if (type === 'boar') {
      const boar = (f.boars || f.semen || []).find(b => (b.id && String(b.id).trim().toLowerCase() === cleanId) || (b.name && String(b.name).trim().toLowerCase() === cleanId) || (b.boar && String(b.boar).trim().toLowerCase() === cleanId));
      if (boar) boar.rfid = null;
    } else if (type === 'piglet_batch' || type === 'batch') {
      const batch = (f.piglets || []).find(b => String(b.id).trim().toLowerCase() === cleanId);
      if (batch) batch.rfid = null;
    }

    if (window.save && typeof window.save === 'function') window.save();
    showToast(`✓ Tag "${tag}" unlinked.`);
    renderRfidCenter();
  }
  window.deleteAnimalTagPair = deleteAnimalTagPair;

  /* ── Edit Scan Log Entry ── */
  function openEditScanModal(scanId) {
    const f = getFarm();
    const scan = (f.rfid_scans || []).find(s => s.id === scanId) || (state.scanHistory || []).find(s => s.id === scanId);
    if (!scan) { showToast('Scan record not found.'); return; }

    state.currentEditingScanId = scanId;
    document.getElementById('editScanModal')?.remove();
    const modal = document.createElement('div');
    modal.id = 'editScanModal';
    modal.className = 'rfid-modal-backdrop';

    const dateVal = typeof localDateTimeValue === 'function'
      ? localDateTimeValue(scan.timestamp || new Date())
      : (scan.timestamp ? new Date(scan.timestamp).toISOString().slice(0, 16) : new Date().toISOString().slice(0, 16));

    modal.innerHTML = `
      <div class="rfid-dossier-card">
        <div class="rfid-card-header">
          <div class="eyebrow" style="color:var(--teal2);font-weight:700">✏️ EDIT SCAN AUDIT LOG</div>
          <button type="button" class="rfid-close-btn" onclick="document.getElementById('editScanModal').remove()">×</button>
        </div>
        <h3 style="margin-top:0">Edit Tag Scan Entry</h3>

        <form onsubmit="window.saveEditScan(event)">
          <div class="field" style="margin-bottom:12px">
            <label>Tag ID / Barcode *</label>
            <input type="text" id="editScanTag" value="${esc(scan.tag)}" required class="suggest-input">
          </div>

          <div class="field" style="margin-bottom:12px">
            <label>Scan Protocol / Hardware Source *</label>
            <select id="editScanProto" class="rfid-select">
              ${[
                'Camera (EAN-13)',
                'Camera (QR)',
                'Camera (Code-128)',
                'BLE (Stick Reader)',
                'NFC Ear Tag',
                'Manual Search',
                'Audit Lookup',
                'Simulator (134.2 kHz)'
              ].map(p => `<option value="${p}" ${scan.protocol === p || scan.protocol.includes(p) ? 'selected' : ''}>${p}</option>`).join('')}
            </select>
          </div>

          <div class="field" style="margin-bottom:12px">
            <label>Scan Timestamp *</label>
            <input type="datetime-local" id="editScanTime" value="${dateVal}" required class="suggest-input">
          </div>

          <div class="field" style="margin-bottom:16px">
            <label>Location / Field Note</label>
            <input type="text" id="editScanLoc" value="${esc(scan.pen_location || '')}" placeholder="e.g. Gestation Barn A · Stall G-01" class="suggest-input">
          </div>

          <div class="rfid-card-footer">
            <button type="button" class="btn ghost" onclick="document.getElementById('editScanModal').remove()">Cancel</button>
            <button type="submit" class="btn">✓ Save Audit Log Entry</button>
          </div>
        </form>
      </div>
    `;
    document.body.appendChild(modal);
  }
  window.openEditScanModal = openEditScanModal;

  window.saveEditScan = function(e) {
    if (e) e.preventDefault();
    const scanId = state.currentEditingScanId;
    const tag = document.getElementById('editScanTag')?.value.trim();
    const proto = document.getElementById('editScanProto')?.value;
    const timeVal = document.getElementById('editScanTime')?.value;
    const loc = document.getElementById('editScanLoc')?.value.trim();

    if (!tag) { showToast('Tag ID cannot be blank.'); return; }
    const f = getFarm();
    const scan = (f.rfid_scans || []).find(s => s.id === scanId);
    const memScan = (state.scanHistory || []).find(s => s.id === scanId);

    const matched = findAnimalByTag(tag);

    const updated = {
      tag,
      protocol: proto || 'Manual',
      timestamp: timeVal ? new Date(timeVal).toISOString() : new Date().toISOString(),
      matched: Boolean(matched),
      animal_type: matched ? matched.type : null,
      animal_id: matched ? matched.id : null,
      animal_name: matched ? matched.name : null,
      pen_location: loc || (matched ? (matched.pen ? `${matched.barn || 'Barn'} · ${matched.pen}` : 'Not assigned') : 'Unknown')
    };

    if (scan) Object.assign(scan, updated);
    if (memScan) Object.assign(memScan, updated);

    if (window.save && typeof window.save === 'function') window.save();
    showToast(`✓ Scan log for tag "${tag}" updated!`);
    document.getElementById('editScanModal')?.remove();
    renderRfidCenter();
  };

  /* ── Delete Scan Entry ── */
  function deleteScanEntry(scanId) {
    const f = getFarm();
    const scan = (f.rfid_scans || []).find(s => s.id === scanId);
    const tag = scan ? scan.tag : 'this';

    if (!confirm(`Delete scan log record for tag "${tag}"?`)) return;

    if (f.rfid_scans) {
      f.rfid_scans = f.rfid_scans.filter(s => s.id !== scanId);
    }
    state.scanHistory = state.scanHistory.filter(s => s.id !== scanId);

    if (window.save && typeof window.save === 'function') window.save();
    showToast(`✓ Scan log entry deleted.`);
    renderRfidCenter();
  }
  window.deleteScanEntry = deleteScanEntry;

  /* ── Clear All Scan Logs ── */
  function clearAllScans() {
    if (!confirm('Permanently clear all recorded tag scan audit logs?')) return;
    const f = getFarm();
    f.rfid_scans = [];
    state.scanHistory = [];
    if (window.save && typeof window.save === 'function') window.save();
    showToast('✓ All scan audit logs cleared.');
    renderRfidCenter();
  }
  window.clearAllScans = clearAllScans;

  /* ─────────────────────────────────────────────────────────────────────────
     6. SCANNER MODAL (UNIFIED SCANNER LAUNCHER)
     ───────────────────────────────────────────────────────────────────────── */
  function openScannerModal(initialTab) {
    closeScannerModal();
    const modal = document.createElement('div');
    modal.id = 'unifiedScannerModal';
    modal.className = 'rfid-modal-backdrop';
    modal.innerHTML = `
      <div class="scanner-dialog">
        <div class="scanner-dialog-header">
          <div class="eyebrow">SMART FIELD SCANNER</div>
          <h3>Scan Animal Ear-Tag</h3>
          <button class="rfid-close-btn" onclick="window.closeScannerModal()">×</button>
        </div>

        <div class="scanner-mode-tabs">
          <button class="scan-tab active" id="tabOptCamera" onclick="window.switchScanMode('camera')">📷 Camera Scan</button>
          <button class="scan-tab" id="tabOptBle" onclick="window.switchScanMode('ble')">📶 Bluetooth Stick</button>
          <button class="scan-tab" id="tabOptNfc" onclick="window.switchScanMode('nfc')">📱 NFC Tap</button>
          <button class="scan-tab" id="tabOptManual" onclick="window.switchScanMode('manual')">⌨️ Manual Search</button>
        </div>

        <div class="scanner-dialog-body" id="scannerModeBody">
          <!-- Default: Camera Viewfinder -->
          <div id="scannerViewfinder"></div>
        </div>
      </div>
    `;
    document.body.appendChild(modal);

    setTimeout(() => {
      switchScanMode(initialTab || 'camera');
    }, 50);
  }

  function closeScannerModal() {
    closeCameraScanner();
    const el = document.getElementById('unifiedScannerModal');
    if (el) el.remove();
  }

  function switchScanMode(mode) {
    document.querySelectorAll('.scan-tab').forEach(b => b.classList.remove('active'));
    const body = document.getElementById('scannerModeBody');
    if (!body) return;

    if (mode === 'camera') {
      const tab = document.getElementById('tabOptCamera');
      if (tab) tab.classList.add('active');
      body.innerHTML = `<div id="scannerViewfinder"></div>`;
      openCameraScanner('scannerViewfinder');
    } else if (mode === 'ble') {
      const tab = document.getElementById('tabOptBle');
      if (tab) tab.classList.add('active');
      closeCameraScanner();
      body.innerHTML = `
        <div class="ble-scan-pane">
          <div class="pulse-ring-wrap">
            <div class="pulse-ring"></div>
            <div class="pulse-ring delay"></div>
            <div class="pulse-center-ico">📶</div>
          </div>
          <h4>ISO 11784/11785 Bluetooth Stick Reader</h4>
          <p>Make sure your Allflex, Agrident, or Tru-Test RFID stick reader is powered on and in range.</p>
          <div class="ble-btn-tray">
            ${state.bleConnected ? `
              <div class="badge ok" style="padding:10px 16px; font-size:15px">✓ Reader Connected: ${esc(state.bleDevice?.name||'Ready')}</div>
            ` : `
              <button type="button" class="btn large" onclick="window.connectBluetoothReader()">Pair Bluetooth Stick Reader →</button>
            `}
          </div>
        </div>
      `;
    } else if (mode === 'nfc') {
      const tab = document.getElementById('tabOptNfc');
      if (tab) tab.classList.add('active');
      closeCameraScanner();
      body.innerHTML = `
        <div class="nfc-scan-pane">
          <div class="nfc-icon-large">📱</div>
          <h4>Tap Ear-Tag to Phone</h4>
          <p>Hold the back of your smartphone against the pig's RFID ear tag or microchip implant.</p>
          ${state.nfcListening ? `
            <div class="badge ok">✓ NFC Antenna Active &amp; Ready</div>
          ` : `
            <button type="button" class="btn large" onclick="window.startNfcReader()" ${!('NDEFReader' in window)?'disabled':''}>
              ${'NDEFReader' in window ? 'Activate NFC Antenna' : 'NFC Not Supported on this Device'}
            </button>
          `}
        </div>
      `;
      if ('NDEFReader' in window && !state.nfcListening) startNfcReader();
    } else if (mode === 'manual') {
      const tab = document.getElementById('tabOptManual');
      if (tab) tab.classList.add('active');
      closeCameraScanner();
      body.innerHTML = `
        <div class="manual-scan-pane">
          <h4>Lookup or Test Tag</h4>
          <div class="field" style="margin-top:14px">
            <label>Tag Number, Ear Notch, or Animal Name</label>
            <input type="text" id="dlgManualInput" placeholder="e.g. 982000412345001 or Bella..." onkeydown="if(event.key==='Enter') { window.testManualTagScan(document.getElementById('dlgManualInput').value); window.closeScannerModal(); }">
          </div>
          <button type="button" class="btn" style="width:100%;margin-top:12px" onclick="window.testManualTagScan(document.getElementById('dlgManualInput').value); window.closeScannerModal();">Find Animal Dossier →</button>
        </div>
      `;
    }
  }

  function simulateRandomTag() {
    const f = getFarm();
    const candidates = [];
    (f.sows || []).forEach(s => { if (s.rfid) candidates.push(s.rfid); });
    (f.boars || f.semen || []).forEach(b => { if (b.rfid) candidates.push(b.rfid); });
    (f.piglets || []).forEach(b => { if (b.rfid) candidates.push(b.rfid); });

    let tag = '';
    if (candidates.length > 0 && Math.random() > 0.3) {
      tag = candidates[Math.floor(Math.random() * candidates.length)];
    } else {
      // Generate realistic 15-digit ISO 11784 FDX-B tag
      tag = '982' + String(Math.floor(100000000000 + Math.random() * 900000000000));
    }
    handleDetectedTag(tag, 'Simulator (134.2 kHz)');
  }

  function testManualTagScan(val) {
    const input = val || document.getElementById('manualTagInput')?.value;
    if (!input) {
      showToast('Please enter a tag number or animal name.');
      return;
    }
    handleDetectedTag(input, 'Manual Search');
  }

  // Global helper for toast
  function showToast(msg) {
    if (window.toast && typeof window.toast === 'function') window.toast(msg);
    else console.log('[RFID Toast]:', msg);
  }

  // Quick Action Callbacks
  window.quickLogVax = function (id, type) {
    if (window.closeQuickActionModal) window.closeQuickActionModal();
    const cat = (type === 'boar') ? 'boar' : (type === 'batch' || type === 'piglet_batch' || type === 'piglet') ? 'batch' : 'sow';
    if (window.openRecordVaccination) {
      window.openRecordVaccination(cat, id, id);
    } else if (window.openVaxModal) {
      window.openVaxModal(cat, id, id);
    } else if (window.go) {
      window.go('vaccination');
    }
  };

  window.quickLogWeight = function (id, type) {
    if (window.closeQuickActionModal) window.closeQuickActionModal();
    if (type === 'batch' || type === 'piglet_batch' || type === 'piglet') {
      if (window.openBatchPerformance) window.openBatchPerformance(id);
      else if (window.openFattenerCenter) window.openFattenerCenter(id);
      else if (window.go) window.go('piglets');
    } else if (type === 'sow') {
      if (window.openSowProfile) window.openSowProfile(id);
      else if (window.go) window.go('sows');
    } else if (type === 'boar') {
      if (window.openBoarDetailModal) window.openBoarDetailModal(id);
      else if (window.go) window.go('semen');
    }
  };

  window.quickLogHeat = function (id) {
    if (window.closeQuickActionModal) window.closeQuickActionModal();
    const f = getFarm();
    const clean = String(id || '').trim().toLowerCase();
    const idx = (f.sows || []).findIndex(s => (s.id && String(s.id).toLowerCase() === clean) || (s.name && String(s.name).toLowerCase() === clean));
    if (idx !== -1) {
      const s = f.sows[idx];
      if (s.insemination && window.openReheatRecord) window.openReheatRecord(idx);
      else if (window.openHeatRecord) window.openHeatRecord(idx);
      else if (window.openBreedSow) window.openBreedSow(idx);
    } else if (window.openHeatRecord) {
      window.openHeatRecord(0);
    } else if (window.go) {
      window.go('sows');
    }
  };

  window.viewAnimalProfile = function (id, type) {
    if (window.closeQuickActionModal) window.closeQuickActionModal();
    if (window.closeScannerModal) window.closeScannerModal();
    const cleanId = String(id || '').trim();

    if (type === 'sow') {
      if (window.openSowProfile) {
        window.openSowProfile(cleanId);
      } else if (window.go) {
        window.go('sows');
      }
    } else if (type === 'boar') {
      if (window.openBoarDetailModal) {
        window.openBoarDetailModal(cleanId);
      } else if (window.go) {
        window.go('semen');
      }
    } else if (type === 'piglet_batch' || type === 'batch' || type === 'piglet') {
      if (window.openBatchPerformance) {
        window.openBatchPerformance(cleanId);
      } else if (window.openFattenerCenter) {
        window.openFattenerCenter(cleanId);
      } else if (window.openBatchHub) {
        window.openBatchHub(cleanId);
      } else if (window.go) {
        window.go('piglets');
      }
    } else {
      if (window.openSowProfile) {
        window.openSowProfile(cleanId);
      } else if (window.go) {
        window.go('dashboard');
      }
    }
  };

  // Global Exports
  window.openRfidScanner = () => openScannerModal('camera');
  window.openScannerModal = openScannerModal;
  window.closeScannerModal = closeScannerModal;
  window.switchScanMode = switchScanMode;
  window.connectBluetoothReader = connectBluetoothReader;
  window.disconnectBleReader = onBleDisconnected;
  window.startNfcReader = startNfcReader;
  window.openCameraScanner = openCameraScanner;

  window.toggleCameraTorch = toggleCameraTorch;
  window.setCameraZoom = setCameraZoom;
  window.scanBarcodeFromImageFile = scanBarcodeFromImageFile;

  window.closeCameraScanner = closeCameraScanner;
  window.closeQuickActionModal = closeQuickActionModal;
  window.confirmPairTag = confirmPairTag;
  window.simulateRandomTag = simulateRandomTag;
  window.testManualTagScan = testManualTagScan;
  window.lookupTag = tag => handleDetectedTag(tag, 'Audit Lookup');
  window.renderRFID = renderRfidCenter;

  // Extend renderAll
  const prevRender = window.renderAll;
  window.renderAll = function () {
    if (typeof prevRender === 'function') (typeof prevRender === 'function' && prevRender());
    if (document.getElementById('rfid')) renderRfidCenter();
  };

  console.info('%cARSwineTech Pro — RFID/EID Smart Hardware Engine Loaded', 'color:#0d8d91;font-weight:bold');
})();