#!/usr/bin/env python3
"""
TTS Server — 玉瑶语音合成服务

支持三引擎：
  • Edge-TTS （默认）— 微软云端，音质佳，需联网
  • ChatTTS（本地） — 开源本地模型，完全离线
  • MOSS-TTS（轻量）— 0.1B参数CPU离线模型，支持20种语言

用法:
  python tts_server.py [port]

环境变量:
  TTS_ENGINE=edge|chattts|moss   # 默认引擎
  TTS_VOICE=...                   # 默认声音
  MOSS_TTS_URL=http://127.0.0.1:8000  # MOSS-TTS 服务地址
  CHATTTS_MODEL_PATH              # ChatTTS 模型路径（自动检测）
"""
import json
import os
import sys
import uuid
import argparse
import asyncio
import threading
import requests
from http.server import HTTPServer, BaseHTTPRequestHandler
from pathlib import Path
from functools import partial

# ── 路径 ──
SCRIPT_DIR = Path(__file__).parent
DATA_DIR = SCRIPT_DIR / ".." / ".." / "data" / "webui"
AUDIO_DIR = DATA_DIR / "audio"

# ── 配置 ──
TTS_ENGINE = os.environ.get("TTS_ENGINE", "edge")  # edge | chattts
TTS_VOICE = os.environ.get("TTS_VOICE", "zh-CN-XiaoyiNeural")
RATE = os.environ.get("TTS_RATE", "+0%")
VOLUME = os.environ.get("TTS_VOLUME", "+0%")

# ChatTTS 模型路径（自动检测）
CHATTTS_PATH = os.environ.get(
    "CHATTTS_MODEL_PATH",
    str(Path(SCRIPT_DIR, "..", "..", "voxcpm2", "models", "chattts").resolve())
)
_CHAT_MODEL = None  # 懒加载

# MOSS-TTS 服务地址
MOSS_TTS_URL = os.environ.get("MOSS_TTS_URL", "http://127.0.0.1:8000")

# ── 声音列表 ──
EDGE_VOICES = [
    {"id": "zh-CN-XiaoxiaoNeural", "name": "晓晓", "gender": "女", "locale": "普通话", "engine": "edge"},
    {"id": "zh-CN-XiaoyiNeural", "name": "晓伊", "gender": "女", "locale": "普通话（情感丰富）", "engine": "edge"},
    {"id": "zh-CN-YunjianNeural", "name": "云健", "gender": "男", "locale": "普通话", "engine": "edge"},
    {"id": "zh-CN-YunxiNeural", "name": "云希", "gender": "男", "locale": "普通话（温柔）", "engine": "edge"},
    {"id": "zh-CN-YunxiaNeural", "name": "云夏", "gender": "男", "locale": "普通话", "engine": "edge"},
    {"id": "zh-CN-YunyangNeural", "name": "云扬", "gender": "男", "locale": "普通话（阳光）", "engine": "edge"},
    {"id": "zh-CN-liaoning-XiaobeiNeural", "name": "晓北", "gender": "女", "locale": "东北话", "engine": "edge"},
    {"id": "zh-CN-shaanxi-XiaoniNeural", "name": "晓妮", "gender": "女", "locale": "陕西话", "engine": "edge"},
    {"id": "zh-HK-HiuGaaiNeural", "name": "晓佳", "gender": "女", "locale": "粤语", "engine": "edge"},
    {"id": "zh-HK-HiuMaanNeural", "name": "晓文", "gender": "女", "locale": "粤语", "engine": "edge"},
    {"id": "zh-HK-WanLungNeural", "name": "云龙", "gender": "男", "locale": "粤语", "engine": "edge"},
    {"id": "zh-TW-HsiaoChenNeural", "name": "晓臻", "gender": "女", "locale": "台湾国语", "engine": "edge"},
    {"id": "zh-TW-YunJheNeural", "name": "云哲", "gender": "男", "locale": "台湾国语", "engine": "edge"},
    {"id": "zh-TW-HsiaoYuNeural", "name": "晓雨", "gender": "女", "locale": "台湾国语", "engine": "edge"},
]

CHATTTS_VOICES = [
    {"id": "chattts_default", "name": "ChatTTS 默认", "gender": "女", "locale": "普通话（本地模型）", "engine": "chattts"},
]

MOSS_VOICES = [
    # ── 中文女声 ──
    {"id": "moss_xiaobei", "name": "小北（温柔晚安）", "gender": "女", "locale": "普通话·温柔知性", "engine": "moss"},
    {"id": "moss_yuewen", "name": "悦文（台湾腔）", "gender": "女", "locale": "普通话·台湾腔", "engine": "moss"},
    {"id": "moss_lingyu", "name": "灵雨（深夜晚安）", "gender": "女", "locale": "普通话·轻柔治愈", "engine": "moss"},
    {"id": "moss_yangmi", "name": "杨幂（与自己同行）", "gender": "女", "locale": "普通话·知性清醒", "engine": "moss"},
    # ── 中文男声 ──
    {"id": "moss_junhao", "name": "骏豪（京味闲聊）", "gender": "男", "locale": "普通话·北京味儿", "engine": "moss"},
    {"id": "mosh_zhiming", "name": "志明（时间观念）", "gender": "男", "locale": "普通话·纪录片腔", "engine": "moss"},
    # ── 英文 ──
    {"id": "moss_ava", "name": "Ava（English）", "gender": "女", "locale": "English·Academic", "engine": "moss"},
    {"id": "moss_adam", "name": "Adam（English）", "gender": "男", "locale": "English·News", "engine": "moss"},
    {"id": "moss_taylor", "name": "Taylor Swift", "gender": "女", "locale": "English·Warm", "engine": "moss"},
    # ── 日语 ──
    {"id": "moss_yui", "name": "Yui（日本語）", "gender": "女", "locale": "日本語·ニュース", "engine": "moss"},
]

ALL_VOICES = EDGE_VOICES + CHATTTS_VOICES + MOSS_VOICES


def _load_chattts():
    """懒加载 ChatTTS 模型（线程安全）"""
    global _CHAT_MODEL
    if _CHAT_MODEL is not None:
        return _CHAT_MODEL
    print("[ChatTTS] 加载本地模型中...")
    os.environ["CHATTTS_MODEL_PATH"] = CHATTTS_PATH
    import ChatTTS
    chat = ChatTTS.Chat()
    chat.load(device="cuda", source="local", custom_path=CHATTTS_PATH)
    _CHAT_MODEL = chat
    print(f"[ChatTTS] 加载完成 (模型路径: {CHATTTS_PATH})")
    return _CHAT_MODEL


async def generate_edge_tts(text: str) -> dict:
    """Edge-TTS 云端合成"""
    import edge_tts
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    filename = f"tts_{uuid.uuid4().hex[:12]}.mp3"
    filepath = AUDIO_DIR / filename
    communicate = edge_tts.Communicate(text, TTS_VOICE, rate=RATE, volume=VOLUME)
    await communicate.save(str(filepath))
    size = filepath.stat().st_size
    return {
        "url": f"/audio/{filename}", "filename": filename,
        "duration_sec": round(size / 16000, 1), "size_bytes": size,
    }


def generate_chattts(text: str) -> dict:
    """ChatTTS 本地合成"""
    import numpy as np
    import soundfile as sf
    chat = _load_chattts()
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    wavs = chat.infer(text, use_decoder=True)
    sr = 24000
    audio = wavs[0]
    # ChatTTS 可能返回 torch tensor 或 numpy array
    if hasattr(audio, 'cpu'):
        audio = audio.cpu().numpy()
    filename = f"tts_{uuid.uuid4().hex[:12]}.wav"
    filepath = AUDIO_DIR / filename
    sf.write(str(filepath), audio, sr)
    size = filepath.stat().st_size
    return {
        "url": f"/audio/{filename}", "filename": filename,
        "duration_sec": round(len(audio) / sr, 1), "size_bytes": size,
    }


def _moss_voice_name(voice_id: str) -> str:
    """将 MOSS 声音ID映射为 infer_onnx.py 需要的 voice 名"""
    return "Xiaobei" if "xiaobei" in voice_id else "Junhao"


def _moss_demo_id(voice_id: str) -> str:
    """将 MOSS 声音ID映射为 WebUI 的 demo_id（不同 demo 有不同的参考音色）
    demo.jsonl 映射:
      demo-1 zh_1.wav   默认女声   | demo-2  zh_6.wav  温柔治愈女声
      demo-3 zh_4.wav   台湾腔女声 | demo-4  zh_3.wav  京味儿男声
      demo-5 zh_10.wav  纪录片男声 | demo-6  zh_11.wav 杨幂女声
      demo-7 en_6.wav   英文女声   | demo-8  en_2.wav  英文女声B
      demo-9 en_4.wav   英文男声   | demo-11 en_7.wav  Taylor Swift
      demo-13 jp_2.wav  日语女声
    """
    mapping = {
        "xiaobei": "demo-1",   # zh_1.wav 默认女声
        "yuewen":  "demo-3",   # zh_4.wav 台湾腔
        "lingyu":  "demo-2",   # zh_6.wav 温柔治愈
        "yangmi":  "demo-6",   # zh_11.wav 杨幂
        "junhao":  "demo-4",   # zh_3.wav 京味儿闲聊
        "zhiming": "demo-5",   # zh_10.wav 纪录片
        "ava":     "demo-8",   # en_2.wav English academic
        "adam":    "demo-9",   # en_4.wav English news
        "taylor":  "demo-11",  # en_7.wav Taylor Swift
        "yui":     "demo-13",  # jp_2.wav Japanese
    }
    for key, demo in mapping.items():
        if key in voice_id:
            return demo
    return "demo-1"


def _moss_health_check() -> bool:
    """检查 MOSS-TTS 服务是否在线（超时2秒）"""
    try:
        resp = requests.get(f"{MOSS_TTS_URL}/health", timeout=2)
        return resp.ok
    except Exception:
        return False


def generate_moss_tts(text: str, voice_id: str = "moss_junhao") -> dict:
    """MOSS-TTS 本地轻量合成（纯CPU·0.1B参数·ONNX）"""
    import base64
    voice = _moss_voice_name(voice_id)
    demo_id = _moss_demo_id(voice_id)
    AUDIO_DIR.mkdir(parents=True, exist_ok=True)

    # MOSS WebUI 采用 Form-encoded 参数
    data = {
        "text": text,
        "demo_id": demo_id,
        "max_new_frames": "375",
        "audio_temperature": "0.8",
        "audio_top_p": "0.95",
        "audio_top_k": "25",
        "text_temperature": "1.0",
        "text_top_p": "1.0",
        "text_top_k": "50",
        "audio_repetition_penalty": "1.2",
        "seed": "0",
        "do_sample": "1",
        "enable_text_normalization": "0",
        "enable_normalize_tts_text": "1",
    }

    resp = requests.post(
        f"{MOSS_TTS_URL}/api/generate",
        data=data,
        timeout=120,
    )
    resp.raise_for_status()
    body = resp.json()

    # MOSS 返回 base64 WAV 音频
    wav_bytes = base64.b64decode(body["audio_base64"])
    sample_rate = int(body.get("sample_rate", 48000))

    filename = f"tts_{uuid.uuid4().hex[:12]}.wav"
    filepath = AUDIO_DIR / filename
    with open(filepath, "wb") as f:
        f.write(wav_bytes)

    size = filepath.stat().st_size
    duration_sec = round(size / (sample_rate * 4), 1)  # 16bit stereo = 4 bytes/frame
    return {
        "url": f"/audio/{filename}", "filename": filename,
        "duration_sec": duration_sec, "size_bytes": size,
    }


class TTSHandler(BaseHTTPRequestHandler):
    engine = TTS_ENGINE  # class-level default

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
            self._send_json({
                "status": "ok",
                "engine": self.engine,
                "voice": TTS_VOICE,
                "chattts_loaded": _CHAT_MODEL is not None,
                "moss_available": _moss_health_check(),
            })
        elif self.path == "/voices":
            self._send_json({"voices": ALL_VOICES, "current": TTS_VOICE, "engine": self.engine})
        elif self.path == "/":
            html = f'''<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8"><title>YuYao TTS</title><style>
body{{font-family:sans-serif;background:#0d0812;color:#f0e0e8;display:flex;align-items:center;justify-content:center;height:100vh;margin:0}}
.card{{background:#1c1530;border:1px solid #2a1e35;border-radius:12px;padding:30px 40px;text-align:center}}
h1{{color:#e8a0b4;font-size:20px;margin:0 0 8px 0}}
.status{{color:#4ade80;font-size:13px;margin-bottom:12px}}
.info{{color:#b8a0b0;font-size:11px;line-height:1.6}}
code{{background:#0d0812;padding:2px 6px;border-radius:4px;font-size:11px}}
.tag{{display:inline-block;padding:1px 6px;border-radius:4px;font-size:9px;margin-left:4px}}
.tag-edge{{background:rgba(96,165,250,0.15);color:#60a5fa}}
.tag-local{{background:rgba(74,222,128,0.15);color:#4ade80}}
.tag-moss{{background:rgba(251,191,36,0.15);color:#fbbf24}}
</style></head><body><div class="card">
<h1>YuYao TTS Service</h1>
<div class="status">Running</div>
<div class="info">
Engine: <code>{self.engine}</code>
<span class="tag {"tag-moss" if self.engine=="moss" else "tag-local" if self.engine=="chattts" else "tag-edge"}">{self.engine}</span><br>
Voice: <code>{TTS_VOICE}</code><br>
POST <code>/tts</code> generate speech<br>
GET <code>/health</code> health | <code>/voices</code> list
</div></div></body></html>'''
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Access-Control-Allow-Origin", "*")
            self.end_headers()
            self.wfile.write(html.encode("utf-8"))
        else:
            self._send_json({"error": "not found"}, 404)

    def do_POST(self):
        length = int(self.headers.get("Content-Length", 0))
        raw = self.rfile.read(length)

        # ── 解码 body ──
        def _decode_body(raw: bytes) -> dict:
            for enc in ['utf-8', 'gbk', 'gb2312']:
                try: return json.loads(raw.decode(enc))
                except (UnicodeDecodeError, json.JSONDecodeError): continue
            return json.loads(raw.decode('utf-8', errors='replace'))

        # ── 切换引擎 ──
        if self.path == "/engine":
            try:
                body = _decode_body(raw)
                engine = body.get("engine", "").strip()
                if engine not in ("edge", "chattts", "moss"):
                    self._send_json({"error": f"不支持的引擎: {engine}"}, 400)
                    return
                TTSHandler.engine = engine
                print(f"[TTS] 切换到引擎: {engine}")
                self._send_json({"ok": True, "engine": engine})
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
            return

        # ── 切换声音 ──
        if self.path == "/voice":
            try:
                body = _decode_body(raw)
                voice_id = body.get("voice", "").strip()
                if not any(v["id"] == voice_id for v in ALL_VOICES):
                    self._send_json({"error": f"不支持的声音: {voice_id}"}, 400)
                    return
                global TTS_VOICE
                TTS_VOICE = voice_id
                # Edge voice → 自动切 edge 引擎
                for v in ALL_VOICES:
                    if v["id"] == voice_id:
                        TTSHandler.engine = v.get("engine", "edge")
                        break
                print(f"[TTS] 切换到: {TTS_VOICE} (引擎: {TTSHandler.engine})")
                self._send_json({"ok": True, "voice": TTS_VOICE, "engine": TTSHandler.engine})
            except Exception as e:
                self._send_json({"error": str(e)}, 500)
            return

        # ── TTS 生成 ──
        if self.path == "/tts":
            try:
                body = _decode_body(raw)
                text = body.get("text", "").strip()
                if not text:
                    self._send_json({"error": "text is required"}, 400)
                    return

                if self.engine == "chattts":
                    result = generate_chattts(text)
                elif self.engine == "moss":
                    result = generate_moss_tts(text, TTS_VOICE)
                else:
                    loop = asyncio.new_event_loop()
                    asyncio.set_event_loop(loop)
                    result = loop.run_until_complete(generate_edge_tts(text))
                    loop.close()

                self._send_json(result)
            except Exception as e:
                import traceback
                traceback.print_exc()
                self._send_json({"error": str(e)}, 500)
        else:
            self._send_json({"error": "not found"}, 404)

    def log_message(self, format, *args):
        if "/health" not in args[0]:
            print(f"[TTS] {args[0]} {args[1]} {args[2]}")


def main():
    parser = argparse.ArgumentParser(description="YuYao TTS Server")
    parser.add_argument("port", nargs="?", type=int, default=8765,
                        help="监听端口 (默认: 8765)")
    args = parser.parse_args()

    server = HTTPServer(("0.0.0.0", args.port), TTSHandler)
    moss_ok = _moss_health_check()
    print(f"[TTS] YuYao TTS Service: http://localhost:{args.port}")
    print(f"[TTS]   engine: {TTSHandler.engine} | voice: {TTS_VOICE}")
    print(f"[TTS]   POST /tts     generate speech (JSON: {{'text':'...'}})")
    print(f"[TTS]   POST /voice   switch voice")
    print(f"[TTS]   POST /engine  switch engine (edge|chattts|moss)")
    print(f"[TTS]   GET  /voices  list voices")
    print(f"[TTS]   GET  /health  health check")
    print(f"[TTS]   MOSS-TTS: {'[OK]' if moss_ok else '[OFF]'} ({MOSS_TTS_URL})")
    print(f"[TTS]   audio dir: {AUDIO_DIR}")

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n[TTS] 服务关闭")
        server.server_close()


if __name__ == "__main__":
    main()
