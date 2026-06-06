#!/usr/bin/env python3
"""
TTS Server — Edge-TTS 语音合成桥接服务

为 WenStar 玉瑶聊天系统提供 TTS 功能。
使用 Microsoft Edge 免费 TTS 引擎（无需 GPU，离线可用）。

用法:
  python tts_server.py [port]

环境变量:
  TTS_VOICE=zh-CN-XiaoxiaoNeural   # 中文女声（默认）
  TTS_VOICE=zh-CN-YunxiNeural      # 中文男声
  TTS_VOICE=zh-CN-XiaoyiNeural     # 中文情感女声
"""
import json
import os
import sys
import uuid
import argparse
import asyncio
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path

# ── 路径 ──
SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR / ".." / ".." / "data" / "webui"
AUDIO_DIR = DATA_DIR / "audio"

# ── 配置 ──
TTS_VOICE = os.environ.get("TTS_VOICE", "zh-CN-XiaoxiaoNeural")
RATE = os.environ.get("TTS_RATE", "+0%")   # 语速: -50% ~ +50%
VOLUME = os.environ.get("TTS_VOLUME", "+0%")  # 音量: -50% ~ +50%

# 中文声音列表
CHINESE_VOICES = [
    {"id": "zh-CN-XiaoxiaoNeural", "name": "晓晓", "gender": "女", "locale": "普通话"},
    {"id": "zh-CN-XiaoyiNeural", "name": "晓伊", "gender": "女", "locale": "普通话（情感丰富）"},
    {"id": "zh-CN-YunjianNeural", "name": "云健", "gender": "男", "locale": "普通话"},
    {"id": "zh-CN-YunxiNeural", "name": "云希", "gender": "男", "locale": "普通话（温柔）"},
    {"id": "zh-CN-YunxiaNeural", "name": "云夏", "gender": "男", "locale": "普通话"},
    {"id": "zh-CN-YunyangNeural", "name": "云扬", "gender": "男", "locale": "普通话（阳光）"},
    {"id": "zh-CN-liaoning-XiaobeiNeural", "name": "晓北", "gender": "女", "locale": "东北话"},
    {"id": "zh-CN-shaanxi-XiaoniNeural", "name": "晓妮", "gender": "女", "locale": "陕西话"},
    {"id": "zh-HK-HiuGaaiNeural", "name": "晓佳", "gender": "女", "locale": "粤语"},
    {"id": "zh-HK-HiuMaanNeural", "name": "晓文", "gender": "女", "locale": "粤语"},
    {"id": "zh-HK-WanLungNeural", "name": "云龙", "gender": "男", "locale": "粤语"},
    {"id": "zh-TW-HsiaoChenNeural", "name": "晓臻", "gender": "女", "locale": "台湾国语"},
    {"id": "zh-TW-YunJheNeural", "name": "云哲", "gender": "男", "locale": "台湾国语"},
    {"id": "zh-TW-HsiaoYuNeural", "name": "晓雨", "gender": "女", "locale": "台湾国语"},
]


async def generate_tts(text: str) -> dict:
    """生成语音，返回音频文件信息"""
    import edge_tts

    AUDIO_DIR.mkdir(parents=True, exist_ok=True)

    filename = f"tts_{uuid.uuid4().hex[:12]}.mp3"
    filepath = AUDIO_DIR / filename

    communicate = edge_tts.Communicate(
        text,
        TTS_VOICE,
        rate=RATE,
        volume=VOLUME,
    )
    await communicate.save(str(filepath))

    duration = 0
    size = filepath.stat().st_size
    # 粗略估算时长（MP3 约 16KB/秒）
    if size > 0:
        duration = size / 16000

    return {
        "url": f"/audio/{filename}",
        "filename": filename,
        "duration_sec": round(duration, 1),
        "size_bytes": size,
    }


class TTSHandler(BaseHTTPRequestHandler):
    """HTTP 请求处理器"""

    def _send_json(self, data: dict, status: int = 200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        self.wfile.write(json.dumps(data, ensure_ascii=False).encode("utf-8"))

    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "POST, GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def do_GET(self):
        if self.path == "/health":
            self._send_json({"status": "ok", "engine": "edge-tts", "voice": TTS_VOICE})
        elif self.path == "/voices":
            self._send_json({"voices": CHINESE_VOICES, "current": TTS_VOICE})
        elif self.path == "/":
            html = '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>YuYao TTS</title><style>body{font-family:sans-serif;background:#0d0812;color:#f0e0e8;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}.card{background:#1c1530;border:1px solid #2a1e35;border-radius:12px;padding:30px 40px;text-align:center}h1{color:#e8a0b4;font-size:20px;margin:0 0 8px 0}.status{color:#4ade80;font-size:13px;margin-bottom:12px}.info{color:#b8a0b0;font-size:11px;line-height:1.6}code{background:#0d0812;padding:2px 6px;border-radius:4px;font-size:11px}</style></head><body><div class="card"><h1>TTS Voice Service</h1><div class="status">Running</div><div class="info">Voice: <code>'+TTS_VOICE+'</code><br>POST <code>/tts</code> generate speech<br>GET <code>/health</code> health check</div></div></body></html>'
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(html.encode("utf-8"))
        else:
            self._send_json({"error": "not found"}, 404)

    def do_POST(self):
        if self.path == "/voice":
            try:
                length = int(self.headers.get("Content-Length", 0))
                raw = self.rfile.read(length)
                body = json.loads(raw.decode("utf-8"))
                voice_id = body.get("voice", "").strip()
                if not any(v["id"] == voice_id for v in CHINESE_VOICES):
                    self._send_json({"error": f"不支持的声音: {voice_id}"}, 400)
                    return
                global TTS_VOICE
                TTS_VOICE = voice_id
                print(f"[TTS] 切换到声音: {voice_id}")
                self._send_json({"ok": True, "voice": TTS_VOICE})
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
            return

        if self.path == "/tts":
            try:
                length = int(self.headers.get("Content-Length", 0))
                raw = self.rfile.read(length)
                # 处理编码：尝试 UTF-8 和 GBK
                body = None
                for enc in ['utf-8', 'gbk', 'gb2312']:
                    try:
                        body = json.loads(raw.decode(enc))
                        break
                    except (UnicodeDecodeError, json.JSONDecodeError):
                        continue
                if body is None:
                    body = json.loads(raw.decode('utf-8', errors='replace'))
                text = body.get("text", "").strip()
                if not text:
                    self._send_json({"error": "text is required"}, 400)
                    return
                # 异步转同步
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                result = loop.run_until_complete(generate_tts(text))
                loop.close()
                self._send_json(result)
            except Exception as e:
                import traceback
                traceback.print_exc()
                self._send_json({"error": str(e)}, 500)
        else:
            self._send_json({"error": "not found"}, 404)

    def log_message(self, format, *args):
        """简化日志输出"""
        if "/health" not in args[0]:
            print(f"[TTS] {args[0]} {args[1]} {args[2]}")


def main():
    parser = argparse.ArgumentParser(description="Edge-TTS Server")
    parser.add_argument("port", nargs="?", type=int, default=8765,
                       help="监听端口 (默认: 8765)")
    args = parser.parse_args()

    server = HTTPServer(("0.0.0.0", args.port), TTSHandler)
    print(f"[TTS] Edge-TTS 语音合成服务启动: http://localhost:{args.port}")
    print(f"[TTS] 声音: {TTS_VOICE} | 语速: {RATE} | 音量: {VOLUME}")
    print(f"[TTS]   POST /tts  - 生成语音 (JSON: {{'text':'...'}})")
    print(f"[TTS]   GET  /health - 健康检查")
    print(f"[TTS] 音频输出目录: {AUDIO_DIR}")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[TTS] 服务关闭")
        server.server_close()


if __name__ == "__main__":
    main()
