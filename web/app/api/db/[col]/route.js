import { COLLECTIONS, list, persistent } from "../../../../lib/store";
import { json, fail } from "../../../../lib/http";

export const dynamic = "force-dynamic";

export async function GET(_req, { params }) {
  const { col } = await params;
  if (!COLLECTIONS.includes(col)) return fail("not_found", 404);
  try { return json({ docs: await list(col), persistent }); }
  catch (e) { console.error(e); return fail("unavailable", 503); }
}
