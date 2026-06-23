/**
 * config — 配置加载
 *
 * 从环境变量 + 命令行参数加载配置。
 * 优先级: CLI args > 环境变量 > 默认值
 */

export interface LibraryConfig {
  port: number;
  dataDir: string;
  watchDir: string;
  userId: string;
  syncInterval: number;
  autoSync: boolean;
}

const DEFAULT_CONFIG: LibraryConfig = {
  port: 3737,
  dataDir: './data',
  watchDir: './data/watch',
  userId: 'library',
  syncInterval: 300_000,
  autoSync: true,
};

export function loadConfig(): LibraryConfig {
  const args = parseArgs();
  return {
    port: args.port ?? (parseInt(process.env.TAIXU_LIBRARY_PORT ?? '', 10) || DEFAULT_CONFIG.port),
    dataDir: args.dataDir ?? (process.env.TAIXU_LIBRARY_DATA_DIR || DEFAULT_CONFIG.dataDir),
    watchDir: args.watchDir ?? (process.env.TAIXU_LIBRARY_WATCH_DIR || DEFAULT_CONFIG.watchDir),
    userId: args.userId ?? (process.env.TAIXU_LIBRARY_USER_ID || DEFAULT_CONFIG.userId),
    syncInterval: DEFAULT_CONFIG.syncInterval,
    autoSync: DEFAULT_CONFIG.autoSync,
  };
}

function parseArgs(): Partial<LibraryConfig> {
  const config: Partial<LibraryConfig> = {};
  const argv = process.argv.slice(2);

  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--port':
        config.port = parseInt(argv[++i], 10);
        break;
      case '--data-dir':
        config.dataDir = argv[++i];
        break;
      case '--watch-dir':
        config.watchDir = argv[++i];
        break;
      case '--user-id':
        config.userId = argv[++i];
        break;
    }
  }

  return config;
}
