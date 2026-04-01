// POST /api/querypie/set-cookies — Worker로 쿠키 프록시
// 브라우저 DevTools에서 복사한 쿠키를 사내망 Worker에 전달
import { NextRequest, NextResponse } from "next/server";
import { setWorkerCookies, isSessionConfigured } from "@/lib/querypie";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { cookies } = body;

    if (!Array.isArray(cookies) || cookies.length === 0) {
      return NextResponse.json(
        { error: "cookies 배열이 필요합니다 (Playwright Cookie 형식)" },
        { status: 400 },
      );
    }

    await setWorkerCookies(cookies);
    return NextResponse.json({ ok: true, count: cookies.length });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}

export async function GET() {
  try {
    const configured = await isSessionConfigured();
    return NextResponse.json({ configured });
  } catch {
    return NextResponse.json({ configured: false });
  }
}
