import { COLLECTIONS, get, set, del, allow } from "../../../../../lib/store";
import { json, fail, readBody, clientIp } from "../../../../../lib/http";

export const dynamic = "force-dynamic";
const MAX_DOC = 200_000;
const WRITES_PER_HOUR = 600;

async function guard(req, params) {
  const { col, id } = await params;
  if (!COLLECTIONS.includes(col) || !/^[A-Za-z0-9_-]{1,64}$/.test(id)) return { error: fail("not_found", 404) };
  if (!(await allow(`w:${clientIp(req)}`, WRITES_PER_HOUR))) return { error: fail("rate_limited", 429) };
  return { col, id };
}
const isObj = v => v && typeof v === "object" && !Array.isArray(v);

// set: 문서 전체 교체
export async function PUT(req, { params }) {
  const g = await guard(req, params); if (g.error) return g.error;
  try {
    const body = await readBody(req, MAX_DOC);
    if (!isObj(body)) return fail("invalid_argument", 400);
    await set(g.col, g.id, body);
    return json({ ok: true });
  } catch (e) { return e?.code ? fail(e.code, e.code === "too_large" ? 413 : 400) : (console.error(e), fail("unavailable", 503)); }
}

// update: 기존 문서에 필드 병합. 없는 문서는 invalid_argument.
export async function PATCH(req, { params }) {
  const g = await guard(req, params); if (g.error) return g.error;
  try {
    const patch = await readBody(req, MAX_DOC);
    if (!isObj(patch)) return fail("invalid_argument", 400);
    const cur = await get(g.col, g.id);
    if (!cur) return fail("invalid_argument", 400, "document not found");
    await set(g.col, g.id, { ...cur, ...patch });
    return json({ ok: true });
  } catch (e) { return e?.code ? fail(e.code, e.code === "too_large" ? 413 : 400) : (console.error(e), fail("unavailable", 503)); }
}

export async function DELETE(req, { params }) {
  const g = await guard(req, params); if (g.error) return g.error;
  try { await del(g.col, g.id); return json({ ok: true }); }
  catch (e) { console.error(e); return fail("unavailable", 503); }
}
