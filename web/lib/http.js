export const json = (body, status = 200) => Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
export const fail = (code, status, message = code) => json({ code, message }, status);
export const clientIp = req => (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || "local";

export async function readBody(req, maxBytes) {
  const text = await req.text();
  if (text.length > maxBytes) throw { code: "too_large" };
  try { return JSON.parse(text); } catch { throw { code: "invalid_argument" }; }
}
