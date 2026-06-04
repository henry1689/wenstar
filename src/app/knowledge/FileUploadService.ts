/**
 * FileUploadService — 文件上传解析服务
 *
 * 支持 8 种文件类型：
 *   .txt  — 直接读取
 *   .md   — 去除 Markdown 语法标记后转纯文本
 *   .pdf  — pdf-parse 提取文本
 *   .docx — mammoth 提取原始文本
 *   .xlsx / .xls / .csv — SheetJS 解析为表格文本
 *   .jpg / .jpeg / .png / .gif / .webp — tesseract.js OCR 识别文字
 *
 * 所有解析结果统一返回 { title, content, source_type, source_name, file_size }
 */
import mammoth from 'mammoth';
import pdfParse from 'pdf-parse';
import * as XLSX from 'xlsx';
import { createWorker } from 'tesseract.js';
import { writeFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const UPLOAD_DIR = join(__dirname, '..', '..', '..', 'data', 'webui', 'uploads');

function ensureUploadDir(): void {
  if (!existsSync(UPLOAD_DIR)) mkdirSync(UPLOAD_DIR, { recursive: true });
}

export interface ParsedFile {
  title: string;
  content: string;
  source_type: string;
  source_name: string;
  file_size: number;
}

/**
 * 根据 MIME 类型解析文件内容
 */
export async function parseFile(
  buffer: Buffer,
  mimeType: string,
  originalName: string,
): Promise<ParsedFile> {
  const ext = originalName.toLowerCase().split('.').pop() ?? '';
  const title = originalName.replace(/\.[^/.]+$/, '');
  const fileSize = buffer.length;

  let content: string;

  // 根据 MIME 和扩展名路由
  if (mimeType === 'text/plain' || ext === 'txt') {
    content = buffer.toString('utf-8');
  } else if (mimeType === 'text/markdown' || ext === 'md') {
    content = stripMarkdown(buffer.toString('utf-8'));
  } else if (mimeType === 'application/pdf' || ext === 'pdf') {
    content = await parsePdf(buffer);
  } else if (
    mimeType === 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    ext === 'docx'
  ) {
    content = await parseDocx(buffer);
  } else if (
    /^application\/vnd\.(openxmlformats-officedocument\.spreadsheetml|ms-excel)/.test(mimeType) ||
    ext === 'xlsx' || ext === 'xls' || ext === 'csv'
  ) {
    content = await parseExcel(buffer, ext);
  } else if (
    /^image\//.test(mimeType) ||
    ['jpg', 'jpeg', 'png', 'gif', 'webp', 'bmp'].includes(ext)
  ) {
    content = await parseImage(buffer, originalName);
  } else {
    // 兜底：未知类型尝试按文本读
    content = buffer.toString('utf-8').substring(0, 1000);
  }

  // 保存原始文件到上传目录
  ensureUploadDir();
  const safeName = originalName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const filePath = join(UPLOAD_DIR, `${Date.now()}_${safeName}`);
  writeFileSync(filePath, buffer);

  return {
    title,
    content: content.trim(),
    source_type: ext || 'unknown',
    source_name: originalName,
    file_size: fileSize,
  };
}

/** PDF 文本提取 */
async function parsePdf(buffer: Buffer): Promise<string> {
  try {
    const data = await pdfParse(buffer);
    return data.text || '';
  } catch (err) {
    console.warn('[FileUpload] PDF 解析失败:', err);
    return `[PDF 解析失败]`;
  }
}

/** DOCX 文本提取 */
async function parseDocx(buffer: Buffer): Promise<string> {
  try {
    const result = await mammoth.extractRawText({ buffer });
    return result.value || '';
  } catch (err) {
    console.warn('[FileUpload] DOCX 解析失败:', err);
    return `[DOCX 解析失败]`;
  }
}

/** Excel / CSV 解析 */
async function parseExcel(buffer: Buffer, ext: string): Promise<string> {
  try {
    const workbook = XLSX.read(buffer, { type: 'buffer' });
    let result = `【文件共 ${workbook.SheetNames.length} 个工作表】\n\n`;

    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const jsonData = XLSX.utils.sheet_to_json<any[]>(sheet, { header: 1 });

      result += `📊 工作表: ${sheetName} (${jsonData.length} 行)\n`;
      if (jsonData.length > 0) {
        // 取前 50 行作为展示
        const maxRows = Math.min(jsonData.length, 50);
        for (let r = 0; r < maxRows; r++) {
          const row = jsonData[r];
          if (row && row.length > 0) {
            result += `  行${r + 1}: ${row.map(c => c ?? '').join(' | ')}\n`;
          }
        }
        if (jsonData.length > 50) {
          result += `  ... 还有 ${jsonData.length - 50} 行未展示\n`;
        }
      }
      result += '\n';
    }

    return result;
  } catch (err) {
    console.warn('[FileUpload] Excel 解析失败:', err);
    return `[Excel 解析失败: ${err instanceof Error ? err.message : '未知错误'}]`;
  }
}

/** 图片 OCR 文字识别 */
async function parseImage(buffer: Buffer, fileName: string): Promise<string> {
  const ext = fileName.toLowerCase().split('.').pop() ?? '';
  const mimeMap: Record<string, string> = {
    jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png',
    gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp',
  };

  try {
    // 先用 Tesseract.js 做 OCR
    const worker = await createWorker('chi_sim+eng');
    const { data } = await worker.recognize(buffer);
    await worker.terminate();

    let result = `🖼️ 图片文件: ${fileName}\n`;
    result += `📐 类型: ${mimeMap[ext] || 'image'}\n`;
    result += `📦 大小: ${(buffer.length / 1024).toFixed(1)} KB\n\n`;

    if (data.text && data.text.trim()) {
      result += `【识别的文字内容】\n${data.text.trim()}`;
    } else {
      // 尝试英文 OCR
      const workerEn = await createWorker('eng');
      const { data: dataEn } = await workerEn.recognize(buffer);
      await workerEn.terminate();

      if (dataEn.text && dataEn.text.trim()) {
        result += `【识别的文字内容(英文)】\n${dataEn.text.trim()}`;
      } else {
        result += `[未在图片中识别到文字内容。图片已保存，玉瑶可以看到图片文件]`;
      }
    }

    return result;
  } catch (err) {
    console.warn('[FileUpload] 图片 OCR 识别失败:', err);
    return `🖼️ 图片文件: ${fileName}\n📐 类型: ${mimeMap[ext] || 'image'}\n📦 大小: ${(buffer.length / 1024).toFixed(1)} KB\n\n[OCR 识别失败: ${err instanceof Error ? err.message : '未知错误'}]`;
  }
}

/** Excel 导出为 JSON 格式（供编辑 API 使用） */
export function excelToJson(buffer: Buffer): { sheets: Array<{ name: string; data: any[][] }> } {
  const workbook = XLSX.read(buffer, { type: 'buffer' });
  const sheets = workbook.SheetNames.map(name => ({
    name,
    data: XLSX.utils.sheet_to_json<any[]>(workbook.Sheets[name], { header: 1 }),
  }));
  return { sheets };
}

/** 从 JSON 生成 Excel buffer（供编辑 API 使用） */
export function jsonToExcel(sheets: Array<{ name: string; data: any[][] }>): Buffer {
  const workbook = XLSX.utils.book_new();
  for (const sheet of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(sheet.data);
    XLSX.utils.book_append_sheet(workbook, ws, sheet.name);
  }
  return Buffer.from(XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }));
}

/** 去除 Markdown 语法标记 */
function stripMarkdown(text: string): string {
  return text
    .replace(/#{1,6}\s+/g, '')
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
    .replace(/`{1,3}[^`]*`{1,3}/g, '')
    .replace(/!\[.*?\]\(.*?\)/g, '')
    .replace(/\[([^\]]+)\]\(.*?\)/g, '$1')
    .replace(/>\s+/g, '')
    .replace(/[-*+]\s+/g, '')
    .replace(/\d+\.\s+/g, '')
    .replace(/```[\s\S]*?```/g, '')
    .replace(/\n{3,}/g, '\n\n');
}
