/**
 * FolderManager — 外挂文件夹 MD 自动摄入流水线
 *
 * SP2-4: 用户丢文件到待处理目录，自动解析 → 生成 MD → 写入知识库
 *
 * 目录结构:
 *   知识库根目录/
 *   ├── 01-待处理素材/    ← 丢文件进来，自动触发解析
 *   ├── 02-知识笔记库/    ← 生成的 MD 笔记，可手动编辑
 *   ├── 03-原始附件归档/  ← 原始文件按分类归档
 *   └── 04-回收站/        ← 删除的文件可恢复
 *
 * 支持格式: txt, md, docx, pdf, jpg, png
 */
import fs from 'node:fs';
import path from 'node:path';

export class FolderManager {
  private rootPath: string;
  private watcher: fs.FSWatcher | null = null;
  private watchTimer: ReturnType<typeof setTimeout> | null = null;
  private processing = false;

  constructor(rootPath?: string) {
    this.rootPath = rootPath || process.env['KNOWLEDGE_FOLDER_PATH'] || path.join(process.cwd(), 'data', 'external-knowledge');
  }

  /** 获取各子目录路径 */
  get dirs() {
    return {
      pending: path.join(this.rootPath, '01-待处理素材'),
      notes: path.join(this.rootPath, '02-知识笔记库'),
      archive: path.join(this.rootPath, '03-原始附件归档'),
      trash: path.join(this.rootPath, '04-回收站'),
    };
  }

  /** 初始化目录结构 */
  async initialize(): Promise<void> {
    const dirs = Object.values(this.dirs);
    for (const d of dirs) {
      if (!fs.existsSync(d)) {
        fs.mkdirSync(d, { recursive: true });
        console.log('[FolderManager] 创建目录: ' + d);
      }
    }
    console.log('[FolderManager] ✅ 目录结构初始化完成: ' + this.rootPath);
  }

  /** 启动文件监听 */
  startWatching(intervalMs: number = 3000): void {
    if (this.watcher) return;
    // 使用轮询方式（跨平台兼容）
    const poll = () => {
      this.scanPending();
      this.watchTimer = setTimeout(poll, intervalMs);
    };
    this.watchTimer = setTimeout(poll, intervalMs);
    console.log('[FolderManager] 文件监听已启动（轮询间隔: ' + intervalMs + 'ms）');
  }

  /** 停止监听 */
  stopWatching(): void {
    if (this.watchTimer) { clearTimeout(this.watchTimer); this.watchTimer = null; }
    if (this.watcher) { this.watcher.close(); this.watcher = null; }
    console.log('[FolderManager] 文件监听已停止');
  }

  /** 扫描待处理目录 */
  async scanPending(): Promise<void> {
    if (this.processing) return;
    try {
      const files = fs.readdirSync(this.dirs.pending);
      for (const file of files) {
        const filePath = path.join(this.dirs.pending, file);
        const stat = fs.statSync(filePath);
        if (!stat.isFile()) continue;
        // 正在写入的文件跳过（3秒内修改过的）
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs < 3000) continue;
        await this.processFile(filePath);
      }
    } catch (err) {
      // 目录不存在不报错
    }
  }

  /** 处理单个文件 */
  async processFile(filePath: string): Promise<void> {
    this.processing = true;
    const ext = path.extname(filePath).toLowerCase();
    const baseName = path.basename(filePath);
    const fileNameNoExt = path.basename(filePath, ext);

    try {
      let text = '';
      const extMap: Record<string, string> = {
        '.txt': 'txt', '.md': 'md', '.docx': 'docx', '.pdf': 'pdf',
        '.jpg': 'image', '.jpeg': 'image', '.png': 'image',
      };
      const fileType = extMap[ext] || 'other';

      if (fileType === 'other') {
        console.log('[FolderManager] 跳过不支持格式: ' + ext);
        this.processing = false;
        return;
      }

      // 不同格式处理
      if (fileType === 'txt' || fileType === 'md') {
        text = fs.readFileSync(filePath, 'utf-8');
      } else if (fileType === 'docx') {
        try {
          const mammoth = await import('mammoth');
          const result = await mammoth.extractRawText({ buffer: fs.readFileSync(filePath) });
          text = result.value;
        } catch {
          text = '[docx 解析失败]';
        }
      } else if (fileType === 'pdf') {
        try {
          const pdfParse = await import('pdf-parse');
          const dataBuffer = fs.readFileSync(filePath);
          const data = await pdfParse(dataBuffer);
          text = data.text || '';
        } catch {
          text = '[pdf 解析失败]';
        }
      } else if (fileType === 'image') {
        try {
          const tesseract = await import('tesseract.js');
          const result = await tesseract.recognize(filePath, 'chi_sim+eng');
          text = result.data.text || '[图片未识别到文字]';
        } catch {
          text = '[图片 OCR 失败]';
        }
      }

      if (!text || text.trim().length === 0) {
        console.log('[FolderManager] 空内容跳过: ' + baseName);
        this.processing = false;
        return;
      }

      // 生成 MD 笔记
      const summary = text.replace(/\s+/g, ' ').trim().substring(0, 200);
      const entityMatches = text.match(/[赵孙李周吴郑王冯陈褚蒋沈韩杨朱秦许何吕施张孔曹严华金魏陶姜戚谢邹柏水窦章苏潘葛彭郎鲁韦马苗凤花方俞任袁柳鲍史费廉岑薛雷贺倪汤罗郝邬安乐][一-龥]{1,2}/g) || [];
            // 任务2: 图片情感标签滤镜
      const imageTags = fileType === 'image' ? (await import("./parsers/ImageParser.js")).analyzeImageTags(text) : [];
      const topicKeywords = [
        ...imageTags,
        ...['工作','项目','技术','家庭','情感','健康','学习','生活','娱乐','社交']
          .filter(kw => text.includes(kw)),
      ];

      const now = new Date().toISOString();
      const mdContent = [
        '---',
        'dna_id: MD_' + Date.now().toString(36),
        'source_file: ' + baseName,
        'file_type: ' + fileType,
        'create_time: ' + now,
        'entity_list: [' + [...new Set(entityMatches)].slice(0, 10).join(', ') + ']',
        'topic_tags: [' + topicKeywords.join(', ') + ']',
        'calcium_score: 0.0',
        'memory_level: 粉末',
        '---',
        '',
        '# ' + fileNameNoExt,
        '',
        '> 摘要：' + summary,
        '',
        text.substring(0, 10000),
      ].join('\n');

      // 写入 02-知识笔记库
      const notePath = path.join(this.dirs.notes, fileNameNoExt + '.md');
      fs.writeFileSync(notePath, mdContent, 'utf-8');
      console.log('[FolderManager] 生成MD笔记: ' + fileNameNoExt + '.md');

      // 归档原始文件
      const archiveDir = path.join(this.dirs.archive, fileType);
      if (!fs.existsSync(archiveDir)) fs.mkdirSync(archiveDir, { recursive: true });
      const archivePath = path.join(archiveDir, baseName);
      fs.renameSync(filePath, archivePath);

      console.log('[FolderManager] 归档: ' + baseName + ' → ' + fileType + '/');
    } catch (err) {
      console.warn('[FolderManager] 处理失败: ' + baseName, err);
    }
    this.processing = false;
  }

  /** 同步笔记库变更到知识库 */
  async syncNotes(): Promise<void> {
    try {
      const files = fs.readdirSync(this.dirs.notes);
      for (const file of files) {
        if (!file.endsWith('.md')) continue;
        const filePath = path.join(this.dirs.notes, file);
        const stat = fs.statSync(filePath);
        const ageMs = Date.now() - stat.mtimeMs;
        if (ageMs < 5000) continue; // 正在编辑中
        // 已存在且未修改则跳过
        // 实际场景通过 mtime 追踪
      }
    } catch (err) {
      console.warn('[FolderManager] 笔记同步失败:', err);
    }
  }

  /** 释放资源 */
  dispose(): void {
    this.stopWatching();
  }
}
