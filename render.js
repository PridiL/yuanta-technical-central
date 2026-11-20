/* Page renderer shared by the editor and the PDF export.
 * Coordinates: 1 CSS px == 1 pt of the slide (A4 portrait = 595 x 842).
 */
(function () {
  const LINE = { "Quark": 1.22, "Kanit Light": 1.15 };   // PowerPoint single-spacing per font (measured)
  const ALIGN = { l: "left", ctr: "center", r: "right", just: "justify", dist: "justify" };
  const ANCHOR = { t: "flex-start", ctr: "center", b: "flex-end" };
  const TH_MONTHS = ["มกราคม", "กุมภาพันธ์", "มีนาคม", "เมษายน", "พฤษภาคม", "มิถุนายน", "กรกฎาคม",
    "สิงหาคม", "กันยายน", "ตุลาคม", "พฤศจิกายน", "ธันวาคม"];

  function thaiDate(iso) {
    if (!iso) return "";
    const [y, m, d] = iso.split("-").map(Number);
    return `${d} ${TH_MONTHS[m - 1]} ${y}`;
  }
  function ddmmyyyy(iso) { const [y, m, d] = iso.split("-"); return `${d}${m}${y}`; }

  function styleText(node, st) {
    const s = node.style;
    s.fontFamily = `'${st.font}', 'Quark', sans-serif`;
    s.fontSize = st.size + "px";
    s.color = "#" + st.color;
    s.textAlign = ALIGN[st.align] || "left";
    s.lineHeight = ((LINE[st.font] || 1.2) * (st.lnSpc || 1)).toFixed(3);
  }

  function cellKey(e, r, c) { return `${e.key}_r${r}c${c}`; }

  /* image crop: {x, y, w, h} = visible part of the image, as fractions of its width/height */
  function isCrop(val) { return val && (val.fit === "crop" || val.fit === "cover"); }
  function coverCrop(iw, ih, fw, fh) {          // largest centred area with the frame's shape
    const ia = iw / ih, fa = fw / fh;
    return ia > fa ? { x: (1 - fa / ia) / 2, y: 0, w: fa / ia, h: 1 } : { x: 0, y: (1 - ia / fa) / 2, w: 1, h: ia / fa };
  }
  function cropOf(val, fw, fh) {
    if (val.crop && val.crop.w > 0 && val.crop.h > 0) return val.crop;
    return coverCrop(val.w || fw, val.h || fh, fw, fh);
  }
  function placeCrop(img, c) {
    Object.assign(img.style, { position: "absolute", maxWidth: "none", objectFit: "fill",
      width: (100 / c.w) + "%", height: (100 / c.h) + "%",
      left: (-c.x / c.w * 100) + "%", top: (-c.y / c.h * 100) + "%" });
  }

  /* value helpers ---------------------------------------------------- */
  function textValue(ctx, e) {
    if (e.link === "date") return thaiDate(ctx.report.report_date);
    const f = ctx.fields[e.key];
    return f ? (f.v ?? "") : "";
  }
  function cellValue(ctx, e, r, c) {
    const f = ctx.fields[cellKey(e, r, c)];
    return f ? (f.v ?? "") : "";
  }

  /* build one page --------------------------------------------------- */
  function buildPage(slide, ctx, opts = {}) {
    const M = ctx.manifest;
    const page = document.createElement("div");
    page.className = "page" + (opts.edit ? " editing" : "");
    page.style.width = M.widthPt + "px";
    page.style.height = M.heightPt + "px";
    page.dataset.n = slide.n;
    const bg = document.createElement("img");
    bg.className = "bg"; bg.alt = ""; bg.draggable = false;
    bg.src = ctx.base + slide.bg;
    page.appendChild(bg);

    for (const e of slide.elements) {
      const [x, y, w, h] = e.box;
      const box = document.createElement("div");
      box.className = "el el-" + e.type;
      box.dataset.key = e.key;
      Object.assign(box.style, { left: x + "px", top: y + "px", width: w + "px" });

      if (e.type === "text") {
        const st = e.style;
        box.style.minHeight = h + "px";
        box.style.padding = st.ins.map(v => v + "px").join(" ").replace(/^(\S+) (\S+) (\S+) (\S+)$/, "$2 $3 $4 $1");
        box.style.justifyContent = ANCHOR[st.anchor] || "flex-start";
        if (!st.wrap) box.style.whiteSpace = "nowrap";
        const tx = document.createElement("div");
        tx.className = "tx";
        styleText(tx, st);
        tx.textContent = textValue(ctx, e);
        if (opts.edit) {
          if (e.link === "date") { box.classList.add("linked"); box.title = "วันที่ของรีพอร์ต (แก้ที่แถบด้านบน)"; }
          else {
            tx.contentEditable = "plaintext-only";
            tx.spellcheck = false;
            tx.dataset.ph = (e.default || "").replace(/\s+/g, " ").slice(0, 160);
            const f = ctx.fields[e.key];
            if (f && f.by === "_copy") box.classList.add("stale");
          }
        }
        box.appendChild(tx);
      } else if (e.type === "image") {
        box.style.height = h + "px";
        const f = ctx.fields[e.key];
        const val = f && f.v;
        if (val && val.url) {
          const img = document.createElement("img");
          img.className = "chart"; img.alt = ""; img.draggable = false;
          img.crossOrigin = "anonymous";
          ctx.resolveUrl(val.url).then(u => { img.src = u; });
          if (isCrop(val)) {                       // fill the frame, showing the chosen part of the image
            const clip = document.createElement("div"); clip.className = "clip";
            placeCrop(img, cropOf(val, w, h));
            clip.appendChild(img); box.appendChild(clip);
          } else {
            img.style.objectFit = val.fit === "stretch" ? "fill" : "contain";
            box.appendChild(img);
          }
          if (opts.edit && f.by === "_copy") box.classList.add("stale");
        } else if (opts.edit) {
          box.classList.add("empty");
          box.innerHTML = `<div class="ph"><b>วางรูปกราฟ</b><span>คลิกเลือกกรอบนี้ แล้วกด Ctrl+V<br>หรือลากไฟล์มาวาง / ดับเบิลคลิกเพื่อเลือกไฟล์</span></div>`;
        }
        if (opts.edit) {
          box.tabIndex = 0;
          const bar = document.createElement("div");
          bar.className = "imgbar";
          bar.innerHTML = `<button data-act="upload" title="เลือกไฟล์">อัปโหลด</button>` +
            (val && val.url ? (isCrop(val) ? `<button data-act="adjust" title="ลากเพื่อเลื่อนรูป หมุนลูกกลิ้งเพื่อซูม (หรือดับเบิลคลิกที่รูป)">✥ ปรับรูป</button>` : "") +
              `<button data-act="fit" title="สลับวิธีวางรูป: เต็มกรอบ (ปรับตำแหน่งได้) → พอดีกรอบ (เห็นทั้งรูป) → ยืดเต็มกรอบ">${isCrop(val) ? "เต็มกรอบ" : val.fit === "stretch" ? "ยืดเต็มกรอบ" : "พอดีกรอบ"}</button><button data-act="clear" title="ลบรูป">ลบ</button>` : "");
          box.appendChild(bar);
        }
      } else if (e.type === "table") {
        box.style.height = h + "px";
        let ty = 0;
        e.rows.forEach((row, r) => {
          let tx0 = 0;
          row.cells.forEach((cell, c) => {
            const cw = e.cols.slice(c, c + (cell.span[0] || 1)).reduce((a, b) => a + b, 0);
            if (!cell.merged) {
              const cd = document.createElement("div");
              cd.className = "cell";
              const st = cell.style;
              Object.assign(cd.style, { left: tx0 + "px", top: ty + "px", width: cw + "px", height: row.h + "px",
                padding: `${st.ins[1]}px ${st.ins[2]}px ${st.ins[3]}px ${st.ins[0]}px`,
                justifyContent: ANCHOR[st.anchor] || "flex-start" });
              const t = document.createElement("div");
              t.className = "tx"; styleText(t, st);
              t.textContent = cellValue(ctx, e, r, c);
              t.dataset.key = cellKey(e, r, c);
              if (opts.edit) {
                t.contentEditable = "plaintext-only"; t.spellcheck = false;
                t.dataset.ph = cell.text;
                const f = ctx.fields[cellKey(e, r, c)];
                if (f && f.by === "_copy") cd.classList.add("stale");
              }
              cd.appendChild(t);
              box.appendChild(cd);
            }
            tx0 += e.cols[c];
          });
          ty += row.h;
        });
      }
      page.appendChild(box);
    }
    return page;
  }

  function buildDisclaimerPage(url, ctx) {
    const M = ctx.manifest;
    const page = document.createElement("div");
    page.className = "page disc";
    page.style.width = M.widthPt + "px"; page.style.height = M.heightPt + "px";
    const img = document.createElement("img");
    img.className = "bg"; img.alt = ""; img.crossOrigin = "anonymous";
    ctx.resolveUrl(url).then(u => { img.src = u; });
    page.appendChild(img);
    return page;
  }

  window.YTCRender = { buildPage, buildDisclaimerPage, thaiDate, ddmmyyyy, cellKey, textValue, cellValue,
    isCrop, coverCrop, cropOf, placeCrop };
})();
