import { createClient } from "@supabase/supabase-js";

// Supabase 연결 정보는 서버 환경 변수에서만 읽는다. 서비스(secret) 키는 브라우저로 보내지 않는다.
// Vercel의 Supabase 연동은 SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY를, 직접 넣을 때는 SUPABASE_SECRET_KEY도 받는다.
const url = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY;
const sb = url && key ? createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }) : null;

// 환경 변수가 없으면(로컬 개발) 서버 메모리에 둔다. 재시작하면 사라진다.
const mem = globalThis.__lvcMem || (globalThis.__lvcMem = { h: {}, n: {} });

export const COLLECTIONS = ["scenarios", "comments", "history", "config", "aar"];
export const persistent = !!sb;
const T = "lvc_docs";
const check = ({ data, error }) => { if (error) throw error; return data; };

export async function list(c) {
  if (!sb) return Object.entries(mem.h[c] || {}).map(([id, v]) => ({ id, data: v }));
  return check(await sb.from(T).select("id, data").eq("col", c));
}
export async function get(c, id) {
  if (!sb) return mem.h[c]?.[id] ?? null;
  const row = check(await sb.from(T).select("data").eq("col", c).eq("id", id).maybeSingle());
  return row?.data ?? null;
}
export async function set(c, id, v) {
  if (!sb) { (mem.h[c] = mem.h[c] || {})[id] = v; return; }
  check(await sb.from(T).upsert({ col: c, id, data: v, updated_at: new Date().toISOString() }));
}
export async function del(c, id) {
  if (!sb) { delete mem.h[c]?.[id]; return; }
  check(await sb.from(T).delete().eq("col", c).eq("id", id));
}

// 시간당 요청 수 제한. 한도를 넘으면 false. (DB 함수 lvc_hit가 원자적으로 센다)
export async function allow(bucket, limit) {
  const k = `${bucket}:${Math.floor(Date.now() / 3600000)}`;
  if (!sb) { mem.n[k] = (mem.n[k] || 0) + 1; return mem.n[k] <= limit; }
  return check(await sb.rpc("lvc_hit", { p_key: k, p_limit: limit })) === true;
}
