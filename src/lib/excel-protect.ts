// 엑셀 파일 비밀번호 보호 (exceljs)
import ExcelJS from "exceljs";

const DEFAULT_PASSWORD = "1234abcd";

export async function protectExcel(
  buffer: Buffer,
  password: string = DEFAULT_PASSWORD,
): Promise<Buffer> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);

  // 모든 시트에 비밀번호 보호 적용
  workbook.eachSheet((sheet) => {
    sheet.protect(password, {
      selectLockedCells: true,
      selectUnlockedCells: true,
      formatColumns: false,
      formatRows: false,
      formatCells: false,
      insertColumns: false,
      insertRows: false,
      insertHyperlinks: false,
      deleteColumns: false,
      deleteRows: false,
      sort: false,
      autoFilter: false,
    });
  });

  const result = await workbook.xlsx.writeBuffer();
  return Buffer.from(result);
}
