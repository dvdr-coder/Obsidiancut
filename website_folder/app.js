(function () {
  const DATA = window.OBSIDIAN_DOCS_DATA;
  const DIAGRAMS = window.OBSIDIAN_DIAGRAMS;

  // Theme initialization
  const htmlEl = document.documentElement;
  const savedTheme = localStorage.getItem("obsidian-docs-theme");
  if (savedTheme === "light") {
    htmlEl.classList.remove("dark");
  } else {
    htmlEl.classList.add("dark");
  }

  const themeBtn = document.getElementById("theme-toggle-btn");
  function syncThemeLabel() {
    if (!themeBtn) return;
    themeBtn.textContent = htmlEl.classList.contains("dark") ? "☀ Light Mode" : "🌙 Dark Mode";
  }
  syncThemeLabel();
  if (themeBtn) {
    themeBtn.addEventListener("click", function () {
      htmlEl.classList.toggle("dark");
      localStorage.setItem(
        "obsidian-docs-theme",
        htmlEl.classList.contains("dark") ? "dark" : "light"
      );
      syncThemeLabel();
    });
  }

  // Mobile sidebar drawer
  const sidebarEl = document.getElementById("sidebar");
  const mobileMenuBtn = document.getElementById("mobile-menu-btn");
  if (mobileMenuBtn && sidebarEl) {
    mobileMenuBtn.addEventListener("click", function () {
      sidebarEl.classList.toggle("open");
    });
    sidebarEl.querySelectorAll("a").forEach(function (link) {
      link.addEventListener("click", function () {
        sidebarEl.classList.remove("open");
      });
    });
  }

  // Scroll-spy active sidebar link
  const navLinks = Array.from(document.querySelectorAll(".sidebar .nav-link"));
  const sections = navLinks
    .map(function (a) {
      const id = (a.getAttribute("href") || "").replace("#", "");
      return id ? document.getElementById(id) : null;
    })
    .filter(Boolean);

  function updateScrollSpy() {
    let activeId = "overview";
    const scrollPos = window.scrollY + 130;
    for (let i = 0; i < sections.length; i++) {
      const sec = sections[i];
      if (sec && sec.offsetTop <= scrollPos) {
        activeId = sec.id;
      }
    }
    navLinks.forEach(function (a) {
      const target = (a.getAttribute("href") || "").replace("#", "");
      a.classList.toggle("active", target === activeId);
    });
  }
  window.addEventListener("scroll", updateScrollSpy, { passive: true });
  updateScrollSpy();

  // Mount interactive SVG diagrams
  function renderDiagramMount(containerId, diagramKey) {
    const host = document.getElementById(containerId);
    const diag = DIAGRAMS && DIAGRAMS[diagramKey];
    if (!host || !diag) return;

    const firstNodeKey = Object.keys(diag.nodes)[0];
    host.innerHTML =
      '<div class="diagram-toolbar">' +
      '  <div class="diagram-title"><span>⚡ ' + diag.title + '</span></div>' +
      '  <span class="chip">Click any block below to inspect modules</span>' +
      "</div>" +
      '<div class="diagram-canvas-wrap">' + diag.svg + "</div>" +
      '<div class="diagram-inspector" id="' + containerId + '-inspector"></div>';

    function selectNode(nodeKey) {
      const info = diag.nodes[nodeKey];
      if (!info) return;
      host.querySelectorAll(".diagram-node").forEach(function (el) {
        el.classList.toggle("is-selected", el.getAttribute("data-node") === nodeKey);
      });
      const insp = document.getElementById(containerId + "-inspector");
      if (!insp) return;
      const chipsHtml = (info.chips || [])
        .map(function (c) {
          return '<span class="chip">' + escapeHtml(c) + "</span>";
        })
        .join("");
      insp.innerHTML =
        "<div>" +
        "  <h4>" + escapeHtml(info.title) + "</h4>" +
        "  <p>" + escapeHtml(info.summary) + "</p>" +
        '  <div class="chip-row">' + chipsHtml + "</div>" +
        "</div>";
    }

    host.querySelectorAll(".diagram-node").forEach(function (el) {
      el.addEventListener("click", function () {
        const key = el.getAttribute("data-node");
        if (key) selectNode(key);
      });
    });

    selectNode(firstNodeKey);
  }

  renderDiagramMount("diag-architecture", "architecture");
  renderDiagramMount("diag-audio", "audioPipeline");
  renderDiagramMount("diag-render", "renderDag");

  // Codebase Module Explorer + Filter + Search
  const moduleGridEl = document.getElementById("module-grid");
  const filterBtns = Array.from(document.querySelectorAll("#layer-filters .pill-btn"));
  const searchInput = document.getElementById("global-search");
  let activeLayer = "all";
  let searchQuery = "";

  function renderModules() {
    if (!moduleGridEl || !DATA) return;
    const filtered = DATA.modules.filter(function (m) {
      const layerMatch = activeLayer === "all" || m.layer === activeLayer;
      if (!layerMatch) return false;
      if (!searchQuery) return true;
      const hay = (m.path + " " + m.summary + " " + m.symbols.join(" ") + " " + m.badge).toLowerCase();
      return hay.indexOf(searchQuery) !== -1;
    });

    if (filtered.length === 0) {
      moduleGridEl.innerHTML =
        '<div class="card"><p>No matching files found for "' +
        escapeHtml(searchQuery) +
        '". Try clearing the filter or search query.</p></div>';
      return;
    }

    moduleGridEl.innerHTML = filtered
      .map(function (m) {
        const badgeClass =
          m.layer === "audio"
            ? "layer-audio"
            : m.layer === "math"
              ? "layer-math"
              : m.layer === "backend"
                ? "layer-backend"
                : m.layer === "cli"
                  ? "layer-cli"
                  : "layer-frontend";
        const tags = m.symbols
          .map(function (s) {
            return '<span class="symbol-tag">' + escapeHtml(s) + "</span>";
          })
          .join("");
        return (
          '<article class="module-card">' +
          '  <div class="module-top">' +
          '    <span class="module-path">' + escapeHtml(m.path) + "</span>" +
          '    <span class="layer-badge ' + badgeClass + '">' + escapeHtml(m.badge) + "</span>" +
          "  </div>" +
          '  <p class="module-desc">' + escapeHtml(m.summary) + "</p>" +
          '  <div class="symbol-list">' + tags + "</div>" +
          "</article>"
        );
      })
      .join("");
  }

  filterBtns.forEach(function (btn) {
    btn.addEventListener("click", function () {
      activeLayer = btn.getAttribute("data-layer") || "all";
      filterBtns.forEach(function (b) {
        b.classList.toggle("active", b === btn);
      });
      renderModules();
    });
  });

  if (searchInput) {
    searchInput.addEventListener("input", function () {
      searchQuery = (searchInput.value || "").trim().toLowerCase();
      renderModules();
      renderApiTable();
    });
  }
  renderModules();

  // Parity Matrix Table
  const parityBody = document.getElementById("parity-table-body");
  if (parityBody && DATA) {
    parityBody.innerHTML = DATA.parityMap
      .map(function (row) {
        return (
          "<tr>" +
          "<td><strong>" + escapeHtml(row.feature) + "</strong></td>" +
          "<td><code>" + escapeHtml(row.frontend) + "</code></td>" +
          "<td><code>" + escapeHtml(row.backend) + "</code></td>" +
          "</tr>"
        );
      })
      .join("");
  }

  // Installation Tabs
  const installTabs = Array.from(document.querySelectorAll("#install-tabs .tab-btn"));
  const installHost = document.getElementById("install-panel");
  function renderInstallPanel(key) {
    const info = DATA && DATA.installGuides && DATA.installGuides[key];
    if (!info || !installHost) return;
    let html =
      '<div class="card">' +
      "  <h3>" + escapeHtml(info.title) + "</h3>" +
      '  <p style="margin-bottom:10px">' + escapeHtml(info.note) + "</p>" +
      buildCodeBlock("bash", info.commands);
    if (info.rawCode) {
      html +=
        '<div style="margin-top:8px;font-size:12px;font-weight:700;color:var(--text-muted)">Exact Contents of <code>' +
        escapeHtml(info.codeTitle) +
        "</code>:</div>" +
        buildCodeBlock("bash", info.rawCode);
    }
    html += "</div>";
    installHost.innerHTML = html;
    wireCopyButtons(installHost);
  }

  installTabs.forEach(function (btn) {
    btn.addEventListener("click", function () {
      installTabs.forEach(function (b) {
        b.classList.toggle("active", b === btn);
      });
      renderInstallPanel(btn.getAttribute("data-install") || "runsh");
    });
  });
  renderInstallPanel("runsh");

  // API Reference Table
  const apiHost = document.getElementById("api-table-body");
  function renderApiTable() {
    if (!apiHost || !DATA) return;
    const rows = DATA.endpoints.filter(function (ep) {
      if (!searchQuery) return true;
      return (ep.path + " " + ep.summary + " " + ep.method).toLowerCase().indexOf(searchQuery) !== -1;
    });
    apiHost.innerHTML = rows
      .map(function (ep) {
        const cls =
          ep.method === "GET"
            ? "m-get"
            : ep.method === "POST"
              ? "m-post"
              : ep.method === "PATCH"
                ? "m-patch"
                : "m-delete";
        return (
          "<tr>" +
          '<td><span class="method-badge ' + cls + '">' + escapeHtml(ep.method) + "</span></td>" +
          "<td><code>" + escapeHtml(ep.path) + "</code></td>" +
          "<td>" + escapeHtml(ep.summary) + "<br><code style='font-size:11px;color:var(--text-dim)'>" + escapeHtml(ep.curl.replace(/\\\n\s*/g, " ")) + "</code></td>" +
          "<td><button class='copy-btn' data-copy='" + escapeAttr(ep.curl) + "'>Copy curl</button></td>" +
          "</tr>"
        );
      })
      .join("");
    wireCopyButtons(apiHost);
  }
  renderApiTable();

  // Shortcuts Table
  const shortcutHost = document.getElementById("shortcuts-table-body");
  if (shortcutHost && DATA) {
    shortcutHost.innerHTML = DATA.shortcuts
      .map(function (pair) {
        return (
          "<tr><td><kbd class='symbol-tag'>" +
          escapeHtml(pair[0]) +
          "</kbd></td><td>" +
          escapeHtml(pair[1]) +
          "</td></tr>"
        );
      })
      .join("");
  }

  // Copy helper
  function buildCodeBlock(lang, code) {
    return (
      '<div class="code-wrap">' +
      '  <div class="code-head"><span>' + escapeHtml(lang) + "</span>" +
      '    <button type="button" class="copy-btn" data-copy="' + escapeAttr(code) + '">Copy</button>' +
      "  </div>" +
      "  <pre><code>" + escapeHtml(code) + "</code></pre>" +
      "</div>"
    );
  }

  function wireCopyButtons(scope) {
    (scope || document).querySelectorAll(".copy-btn[data-copy]").forEach(function (btn) {
      btn.addEventListener("click", function () {
        const text = btn.getAttribute("data-copy") || "";
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(text).then(function () {
            const orig = btn.textContent;
            btn.textContent = "Copied ✓";
            setTimeout(function () {
              btn.textContent = orig;
            }, 1400);
          });
        }
      });
    });
  }
  wireCopyButtons(document);

  // =========================================================================
  // INTERACTIVE VISUAL REPRESENTATION 1: Waveform Trim & Fade Canvas
  // =========================================================================
  const wfCanvas = document.getElementById("sim-waveform");
  const wfTrimEl = document.getElementById("wf-trim");
  const wfFadeInEl = document.getElementById("wf-fadein");
  const wfFadeOutEl = document.getElementById("wf-fadeout");
  const wfVolEl = document.getElementById("wf-vol");
  const wfRevEl = document.getElementById("wf-reverse");
  const wfCurveEl = document.getElementById("wf-curve");

  // Deterministic synthetic 220-bin song peaks matching 120 BPM drum + bass energy
  const MOCK_SONG_PEAKS = Array.from({ length: 220 }, function (_, i) {
    const t = (i / 220) * 16;
    const beatPhase = t % 0.5;
    const kick = beatPhase < 0.14 ? Math.exp(-beatPhase * 16) * 0.72 : 0;
    const chord = 0.24 + 0.14 * Math.sin(t * 2.1) + 0.08 * Math.cos(t * 7.3);
    return Math.min(1, Math.max(0.08, chord + kick));
  });

  function fadeEval(u, curve) {
    const c = Math.max(0, Math.min(1, u));
    if (curve === "linear") return c;
    if (curve === "exp") return c * c;
    if (curve === "log") return Math.sqrt(c);
    return 0.5 - 0.5 * Math.cos(Math.PI * c);
  }

  function drawSimWaveform() {
    if (!wfCanvas) return;
    const ctx = wfCanvas.getContext("2d");
    if (!ctx) return;

    const trimStart = Number(wfTrimEl ? wfTrimEl.value : 0);
    const fadeIn = Number(wfFadeInEl ? wfFadeInEl.value : 0.15);
    const fadeOut = Number(wfFadeOutEl ? wfFadeOutEl.value : 0.2);
    const volume = Number(wfVolEl ? wfVolEl.value : 1);
    const rev = Boolean(wfRevEl && wfRevEl.checked);
    const curve = wfCurveEl ? wfCurveEl.value : "scurve";

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = wfCanvas.clientWidth || 340;
    const cssH = wfCanvas.clientHeight || 130;
    wfCanvas.width = Math.round(cssW * dpr);
    wfCanvas.height = Math.round(cssH * dpr);
    const w = wfCanvas.width;
    const h = wfCanvas.height;

    ctx.fillStyle = "#070b12";
    ctx.fillRect(0, 0, w, h);

    const midY = h * 0.5;
    const maxHalf = h * 0.43;

    ctx.strokeStyle = "rgba(52, 211, 153, 0.25)";
    ctx.lineWidth = dpr;
    ctx.beginPath();
    ctx.moveTo(0, midY);
    ctx.lineTo(w, midY);
    ctx.stroke();

    const cols = Math.max(40, Math.round(cssW));
    const upper = new Float32Array(cols);
    const lower = new Float32Array(cols);
    const sliceStart = trimStart * 0.6;
    const sliceSpan = Math.max(0.25, 1 - sliceStart);

    for (let i = 0; i < cols; i++) {
      const u = i / (cols - 1);
      const srcU = sliceStart + (rev ? 1 - u : u) * sliceSpan;
      const idx = Math.min(MOCK_SONG_PEAKS.length - 1, Math.floor(srcU * (MOCK_SONG_PEAKS.length - 1)));
      const peak = MOCK_SONG_PEAKS[idx];
      let fMult = 1;
      if (fadeIn > 0.01 && u < fadeIn) fMult *= fadeEval(u / fadeIn, curve);
      if (fadeOut > 0.01 && u > 1 - fadeOut) fMult *= fadeEval((1 - u) / fadeOut, curve);
      const amp = Math.min(1, peak * volume * fMult);
      upper[i] = midY - amp * maxHalf;
      lower[i] = midY + amp * maxHalf;
    }

    ctx.beginPath();
    for (let i = 0; i < cols; i++) {
      const x = (i / (cols - 1)) * w;
      if (i === 0) ctx.moveTo(x, upper[i]);
      else ctx.lineTo(x, upper[i]);
    }
    for (let i = cols - 1; i >= 0; i--) {
      const x = (i / (cols - 1)) * w;
      ctx.lineTo(x, lower[i]);
    }
    ctx.closePath();
    ctx.fillStyle = "rgba(16, 185, 129, 0.58)";
    ctx.fill();
    ctx.strokeStyle = "#6ee7b7";
    ctx.lineWidth = dpr;
    ctx.stroke();

    // Rubber-band volume line
    const volY = Math.max(4 * dpr, Math.min(h - 4 * dpr, (1 - volume / 1.6) * h));
    ctx.strokeStyle = "#fde047";
    ctx.lineWidth = 1.6 * dpr;
    ctx.beginPath();
    ctx.moveTo(0, volY);
    ctx.lineTo(w, volY);
    ctx.stroke();
  }

  [wfTrimEl, wfFadeInEl, wfFadeOutEl, wfVolEl, wfRevEl, wfCurveEl].forEach(function (el) {
    if (el) el.addEventListener("input", drawSimWaveform);
  });
  drawSimWaveform();

  // =========================================================================
  // INTERACTIVE VISUAL REPRESENTATION 2: Live 32-Band RTA Spectrum & EQ
  // =========================================================================
  const specCanvas = document.getElementById("sim-spectrum");
  const eqLowEl = document.getElementById("eq-low");
  const eqMidEl = document.getElementById("eq-mid");
  const eqHighEl = document.getElementById("eq-high");
  const specModeEl = document.getElementById("spec-mode");

  const specSmooth = new Float32Array(32);
  const specPeaks = new Float32Array(32);
  let simTime = 0;

  function tickSimSpectrum() {
    if (specCanvas) {
      const ctx = specCanvas.getContext("2d");
      if (ctx) {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const cssW = specCanvas.clientWidth || 340;
        const cssH = specCanvas.clientHeight || 130;
        if (specCanvas.width !== Math.round(cssW * dpr) || specCanvas.height !== Math.round(cssH * dpr)) {
          specCanvas.width = Math.round(cssW * dpr);
          specCanvas.height = Math.round(cssH * dpr);
        }
        const w = specCanvas.width;
        const h = specCanvas.height;

        const lowDb = Number(eqLowEl ? eqLowEl.value : 0);
        const midDb = Number(eqMidEl ? eqMidEl.value : 0);
        const highDb = Number(eqHighEl ? eqHighEl.value : 0);
        const mode = specModeEl ? specModeEl.value : "bars";

        simTime += 0.04;
        const beat = Math.exp(-((simTime % 0.8) * 6));
        const n = 32;

        for (let b = 0; b < n; b++) {
          const u = b / (n - 1);
          const hz = 36 * Math.pow(15500 / 36, u);
          const wLow = hz < 260 ? 1 - Math.max(0, hz - 90) / 170 : 0;
          const wHigh = hz > 2400 ? Math.min(1, (hz - 2400) / 3600) : 0;
          const wMid = Math.max(0, 1 - wLow - wHigh);
          const eqMult =
            Math.pow(10, lowDb / 24) * wLow +
            Math.pow(10, midDb / 24) * wMid +
            Math.pow(10, highDb / 24) * wHigh;

          const baseShape = 0.25 + 0.55 * Math.exp(-u * 1.1) + (u < 0.25 ? beat * 0.45 : beat * 0.14);
          const wave = 0.78 + 0.22 * Math.sin(simTime * (4 + b * 0.35) + b);
          const target = Math.max(0.02, Math.min(1, baseShape * wave * eqMult));
          specSmooth[b] += (target - specSmooth[b]) * 0.35;
          if (specSmooth[b] >= specPeaks[b]) specPeaks[b] = specSmooth[b];
          else specPeaks[b] = Math.max(specSmooth[b], specPeaks[b] - 0.008);
        }

        ctx.fillStyle = "#070b12";
        ctx.fillRect(0, 0, w, h);

        const grad = ctx.createLinearGradient(0, h, 0, 0);
        grad.addColorStop(0, "#10b981");
        grad.addColorStop(0.5, "#06b6d4");
        grad.addColorStop(0.8, "#f59e0b");
        grad.addColorStop(1, "#ef4444");

        if (mode === "curve") {
          ctx.beginPath();
          ctx.moveTo(0, h);
          for (let b = 0; b < n; b++) {
            const x = (b / (n - 1)) * w;
            const y = h - specSmooth[b] * (h - 10 * dpr);
            ctx.lineTo(x, y);
          }
          ctx.lineTo(w, h);
          ctx.closePath();
          ctx.save();
          ctx.globalAlpha = 0.35;
          ctx.fillStyle = grad;
          ctx.fill();
          ctx.restore();

          ctx.beginPath();
          for (let b = 0; b < n; b++) {
            const x = (b / (n - 1)) * w;
            const y = h - specSmooth[b] * (h - 10 * dpr);
            if (b === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
          }
          ctx.strokeStyle = "#34d399";
          ctx.lineWidth = 2 * dpr;
          ctx.stroke();
        } else if (mode === "mirror") {
          const slotW = w / n;
          const barW = slotW * 0.72;
          const midY = h * 0.5;
          ctx.fillStyle = grad;
          for (let b = 0; b < n; b++) {
            const halfH = specSmooth[b] * (h * 0.45);
            ctx.fillRect(b * slotW + (slotW - barW) * 0.5, midY - halfH, barW, halfH * 2);
          }
        } else {
          const slotW = w / n;
          const barW = slotW * 0.72;
          for (let b = 0; b < n; b++) {
            const barH = specSmooth[b] * (h - 8 * dpr);
            const x = b * slotW + (slotW - barW) * 0.5;
            ctx.fillStyle = grad;
            ctx.fillRect(x, h - barH, barW, barH);
            ctx.fillStyle = "#f8fafc";
            ctx.fillRect(x, h - specPeaks[b] * (h - 8 * dpr) - 2 * dpr, barW, 1.8 * dpr);
          }
        }
      }
    }
    window.requestAnimationFrame(tickSimSpectrum);
  }
  window.requestAnimationFrame(tickSimSpectrum);

  // =========================================================================
  // INTERACTIVE VISUAL REPRESENTATION 3: Crossfade & Keyframe Easing Plotter
  // =========================================================================
  const curveCanvas = document.getElementById("sim-curves");
  const curveSelect = document.getElementById("curve-kind");

  function drawCurves() {
    if (!curveCanvas) return;
    const ctx = curveCanvas.getContext("2d");
    if (!ctx) return;

    const kind = curveSelect ? curveSelect.value : "scurve";
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const cssW = curveCanvas.clientWidth || 340;
    const cssH = curveCanvas.clientHeight || 130;
    curveCanvas.width = Math.round(cssW * dpr);
    curveCanvas.height = Math.round(cssH * dpr);
    const w = curveCanvas.width;
    const h = curveCanvas.height;

    ctx.fillStyle = "#070b12";
    ctx.fillRect(0, 0, w, h);

    // Grid
    ctx.strokeStyle = "rgba(148, 163, 184, 0.14)";
    ctx.lineWidth = dpr;
    for (let g = 1; g < 4; g++) {
      const y = (g / 4) * h;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(w, y);
      ctx.stroke();
    }

    const pad = 12 * dpr;
    const gw = w - pad * 2;
    const gh = h - pad * 2;

    function evalGain(u) {
      if (kind === "linear") return u;
      if (kind === "exp") return u * u;
      if (kind === "easeIn") return u * u;
      if (kind === "easeOut") return 1 - (1 - u) * (1 - u);
      return 0.5 - 0.5 * Math.cos(Math.PI * u);
    }

    // Outgoing clip curve (Emerald)
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const u = i / 60;
      const g = evalGain(1 - u);
      const x = pad + u * gw;
      const y = pad + (1 - g) * gh;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "#34d399";
    ctx.lineWidth = 2.4 * dpr;
    ctx.stroke();

    // Incoming / Keyframe target curve (Amber)
    ctx.beginPath();
    for (let i = 0; i <= 60; i++) {
      const u = i / 60;
      const g = evalGain(u);
      const x = pad + u * gw;
      const y = pad + (1 - g) * gh;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.strokeStyle = "#fbbf24";
    ctx.lineWidth = 2.4 * dpr;
    ctx.stroke();
  }

  if (curveSelect) curveSelect.addEventListener("change", drawCurves);
  drawCurves();

  window.addEventListener("resize", function () {
    drawSimWaveform();
    drawCurves();
  });

  function escapeHtml(str) {
    return String(str)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function escapeAttr(str) {
    return escapeHtml(str).replace(/'/g, "&#39;");
  }
})();
