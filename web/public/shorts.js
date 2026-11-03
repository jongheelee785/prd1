// 사후검토 쇼츠: 시나리오 단계를 1080×1920 세로 영상으로 녹화한다.
// 앱(index.html)의 함수(mapSVG, recommend 등)와 데이터를 그대로 쓰고, 프레임은 순수 SVG로 그려 캔버스에 옮긴 뒤 MediaRecorder로 녹화한다.
// 열기: /?view=shorts&s=시나리오ID
(async () => {
  const W = 1080, H = 1920, FPS = 30, SCENE = 4.2, INTRO = 3.6, OUTRO = 3.6, FADE = 0.45;
  const wait = t => new Promise(r => setTimeout(r, t));
  for (let i = 0; i < 300 && !cur(); i++) await wait(100);
  const sc = cur();

  // 앱 화면은 그대로 두고 위에 덮는다(앱의 구독·렌더는 계속 돈다)
  document.documentElement.dataset.theme = "dark";
  const ui = document.createElement("div");
  ui.style.cssText = "position:fixed;inset:0;z-index:50;background:#0b0f11;color:#e3eae6;display:flex;flex-direction:column;align-items:center;gap:10px;padding:12px;overflow:auto;font-family:var(--f-sans)";
  document.body.appendChild(ui);
  if (!sc) { ui.innerHTML = "<p>시나리오를 찾지 못했습니다. 주소의 s= 값을 확인하세요.</p>"; return; }

  // 지도 SVG에 쓸 CSS: 앱 스타일에서 지도 관련 규칙만 모으고 색 토큰은 실제 값으로 바꾼다
  const cs = getComputedStyle(document.documentElement);
  let css = "";
  for (const sheet of document.styleSheets) {
    let rules; try { rules = sheet.cssRules; } catch { continue; }
    for (const r of rules) if (r.selectorText && /\.(m-|f-|mk|fr\b|gl\b|gd\b)/.test(r.selectorText)) css += r.cssText + "\n";
  }
  css = css.replace(/var\((--[\w-]+)(?:,[^)]*)?\)/g, (_, v) => cs.getPropertyValue(v).trim() || "#888");
  const C = k => cs.getPropertyValue(k).trim();
  const col = { bg: "#0b0f11", panel: "#151c20", line: "#2b363a", ink: "#e9efeb", muted: "#98a6a0", accent: C("--accent") || "#e07b42", ok: C("--ok") || "#5fbf7a", warn: C("--warn") || "#e0b042" };
  const FONT = "'Malgun Gothic','Apple SD Gothic Neo','Noto Sans KR',sans-serif";

  // 글자 폭 어림으로 줄바꿈
  const cw = ch => (/[ㄱ-힝]/.test(ch) ? 1 : /[A-Z0-9]/.test(ch) ? 0.62 : /[\s.,·()]/.test(ch) ? 0.34 : 0.55);
  function wrap(text, width, size, max) {
    const out = []; let line = "", w = 0;
    for (const word of String(text).split(/(\s+)/)) {
      const ww = [...word].reduce((s, ch) => s + cw(ch), 0) * size;
      if (w + ww > width && line.trim()) { out.push(line.trim()); line = ""; w = 0; if (/^\s+$/.test(word)) continue; }
      if (ww > width) { for (const ch of word) { const c = cw(ch) * size; if (w + c > width) { out.push(line); line = ""; w = 0; } line += ch; w += c; } continue; }
      line += word; w += ww;
    }
    if (line.trim()) out.push(line.trim());
    if (out.length > max) { out.length = max; out[max - 1] = out[max - 1].replace(/.{0,2}$/, "…"); }
    return out;
  }
  const T = (x, y, s, fill, text, weight = 400, anchor = "start") => `<text x="${x}" y="${y}" font-size="${s}" fill="${fill}" font-weight="${weight}" text-anchor="${anchor}" font-family="${FONT}">${esc(text)}</text>`;
  const lines = (x, y, s, fill, arr, lh = 1.38, weight = 400) => arr.map((l, k) => T(x, y + k * s * lh, s, fill, l, weight)).join("");
  const map = (i, upto, y) => mapSVG(sc.field, sc.phases, i, upto).replace('<svg class="map"', `<svg x="40" y="${y}" width="1000" height="633" class="map"`);
  const head = sub => `<rect width="${W}" height="${H}" fill="${col.bg}"/>
    ${T(60, 104, 34, col.accent, "LVC 사후검토 · 가상 데이터", 700)}
    ${lines(60, 176, 54, col.ink, wrap(sc.title.split(" · ")[0], 960, 54, 1), 1.3, 800)}
    ${sub}`;
  const foot = `${T(540, 1868, 28, col.muted, "lvc-scenario-helper.vercel.app · 모든 부대·위치는 가상", 400, "middle")}`;
  const wrapSVG = body => `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}"><style>${css}</style>${body}</svg>`;

  // 단계별 추천: 기록이 있으면 규칙 기반 추천(개선 우선) + 저장된 AI 추천, 없으면 교범 점검 항목
  function recsFor(i) {
    const p = sc.phases[i], r = aarOf(sc, i);
    let list = r ? recommend(sc, i, r) : (AAR_BEST[`${sc.op}.${p.tag}`] || AAR_BEST[p.tag] || AAR_BEST._).map(([a, w, c]) => ({ kind: "check", act: a, why: w, cite: parseCites(c) }));
    list = [...list.filter(x => x.kind === "fix"), ...list.filter(x => x.kind !== "fix")];
    if (r?.ai?.recs?.length) list.splice(1, 0, { ...r.ai.recs[0], kind: "ai" });
    return list.slice(0, 3);
  }
  const KIND = { fix: ["개선", col.accent], keep: ["유지", col.ok], check: ["점검", col.muted], ai: ["AI", "#7fb0ea"] };

  function stepDots(i, y) {
    const n = sc.phases.length, gap = 960 / (n - 1);
    return sc.phases.map((q, k) => { const x = 60 + k * gap, done = k <= i, rec = aarOf(sc, k);
      const fill = k === i ? col.accent : done ? "#3a4a50" : "#1d2629";
      return `<circle cx="${x}" cy="${y}" r="${k === i ? 24 : 18}" fill="${fill}" stroke="${rec ? col.warn : col.line}" stroke-width="3"/>${T(x, y + 9, k === i ? 24 : 20, col.ink, String(k + 1), 700, "middle")}`;
    }).join("") + `<line x1="60" y1="${y}" x2="1020" y2="${y}" stroke="${col.line}" stroke-width="3" opacity=".6"/>`.replace(/^/, "");
  }

  function sceneStep(i) {
    const p = sc.phases[i], r = aarOf(sc, i);
    const plan = wrap(p.content.split(/(?<=다\.)\s/)[0], 960, 36, 3);
    const actual = r ? [`진행 조건: ${AAR_GATE[r.gate] || "-"} · 결과: ${AAR_RESULT[r.result] || "-"}${String(r.loss).trim() ? ` · 손실 ${r.loss}%` : ""}`,
      ...(r.injects || []).map(id => { const e = eventsFor(sc, i).find(x => x.id === id); return e ? `${e.id} ${e.ev}` : id; }), ...(r.action ? [r.action] : [])]
      : ["실제 수행 기록 없음 → 교범 기준으로 점검"];
    let y = 1132, body = "";
    body += T(60, 1080, 30, col.muted, "계획", 700) + lines(60, y, 36, col.ink, plan);
    y += plan.length * 50 + 40;
    body += T(60, y, 30, col.muted, "실제 수행", 700);
    const act = actual.flatMap(a => wrap(a, 960, 34, 2)).slice(0, 3);
    body += lines(60, y + 52, 34, r ? col.warn : col.muted, act);
    y += 52 + act.length * 47 + 34;
    body += T(60, y, 30, col.accent, "더 나은 전투행동 결심", 700); y += 54;
    for (const rec of recsFor(i)) {
      if (y > 1780) break;
      const [lab, c] = KIND[rec.kind] || KIND.check;
      const t = wrap(rec.act, 860, 34, 2);
      body += `<rect x="60" y="${y - 32}" width="84" height="44" rx="8" fill="${c}" opacity=".22"/>${T(102, y, 26, c, lab, 700, "middle")}`;
      body += lines(160, y, 34, col.ink, t, 1.32, 600);
      y += t.length * 45;
      body += T(160, y + 4, 26, col.muted, "근거: " + ((rec.cite || []).join(" · ") || "일반 원칙"));
      y += 62;
    }
    return wrapSVG(head(`${T(60, 248, 44, col.accent, `PH-${pad(i + 1)}`, 800)}${T(220, 248, 44, col.ink, `${p.name} · ${p.when || ""}`, 700)}`) +
      `<rect x="34" y="290" width="1012" height="645" rx="14" fill="${col.panel}"/>${map(i, i, 296)}${stepDots(i, 990)}${body}${foot}`);
  }
  function sceneIntro() {
    const L = sc.phases.map((p, k) => `${k + 1}. ${p.name} (${p.when || ""})`);
    return wrapSVG(head(T(60, 250, 38, col.muted, `해병 ${sc.unit}(+) vs 가상 적색군 ${sc.enemy}(+) · ${FIELDS[sc.field].name}`)) +
      `<rect x="34" y="290" width="1012" height="645" rx="14" fill="${col.panel}"/>${map(-1, null, 296)}
      ${T(60, 1040, 44, col.ink, "전투행동을 다시 보며 더 나은 결심 찾기", 800)}
      ${lines(80, 1120, 36, col.muted, L, 1.5)}
      ${T(60, 1120 + L.length * 54 + 50, 36, col.accent, "▶ 단계별 재생 · 기록 대비 추천 · 근거", 700)}${foot}`);
  }
  function sceneOutro() {
    const pts = ["조건이 갖춰진 뒤에 다음 단계로: 절차를 지킨 공격 손실 약 5~10%, 무시한 공격 최대 50% (웹 1)",
      "재밍 시 광섬유 FPV·유선·수신호로 전환, 발사 후 즉시 위치 이동 (웹 1·2·8)",
      "AI는 후보 제시, 사격·기동 결심은 사람이 하고 승인·거부를 기록 (웹 4)"];
    let y = 760, b = "";
    for (const t of pts) { const l = wrap(t, 900, 40, 3); b += `<circle cx="80" cy="${y - 13}" r="10" fill="${col.accent}"/>` + lines(110, y, 40, col.ink, l, 1.35, 600); y += l.length * 54 + 50; }
    return wrapSVG(`<rect width="${W}" height="${H}" fill="${col.bg}"/>${T(540, 420, 40, col.accent, "LVC 사후검토", 700, "middle")}
      ${T(540, 520, 64, col.ink, "핵심 교훈 3가지", 800, "middle")}${b}
      ${T(540, 1560, 44, col.ink, "lvc-scenario-helper.vercel.app", 700, "middle")}
      ${T(540, 1630, 32, col.muted, "훈련 시나리오 설계 · 검토 · 사후검토", 400, "middle")}
      ${T(540, 1868, 28, col.muted, "모든 부대·위치·수치는 교육용 가상 데이터", 400, "middle")}`);
  }

  const toImg = svg => new Promise((res, rej) => { const im = new Image(); im.onload = () => res(im); im.onerror = rej; im.src = "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg); });
  ui.innerHTML = `<b>사후검토 쇼츠 만들기</b><span id="shs" style="font-size:13px;color:#98a6a0">장면을 그리는 중…</span>
    <canvas id="shc" width="${W}" height="${H}" style="height:min(78vh,820px);aspect-ratio:9/16;border:1px solid #2b363a;border-radius:8px"></canvas>
    <div id="sha" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:center"></div>`;
  const status = t => (ui.querySelector("#shs").textContent = t);
  const canvas = ui.querySelector("#shc"), ctx = canvas.getContext("2d");
  let scenes;
  try {
    scenes = [{ img: await toImg(sceneIntro()), d: INTRO }];
    for (let i = 0; i < sc.phases.length; i++) scenes.push({ img: await toImg(sceneStep(i)), d: SCENE });
    scenes.push({ img: await toImg(sceneOutro()), d: OUTRO });
  } catch (e) { status("장면을 그리지 못했습니다: " + e); console.error(e); return; }
  const total = scenes.reduce((s, x) => s + x.d, 0);
  ctx.drawImage(scenes[0].img, 0, 0);

  function draw(t) {
    let acc = 0, k = 0;
    while (k < scenes.length - 1 && t >= acc + scenes[k].d) acc += scenes[k++].d;
    const local = t - acc;
    ctx.globalAlpha = 1;
    if (k > 0 && local < FADE) { ctx.drawImage(scenes[k - 1].img, 0, 0); ctx.globalAlpha = local / FADE; }
    ctx.drawImage(scenes[k].img, 0, 0); ctx.globalAlpha = 1;
    ctx.fillStyle = "#1d2629"; ctx.fillRect(0, H - 10, W, 10);
    ctx.fillStyle = col.accent; ctx.fillRect(0, H - 10, W * Math.min(1, t / total), 10);
  }

  const types = ["video/mp4;codecs=avc1.42E01E", "video/mp4", "video/webm;codecs=vp9", "video/webm"];
  const mime = types.find(m => window.MediaRecorder?.isTypeSupported?.(m));
  const ext = mime?.startsWith("video/mp4") ? "mp4" : "webm";
  const actions = ui.querySelector("#sha");
  if (!mime) { status("이 브라우저는 영상 녹화를 지원하지 않습니다."); return; }

  async function record() {
    actions.innerHTML = ""; status(`녹화 중… (${Math.round(total)}초, ${ext})`);
    const stream = canvas.captureStream(FPS), chunks = [];
    const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
    rec.ondataavailable = e => e.data.size && chunks.push(e.data);
    const done = new Promise(r => (rec.onstop = r));
    rec.start(500);
    const t0 = performance.now();
    await new Promise(res => { const tick = () => { const t = (performance.now() - t0) / 1000; draw(Math.min(t, total)); if (t < total + 0.3) requestAnimationFrame(tick); else res(); }; requestAnimationFrame(tick); });
    rec.stop(); await done;
    const blob = new Blob(chunks, { type: mime.split(";")[0] }), name = `lvc-aar-shorts.${ext}`;
    const url = URL.createObjectURL(blob);
    status(`완성: ${(blob.size / 1048576).toFixed(1)}MB · ${ext} · 1080×1920`);
    actions.innerHTML = `<a href="${url}" download="${name}" style="color:#e07b42">영상 내려받기</a><button id="shr">다시 녹화</button>`;
    actions.querySelector("#shr").onclick = record;
    window.__shortsBlob = blob;
    // 로컬 녹화 서버로 열었을 때는 파일로 바로 저장한다(배포 사이트에서는 조용히 실패)
    try { const r = await fetch(`/save-shorts?name=${name}`, { method: "POST", body: blob }); if (r.ok) status(`완성 · 저장됨: ${await r.text()}`); } catch {}
  }
  actions.innerHTML = `<button id="shgo" style="padding:8px 16px">● 녹화 시작</button>`;
  actions.querySelector("#shgo").onclick = record;
  status(`장면 ${scenes.length}개 준비됨 · 약 ${Math.round(total)}초`);
  if (new URLSearchParams(location.search).get("auto") === "1") record();
})();
