import { GoogleGenAI, ApiError, ThinkingLevel } from "@google/genai";
import { allow } from "../../../lib/store";
import { fail, readBody, clientIp } from "../../../lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 120;
const DEADLINE = 90_000; // 이 시간이 지나면 다음 모델로 넘어가지 않는다

// 무료 등급에서 쓸 수 있는 Flash 계열을 기본으로 둔다. 바꾸려면 GEMINI_MODEL 환경 변수를 넣는다.
// gemini-2.5-flash는 신규 사용자에게 닫혀 있어 Google이 권하는 최신 Flash를 쓴다.
// 무료 등급은 몰리면 503을 주므로, 앞 모델이 바쁘거나 없으면 다음 모델로 넘어간다.
const MODEL = process.env.GEMINI_MODEL || "gemini-3.8-flash";
const FALLBACKS = [MODEL, "gemini-3.5-flash", "gemini-3.8-flash-lite", "gemini-3.5-flash-lite"].filter((m, i, a) => a.indexOf(m) === i);
const retryable = e => (e instanceof ApiError && [404, 429, 500, 503].includes(e.status)) || /abort|timeout/i.test(`${e?.name} ${e?.message}`);
const MAX_PROMPT = 60_000;
const CALLS_PER_HOUR = 30;
const SYSTEM = "너는 군 교육훈련용 LVC 시나리오 설계·사후검토 도우미다. 모든 정보는 가상이며, 실제 부대명·지명·인명·좌표는 쓰지 않는다. 요청한 형식(JSON)만 답한다.";

// API 키는 서버 환경 변수(GEMINI_API_KEY)에서만 읽는다. 브라우저로 보내지 않는다.
let client = null;
const getClient = () => (client ||= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY.trim().replace(/^["']|["']$/g, "") }));

// 설정 확인용: 이 키로 쓸 수 있는 Flash 계열 모델 이름만 돌려준다(키는 노출하지 않음)
export async function GET() {
  if (!process.env.GEMINI_API_KEY) return fail("not_granted", 503);
  const t0 = Date.now();
  try {
    const names = [];
    const pager = await getClient().models.list({ config: { pageSize: 100, httpOptions: { timeout: 15000 } } });
    for await (const m of pager) if (/flash/i.test(m.name)) names.push(m.name.replace(/^models\//, ""));
    return Response.json({ model: MODEL, ms: Date.now() - t0, flash: names });
  } catch (e) { return Response.json({ model: MODEL, ms: Date.now() - t0, error: String(e?.message || e).replace(/AIza[0-9A-Za-z_-]+/g, "AIza***").slice(0, 300) }, { status: 502 }); }
}

export async function POST(req) {
  if (!process.env.GEMINI_API_KEY) return fail("not_granted", 503, "GEMINI_API_KEY가 설정되지 않았습니다.");
  const t0 = Date.now(), mark = s => console.log(`[sample] ${s} +${Date.now() - t0}ms`);
  if (!(await allow(`ai:${clientIp(req)}`, CALLS_PER_HOUR))) return fail("rate_limited", 429);
  mark("rate-limit ok");
  let body;
  try { body = await readBody(req, MAX_PROMPT + 1000); } catch (e) { return fail(e.code, 400); }
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  if (!prompt || prompt.length > MAX_PROMPT) return fail("invalid_argument", 400);

  // 모델마다 첫 조각을 15초까지만 기다리고, 안 오면 그 요청을 끊고 다음 모델로 넘어간다(본문 스트리밍에는 제한 없음).
  let ctl, lastErr, idx = -1;
  async function openNext() {
    while (++idx < FALLBACKS.length && Date.now() - t0 < DEADLINE) {
      const model = FALLBACKS[idx];
      ctl = new AbortController();
      const timer = setTimeout(() => ctl.abort(new Error("first chunk timeout")), 15000);
      try {
        const stream = await getClient().models.generateContentStream({
          model,
          contents: prompt,
          // 생각 단계를 낮추면 첫 글자가 빨리 오고 무료 한도도 덜 쓴다.
          config: { systemInstruction: SYSTEM, responseMimeType: "application/json", maxOutputTokens: 16000, thinkingConfig: { thinkingLevel: ThinkingLevel.LOW }, abortSignal: ctl.signal },
        });
        const it = stream[Symbol.asyncIterator]();
        const first = await it.next();
        clearTimeout(timer);
        mark(`first chunk (${model})`);
        return { it, first };
      } catch (e) {
        clearTimeout(timer);
        lastErr = ctl.signal.aborted ? new Error("first chunk timeout") : e; mark(`${model} failed: ${e?.status || e?.name}`);
        if (!retryable(lastErr)) return null;
      }
    }
    return null;
  }
  // 첫 모델을 응답 전에 열어 키·한도 오류는 HTTP 상태로 돌려준다
  let cur = await openNext();
  if (!cur) return apiError(lastErr);

  const enc = new TextEncoder();
  const send = (c, chunk) => { const t = chunk?.text; if (t) c.enqueue(enc.encode(t)); };
  const out = new ReadableStream({
    async start(c) {
      for (;;) {
        try {
          let last = cur.first.value;
          if (!cur.first.done) send(c, last);
          for (let r = await cur.it.next(); !r.done; r = await cur.it.next()) { send(c, r.value); last = r.value; }
          const reason = last?.candidates?.[0]?.finishReason;
          if (reason === "SAFETY" || reason === "PROHIBITED_CONTENT" || last?.promptFeedback?.blockReason) c.enqueue(enc.encode("\n\u0000REFUSAL"));
          break;
        } catch (e) {
          // 답하던 모델이 중간에 끊기면 다음 모델로 처음부터 다시 받는다. 화면은 RESET 표시 뒤 글만 쓴다.
          lastErr = e; mark(`stream broke: ${e?.status || e?.name}`);
          cur = retryable(e) ? await openNext() : null;
          if (!cur) { console.error(lastErr); c.enqueue(enc.encode("\n\u0000ERROR")); break; }
          c.enqueue(enc.encode("\u0000RESET"));
        }
      }
      c.close();
    },
    cancel() { ctl?.abort(); },
  });
  return new Response(out, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

function apiError(e) {
  console.error(e);
  const s = e instanceof ApiError ? e.status : 0;
  if (s === 400 && /API key/i.test(e.message)) return fail("not_granted", 503, "API 키를 확인해 주세요.");
  if (s === 401 || s === 403) return fail("not_granted", 503, "API 키를 확인해 주세요.");
  if (s === 429) return fail("rate_limited", 429, "무료 사용 한도에 걸렸습니다. 잠시 후 다시 시도해 주세요.");
  if (s === 503 || /timeout/i.test(e?.message)) return fail("rate_limited", 503, "AI 사용자가 몰려 있습니다. 잠시 후 다시 시도해 주세요.");
  return fail("unavailable", 502);
}
