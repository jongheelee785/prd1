// 웹앱용 연결 계층: 앱이 쓰는 claude.use("db" | "user" | "sample" | "downloads")를 이 서버의 /api로 잇는다.
(() => {
  const POLL_MS = 4000;
  const err = (code, message) => Object.assign(new Error(message || code), { code });
  async function call(method, path, body) {
    const r = await fetch(path, { method, headers: body ? { "Content-Type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) throw err(data.code || "unavailable", data.message);
    return data;
  }

  // 컬렉션 구독: 주기적으로 목록을 받아 바뀌었을 때만 콜백한다. 쓰기 직후에는 바로 다시 받는다.
  const watchers = {};
  function refresh(c) { (watchers[c] || []).forEach(w => w.tick()); }
  function onSnapshot(c, cb, onErr) {
    let last = null, timer = null, stopped = false, failed = false;
    const w = {
      async tick() {
        if (stopped) return;
        clearTimeout(timer);
        try {
          const { docs } = await call("GET", `/api/db/${c}`);
          failed = false;
          const sig = JSON.stringify(docs);
          if (sig !== last) { last = sig; cb({ docs: docs.map(d => ({ id: d.id, data: () => d.data })), metadata: { fromCache: false } }); }
        } catch (e) { if (!failed) { failed = true; onErr?.(e); } }
        if (!stopped) timer = setTimeout(() => w.tick(), document.hidden ? POLL_MS * 4 : POLL_MS);
      },
    };
    (watchers[c] = watchers[c] || []).push(w);
    w.tick();
    return () => { stopped = true; clearTimeout(timer); watchers[c] = watchers[c].filter(x => x !== w); };
  }
  const db = {
    collection: c => ({
      onSnapshot: (cb, onErr) => onSnapshot(c, cb, onErr),
      doc: id => ({
        set: async v => { await call("PUT", `/api/db/${c}/${id}`, v); refresh(c); },
        update: async p => { await call("PATCH", `/api/db/${c}/${id}`, p); refresh(c); },
        delete: async () => { await call("DELETE", `/api/db/${c}/${id}`); refresh(c); },
      }),
    }),
  };

  // AI: 서버가 Claude 응답 글자를 스트림으로 흘려보낸다.
  async function sample(input, opts = {}) {
    const prompt = typeof input === "string" ? input : input.map(m => m.content).join("\n\n");
    let r;
    try {
      r = await fetch("/api/sample", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ prompt, effort: opts.effort }), signal: opts.signal });
    } catch (e) { throw err(e?.name === "AbortError" ? "cancelled" : "unavailable"); }
    if (!r.ok) { const d = await r.json().catch(() => ({})); throw err(d.code || "unavailable", d.message); }
    const reader = r.body.getReader(), dec = new TextDecoder();
    let text = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        const delta = dec.decode(value, { stream: true });
        text += delta;
        // 서버가 다른 모델로 다시 받기 시작하면 그 앞의 글은 버린다
        const k = text.lastIndexOf("\u0000RESET");
        if (k >= 0) text = text.slice(k + 6);
        opts.onText?.({ text: text.split("\n\u0000")[0], delta });
      }
    } catch (e) { throw err(e?.name === "AbortError" ? "cancelled" : "unavailable"); }
    const [body, flag] = text.split("\n\u0000");
    if (flag === "REFUSAL") throw err("refused", "AI가 이 요청을 거절했습니다.");
    if (flag === "ERROR") throw err("unavailable");
    return { text: body, truncated: false };
  }
  sample.json = async (input, opts) => {
    const { text } = await sample(input, opts);
    const m = text.match(/```(?:json)?\s*([\s\S]*?)```/);
    const raw = (m ? m[1] : text).trim();
    const s = raw.indexOf("{"), e = raw.lastIndexOf("}");
    try { return JSON.parse(s >= 0 && e > s ? raw.slice(s, e + 1) : raw); } catch { throw err("invalid_json"); }
  };

  const downloads = {
    async save({ filename, data }) {
      const a = document.createElement("a");
      a.href = URL.createObjectURL(data); a.download = filename; document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    },
  };
  const user = { can: async () => true, isOwner: () => false, canEdit: () => true };

  // 서버 저장소와 AI 사용 가능 여부는 서버에 물어 결정한다.
  const ready = fetch("/api/health").then(r => r.json()).catch(() => ({}));
  window.claude = {
    use: async name => {
      const h = await ready;
      if (name === "db") return h.db ? db : null;
      if (name === "sample") return h.ai ? sample : null;
      if (name === "downloads") return downloads;
      if (name === "user") return user;
      return null;
    },
  };
})();
