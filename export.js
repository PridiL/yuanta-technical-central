/* PPTX + PDF export, and disclaimer PDF processing.
 * PPTX: the original deck (skeleton.pptx) is edited in place, so masters, layouts,
 * fonts and every design element are exactly the template's.
 */
(function () {
  const A = "http://schemas.openxmlformats.org/drawingml/2006/main";
  const P = "http://schemas.openxmlformats.org/presentationml/2006/main";
  const R = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const PR = "http://schemas.openxmlformats.org/package/2006/relationships";
  const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
  const T_IMG = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
  const T_SLIDE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
  const T_LAYOUT = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout";
  const T_NOTES = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/notesSlide";
  const EMU = 12700;
  const parse = s => new DOMParser().parseFromString(s, "application/xml");
  const ser = d => new XMLSerializer().serializeToString(d);
  const kids = (el, ns, name) => [...el.childNodes].filter(n => n.nodeType === 1 && n.namespaceURI === ns && n.localName === name);
  const kid = (el, ns, name) => kids(el, ns, name)[0] || null;

  function download(blob, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name;
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 30000);
  }

  /* ---- text replacement keeping the template's run/paragraph formatting ---- */
  function setTxBody(txBody, text) {
    const doc = txBody.ownerDocument;
    const ps = kids(txBody, A, "p");
    let pPr = null, rPr = null, endPr = null;
    for (const p of ps) {
      if (!pPr) pPr = kid(p, A, "pPr");
      if (!endPr) endPr = kid(p, A, "endParaRPr");
      for (const r of kids(p, A, "r")) {
        const t = kid(r, A, "t");
        if (!rPr && t && t.textContent.trim()) rPr = kid(r, A, "rPr");
      }
      if (!rPr) { const r = kid(p, A, "r"); if (r) rPr = kid(r, A, "rPr"); }
    }
    ps.forEach(p => p.remove());
    const proto = rPr || endPr;
    for (const line of String(text ?? "").split("\n")) {
      const p = doc.createElementNS(A, "a:p");
      if (pPr) p.appendChild(pPr.cloneNode(true));
      if (line) {
        const r = doc.createElementNS(A, "a:r");
        if (proto) {
          const rp = doc.createElementNS(A, "a:rPr");
          for (const at of proto.attributes) rp.setAttribute(at.name, at.value);
          rp.removeAttribute("err"); rp.removeAttribute("dirty");
          for (const c of proto.childNodes) rp.appendChild(c.cloneNode(true));
          r.appendChild(rp);
        }
        const t = doc.createElementNS(A, "a:t"); t.textContent = line; r.appendChild(t);
        p.appendChild(r);
      }
      if (proto) {
        const ep = doc.createElementNS(A, "a:endParaRPr");
        for (const at of proto.attributes) ep.setAttribute(at.name, at.value);
        ep.removeAttribute("err"); ep.removeAttribute("dirty");
        for (const c of proto.childNodes) ep.appendChild(c.cloneNode(true));
        p.appendChild(ep);
      }
      txBody.appendChild(p);
    }
  }

  function sniffExt(bytes) {
    if (bytes[0] === 0x89 && bytes[1] === 0x50) return "png";
    if (bytes[0] === 0xff && bytes[1] === 0xd8) return "jpeg";
    if (bytes[0] === 0x47 && bytes[1] === 0x49) return "gif";
    return "png";
  }

  async function ensureDefaults(zip, exts) {
    const ct = parse(await zip.file("[Content_Types].xml").async("string"));
    const have = new Set([...ct.documentElement.getElementsByTagNameNS(CT, "Default")].map(d => d.getAttribute("Extension").toLowerCase()));
    for (const ext of exts) if (!have.has(ext)) {
      const d = ct.createElementNS(CT, "Default");
      d.setAttribute("Extension", ext); d.setAttribute("ContentType", "image/" + (ext === "jpg" ? "jpeg" : ext));
      ct.documentElement.insertBefore(d, ct.documentElement.firstChild);
    }
    zip.file("[Content_Types].xml", ser(ct));
  }

  /* ---- slide list surgery ---- */
  async function loadPres(zip) {
    return {
      pres: parse(await zip.file("ppt/presentation.xml").async("string")),
      rels: parse(await zip.file("ppt/_rels/presentation.xml.rels").async("string")),
      ct: parse(await zip.file("[Content_Types].xml").async("string")),
    };
  }
  async function savePres(zip, S) {
    zip.file("ppt/presentation.xml", ser(S.pres));
    zip.file("ppt/_rels/presentation.xml.rels", ser(S.rels));
    zip.file("[Content_Types].xml", ser(S.ct));
  }
  function relsPathOf(part) { const i = part.lastIndexOf("/"); return part.slice(0, i) + "/_rels/" + part.slice(i + 1) + ".rels"; }
  function removeOverride(S, part) {
    for (const o of [...S.ct.documentElement.getElementsByTagNameNS(CT, "Override")])
      if (o.getAttribute("PartName") === "/" + part) o.remove();
  }
  async function removeSlide(zip, S, part) {
    const target = part.replace(/^ppt\//, "");
    const rel = [...S.rels.documentElement.getElementsByTagNameNS(PR, "Relationship")].find(r => r.getAttribute("Target") === target);
    if (rel) {
      const rid = rel.getAttribute("Id");
      for (const s of [...S.pres.getElementsByTagNameNS(P, "sldId")]) if (s.getAttributeNS(R, "id") === rid) s.remove();
      rel.remove();
    }
    const rp = relsPathOf(part);
    if (zip.file(rp)) {
      const rels = parse(await zip.file(rp).async("string"));
      for (const r of rels.documentElement.getElementsByTagNameNS(PR, "Relationship")) {
        if (r.getAttribute("Type") === T_NOTES) {
          const np = "ppt/notesSlides/" + r.getAttribute("Target").split("/").pop();
          zip.remove(np); zip.remove(relsPathOf(np)); removeOverride(S, np);
        }
      }
      zip.remove(rp);
    }
    zip.remove(part); removeOverride(S, part);
  }
  async function layoutOf(zip, part) {
    const rels = parse(await zip.file(relsPathOf(part)).async("string"));
    const r = [...rels.documentElement.getElementsByTagNameNS(PR, "Relationship")].find(x => x.getAttribute("Type") === T_LAYOUT);
    return r && r.getAttribute("Target");
  }
  function addPictureSlide(zip, S, { num, layout, mediaName, wEmu, hEmu, name }) {
    const part = `ppt/slides/slide${num}.xml`;
    zip.file(part, `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="${A}" xmlns:r="${R}" xmlns:p="${P}"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="0" cy="0"/><a:chOff x="0" y="0"/><a:chExt cx="0" cy="0"/></a:xfrm></p:grpSpPr><p:pic><p:nvPicPr><p:cNvPr id="2" name="${name}"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="rId2"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${wEmu}" cy="${hEmu}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`);
    zip.file(relsPathOf(part), `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${PR}"><Relationship Id="rId1" Type="${T_LAYOUT}" Target="${layout}"/><Relationship Id="rId2" Type="${T_IMG}" Target="../media/${mediaName}"/></Relationships>`);
    const o = S.ct.createElementNS(CT, "Override");
    o.setAttribute("PartName", "/" + part);
    o.setAttribute("ContentType", "application/vnd.openxmlformats-officedocument.presentationml.slide+xml");
    S.ct.documentElement.appendChild(o);
    const rid = "rIdYtc" + num;
    const rel = S.rels.createElementNS(PR, "Relationship");
    rel.setAttribute("Id", rid); rel.setAttribute("Type", T_SLIDE); rel.setAttribute("Target", `slides/slide${num}.xml`);
    S.rels.documentElement.appendChild(rel);
    const lst = S.pres.getElementsByTagNameNS(P, "sldIdLst")[0];
    const ids = [...lst.getElementsByTagNameNS(P, "sldId")].map(s => +s.getAttribute("id"));
    const sid = S.pres.createElementNS(P, "p:sldId");
    sid.setAttribute("id", String(Math.max(255, ...ids, ...(S.usedIds || [])) + 1));
    (S.usedIds = S.usedIds || []).push(+sid.getAttribute("id"));
    sid.setAttributeNS(R, "r:id", rid);
    lst.appendChild(sid);
  }

  /* ---- PPTX ---- */
  async function exportPptx(ctx, onStep) {
    const M = ctx.manifest;
    onStep && onStep("กำลังโหลดเทมเพลต…");
    const zip = await JSZip.loadAsync(await (await fetch(ctx.base + "skeleton.pptx")).arrayBuffer());
    const exts = new Set();
    for (const slide of M.slides) {
      if (!slide.elements.length) continue;
      onStep && onStep(`กำลังสร้างหน้า ${slide.n}…`);
      const doc = parse(await zip.file(slide.part).async("string"));
      const rp = relsPathOf(slide.part);
      const rels = parse(await zip.file(rp).async("string"));
      const byId = {};
      for (const c of doc.getElementsByTagNameNS(P, "cNvPr")) byId[c.getAttribute("id")] = c.parentNode.parentNode;
      for (const e of slide.elements) {
        const node = byId[e.spid];
        if (!node) continue;
        if (e.type === "text") {
          const tb = kid(node, P, "txBody");
          if (tb) setTxBody(tb, YTCRender.textValue(ctx, e));
        } else if (e.type === "table") {
          const tbl = node.getElementsByTagNameNS(A, "tbl")[0];
          kids(tbl, A, "tr").forEach((tr, r) => kids(tr, A, "tc").forEach((tc, c) => {
            const tb = kid(tc, A, "txBody");
            if (tb && !(e.rows[r] && e.rows[r].cells[c] && e.rows[r].cells[c].merged)) setTxBody(tb, YTCRender.cellValue(ctx, e, r, c));
          }));
        } else if (e.type === "image") {
          const f = ctx.fields[e.key]; const val = f && f.v;
          if (!val || !val.url) { node.remove(); continue; }
          const bytes = await ctx.fetchBytes(val.url);
          const ext = sniffExt(bytes); exts.add(ext);
          const media = `ytc_s${slide.n}_${e.spid}.${ext}`;
          zip.file("ppt/media/" + media, bytes);
          const rid = "rIdYtc" + e.spid;
          const rel = rels.createElementNS(PR, "Relationship");
          rel.setAttribute("Id", rid); rel.setAttribute("Type", T_IMG); rel.setAttribute("Target", "../media/" + media);
          rels.documentElement.appendChild(rel);
          const blipFill = kid(node, P, "blipFill");
          const blip = kid(blipFill, A, "blip");
          blip.setAttributeNS(R, "r:embed", rid);
          for (const ch of [...blipFill.childNodes]) if (ch !== blip) ch.remove();
          const [x, y, w, h] = e.box;
          const iw = val.w || w, ih = val.h || h;
          {                                           // same placement as the editor
            const R = YTCRender.rectOf(val, w, h);
            // part of the frame the picture covers, and the part of the picture that shows
            const il = Math.max(0, R.l), it = Math.max(0, R.t), ir = Math.min(1, R.l + R.w), ib = Math.min(1, R.t + R.h);
            const xf = kid(kid(node, P, "spPr"), A, "xfrm");
            kid(xf, A, "off").setAttribute("x", Math.round((x + il * w) * EMU));
            kid(xf, A, "off").setAttribute("y", Math.round((y + it * h) * EMU));
            kid(xf, A, "ext").setAttribute("cx", Math.max(1, Math.round((ir - il) * w * EMU)));
            kid(xf, A, "ext").setAttribute("cy", Math.max(1, Math.round((ib - it) * h * EMU)));
            const pct = v => String(Math.round(v * 100000));
            const sr = doc.createElementNS(A, "a:srcRect");
            const L = (il - R.l) / R.w, T = (it - R.t) / R.h, Rr = (R.l + R.w - ir) / R.w, B = (R.t + R.h - ib) / R.h;
            if (L > 1e-5) sr.setAttribute("l", pct(L)); if (T > 1e-5) sr.setAttribute("t", pct(T));
            if (Rr > 1e-5) sr.setAttribute("r", pct(Rr)); if (B > 1e-5) sr.setAttribute("b", pct(B));
            if (sr.attributes.length) blipFill.appendChild(sr);
          }
          const st = doc.createElementNS(A, "a:stretch"); st.appendChild(doc.createElementNS(A, "a:fillRect"));
          blipFill.appendChild(st);
        }
      }
      zip.file(slide.part, ser(doc));
      zip.file(rp, ser(rels));
    }
    await ensureDefaults(zip, exts);

    const S = await loadPres(zip);
    // hidden pages
    for (const slide of M.slides) {
      const meta = ctx.fields["_page_" + slide.n]; if (meta && meta.v && meta.v.hidden) await removeSlide(zip, S, slide.part);
    }
    // custom disclaimer -> full-page picture slides replacing the template's
    const disc = ctx.disclaimer;
    if (disc && disc.id !== "default") {
      onStep && onStep("กำลังใส่ Disclaimer…");
      const discParts = M.disclaimerSlides.map(n => M.slides[n - 1].part);
      const layout = await layoutOf(zip, discParts[0]);
      for (const p of discParts) await removeSlide(zip, S, p);
      let maxNum = Math.max(...Object.keys(zip.files).map(f => (f.match(/^ppt\/slides\/slide(\d+)\.xml$/) || [0, 0])[1]).map(Number));
      const wEmu = Math.round(M.widthPt * EMU), hEmu = Math.round(M.heightPt * EMU);
      for (let k = 0; k < disc.pages.length; k++) {
        const bytes = await ctx.fetchBytes(disc.pages[k]);
        const ext = sniffExt(bytes); exts.add(ext);
        const mediaName = `ytc_disc_${k + 1}.${ext}`;
        zip.file("ppt/media/" + mediaName, bytes);
        addPictureSlide(zip, S, { num: ++maxNum, layout, mediaName, wEmu, hEmu, name: `Disclaimer ${k + 1}` });
      }
    }
    await savePres(zip, S);
    await ensureDefaults(zip, exts);
    onStep && onStep("กำลังบีบอัดไฟล์…");
    const blob = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 },
      mimeType: "application/vnd.openxmlformats-officedocument.presentationml.presentation" });
    download(blob, ctx.fileBase + ".pptx");
  }

  /* ---- PDF ---- */
  async function waitImages(node) {
    await Promise.all([...node.querySelectorAll("img")].map(img => new Promise(res => {
      const done = () => res();
      const check = () => { if (img.src && img.complete) done(); else if (img.src) { img.onload = done; img.onerror = done; } else setTimeout(check, 50); };
      check();
    })));
    if (document.fonts) await document.fonts.ready;
  }

  async function exportPdf(ctx, onStep) {
    const M = ctx.manifest;
    const { PDFDocument } = PDFLib;
    const out = await PDFDocument.create();
    const stage = document.createElement("div");
    stage.className = "export-stage";
    document.body.appendChild(stage);
    let fontCSS = null;
    try {
      const pages = M.slides.filter(s => !M.disclaimerSlides.includes(s.n) &&
        !(ctx.fields["_page_" + s.n] && ctx.fields["_page_" + s.n].v && ctx.fields["_page_" + s.n].v.hidden));
      for (const s of pages) {
        onStep && onStep(`กำลังเรนเดอร์หน้า ${s.n}…`);
        const node = YTCRender.buildPage(s, ctx, { edit: false });
        stage.innerHTML = ""; stage.appendChild(node);
        await waitImages(node);
        if (fontCSS === null) fontCSS = await htmlToImage.getFontEmbedCSS(node);
        const jpg = await htmlToImage.toJpeg(node, { pixelRatio: 3, quality: 0.92, backgroundColor: "#ffffff", fontEmbedCSS: fontCSS,
          width: M.widthPt, height: M.heightPt });
        const img = await out.embedJpg(jpg);
        out.addPage([M.widthPt, M.heightPt]).drawImage(img, { x: 0, y: 0, width: M.widthPt, height: M.heightPt });
      }
      onStep && onStep("กำลังใส่ Disclaimer…");
      const disc = ctx.disclaimer;
      const src = await PDFDocument.load(await ctx.fetchBytes(disc.pdf));
      for (const p of await out.copyPages(src, src.getPageIndices())) out.addPage(p);
      out.setTitle(ctx.fileBase); out.setAuthor("Yuanta Securities (Thailand)"); out.setCreator("Yuanta Technical Central");
      onStep && onStep("กำลังบันทึกไฟล์…");
      download(new Blob([await out.save()], { type: "application/pdf" }), ctx.fileBase + ".pdf");
    } finally { stage.remove(); }
  }

  /* ---- disclaimer upload: read PDF, thumbnails, extract chosen pages ---- */
  async function readPdf(bytes) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL("vendor/pdf.worker.min.js", location.href).href;
    return pdfjsLib.getDocument({ data: bytes.slice() }).promise;
  }
  async function renderPdfPage(pdf, i, widthPx, type = "image/jpeg") {
    const page = await pdf.getPage(i + 1);
    const vp1 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: widthPx / vp1.width });
    const cv = document.createElement("canvas");
    cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const g = cv.getContext("2d"); g.fillStyle = "#fff"; g.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: g, viewport: vp }).promise;
    return new Promise(res => cv.toBlob(res, type, 0.88));
  }
  async function extractPages(bytes, idx) {
    const { PDFDocument } = PDFLib;
    const src = await PDFDocument.load(bytes);
    const out = await PDFDocument.create();
    for (const p of await out.copyPages(src, idx)) out.addPage(p);
    return new Blob([await out.save()], { type: "application/pdf" });
  }

  /* ---- PNG: one page, or every page in a ZIP ---- */
  const PNG_RATIO = 3;                                   // 595 pt wide -> 1786 x 2526 px (~216 dpi)
  async function pagePng(ctx, slide, stage, fontCSS) {
    const M = ctx.manifest;
    const node = YTCRender.buildPage(slide, ctx, { edit: false });
    stage.innerHTML = ""; stage.appendChild(node);
    await waitImages(node);
    const css = fontCSS || await htmlToImage.getFontEmbedCSS(node);
    const blob = await htmlToImage.toBlob(node, { pixelRatio: PNG_RATIO, backgroundColor: "#ffffff", fontEmbedCSS: css,
      width: M.widthPt, height: M.heightPt });
    return { blob, css };
  }
  async function imageToPng(bytes, widthPx) {          // disclaimer page jpg -> png at the same size as the pages
    const bmp = await createImageBitmap(new Blob([bytes]));
    const cv = document.createElement("canvas");
    cv.width = widthPx; cv.height = Math.round(bmp.height * widthPx / bmp.width);
    const g = cv.getContext("2d"); g.imageSmoothingQuality = "high"; g.drawImage(bmp, 0, 0, cv.width, cv.height);
    return new Promise(r => cv.toBlob(r, "image/png"));
  }
  const safeName = s => String(s).replace(/[\\/:*?"<>|]+/g, "-").trim();
  const isHidden = (ctx, n) => { const m = ctx.fields["_page_" + n]; return !!(m && m.v && m.v.hidden); };

  async function exportPng(ctx, onStep, onlyN) {
    const M = ctx.manifest;
    const stage = document.createElement("div"); stage.className = "export-stage"; document.body.appendChild(stage);
    try {
      if (onlyN) {                                       // single page
        const s = M.slides.find(x => x.n === onlyN);
        onStep && onStep(`กำลังสร้างรูปหน้า ${onlyN}…`);
        const { blob } = await pagePng(ctx, s, stage);
        download(blob, `${ctx.fileBase} - ${String(onlyN).padStart(2, "0")} ${safeName(s.title)}.png`);
        return;
      }
      const zip = new JSZip();
      const pages = M.slides.filter(s => !M.disclaimerSlides.includes(s.n) && !isHidden(ctx, s.n));
      let css = null, i = 0;
      for (const s of pages) {
        onStep && onStep(`กำลังสร้างรูปหน้า ${s.n}…`);
        const r = await pagePng(ctx, s, stage, css); css = r.css;
        zip.file(`${String(++i).padStart(2, "0")} ${safeName(s.title)}.png`, r.blob);
      }
      const disc = ctx.disclaimer;
      for (let k = 0; k < disc.pages.length; k++) {
        onStep && onStep(`กำลังใส่ Disclaimer หน้า ${k + 1}…`);
        zip.file(`${String(++i).padStart(2, "0")} Disclaimer ${k + 1}.png`,
          await imageToPng(await ctx.fetchBytes(disc.pages[k]), Math.round(M.widthPt * PNG_RATIO)));
      }
      onStep && onStep("กำลังรวมไฟล์ ZIP…");
      download(await zip.generateAsync({ type: "blob" }), `${ctx.fileBase} PNG.zip`);
    } finally { stage.remove(); }
  }

  window.YTCExport = { exportPptx, exportPdf, exportPng, readPdf, renderPdfPage, extractPages, download };
})();
