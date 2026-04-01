// QueryPie 자동 추출 — Playwright + 쿠키 세션 재사용
// SAML SSO(Keycloak)는 자동화 불가 → 저장된 쿠키로 세션 우회
import { chromium } from "playwright";
import fs from "fs";
import path from "path";
import unzipper from "unzipper";
import type { Readable } from "stream";

const SESSION_PATH = path.join(process.cwd(), "data", "querypie-session.json");
const QUERYPIE_BASE = "https://querypie.infra.wadcorp.in";
const ZIP_PASSWORD = "qwer1234!";

export function isSessionConfigured(): boolean {
  try {
    if (!fs.existsSync(SESSION_PATH)) return false;
    const cookies = JSON.parse(fs.readFileSync(SESSION_PATH, "utf-8"));
    return Array.isArray(cookies) && cookies.length > 0;
  } catch {
    return false;
  }
}

function streamToBuffer(stream: Readable): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    stream.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    stream.on("end", () => resolve(Buffer.concat(chunks)));
    stream.on("error", reject);
  });
}

async function extractXlsxFromZip(zipBuffer: Buffer, password: string): Promise<Buffer> {
  const directory = await unzipper.Open.buffer(zipBuffer);
  const xlsxFile = directory.files.find(
    (f) => f.path.endsWith(".xlsx") || f.path.endsWith(".xls"),
  );
  if (!xlsxFile) throw new Error("ZIP에서 엑셀 파일을 찾을 수 없습니다");
  return await xlsxFile.buffer(password);
}

export async function extractFromQueryPie(sql: string): Promise<Buffer> {
  const cookies = JSON.parse(fs.readFileSync(SESSION_PATH, "utf-8"));

  const browser = await chromium.launch({
    headless: true,
    executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE_PATH || undefined,
    args: ["--no-sandbox", "--disable-setuid-sandbox", "--disable-dev-shm-usage"],
  });

  try {
    const context = await browser.newContext({
      // 다운로드 폴더 임시 설정
      acceptDownloads: true,
    });
    await context.addCookies(cookies);
    const page = await context.newPage();

    // 1. QueryPie 접속 + 세션 만료 확인
    await page.goto(QUERYPIE_BASE, { waitUntil: "networkidle", timeout: 30000 });
    if (isAuthPage(page.url())) throw new Error("SESSION_EXPIRED");

    // 2. SQL Worksheet로 이동
    // QueryPie URL 패턴: /sql-editor 또는 /worksheet
    await page.goto(`${QUERYPIE_BASE}/sql-editor`, {
      waitUntil: "networkidle",
      timeout: 30000,
    });
    if (isAuthPage(page.url())) throw new Error("SESSION_EXPIRED");

    // 3. 에디터가 준비될 때까지 대기
    await page.waitForSelector(
      ".CodeMirror, .cm-editor, [data-testid='sql-editor'], textarea.sql-input",
      { timeout: 20000 },
    );

    // 4. SQL 에디터 클릭 → 전체 선택 → 입력
    // CodeMirror v5: .CodeMirror textarea
    // CodeMirror v6 / Monaco: .cm-content
    const editorSelectors = [
      ".CodeMirror textarea",
      ".cm-content",
      "[data-testid='sql-editor'] textarea",
      "textarea.sql-input",
    ];
    let typed = false;
    for (const sel of editorSelectors) {
      const el = page.locator(sel).first();
      if (await el.count() > 0) {
        await el.click();
        await page.keyboard.press("Control+a");
        await page.keyboard.type(sql);
        typed = true;
        break;
      }
    }
    if (!typed) throw new Error("SQL 에디터를 찾을 수 없습니다 — 선택자를 확인해주세요");

    // 5. 실행 버튼 클릭
    await page
      .locator(
        'button:has-text("Run"), button:has-text("실행"), button[title="Run"], button[aria-label="Run"]',
      )
      .first()
      .click();

    // 6. 결과 테이블 대기 (최대 90초)
    await page.waitForSelector(
      '.result-table, .data-grid, [data-testid="result-table"], .ant-table-tbody, .ag-center-cols-container',
      { timeout: 90000 },
    );

    // 7. Export 버튼 클릭
    await page
      .locator(
        'button:has-text("Export"), button[title="Export"], button[aria-label="Export"], [data-testid="export-btn"]',
      )
      .first()
      .click();

    // 8. 비밀번호 입력 다이얼로그 대기
    await page.waitForSelector('input[type="password"]', { timeout: 10000 });
    await page.locator('input[type="password"]').first().fill(ZIP_PASSWORD);

    // 9. 다운로드 트리거 (확인/다운로드 버튼)
    const [download] = await Promise.all([
      page.waitForEvent("download", { timeout: 60000 }),
      page
        .locator(
          'button:has-text("Download"), button:has-text("다운로드"), button:has-text("확인"), button[type="submit"]',
        )
        .last()
        .click(),
    ]);

    // 10. 스트림 → Buffer
    const zipStream = await download.createReadStream();
    const zipBuffer = await streamToBuffer(zipStream as unknown as Readable);

    // 11. ZIP 압축 해제 → .xlsx Buffer 반환
    return await extractXlsxFromZip(zipBuffer, ZIP_PASSWORD);
  } finally {
    await browser.close();
  }
}

function isAuthPage(url: string): boolean {
  return (
    url.includes("keycloak") ||
    url.includes("/auth") ||
    url.includes("/login") ||
    url.includes("sso")
  );
}
