/* Yuanta Technical Central - app shell, report list, collaborative editor */
(function () {
  const TEMPLATES = {
    cpm: { name: "Chart Perspective Morning", base: "templates/cpm/" },
    cpa: { name: "Chart Perspective Afternoon", base: "templates/cpa/" },
  };
  const DISC_GROUP = "shared";   // one quarterly disclaimer for every report format
  const COLORS = ["#e4572e", "#17bebb", "#7b2cbf", "#2a9d8f", "#f4a261", "#d62828", "#3a86ff", "#8338ec", "#06a77d", "#ff006e"];
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  const manifests = {};
  let store, me, view = { name: "home" };

  /* ---------- helpers ---------- */
  function lsGet(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } }
  function lsSet(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) {} }
  function toast(msg, kind = "") {
    const t = document.createElement("div"); t.className = "toast " + kind; t.textContent = msg;
    $("#toasts").appendChild(t); setTimeout(() => t.remove(), kind === "err" ? 7000 : 3200);
  }
  function busy(msg) {
    const b = $("#busy");
    if (msg === false) { b.hidden = true; return; }
    b.hidden = false; $("#busy-msg").textContent = msg;
  }
  async function manifest(tid) {
    if (!manifests[tid]) manifests[tid] = await (await fetch(TEMPLATES[tid].base + "manifest.json")).json();
    return manifests[tid];
  }
  function todayIso() {
    const d = new Date(); const z = new Date(d.getTime() - d.getTimezoneOffset() * 60000);
    return z.toISOString().slice(0, 10);
  }
  function fmtTime(iso) {
    if (!iso) return "";
    const d = new Date(iso);
    return d.toLocaleString("th-TH", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
  }
  function teamLink(reportId) {
    const u = location.origin + location.pathname + (reportId ? "?r=" + reportId : "");
    return store.teamKey ? u + "#k=" + store.teamKey : u;
  }
  function go(name, params = {}) {
    const url = name === "editor" ? "?r=" + params.id : location.pathname;
    history.pushState({}, "", url + (location.hash || ""));
    route();
  }
  async function defaultDisclaimer(tid) {
    const M = await manifest(tid), base = TEMPLATES[tid].base;
    return { id: "default", label: "ค่าเริ่มต้นจากเทมเพลต", pdf: base + M.disclaimerDefault.pdf,
      pages: M.disclaimerDefault.pages.map(p => base + p), created_at: "" };
  }
  async function allDisclaimers(tid) {
    const list = (await store.listDisclaimers(DISC_GROUP)).map(d => ({ ...d, pdf: d.pdf || d.pdf_url }));
    return [...list, await defaultDisclaimer(tid)];
  }

  /* ---------- identity ---------- */
  function ensureMe() {
    me = lsGet("ytc_me", null);
    if (!me) me = { id: YTCStore.uuid(), name: "", color: COLORS[Math.floor(Math.random() * COLORS.length)] };
    // presence id is per browser tab, so two tabs (or two people on one PC) never hide each other
    let tab = null; try { tab = sessionStorage.getItem("ytc_tab"); } catch (e) {}
    if (!tab) { tab = YTCStore.uuid(); try { sessionStorage.setItem("ytc_tab", tab); } catch (e) {} }
    me = { ...me, id: tab };
    if (!me.name) return askName();
    $("#me").textContent = me.name; $("#me").style.background = me.color;
    return Promise.resolve();
  }
  function askName() {
    return new Promise(res => {
      const d = $("#dlg-name"); $("#name-input").value = me.name || "";
      d.showModal();
      $("#name-ok").onclick = ev => {
        ev.preventDefault();
        const v = $("#name-input").value.trim(); if (!v) return;
        me.name = v; lsSet("ytc_me", me); d.close();
        $("#me").textContent = me.name; $("#me").style.background = me.color; res();
      };
    });
  }

  /* ---------- routing ---------- */
  async function route() {
    if (view.leave) { try { await view.leave(); } catch (e) {} }
    const id = new URLSearchParams(location.search).get("r");
    if (id) return openEditor(id);
    return renderHome();
  }

  /* ---------- home ---------- */
  async function renderHome() {
    view = { name: "home" };
    document.body.dataset.view = "home";
    $("#topbar-report").innerHTML = "";
    const main = $("#main");
    main.innerHTML = `<div class="home">
      <section class="hero">
        <div><h1>รีพอร์ตทั้งหมด</h1><p>เขียนบทวิเคราะห์ร่วมกันแบบเรียลไทม์ แล้วดาวน์โหลดเป็น PowerPoint หรือ PDF ในรูปแบบเดิมของรีพอร์ต</p></div>
        <button class="btn primary" id="new-report">+ สร้างรีพอร์ตใหม่</button>
      </section>
      <div class="card"><table class="list" id="report-list"><thead><tr><th>วันที่</th><th>รีพอร์ต</th><th>สถานะ</th><th>แก้ไขล่าสุด</th><th></th></tr></thead><tbody><tr><td colspan="5" class="muted">กำลังโหลด…</td></tr></tbody></table></div>
      <section class="disc-admin card" id="disc-admin"></section>
      <section class="card help"><h2>วิธีใช้</h2><ol>
        <li><b>สร้างรีพอร์ต</b> — เลือกวันที่ แล้วคัดลอกข้อความจากรีพอร์ตล่าสุด (ช่องที่ยังไม่ได้แก้จะมีจุดสีส้ม)</li>
        <li><b>แบ่งงาน</b> — ใส่ชื่อ “ผู้รับผิดชอบ” เหนือแต่ละหน้า ทุกคนเปิดลิงก์เดียวกันแล้วเขียนพร้อมกันได้ เห็นกรอบสีพร้อมชื่อของคนที่กำลังแก้</li>
        <li><b>ข้อความ</b> — คลิกที่กล่องแล้วพิมพ์ได้เลย บันทึกอัตโนมัติ</li>
        <li><b>รูปกราฟ</b> — คลิกกรอบรูปแล้วกด Ctrl+V (หรือลากไฟล์มาวาง) รูปจะเต็มกรอบอัตโนมัติ ดับเบิลคลิกที่รูปเพื่อลากเลื่อน หมุนลูกกลิ้งซูม หรือลากจุดที่ขอบรูปเพื่อยืดซ้าย-ขวา / บน-ล่าง (ปุ่ม “↔ เต็มความกว้าง” ยืดให้เต็มกรอบทันที)</li>
        <li><b>ตาราง</b> — คัดลอกช่วงข้อมูลจาก Excel แล้ววางที่ช่องแรก ระบบจะเติมทั้งตารางให้</li>
        <li><b>ดาวน์โหลด</b> — ปุ่ม PowerPoint / PDF มุมขวาบน ไฟล์ใช้ธีมเดิมของรีพอร์ตทุกอย่าง</li></ol></section>
    </div>`;
    $("#new-report").onclick = newReportDialog;
    let reports = [];
    try { reports = await store.listReports(); } catch (e) { toast("โหลดรายการไม่สำเร็จ: " + e.message, "err"); }
    const tb = $("#report-list tbody");
    tb.innerHTML = reports.length ? reports.map(r => `<tr data-id="${r.id}">
        <td class="date">${esc(YTCRender.thaiDate(r.report_date))}</td>
        <td><a href="?r=${r.id}" class="open">${esc(r.title || TEMPLATES[r.template].name)}</a></td>
        <td><span class="pill ${r.status === "final" ? "ok" : ""}">${r.status === "final" ? "Final" : "Draft"}</span></td>
        <td class="muted">${esc(fmtTime(r.updated_at))}</td>
        <td class="right"><button class="btn ghost sm del" title="ลบรีพอร์ต">ลบ</button></td></tr>`).join("")
      : `<tr><td colspan="5" class="muted">ยังไม่มีรีพอร์ต — กด “สร้างรีพอร์ตใหม่”</td></tr>`;
    tb.querySelectorAll("a.open").forEach(a => a.onclick = ev => { ev.preventDefault(); go("editor", { id: a.closest("tr").dataset.id }); });
    tb.querySelectorAll(".del").forEach(b => b.onclick = async () => {
      const tr = b.closest("tr"); const r = reports.find(x => x.id === tr.dataset.id);
      if (!confirm(`ลบรีพอร์ต ${r.title} วันที่ ${YTCRender.thaiDate(r.report_date)} ?\nลบแล้วกู้คืนไม่ได้`)) return;
      try { await store.deleteReport(r.id); tr.remove(); toast("ลบแล้ว"); } catch (e) { toast(e.message, "err"); }
    });
    renderDisclaimerAdmin("cpm");
  }

  async function renderDisclaimerAdmin(tid) {
    const box = $("#disc-admin"); if (!box) return;
    const list = await allDisclaimers(tid);
    box.innerHTML = `<div class="disc-head"><div><h2>Disclaimer (หน้าท้ายรีพอร์ต)</h2>
      <p class="muted">อัปเดตทุกไตรมาส — อัปโหลด PDF แล้วเลือกหน้าที่ต้องการ รีพอร์ตที่สร้างใหม่จะใช้เวอร์ชันล่าสุดอัตโนมัติ</p></div>
      <button class="btn" id="disc-upload">อัปโหลด Disclaimer ใหม่</button></div>
      <div class="disc-list">${list.map((d, i) => `<div class="disc-item">
        <div class="thumbs">${d.pages.slice(0, 4).map(() => `<img alt="">`).join("")}</div>
        <div><b>${esc(d.label)}</b> ${i === 0 ? `<span class="pill ok">ใช้กับรีพอร์ตใหม่</span>` : ""}
        <div class="muted">${d.pages.length} หน้า${d.created_at ? " · " + esc(fmtTime(d.created_at)) + (d.created_by ? " · " + esc(d.created_by) : "") : ""}</div></div></div>`).join("")}</div>`;
    box.querySelectorAll(".disc-item").forEach((el, i) => el.querySelectorAll("img").forEach(async (img, k) => { img.src = await store.resolveUrl(list[i].pages[k]); }));
    $("#disc-upload").onclick = () => disclaimerUpload(tid, () => renderDisclaimerAdmin(tid));
  }

  async function disclaimerUpload(tid, done) {
    const inp = document.createElement("input"); inp.type = "file"; inp.accept = "application/pdf";
    inp.onchange = async () => {
      const file = inp.files[0]; if (!file) return;
      busy("กำลังอ่าน PDF…");
      let bytes, pdf;
      try { bytes = new Uint8Array(await file.arrayBuffer()); pdf = await YTCExport.readPdf(bytes); }
      catch (e) { busy(false); return toast("อ่านไฟล์ PDF ไม่ได้: " + e.message, "err"); }
      const n = pdf.numPages;
      const d = $("#dlg-disc");
      const pre = new Set(n <= 6 ? [...Array(n).keys()] : [n - 4, n - 3, n - 2, n - 1]);
      const q = Math.floor((new Date().getMonth()) / 3) + 1;
      $("#disc-label").value = `Q${q}/${new Date().getFullYear()}`;
      $("#disc-pages").innerHTML = [...Array(n).keys()].map(i => `<label class="pg ${pre.has(i) ? "on" : ""}"><input type="checkbox" value="${i}" ${pre.has(i) ? "checked" : ""}><canvas></canvas><span>หน้า ${i + 1}</span></label>`).join("");
      $("#disc-pages").querySelectorAll("input").forEach(c => c.onchange = () => c.parentNode.classList.toggle("on", c.checked));
      busy(false); d.showModal();
      // thumbnails
      $("#disc-pages").querySelectorAll("canvas").forEach(async (cv, i) => {
        const b = await YTCExport.renderPdfPage(pdf, i, 160);
        const im = await createImageBitmap(b); cv.width = im.width; cv.height = im.height; cv.getContext("2d").drawImage(im, 0, 0);
      });
      $("#disc-cancel").onclick = () => d.close();
      $("#disc-ok").onclick = async ev => {
        ev.preventDefault();
        const idx = [...$("#disc-pages").querySelectorAll("input:checked")].map(c => +c.value);
        if (!idx.length) return toast("เลือกอย่างน้อย 1 หน้า", "err");
        const label = $("#disc-label").value.trim() || file.name;
        d.close();
        try {
          busy("กำลังเตรียมไฟล์ Disclaimer…");
          const pdfBlob = await YTCExport.extractPages(bytes, idx);
          const folder = "disclaimer-" + DISC_GROUP;
          const pdfUrl = await store.uploadBlob(folder, pdfBlob, "pdf");
          const pages = [];
          for (const i of idx) {
            busy(`กำลังแปลงหน้า ${i + 1}…`);
            pages.push(await store.uploadBlob(folder, await YTCExport.renderPdfPage(pdf, i, 1654), "jpg"));
          }
          await store.addDisclaimer({ template: DISC_GROUP, label, pdf_url: pdfUrl, pages, created_by: me.name });
          busy(false); toast("อัปโหลด Disclaimer แล้ว — รีพอร์ตใหม่จะใช้เวอร์ชันนี้");
          done && done();
        } catch (e) { busy(false); toast("อัปโหลดไม่สำเร็จ: " + e.message, "err"); }
      };
    };
    inp.click();
  }

  async function newReportDialog() {
    const d = $("#dlg-new");
    $("#new-date").value = todayIso();
    const reports = await store.listReports().catch(() => []);
    const sel = $("#new-tpl");
    sel.innerHTML = Object.entries(TEMPLATES).map(([k, t]) => `<option value="${k}">${esc(t.name)}</option>`).join("");
    const pref = lsGet("ytc_last_tpl", "cpm"); if (TEMPLATES[pref]) sel.value = pref;
    let last = null;
    const refresh = () => {
      last = reports.find(r => r.template === sel.value) || null;
      $("#new-src-copy-label").textContent = last ? `คัดลอกข้อความจากรีพอร์ตล่าสุด (${YTCRender.thaiDate(last.report_date)})` : "คัดลอกจากรีพอร์ตล่าสุด (ยังไม่มีรีพอร์ตรูปแบบนี้)";
      $("#new-src-copy").disabled = !last; $("#new-src-copy").checked = !!last; $("#new-src-blank").checked = !last;
    };
    sel.onchange = refresh; refresh();
    $("#new-copy-img").checked = false;
    d.showModal();
    $("#new-cancel").onclick = () => d.close();
    $("#new-ok").onclick = async ev => {
      ev.preventDefault();
      const date = $("#new-date").value; if (!date) return;
      const copy = $("#new-src-copy").checked && last;
      const copyImg = $("#new-copy-img").checked;
      const tid = sel.value; lsSet("ytc_last_tpl", tid);
      d.close(); busy("กำลังสร้างรีพอร์ต…");
      try {
        const M = await manifest(tid);
        const discs = await allDisclaimers(tid);
        const rep = await store.createReport({ template: tid, report_date: date, title: M.name, created_by: me.name });
        const entries = [{ key: "_disclaimer", v: discs[0].id, by: me.name }];
        if (copy) {
          const src = await store.getFields(last.id);
          for (const [k, f] of Object.entries(src)) {
            if (k.startsWith("_")) continue;
            const isImg = f.v && typeof f.v === "object" && f.v.url;
            if (isImg && !copyImg) continue;
            entries.push({ key: k, v: f.v, by: "_copy" });
          }
          for (const [k, f] of Object.entries(src)) if (k.startsWith("_page_") && f.v) entries.push({ key: k, v: { hidden: !!f.v.hidden, owner: f.v.owner || "", done: false }, by: me.name });
        } else {
          for (const s of M.slides) for (const e of s.elements) {
            if (e.type === "text" && e.keep) entries.push({ key: e.key, v: e.default, by: "_tpl" });
            if (e.type === "table") e.rows.forEach((row, r) => row.cells.forEach((c, ci) => {
              if ((e.keepCols || []).includes(ci)) entries.push({ key: YTCRender.cellKey(e, r, ci), v: c.text, by: "_tpl" });
            }));
          }
        }
        await store.setFields(rep.id, entries, me.name);
        busy(false); go("editor", { id: rep.id });
      } catch (e) { busy(false); toast("สร้างไม่สำเร็จ: " + e.message, "err"); }
    };
  }

  /* ---------- editor ---------- */
  async function openEditor(id) {
    document.body.dataset.view = "editor";
    const main = $("#main");
    main.innerHTML = `<div class="loading">กำลังเปิดรีพอร์ต…</div>`;
    let report, fields;
    try {
      report = await store.getReport(id);
      if (!report) { main.innerHTML = `<div class="loading">ไม่พบรีพอร์ตนี้ <a href="./">กลับหน้าแรก</a></div>`; return; }
      fields = await store.getFields(id);
    } catch (e) { main.innerHTML = `<div class="loading">เปิดไม่สำเร็จ: ${esc(e.message)}</div>`; return; }
    const tid = report.template, T = TEMPLATES[tid], M = await manifest(tid);
    const discs = await allDisclaimers(tid);
    const ctx = { manifest: M, base: T.base, fields, report, resolveUrl: u => store.resolveUrl(u), fetchBytes: u => store.fetchBytes(u) };
    const discOf = () => discs.find(d => d.id === (fields._disclaimer && fields._disclaimer.v)) || discs[discs.length - 1];
    ctx.disclaimer = discOf();
    const fileBase = () => `${M.name} ${YTCRender.ddmmyyyy(report.report_date)}`;

    let peers = [], focusKey = null, typed = false, activeImg = null;
    const pending = {}; let saveTimer = null, saving = false;
    const bcastTimers = {};

    /* --- top bar --- */
    $("#topbar-report").innerHTML = `
      <button class="btn ghost sm" id="back" title="กลับหน้ารายการ">← รีพอร์ตทั้งหมด</button>
      <div class="rep-title">${esc(report.title)}</div>
      <input type="date" id="rep-date" value="${report.report_date}" title="วันที่ของรีพอร์ต (ทุกหน้า)">
      <select id="rep-status" title="สถานะ"><option value="draft">Draft</option><option value="final">Final</option></select>
      <span id="save-state" class="save ok">บันทึกแล้ว</span>
      <span id="live-state" class="live wait" title="กำลังเชื่อมต่อ…">● เชื่อมต่อ…</span>
      <div id="peers" class="peers"></div>
      <div class="spacer"></div>
      <label class="chk" title="ไฮไลต์ช่องที่ยังเป็นข้อความเดิมที่คัดลอกมาจากรีพอร์ตก่อนหน้า"><input type="checkbox" id="show-stale" checked> ช่องที่ยังไม่แก้</label>
      <button class="btn sm" id="share">คัดลอกลิงก์</button>
      <button class="btn sm" id="dl-pptx">⬇ PowerPoint</button>
      <button class="btn primary sm" id="dl-pdf">⬇ PDF</button>`;
    $("#rep-status").value = report.status || "draft";
    $("#back").onclick = () => go("home");

    /* --- layout --- */
    main.innerHTML = `<div class="editor"><aside class="side" id="side"></aside><div class="canvas" id="canvas"><div class="zoom" id="zoom"></div></div></div>
      <div class="zoombar"><button id="z-out">−</button><span id="z-val"></span><button id="z-in">+</button><button id="z-fit">พอดี</button></div>`;
    const zoomEl = $("#zoom");
    let zoom = lsGet("ytc_zoom", 0);

    function pageMeta(n) { return (fields["_page_" + n] && fields["_page_" + n].v) || {}; }
    function ownersList() {
      const s = new Set([me.name, ...peers.map(p => p.name)]);
      for (const k in fields) if (k.startsWith("_page_") && fields[k].v && fields[k].v.owner) s.add(fields[k].v.owner);
      return [...s].filter(Boolean);
    }

    function renderSide() {
      const side = $("#side");
      side.innerHTML = `<div class="side-h">หน้าในรีพอร์ต</div>` + M.slides.filter(s => !M.disclaimerSlides.includes(s.n)).map(s => {
        const m = pageMeta(s.n);
        const who = peers.filter(p => p.focus && p.focus.startsWith(`s${s.n}_`));
        return `<a class="side-item ${m.hidden ? "hidden" : ""} ${m.done ? "done" : ""}" href="#p${s.n}" data-n="${s.n}">
          <span class="num">${s.n}</span><span class="t">${esc(s.title)}<small>${m.owner ? esc(m.owner) : "ยังไม่มีผู้รับผิดชอบ"}</small></span>
          <span class="dots">${who.map(p => `<i style="background:${p.color}" title="${esc(p.name)}"></i>`).join("")}</span>
          ${m.done ? `<span class="ok">✓</span>` : ""}</a>`;
      }).join("") + `<a class="side-item" href="#pdisc" data-n="disc"><span class="num">D</span><span class="t">Disclaimer<small>${esc(discOf().label)}</small></span></a>`;
      side.querySelectorAll(".side-item").forEach(a => a.onclick = ev => {
        ev.preventDefault();
        const t = document.getElementById(a.getAttribute("href").slice(1)); t && t.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    function pageHead(s) {
      const m = pageMeta(s.n);
      const h = document.createElement("div"); h.className = "page-head"; h.id = "p" + s.n;
      h.innerHTML = `<span class="pn">หน้า ${s.n}</span><b>${esc(s.title)}</b>
        <label>ผู้รับผิดชอบ <input class="owner" list="owners" value="${esc(m.owner || "")}" placeholder="ใส่ชื่อ"></label>
        <label class="chk"><input type="checkbox" class="done" ${m.done ? "checked" : ""}> เสร็จแล้ว</label>
        <label class="chk"><input type="checkbox" class="hide" ${m.hidden ? "checked" : ""}> ไม่ใส่หน้านี้ในไฟล์</label>`;
      const upd = patch => { const v = { ...pageMeta(s.n), ...patch }; commit("_page_" + s.n, v, { immediate: true }); renderSide(); wrap(s.n).classList.toggle("is-hidden", !!v.hidden); };
      h.querySelector(".owner").onchange = e => upd({ owner: e.target.value.trim() });
      h.querySelector(".done").onchange = e => upd({ done: e.target.checked });
      h.querySelector(".hide").onchange = e => upd({ hidden: e.target.checked });
      return h;
    }
    const wrap = n => document.querySelector(`.page-wrap[data-n="${n}"]`);

    function renderPages() {
      zoomEl.innerHTML = `<datalist id="owners">${ownersList().map(n => `<option value="${esc(n)}">`).join("")}</datalist>`;
      for (const s of M.slides) {
        if (M.disclaimerSlides.includes(s.n)) continue;
        const w = document.createElement("div"); w.className = "page-wrap" + (pageMeta(s.n).hidden ? " is-hidden" : ""); w.dataset.n = s.n;
        w.appendChild(pageHead(s));
        const pg = YTCRender.buildPage(s, ctx, { edit: true });
        w.appendChild(pg); zoomEl.appendChild(w);
        wirePage(pg, s);
      }
      renderDisclaimerSection();
      applyZoom(); paintPeers();
    }

    function renderDisclaimerSection() {
      let w = $(".page-wrap.discw"); if (w) w.remove();
      w = document.createElement("div"); w.className = "page-wrap discw";
      const d = discOf();
      w.innerHTML = `<div class="page-head" id="pdisc"><span class="pn">หน้าท้าย</span><b>Disclaimer</b>
        <label>เวอร์ชัน <select id="disc-sel">${discs.map(x => `<option value="${x.id}" ${x.id === d.id ? "selected" : ""}>${esc(x.label)}</option>`).join("")}</select></label>
        <button class="btn sm" id="disc-up">อัปโหลดใหม่</button></div>`;
      const grid = document.createElement("div"); grid.className = "disc-pages";
      d.pages.forEach(u => grid.appendChild(YTCRender.buildDisclaimerPage(u, ctx)));
      w.appendChild(grid); zoomEl.appendChild(w);
      $("#disc-sel").onchange = e => { commit("_disclaimer", e.target.value, { immediate: true }); ctx.disclaimer = discOf(); renderDisclaimerSection(); renderSide(); };
      $("#disc-up").onclick = () => disclaimerUpload(tid, async () => {
        const fresh = await allDisclaimers(tid); discs.splice(0, discs.length, ...fresh);
        commit("_disclaimer", discs[0].id, { immediate: true }); ctx.disclaimer = discOf(); renderDisclaimerSection(); renderSide();
      });
      applyZoom();
    }

    function applyZoom() {
      const avail = $("#canvas").clientWidth - 72;
      const fit = Math.min(1.9, Math.max(0.5, avail / M.widthPt));
      const z = zoom || fit;
      zoomEl.style.zoom = z;
      $("#z-val").textContent = Math.round(z / 1.333 * 100) + "%";
    }
    $("#z-in").onclick = () => { zoom = Math.min(3, (zoom || parseFloat(zoomEl.style.zoom)) + 0.15); lsSet("ytc_zoom", zoom); applyZoom(); };
    $("#z-out").onclick = () => { zoom = Math.max(0.4, (zoom || parseFloat(zoomEl.style.zoom)) - 0.15); lsSet("ytc_zoom", zoom); applyZoom(); };
    $("#z-fit").onclick = () => { zoom = 0; lsSet("ytc_zoom", 0); applyZoom(); };
    const onResize = () => applyZoom();
    window.addEventListener("resize", onResize);

    /* --- saving --- */
    function setSaveState() {
      const n = Object.keys(pending).length, el = $("#save-state"); if (!el) return;
      el.className = "save " + (n || saving ? "busy" : "ok");
      el.textContent = n || saving ? "กำลังบันทึก…" : "บันทึกแล้ว";
    }
    async function flush() {
      clearTimeout(saveTimer); saveTimer = null;
      const keys = Object.keys(pending); if (!keys.length || saving) return;
      const entries = keys.map(k => ({ key: k, v: pending[k] })); keys.forEach(k => { delete pending[k]; inflight.add(k); });
      saving = true; setSaveState();
      try { await store.setFields(report.id, entries, me.name); keys.forEach(k => { inflight.delete(k); savedAt[k] = Date.now(); }); }
      catch (e) {
        keys.forEach(k => inflight.delete(k));
        for (const en of entries) if (!(en.key in pending)) pending[en.key] = en.v;
        $("#save-state").className = "save err"; $("#save-state").textContent = "บันทึกไม่สำเร็จ — กำลังลองใหม่";
        saving = false; saveTimer = setTimeout(flush, 4000); return;
      }
      saving = false; setSaveState();
      if (Object.keys(pending).length) saveTimer = setTimeout(flush, 600);
    }
    function commit(key, v, { immediate = false, broadcast = true } = {}) {
      fields[key] = { v, by: me.name, at: new Date().toISOString() };
      pending[key] = v; setSaveState();
      if (broadcast && live) live.sendField(key, v);
      clearTimeout(saveTimer); saveTimer = setTimeout(flush, immediate ? 50 : 900);
    }
    function liveType(key, v) {
      fields[key] = { v, by: me.name, at: new Date().toISOString() };
      pending[key] = v; setSaveState();
      if (!bcastTimers[key]) bcastTimers[key] = setTimeout(() => { delete bcastTimers[key]; live && live.sendField(key, fields[key].v); }, 200);
      clearTimeout(saveTimer); saveTimer = setTimeout(flush, 1200);
    }

    /* --- wiring editable elements --- */
    function wirePage(pg, slide) {
      pg.querySelectorAll(".tx[contenteditable]").forEach(tx => {
        const key = tx.dataset.key || tx.closest(".el").dataset.key;
        tx.dataset.key = key;
        tx.addEventListener("focus", () => { focusKey = key; typed = false; live && live.setFocus(key); });
        tx.addEventListener("blur", () => {
          if (focusKey === key) { focusKey = null; live && live.setFocus(null); }
          const holder = tx.closest(".el,.cell"); holder.classList.remove("conflict");
          if (typed) commit(key, tx.innerText.replace(/\n$/, ""), { immediate: true });
          typed = false;
        });
        tx.addEventListener("input", () => {
          if (focusKey !== key) { focusKey = key; live && live.setFocus(key); }
          typed = true;
          tx.closest(".el,.cell").classList.remove("stale");
          liveType(key, tx.innerText.replace(/\n$/, ""));
        });
        tx.addEventListener("paste", ev => {
          const text = (ev.clipboardData || window.clipboardData).getData("text/plain");
          if (tx.closest(".el-table") && /[\t\n]/.test(text.trim())) {   // Excel block -> fill the table
            ev.preventDefault(); pasteGrid(tx, text); return;
          }
          if (ev.clipboardData && [...ev.clipboardData.items].some(i => i.type.startsWith("image/")) && !text) { ev.preventDefault(); toast("วางรูปได้เฉพาะในกรอบรูป — คลิกกรอบรูปก่อนแล้วกด Ctrl+V"); return; }
          ev.preventDefault();
          document.execCommand("insertText", false, text.replace(/\r/g, ""));
        });
      });
      pg.querySelectorAll(".el-image").forEach(box => wireImage(box));
    }

    function pasteGrid(tx, text) {
      const key = tx.dataset.key, m = key.match(/^(.*)_r(\d+)c(\d+)$/);
      const tblKey = m[1], r0 = +m[2], c0 = +m[3];
      const rows = text.replace(/\r/g, "").replace(/\n$/, "").split("\n").map(l => l.split("\t"));
      let n = 0;
      rows.forEach((cols, i) => cols.forEach((val, j) => {
        const k = `${tblKey}_r${r0 + i}c${c0 + j}`;
        const t = document.querySelector(`.tx[data-key="${k}"]`);
        if (t) { t.textContent = val.trim(); t.closest(".cell").classList.remove("stale"); commit(k, val.trim()); n++; }
      }));
      typed = false; toast(`วางข้อมูล ${n} ช่องแล้ว`);
    }

    function wireImage(box) {
      const key = box.dataset.key;
      box.onclick = ev => {
        const act = ev.target.dataset && ev.target.dataset.act;
        selectImg(box);
        if (act === "upload") pickFile(key);
        if (act === "clear") { if (confirm("ลบรูปนี้?")) setImage(key, null); }
        if (act === "fit") {
          const v0 = fields[key].v;
          const cur = (v0.rect || v0.crop) ? "free" : (v0.fit === "cover" ? "crop" : v0.fit || "crop");
          const nxt = { free: "crop", crop: "contain", contain: "stretch", stretch: "crop" }[cur];
          const { rect, crop, ...rest } = v0;
          setImage(key, { ...rest, fit: nxt });
        }
        if (act === "adjust") startAdjust(box);
      };
      box.ondblclick = ev => {
        if (ev.target.closest(".imgbar") || ev.target.closest(".adjbar")) return;
        const v = fields[key] && fields[key].v;
        if (v && v.url) startAdjust(box);
        else pickFile(key);
      };
      box.addEventListener("dragover", ev => { ev.preventDefault(); box.classList.add("drop"); });
      box.addEventListener("dragleave", () => box.classList.remove("drop"));
      box.addEventListener("drop", ev => {
        ev.preventDefault(); box.classList.remove("drop");
        const f = [...ev.dataTransfer.files].find(f => f.type.startsWith("image/"));
        if (f) uploadImage(key, f);
      });
    }
    function selectImg(box) {
      document.querySelectorAll(".el-image.sel").forEach(b => b.classList.remove("sel"));
      box.classList.add("sel"); activeImg = box.dataset.key; box.focus({ preventScroll: true });
      live && live.setFocus(activeImg);
    }
    const onDocClick = ev => {
      if (!ev.target.closest(".el-image")) {
        document.querySelectorAll(".el-image.sel").forEach(b => b.classList.remove("sel"));
        if (activeImg && focusKey === null) live && live.setFocus(null);
        activeImg = null;
      }
    };
    document.addEventListener("mousedown", onDocClick);
    const onPaste = ev => {
      if (!activeImg || document.activeElement && document.activeElement.isContentEditable) return;
      const item = [...(ev.clipboardData ? ev.clipboardData.items : [])].find(i => i.type.startsWith("image/"));
      if (!item) return toast("คลิปบอร์ดไม่มีรูป — คัดลอกรูปกราฟก่อน (เช่น Snipping Tool / TradingView: Copy image)", "err");
      ev.preventDefault(); uploadImage(activeImg, item.getAsFile());
    };
    document.addEventListener("paste", onPaste);

    function pickFile(key) {
      const inp = document.createElement("input"); inp.type = "file"; inp.accept = "image/*";
      inp.onchange = () => inp.files[0] && uploadImage(key, inp.files[0]); inp.click();
    }
    function elementOf(key) { for (const s of M.slides) for (const e of s.elements) if (e.key === key) return e; }
    async function uploadImage(key, file) {
      const e = elementOf(key); const box = document.querySelector(`.el[data-key="${key}"]`);
      box && box.classList.add("uploading");
      try {
        const bmp = await createImageBitmap(file);
        const t = trimBox(bmp);                                  // drop blank screenshot margins
        const maxW = Math.max(2000, Math.round(e.box[2] * 4.2)); // ~300 dpi, with room to zoom in
        const s = Math.min(1, maxW / t.w);
        const cv = document.createElement("canvas");
        cv.width = Math.round(t.w * s); cv.height = Math.round(t.h * s);
        const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
        g.imageSmoothingQuality = "high"; g.drawImage(bmp, t.x, t.y, t.w, t.h, 0, 0, cv.width, cv.height);
        let blob = await new Promise(r => cv.toBlob(r, "image/png")), ext = "png";
        if (blob.size > 1500000) { blob = await new Promise(r => cv.toBlob(r, "image/jpeg", 0.92)); ext = "jpg"; }
        const url = await store.uploadBlob(report.id, blob, ext);
        setImage(key, { url, w: cv.width, h: cv.height, fit: "crop" });   // new picture always fills the frame
        toast("วางรูปแล้ว — ดับเบิลคลิกที่รูปเพื่อเลื่อน/ซูม");
      } catch (err) { toast("อัปโหลดรูปไม่สำเร็จ: " + err.message, "err"); }
      finally { box && box.classList.remove("uploading"); }
    }
    /* blank-margin trim: rows/cols at the edges that are one flat colour (screenshot borders) */
    function trimBox(bmp) {
      const W = bmp.width, H = bmp.height;
      const cv = document.createElement("canvas"); cv.width = W; cv.height = H;
      const g = cv.getContext("2d", { willReadFrequently: true }); g.drawImage(bmp, 0, 0);
      const d = g.getImageData(0, 0, W, H).data;
      const px = (x, y) => (y * W + x) * 4;
      const ref = px(0, 0);
      const near = i => Math.abs(d[i] - d[ref]) < 14 && Math.abs(d[i + 1] - d[ref + 1]) < 14 && Math.abs(d[i + 2] - d[ref + 2]) < 14;
      const rowFlat = y => { for (let x = 0; x < W; x += 2) if (!near(px(x, y))) return false; return true; };
      const colFlat = (x, y0, y1) => { for (let y = y0; y < y1; y += 2) if (!near(px(x, y))) return false; return true; };
      let top = 0, bot = H - 1, left = 0, right = W - 1;
      while (top < bot && rowFlat(top)) top++;
      while (bot > top && rowFlat(bot)) bot--;
      while (left < right && colFlat(left, top, bot + 1)) left++;
      while (right > left && colFlat(right, top, bot + 1)) right--;
      const pad = 2;
      const t = { x: Math.max(0, left - pad), y: Math.max(0, top - pad) };
      t.w = Math.min(W, right + pad + 1) - t.x; t.h = Math.min(H, bot + pad + 1) - t.y;
      if (t.w < W * 0.4 || t.h < H * 0.4) return { x: 0, y: 0, w: W, h: H };   // mostly flat: keep everything
      return t;
    }

    /* picture tool: drag = move, wheel = zoom, edge handles = stretch left/right or up/down */
    let adjusting = null;
    function startAdjust(box) {
      if (!box) return;
      if (adjusting) finishAdjust(true);
      const key = box.dataset.key, e = elementOf(key), v = fields[key] && fields[key].v;
      if (!v || !v.url) return;
      const fw = e.box[2], fh = e.box[3], iw = v.w || fw, ih = v.h || fh;
      let R = { ...YTCRender.rectOf(v, fw, fh) };
      const img = box.querySelector(".clip img"); if (!img) return;
      const ghost = img.cloneNode(); ghost.className = "ghost"; box.insertBefore(ghost, box.firstChild);
      const handles = ["l", "r", "t", "b"].map(side => {
        const hd = document.createElement("div"); hd.className = "hdl hdl-" + side; hd.dataset.side = side;
        hd.title = side === "l" || side === "r" ? "ลากเพื่อยืด/หดรูปซ้าย-ขวา" : "ลากเพื่อยืด/หดรูปบน-ล่าง";
        box.appendChild(hd); return hd;
      });
      box.classList.add("adjusting"); selectImg(box);
      const bar = document.createElement("div"); bar.className = "adjbar";
      bar.innerHTML = `<span>ลากรูป=เลื่อน · ลูกกลิ้ง=ซูม · จุดที่ขอบ=ยืด</span>` +
        `<button data-a="zin" title="ซูมเข้า">＋</button><button data-a="zout" title="ซูมออก">－</button>` +
        `<button data-a="fillw" title="ยืดให้เต็มความกว้างกรอบ">↔ เต็มความกว้าง</button><button data-a="fillh" title="ยืดให้เต็มความสูงกรอบ">↕ เต็มความสูง</button>` +
        `<button data-a="cover">เต็มกรอบ</button><button data-a="contain">พอดีกรอบ</button><button data-a="ok" class="ok">เสร็จ</button>`;
      box.appendChild(bar);
      const MIN = 0.08, MAX = 8;
      const clamp = () => {
        R.w = Math.min(MAX, Math.max(MIN, R.w)); R.h = Math.min(MAX, Math.max(MIN, R.h));
        R.l = Math.min(0.95, Math.max(0.05 - R.w, R.l)); R.t = Math.min(0.95, Math.max(0.05 - R.h, R.t));
      };
      const paint = () => {
        clamp(); YTCRender.placeRect(img, R); YTCRender.placeRect(ghost, R);
        const mx = (R.l + R.w / 2) * 100, my = (R.t + R.h / 2) * 100;
        Object.assign(handles[0].style, { left: R.l * 100 + "%", top: my + "%" });
        Object.assign(handles[1].style, { left: (R.l + R.w) * 100 + "%", top: my + "%" });
        Object.assign(handles[2].style, { left: mx + "%", top: R.t * 100 + "%" });
        Object.assign(handles[3].style, { left: mx + "%", top: (R.t + R.h) * 100 + "%" });
      };
      const zoomAt = (f, px = 0.5, py = 0.5) => {          // keep the frame point (px, py) still
        const nw = Math.min(MAX, Math.max(MIN, R.w * f)), nh = Math.min(MAX, Math.max(MIN, R.h * f));
        R.l = px - (px - R.l) * nw / R.w; R.t = py - (py - R.t) * nh / R.h; R.w = nw; R.h = nh; paint();
      };
      let drag = null;
      const down = ev => {
        if (ev.target.closest(".adjbar")) return;
        ev.preventDefault(); try { box.setPointerCapture(ev.pointerId); } catch (err) {}
        drag = { x: ev.clientX, y: ev.clientY, R: { ...R }, side: ev.target.dataset && ev.target.dataset.side };
      };
      const move = ev => {
        if (!drag) return;
        const r = box.getBoundingClientRect();
        const dx = (ev.clientX - drag.x) / r.width, dy = (ev.clientY - drag.y) / r.height, o = drag.R;
        if (drag.side === "r") R.w = Math.max(MIN, o.w + dx);
        else if (drag.side === "l") { R.w = Math.max(MIN, o.w - dx); R.l = o.l + o.w - R.w; }
        else if (drag.side === "b") R.h = Math.max(MIN, o.h + dy);
        else if (drag.side === "t") { R.h = Math.max(MIN, o.h - dy); R.t = o.t + o.h - R.h; }
        else { R.l = o.l + dx; R.t = o.t + dy; }
        paint();
      };
      const up = () => { drag = null; };
      const wheel = ev => {
        ev.preventDefault();
        const r = box.getBoundingClientRect();
        zoomAt(Math.exp(-ev.deltaY * 0.0015), (ev.clientX - r.left) / r.width, (ev.clientY - r.top) / r.height);
      };
      const keys = ev => { if (ev.key === "Enter") { ev.preventDefault(); finishAdjust(true); } if (ev.key === "Escape") finishAdjust(false); };
      bar.addEventListener("pointerdown", ev => ev.stopPropagation());
      bar.addEventListener("dblclick", ev => ev.stopPropagation());
      bar.onclick = ev => {
        ev.stopPropagation();
        const a = ev.target.dataset.a;
        if (a === "zin") zoomAt(1.15); if (a === "zout") zoomAt(1 / 1.15);
        if (a === "fillw") { R.l = 0; R.w = 1; paint(); }
        if (a === "fillh") { R.t = 0; R.h = 1; paint(); }
        if (a === "cover") { R = YTCRender.coverRect(iw, ih, fw, fh); paint(); }
        if (a === "contain") { R = YTCRender.containRect(iw, ih, fw, fh); paint(); }
        if (a === "ok") finishAdjust(true);
      };
      box.addEventListener("pointerdown", down); box.addEventListener("pointermove", move);
      box.addEventListener("pointerup", up); box.addEventListener("wheel", wheel, { passive: false });
      document.addEventListener("keydown", keys);
      const outside = ev => { if (!box.contains(ev.target)) finishAdjust(true); };
      setTimeout(() => document.addEventListener("mousedown", outside), 0);
      paint();
      adjusting = {
        key, box,
        done: save => {
          box.removeEventListener("pointerdown", down); box.removeEventListener("pointermove", move);
          box.removeEventListener("pointerup", up); box.removeEventListener("wheel", wheel);
          document.removeEventListener("keydown", keys); document.removeEventListener("mousedown", outside);
          if (save) {
            const { crop, ...rest } = fields[key].v;
            const q = n => +n.toFixed(5);
            setImage(key, { ...rest, fit: "free", rect: { l: q(R.l), t: q(R.t), w: q(R.w), h: q(R.h) } });
          } else rerenderEl(key);
        },
      };
    }
    function finishAdjust(save) { const a = adjusting; adjusting = null; if (a) a.done(save); }

    function setImage(key, v) { commit(key, v, { immediate: true }); rerenderEl(key); }
    function rerenderEl(key) {
      const e = elementOf(key); if (!e) return;
      const slide = M.slides.find(s => s.elements.includes(e));
      const tmp = YTCRender.buildPage({ ...slide, elements: [e] }, ctx, { edit: true });
      const fresh = tmp.querySelector(".el"); const old = document.querySelector(`.page .el[data-key="${key}"]`);
      if (old && fresh) { const wasSel = old.classList.contains("sel"); old.replaceWith(fresh); wireImage(fresh); if (wasSel) fresh.classList.add("sel"); }
      paintPeers();
    }

    /* --- remote changes --- */
    function applyRemote(key, v, by) {
      fields[key] = { v, by, at: new Date().toISOString() };
      if (key === "_disclaimer") { ctx.disclaimer = discOf(); renderDisclaimerSection(); renderSide(); return; }
      if (key.startsWith("_page_")) {
        const n = key.slice(6), h = document.getElementById("p" + n);
        if (h) { h.querySelector(".owner").value = v.owner || ""; h.querySelector(".done").checked = !!v.done; h.querySelector(".hide").checked = !!v.hidden; wrap(n).classList.toggle("is-hidden", !!v.hidden); }
        renderSide(); return;
      }
      const tx = document.querySelector(`.tx[data-key="${CSS.escape(key)}"]`);
      if (tx) {
        if (focusKey === key && typed) { tx.closest(".el,.cell").classList.add("conflict"); tx.closest(".el,.cell").dataset.by = by; return; }
        if (tx.innerText.replace(/\n$/, "") !== (v ?? "")) tx.textContent = v ?? "";
        tx.closest(".el,.cell").classList.remove("stale");
      } else if (document.querySelector(`.el-image[data-key="${CSS.escape(key)}"]`)) { if (!(adjusting && adjusting.key === key)) rerenderEl(key); }
    }
    function paintPeers() {
      document.querySelectorAll(".peer-tag").forEach(t => t.remove());
      document.querySelectorAll(".peer-on").forEach(t => { t.classList.remove("peer-on"); t.style.removeProperty("--peer"); });
      for (const p of peers) {
        if (!p.focus) continue;
        const t = document.querySelector(`.tx[data-key="${CSS.escape(p.focus)}"]`);
        const holder = t ? t.closest(".el,.cell") : document.querySelector(`.el[data-key="${CSS.escape(p.focus)}"]`);
        if (!holder) continue;
        holder.classList.add("peer-on"); holder.style.setProperty("--peer", p.color);
        const tag = document.createElement("span"); tag.className = "peer-tag"; tag.textContent = p.name; tag.style.background = p.color;
        (holder.closest(".el") || holder).appendChild(tag);
      }
      const pe = $("#peers");
      if (pe) pe.innerHTML = [{ ...me, self: true }, ...peers].map(p => `<span class="av" style="background:${p.color}" title="${esc(p.name)}${p.self ? " (คุณ)" : ""}">${esc((p.name || "?").slice(0, 2))}</span>`).join("");
    }

    /* ---- sync: live push (WebSocket) + a fallback that re-reads the database over HTTPS.
       Office networks often block or drop WebSockets; the fallback keeps everyone in sync anyway. ---- */
    const inflight = new Set(), savedAt = {}, pushedAt = {};
    let liveState = "wait", pollTimer = null, pollTick = 0, polling = false;
    // newest server timestamp seen; each poll asks only for rows changed after (it - 10 s overlap)
    let lastAt = Object.values(fields).reduce((m, f) => (f.at && f.at > m ? f.at : m), "");
    function showLive() {
      const el = $("#live-state"); if (!el) return;
      const map = { live: ["live ok", "● Live", "เชื่อมต่อแบบเรียลไทม์ — เห็นงานของทีมทันที"],
        poll: ["live poll", "● ซิงก์อัตโนมัติ", "เครือข่ายนี้ไม่รองรับการเชื่อมต่อแบบเรียลไทม์ — ระบบดึงงานของทีมทุก 3 วินาทีแทน"],
        wait: ["live wait", "● เชื่อมต่อ…", "กำลังเชื่อมต่อ…"] }[liveState];
      el.className = map[0]; el.textContent = map[1]; el.title = map[2];
    }
    async function syncPoll() {
      if (polling || document.hidden) return;
      pollTick++;
      polling = true;
      try {
        const since = lastAt ? new Date(new Date(lastAt).getTime() - 10000).toISOString() : "";
        const rows = await store.getFieldsSince(report.id, since);
        const now = Date.now();
        for (const [k, row] of Object.entries(rows)) {
          if (row.at && row.at > lastAt) lastAt = row.at;
          if (k in pending || inflight.has(k)) continue;           // my own unsaved / saving edit
          if (now - (savedAt[k] || 0) < 4000 || now - (pushedAt[k] || 0) < 5000) continue;
          const mine = fields[k] ? JSON.stringify(fields[k].v) : undefined;
          if (mine !== JSON.stringify(row.v)) applyRemote(k, row.v, row.by, true);
        }
        if (pollTick % 5 === 0 || liveState !== "live") {
          const r = await store.getReport(report.id);
          if (r && r.report_date !== report.report_date) { report.report_date = r.report_date; $("#rep-date").value = r.report_date; refreshDates(); }
          if (r && r.status !== report.status) { report.status = r.status; $("#rep-status").value = r.status; }
        }
      } catch (e) { /* offline for a moment - try again next tick */ }
      polling = false;
    }
    pollTimer = setInterval(syncPoll, 3000);
    const onVisible = () => { if (!document.hidden) { pollTick = 4; syncPoll(); } };
    document.addEventListener("visibilitychange", onVisible);

    const live = store.join(report.id, me, {
      onField: (k, v, by) => { pushedAt[k] = Date.now(); applyRemote(k, v, by); },
      onPresence: list => { peers = list.filter(p => p && p.id !== me.id); paintPeers(); renderSide(); },
      onReport: patch => {
        Object.assign(report, patch);
        if (patch.report_date) { $("#rep-date").value = patch.report_date; refreshDates(); }
        if (patch.status) $("#rep-status").value = patch.status;
      },
      onStatus: s => { liveState = s === "live" ? "live" : "poll"; showLive(); if (s === "live") { pollTick = 4; syncPoll(); } },
    });

    function refreshDates() {
      for (const s of M.slides) for (const e of s.elements) if (e.link === "date") {
        const t = document.querySelector(`.el[data-key="${e.key}"] .tx`); if (t) t.textContent = YTCRender.thaiDate(report.report_date);
      }
    }
    $("#rep-date").onchange = async e => {
      const v = e.target.value; if (!v) return;
      report.report_date = v; refreshDates();
      try { await store.updateReport(report.id, { report_date: v }); live.sendReport({ report_date: v }); } catch (err) { toast(err.message, "err"); }
    };
    $("#rep-status").onchange = async e => {
      report.status = e.target.value;
      try { await store.updateReport(report.id, { status: report.status }); live.sendReport({ status: report.status }); } catch (err) { toast(err.message, "err"); }
    };
    $("#show-stale").onchange = e => document.body.classList.toggle("hide-stale", !e.target.checked);
    $("#share").onclick = async () => {
      try { await navigator.clipboard.writeText(teamLink(report.id)); toast("คัดลอกลิงก์รีพอร์ตแล้ว — ส่งให้ทีมได้เลย"); }
      catch (e) { prompt("คัดลอกลิงก์นี้", teamLink(report.id)); }
    };
    const runExport = async (fn, label) => {
      if (document.activeElement && document.activeElement.isContentEditable) document.activeElement.blur();
      finishAdjust(true);
      await flush();
      ctx.disclaimer = discOf(); ctx.fileBase = fileBase();
      try { await fn(ctx, m => busy(m)); busy(false); toast(label + " ดาวน์โหลดแล้ว"); }
      catch (e) { busy(false); console.error(e); toast(label + " ไม่สำเร็จ: " + e.message, "err"); }
    };
    $("#dl-pptx").onclick = () => runExport(YTCExport.exportPptx, "PowerPoint");
    $("#dl-pdf").onclick = () => runExport(YTCExport.exportPdf, "PDF");

    const onUnload = ev => { if (Object.keys(pending).length) { flush(); ev.preventDefault(); ev.returnValue = ""; } };
    window.addEventListener("beforeunload", onUnload);
    const onHide = () => { try { live.leave(); } catch (e) {} };
    window.addEventListener("pagehide", onHide);

    view = {
      name: "editor",
      leave: async () => {
        await flush(); live.leave(); clearInterval(pollTimer); document.removeEventListener("visibilitychange", onVisible);
        window.removeEventListener("resize", onResize); window.removeEventListener("beforeunload", onUnload); window.removeEventListener("pagehide", onHide);
        document.removeEventListener("paste", onPaste); document.removeEventListener("mousedown", onDocClick);
      },
    };
    renderSide(); renderPages(); showLive();
    setTimeout(() => { if (liveState === "wait") { liveState = "poll"; showLive(); } }, 8000);   // never connected
    window.YTC_DEBUG = { ctx, fields, report, M, sync: () => ({ liveState, pollTick }) };
  }

  /* ---------- boot ---------- */
  async function boot() {
    store = await YTCStore.create();
    window.YTC_STORE = store;
    if (store.mode === "nokey") {
      $("#main").innerHTML = `<div class="loading"><h2>ต้องเข้าผ่านลิงก์ของทีม</h2><p>ขอลิงก์ Yuanta Technical Central จากหัวหน้าทีม (ลิงก์จะมี #k=… ต่อท้าย)</p></div>`;
      return;
    }
    $("#mode").textContent = store.mode === "local" ? "โหมดทดลอง (เก็บในเครื่องนี้)" : "ออนไลน์ · ทีม";
    $("#mode").className = "mode " + store.mode;
    await ensureMe();
    $("#me").onclick = () => askName();
    $("#brand").onclick = ev => { ev.preventDefault(); go("home"); };
    window.addEventListener("popstate", route);
    route();
  }
  document.addEventListener("DOMContentLoaded", boot);
})();
