import { GoogleGenAI, ApiError } from "@google/genai";
import { allow } from "../../../lib/store";
import { fail, readBody, clientIp } from "../../../lib/http";

export const dynamic = "force-dynamic";
export const maxDuration = 60;

// 무료 등급에서 쓸 수 있는 Flash 계열을 기본으로 둔다. 바꾸려면 GEMINI_MODEL 환경 변수를 넣는다.
const MODEL = process.env.GEMINI_MODEL || "gemini-flash-latest";
const MAX_PROMPT = 60_000;
const CALLS_PER_HOUR = 30;
const SYSTEM = "너는 군 교육훈련용 LVC 시나리오 설계·사후검토 도우미다. 모든 정보는 가상이며, 실제 부대명·지명·인명·좌표는 쓰지 않는다. 요청한 형식(JSON)만 답한다.";

// API 키는 서버 환경 변수(GEMINI_API_KEY)에서만 읽는다. 브라우저로 보내지 않는다.
let client = null;
const getClient = () => (client ||= new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY.trim().replace(/^["']|["']$/g, "") }));

export async function POST(req) {
  if (!process.env.GEMINI_API_KEY) return fail("not_granted", 503, "GEMINI_API_KEY가 설정되지 않았습니다.");
  if (!(await allow(`ai:${clientIp(req)}`, CALLS_PER_HOUR))) return fail("rate_limited", 429);
  let body;
  try { body = await readBody(req, MAX_PROMPT + 1000); } catch (e) { return fail(e.code, 400); }
  const prompt = typeof body?.prompt === "string" ? body.prompt : "";
  if (!prompt || prompt.length > MAX_PROMPT) return fail("invalid_argument", 400);

  // 스트림을 먼저 열고 첫 조각까지 받아 오류(키·모델·한도)를 응답 전에 잡는다.
  const ctl = new AbortController();
  let it, first;
  try {
    const stream = await getClient().models.generateContentStream({
      model: MODEL,
      contents: prompt,
      config: { systemInstruction: SYSTEM, responseMimeType: "application/json", maxOutputTokens: 16000, abortSignal: ctl.signal },
    });
    it = stream[Symbol.asyncIterator]();
    first = await it.next();
  } catch (e) { return apiError(e); }

  const enc = new TextEncoder();
  const send = (c, chunk) => { const t = chunk?.text; if (t) c.enqueue(enc.encode(t)); };
  const out = new ReadableStream({
    async start(c) {
      try {
        if (!first.done) send(c, first.value);
        let last = first.value;
        for (let r = await it.next(); !r.done; r = await it.next()) { send(c, r.value); last = r.value; }
        const reason = last?.candidates?.[0]?.finishReason;
        if (reason === "SAFETY" || reason === "PROHIBITED_CONTENT" || last?.promptFeedback?.blockReason) c.enqueue(enc.encode("\n\u0000REFUSAL"));
      } catch (e) {
        console.error(e);
        c.enqueue(enc.encode("\n\u0000ERROR"));
      }
      c.close();
    },
    cancel() { ctl.abort(); },
  });
  return new Response(out, { headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" } });
}

function apiError(e) {
  console.error(e);
  const s = e instanceof ApiError ? e.status : 0;
  if (s === 400 && /API key/i.test(e.message)) return fail("not_granted", 503, "API 키를 확인해 주세요.");
  if (s === 401 || s === 403) return fail("not_granted", 503, "API 키를 확인해 주세요.");
  if (s === 429) return fail("rate_limited", 429, "무료 사용 한도에 걸렸습니다. 잠시 후 다시 시도해 주세요.");
  return fail("unavailable", 502);
}
