import { persistent, configError, keyInfo } from "../../../lib/store";
import { json } from "../../../lib/http";

export const dynamic = "force-dynamic";

// db: 서버 저장소 사용 가능, persistent: Supabase 연결됨, ai: Gemini API 키 설정됨
// 배포 환경에서 Supabase가 없으면 서버 메모리는 인스턴스마다 달라 쓸 수 없으므로 브라우저 저장으로 돌린다.
export function GET() {
  const db = persistent || process.env.NODE_ENV !== "production" || !process.env.VERCEL;
  return json({ db, persistent, ai: !!process.env.GEMINI_API_KEY, configError, keyInfo });
}
