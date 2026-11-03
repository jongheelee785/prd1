import { createClient } from "@supabase/supabase-js";
import { readFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

// Supabase 연결 정보는 서버 환경 변수에서만 읽는다. 서비스(secret) 키는 브라우저로 보내지 않는다.
// Vercel의 Supabase 연동은 SUPABASE_URL·SUPABASE_SERVICE_ROLE_KEY를, 직접 넣을 때는 SUPABASE_SECRET_KEY도 받는다.
// 붙여 넣을 때 섞여 든 공백·따옴표는 떼어 낸다. 값이 잘못되면 빌드를 멈추지 않고 configError로 알린다.
const clean = v => String(v || "").trim().replace(/^[A-Z_]+\s*=\s*/, "").replace(/^["']|["']$/g, "").trim();
const url = clean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL);
const key = clean(process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SUPABASE_SECRET_KEY);
export let configError = "";
// 키 자체는 밝히지 않고, 어떤 종류의 키이며 어느 프로젝트 것인지만 알려 준다(설정 확인용)
export const keyInfo = (() => {
  if (!key) return null;
  if (key.startsWith("sb_secret_")) return { kind: "secret" };
  if (key.startsWith("sb_publishable_")) return { kind: "publishable(공개용, 잘못된 키)" };
  try {
    const p = JSON.parse(Buffer.from(key.split(".")[1], "base64url").toString());
    const urlRef = (url.match(/^https:\/\/([^.]+)\.supabase\.co/) || [])[1] || "";
    return { kind: "jwt", role: p.role, sameProject: p.ref === urlRef };
  } catch { return { kind: "알 수 없는 형식", length: key.length, masked: /[•*]/.test(key), hasSpace: /\s/.test(key), startsWith: key.slice(0, 3).replace(/[A-Za-z0-9]/g, c => /[a-z]/.test(c) ? "a" : /[A-Z]/.test(c) ? "A" : "9") }; }
})();
let sb = null;
if (url || key) {
  if (!/^https:\/\/[^\s/]+/.test(url)) configError = "SUPABASE_URL이 https://로 시작하는 Project URL이 아닙니다.";
  else if (!key) configError = "SUPABASE_SERVICE_ROLE_KEY가 비어 있습니다.";
  else {
    try { sb = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } }); }
    catch (e) { configError = "Supabase 연결 정보를 확인해 주세요: " + e.message; }
  }
}

// 환경 변수가 없으면(로컬 개발) 서버 메모리에 둔다. 재시작하면 사라진다.
const mem = globalThis.__lvcMem || (globalThis.__lvcMem = { h: {}, n: {} });

export const COLLECTIONS = ["scenarios", "comments", "history", "config", "aar"];
export const persistent = !!sb;
const T = "lvc_docs";
const check = ({ data, error }) => { if (error) throw error; return data; };

// Vercel에서 Supabase를 연결하면 POSTGRES_URL_NON_POOLING도 들어온다. 그 경우 첫 요청 때
// supabase/setup.sql을 실행해 표·함수를 만든다(여러 번 실행해도 안전). 값이 없으면 SQL Editor에서 직접 실행한다.
const pgUrl = process.env.POSTGRES_URL_NON_POOLING || process.env.POSTGRES_URL;
let ready = null;
function ensureSetup() {
  if (!sb || !pgUrl) return Promise.resolve();
  return (ready ||= (async () => {
    const sql = await readFile(path.join(process.cwd(), "supabase", "setup.sql"), "utf8");
    const client = new pg.Client({ connectionString: pgUrl.replace(/[?&]sslmode=[^&]*/, ""), ssl: { rejectUnauthorized: false } });
    await client.connect();
    try { await client.query(sql); } finally { await client.end(); }
  })().catch(e => { ready = null; console.error("supabase setup failed", e); }));
}

export async function list(c) {
  if (!sb) return Object.entries(mem.h[c] || {}).map(([id, v]) => ({ id, data: v }));
  await ensureSetup();
  return check(await sb.from(T).select("id, data").eq("col", c));
}
export async function get(c, id) {
  if (!sb) return mem.h[c]?.[id] ?? null;
  await ensureSetup();
  const row = check(await sb.from(T).select("data").eq("col", c).eq("id", id).maybeSingle());
  return row?.data ?? null;
}
export async function set(c, id, v) {
  if (!sb) { (mem.h[c] = mem.h[c] || {})[id] = v; return; }
  await ensureSetup();
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
  await ensureSetup();
  return check(await sb.rpc("lvc_hit", { p_key: k, p_limit: limit })) === true;
}
