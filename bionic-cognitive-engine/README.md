# 仿生智脑 (Bionic Cognitive Engine)
## 独立生物智脑 · 底层知识引擎

**版本**: v0.2 · 基础设施  
**世界观**: 太虚境  
**掌管者**: 景幻仙姑  

### 启动方式
```bash
cd tx-cognitive-engine
python main.py
```

### 目录结构
```
tx-cognitive-engine/
├── main.py                     # 入口：初始化DB + 启动交互式Shell
├── requirements.txt            # 依赖
├── config/
│   └── settings.py             # 全局配置
├── core/
│   ├── __init__.py
│   ├── database.py             # SQLite3 数据库引擎 (三张核心表)
│   ├── taixu_engine.py         # BionicEngine 核心类
│   └── models.py               # ORM/数据模型
├── data/
│   ├── alluvial/               # 砂金库（原材料）
│   ├── gold/                   # 金库（标准馆藏+原声带）
│   └── black_diamond/          # 黑钻库（事件+情感曲谱）
├── logs/                       # 运行日志
└── tx_cognitive.db             # SQLite 数据库文件
```

### 三库数据流
```
砂金库 → 基础清洗(IQC) → 金库(原声带) → 做梦提炼 → 黑钻库(事件)
```
