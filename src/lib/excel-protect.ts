// 엑셀 파일 비밀번호 보호 (xlsx-populate — 파일 열기 암호화)
// ExcelJS sheet.protect()는 셀 편집 보호만 제공하므로,
// xlsx-populate의 outputAsync({ password })로 AES-256 파일 암호화 적용
// eslint-disable-next-line @typescript-eslint/no-var-requires
const XlsxPopulate = require("xlsx-populate");

export async function protectExcel(buffer: Buffer, password: string): Promise<Buffer> {
  const workbook = await XlsxPopulate.fromDataAsync(buffer);
  const result = await workbook.outputAsync({ password });
  return Buffer.from(result);
}
