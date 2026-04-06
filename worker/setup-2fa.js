/**
 * Google 2FA 최초 설정 스크립트
 *
 * 브라우저가 열리면:
 * 1. 이메일/비밀번호 자동 입력
 * 2. 2FA 화면에서 수동으로 승인 (휴대폰 탭 등)
 * 3. QueryPie 대시보드 도착 시 자동으로 Google + QueryPie 쿠키 저장
 *
 * 사용법: node setup-2fa.js
 */
const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

// .env 로드
const envPath = path.join(__dirname, ".env");
if (fs.existsSync(envPath)) {
  fs.readFileSync(envPath, "utf-8").split("\n").forEach((line) => {
    const [key, ...vals] = line.split("=");
    if (key && vals.length) process.env[key.trim()] = vals.join("=").trim();
  });
}

const QUERYPIE_BASE = "https://querypie.infra.wadcorp.in";
const EMAIL = process.env.QUERYPIE_EMAIL;
const PASSWORD = process.env.QUERYPIE_PASSWORD;
const SESSION_PATH = path.join(__dirname, "session.json");
const GOOGLE_SESSION_PATH = path.join(__dirname, "google-session.json");

if (!EMAIL || !PASSWORD) {
  console.error("❌ .env에 QUERYPIE_EMAIL / QUERYPIE_PASSWORD를 설정하세요");
  process.exit(1);
}

(async () => {
  console.log("🚀 브라우저를 여는 중... (headless: false)");
  console.log("   이메일/비밀번호는 자동 입력됩니다.");
  console.log("   2FA 화면이 나오면 휴대폰에서 승인해주세요.\n");

  const browser = await chromium.launch({
    headless: false,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const context = await browser.newContext();
  const page = await context.newPage();

  // 1. QueryPie 로그인
  await page.goto(`${QUERYPIE_BASE}/login`, { waitUntil: "networkidle", timeout: 30000 });

  // 2. Login with SAML
  console.log("1. Login with SAML 클릭...");
  await page.locator('button:has-text("Login with SAML")').click();
  await page.waitForLoadState("networkidle");

  // 3. 이메일 입력
  const emailInput = page.locator("#identifierId");
  if ((await emailInput.count()) > 0 && (await emailInput.isVisible())) {
    console.log("2. 이메일 입력...");
    await emailInput.fill(EMAIL);
    await page.locator("#identifierNext").click();
    await page.waitForTimeout(3000);
  }

  // 4. 비밀번호 입력
  const pwInput = page.locator('input[type="password"][name="Passwd"]');
  try {
    await pwInput.waitFor({ state: "visible", timeout: 10000 });
    console.log("3. 비밀번호 입력...");
    await pwInput.fill(PASSWORD);
    await page.locator("#passwordNext").click();
  } catch {
    console.log("3. 비밀번호 화면 스킵 (이미 인증됨)");
  }

  // 5. 2FA 대기 — 사용자가 수동 승인
  console.log("\n⏳ 2FA 승인을 기다리는 중... (최대 120초)");
  console.log("   휴대폰에서 Google 로그인 요청을 승인하세요.\n");

  try {
    await page.waitForURL("**/querypie.infra.wadcorp.in/**", { timeout: 120000 });
    console.log("✅ QueryPie로 리다이렉트 성공!");

    // /dashboard 대기
    try {
      await page.waitForURL("**/dashboard**", { timeout: 15000 });
    } catch {
      await page.goto(`${QUERYPIE_BASE}/dashboard`, { waitUntil: "networkidle", timeout: 15000 });
    }

    console.log(`   최종 URL: ${page.url()}`);

    // 쿠키 저장
    const allCookies = await context.cookies();

    // QueryPie 쿠키
    const qpCookies = allCookies.filter((c) => c.domain.includes("querypie"));
    fs.writeFileSync(SESSION_PATH, JSON.stringify(qpCookies, null, 2), "utf-8");
    console.log(`\n📦 QueryPie 쿠키 ${qpCookies.length}개 저장 → session.json`);

    // Google 세션 쿠키
    const googleCookies = allCookies.filter(
      (c) => c.domain.includes("google") || c.domain.includes("gstatic") || c.domain.includes("youtube"),
    );
    fs.writeFileSync(GOOGLE_SESSION_PATH, JSON.stringify(googleCookies, null, 2), "utf-8");
    console.log(`📦 Google 세션 쿠키 ${googleCookies.length}개 저장 → google-session.json`);

    console.log("\n✅ 설정 완료! 이제 Worker가 자동으로 2FA 없이 로그인할 수 있습니다.");
    console.log("   Worker 실행: node server.js");
  } catch {
    console.error("\n❌ 120초 내에 로그인이 완료되지 않았습니다.");
    console.error("   다시 실행해주세요: node setup-2fa.js");
    await page.screenshot({ path: path.join(__dirname, "setup-2fa-timeout.png"), fullPage: true });
  }

  await browser.close();
})();
