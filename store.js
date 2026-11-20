/* Data layer: one interface, two backends.
 *   cloud  - Supabase (Postgres + Storage + Realtime), shared by the whole team
 *   local  - IndexedDB + BroadcastChannel, for this browser only (no config)
 * Field values are stored as {v, by, at}.
 */
(function () {
  const uuid = () => (crypto.randomUUID ? crypto.randomUUID() :
    "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, c => {
      const r = Math.random() * 16 | 0; return (c === "x" ? r : (r & 3 | 8)).toString(16);
    }));
  const nowIso = () => new Date().toISOString();

  async function sha256hex(s) {
    const b = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(s));
    return [...new Uint8Array(b)].map(x => x.toString(16).padStart(2, "0")).join("");
  }

  /* ---------------- local (IndexedDB) ---------------- */
  function idb() {
    return new Promise((res, rej) => {
      const r = indexedDB.open("ytc", 1);
      r.onupgradeneeded = () => r.result.createObjectStore("kv");
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }
  let _db;
  async function kv(mode, key, val) {
    _db = _db || await idb();
    return new Promise((res, rej) => {
      const tx = _db.transaction("kv", mode === "get" ? "readonly" : "readwrite");
      const st = tx.objectStore("kv");
      const r = mode === "get" ? st.get(key) : mode === "del" ? st.delete(key) : st.put(val, key);
      r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error);
    });
  }

  function LocalStore() {
    const urlCache = {};
    return {
      mode: "local",
      async listReports() { return ((await kv("get", "reports")) || []).sort((a, b) => b.report_date.localeCompare(a.report_date) || b.created_at.localeCompare(a.created_at)); },
      async getReport(id) { return ((await kv("get", "reports")) || []).find(r => r.id === id) || null; },
      async createReport(r) {
        const list = (await kv("get", "reports")) || [];
        const rec = { id: uuid(), status: "draft", created_at: nowIso(), updated_at: nowIso(), ...r };
        list.push(rec); await kv("put", "reports", list); return rec;
      },
      async updateReport(id, patch) {
        const list = (await kv("get", "reports")) || [];
        const r = list.find(x => x.id === id); Object.assign(r, patch, { updated_at: nowIso() });
        await kv("put", "reports", list); return r;
      },
      async deleteReport(id) {
        const list = ((await kv("get", "reports")) || []).filter(x => x.id !== id);
        await kv("put", "reports", list); await kv("del", "fields:" + id);
      },
      async getFields(id) { return (await kv("get", "fields:" + id)) || {}; },
      async setFields(id, entries, by) {
        const f = (await kv("get", "fields:" + id)) || {};
        for (const { key, v, by: b } of entries) f[key] = { v, by: b || by, at: nowIso() };
        await kv("put", "fields:" + id, f);
        const list = (await kv("get", "reports")) || [];
        const r = list.find(x => x.id === id); if (r) { r.updated_at = nowIso(); await kv("put", "reports", list); }
      },
      async uploadBlob(reportId, blob, ext) {
        const id = uuid(); await kv("put", "blob:" + id, blob); return "idb:" + id;
      },
      async resolveUrl(url) {
        if (!url || !url.startsWith("idb:")) return url;
        if (!urlCache[url]) { const b = await kv("get", "blob:" + url.slice(4)); urlCache[url] = b ? URL.createObjectURL(b) : ""; }
        return urlCache[url];
      },
      async fetchBytes(url) {
        if (url.startsWith("idb:")) { const b = await kv("get", "blob:" + url.slice(4)); return new Uint8Array(await b.arrayBuffer()); }
        return new Uint8Array(await (await fetch(url)).arrayBuffer());
      },
      async listDisclaimers(template) { return ((await kv("get", "disclaimers")) || []).filter(d => d.template === template).sort((a, b) => b.created_at.localeCompare(a.created_at)); },
      async addDisclaimer(d) {
        const list = (await kv("get", "disclaimers")) || [];
        const rec = { id: uuid(), created_at: nowIso(), ...d }; list.push(rec); await kv("put", "disclaimers", list); return rec;
      },
      join(reportId, me, h) {
        const ch = new BroadcastChannel("ytc-" + reportId);
        const peers = {}; let focus = null;
        const hello = () => ch.postMessage({ t: "p", id: me.id, name: me.name, color: me.color, focus, at: Date.now() });
        const emit = () => h.onPresence(Object.values(peers));
        ch.onmessage = e => {
          const m = e.data;
          if (m.t === "f") h.onField(m.key, m.v, m.by);
          if (m.t === "p") { const isNew = !peers[m.id]; peers[m.id] = m; emit(); if (isNew) hello(); }
          if (m.t === "bye") { delete peers[m.id]; emit(); }
          if (m.t === "r") h.onReport && h.onReport(m.patch);
        };
        const iv = setInterval(() => {
          hello(); const t = Date.now();
          for (const k in peers) if (t - peers[k].at > 12000) delete peers[k];
          emit();
        }, 4000);
        hello();
        return {
          sendField(key, v) { ch.postMessage({ t: "f", key, v, by: me.name }); },
          sendReport(patch) { ch.postMessage({ t: "r", patch }); },
          setFocus(k) { focus = k; hello(); },
          leave() { ch.postMessage({ t: "bye", id: me.id }); clearInterval(iv); ch.close(); },
        };
      },
    };
  }

  /* ---------------- cloud (Supabase) ---------------- */
  function CloudStore(cfg, teamKey, keyHash) {
    const sb = supabase.createClient(cfg.supabaseUrl, cfg.supabaseKey, {
      global: { headers: { "x-team-key": teamKey } },
      auth: { persistSession: false, autoRefreshToken: false },
      realtime: { params: { eventsPerSecond: 20 } },
    });
    const B = cfg.bucket || "ytc";
    const chk = ({ data, error }) => { if (error) throw new Error(error.message || String(error)); return data; };
    return {
      mode: "cloud", sb,
      async listReports() {
        return chk(await sb.from("reports").select("*").order("report_date", { ascending: false }).order("created_at", { ascending: false }).limit(300));
      },
      async getReport(id) { return chk(await sb.from("reports").select("*").eq("id", id).maybeSingle()); },
      async createReport(r) { return chk(await sb.from("reports").insert(r).select().single()); },
      async updateReport(id, patch) { return chk(await sb.from("reports").update({ ...patch, updated_at: nowIso() }).eq("id", id).select().single()); },
      async deleteReport(id) { chk(await sb.from("reports").delete().eq("id", id)); },
      async getFields(id) {
        const rows = chk(await sb.from("fields").select("key,value,updated_by,updated_at").eq("report_id", id));
        const out = {}; for (const r of rows) out[r.key] = { v: r.value, by: r.updated_by, at: r.updated_at }; return out;
      },
      async setFields(id, entries, by) {
        const at = nowIso();
        const rows = entries.map(e => ({ report_id: id, key: e.key, value: e.v === undefined ? null : e.v, updated_by: e.by || by, updated_at: at }));
        for (let i = 0; i < rows.length; i += 200) chk(await sb.from("fields").upsert(rows.slice(i, i + 200)));
      },
      async uploadBlob(reportId, blob, ext) {
        const path = `${keyHash}/${reportId}/${uuid()}.${ext}`;
        chk(await sb.storage.from(B).upload(path, blob, { contentType: blob.type, cacheControl: "31536000", upsert: false }));
        return sb.storage.from(B).getPublicUrl(path).data.publicUrl;
      },
      async resolveUrl(url) { return url; },
      async fetchBytes(url) { return new Uint8Array(await (await fetch(url)).arrayBuffer()); },
      async listDisclaimers(template) {
        return chk(await sb.from("disclaimers").select("*").eq("template", template).order("created_at", { ascending: false }));
      },
      async addDisclaimer(d) { return chk(await sb.from("disclaimers").insert(d).select().single()); },
      join(reportId, me, h) {
        const ch = sb.channel(`ytc-${keyHash.slice(0, 16)}-${reportId}`, {
          config: { broadcast: { self: false }, presence: { key: me.id } },
        });
        let focus = null;
        ch.on("broadcast", { event: "f" }, ({ payload: m }) => h.onField(m.key, m.v, m.by));
        ch.on("broadcast", { event: "r" }, ({ payload: m }) => h.onReport && h.onReport(m.patch));
        ch.on("presence", { event: "sync" }, () => {
          const st = ch.presenceState();
          h.onPresence(Object.entries(st).filter(([k]) => k !== me.id).map(([, v]) => v[v.length - 1]));
        });
        const track = () => ch.track({ id: me.id, name: me.name, color: me.color, focus });
        ch.subscribe(s => { if (s === "SUBSCRIBED") { track(); h.onStatus && h.onStatus("live"); } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT" || s === "CLOSED") { h.onStatus && h.onStatus("offline"); } });
        return {
          sendField(key, v) { ch.send({ type: "broadcast", event: "f", payload: { key, v, by: me.name } }); },
          sendReport(patch) { ch.send({ type: "broadcast", event: "r", payload: { patch } }); },
          setFocus(k) { focus = k; track(); },
          leave() { sb.removeChannel(ch); },
        };
      },
    };
  }

  window.YTCStore = {
    uuid, sha256hex,
    async create() {
      const cfg = window.YTC_CONFIG || {};
      if (!cfg.supabaseUrl) return LocalStore();
      const m = location.hash.match(/k=([A-Za-z0-9_-]+)/);
      if (m) { try { localStorage.setItem("ytc_key", m[1]); } catch (e) {} }
      let key = m ? m[1] : null;
      if (!key) { try { key = localStorage.getItem("ytc_key"); } catch (e) {} }
      if (!key) return { mode: "nokey" };
      const hash = (await sha256hex(key)).slice(0, 32);
      const st = CloudStore(cfg, key, hash);
      st.teamKey = key;
      return st;
    },
  };
})();
