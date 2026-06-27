"""
简易 Edge-TTS 语音服务 (端口 8765)
"""
import asyncio
import json
import os
import tempfile
from pathlib import Path

try:
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse, FileResponse
    import uvicorn
except ImportError:
    os.system("pip install fastapi uvicorn")
    from fastapi import FastAPI, Request
    from fastapi.responses import JSONResponse, FileResponse
    import uvicorn

import edge_tts

AUDIO_DIR = Path(os.path.join(os.path.dirname(__file__), "..", "data", "webui", "audio"))
AUDIO_DIR.mkdir(parents=True, exist_ok=True)

app = FastAPI()

# 默认语音
DEFAULT_VOICE = "zh-CN-XiaoxiaoNeural"
_current_voice = DEFAULT_VOICE

# 预置的中文语音列表（edge-tts 支持的所有中文语音）
CHINESE_VOICES = [
    {"id": "zh-CN-XiaoxiaoNeural", "name": "晓晓", "gender": "女", "locale": "zh-CN"},
    {"id": "zh-CN-XiaoyiNeural", "name": "晓伊", "gender": "女", "locale": "zh-CN"},
    {"id": "zh-CN-YunjianNeural", "name": "云健", "gender": "男", "locale": "zh-CN"},
    {"id": "zh-CN-YunxiNeural", "name": "云希", "gender": "男", "locale": "zh-CN"},
    {"id": "zh-CN-YunyangNeural", "name": "云扬", "gender": "男", "locale": "zh-CN"},
    {"id": "zh-CN-liaoning-XiaobeiNeural", "name": "晓北(东北)", "gender": "女", "locale": "zh-CN-liaoning"},
    {"id": "zh-CN-shaanxi-XiaoniNeural", "name": "晓妮(陕西)", "gender": "女", "locale": "zh-CN-shaanxi"},
    {"id": "zh-HK-HiuGaaiNeural", "name": "晓佳(粤语)", "gender": "女", "locale": "zh-HK"},
    {"id": "zh-HK-HiuMaanNeural", "name": "晓曼(粤语)", "gender": "女", "locale": "zh-HK"},
    {"id": "zh-HK-WanLungNeural", "name": "云龙(粤语)", "gender": "男", "locale": "zh-HK"},
    {"id": "zh-TW-HsiaoChenNeural", "name": "晓臻(台湾)", "gender": "女", "locale": "zh-TW"},
    {"id": "zh-TW-HsiaoYuNeural", "name": "晓雨(台湾)", "gender": "女", "locale": "zh-TW"},
    {"id": "zh-TW-YunJheNeural", "name": "云哲(台湾)", "gender": "男", "locale": "zh-TW"},
]

@app.get("/health")
async def health():
    return {"status": "ok", "engine": "edge-tts"}

@app.get("/")
async def root():
    return {"service": "Edge-TTS", "status": "running", "port": 8765}

@app.get("/voices")
async def voices():
    """返回可用声音列表和当前选中的声音"""
    return {
        "voices": CHINESE_VOICES,
        "current": _current_voice,
        "engine": "edge",
    }

@app.post("/voice")
async def set_voice(request: Request):
    """切换语音"""
    global _current_voice
    try:
        body = await request.json()
        voice_id = body.get("voice", "")
        if not voice_id:
            return JSONResponse({"error": "voice required"}, status_code=400)
        # 验证声音是否在列表中
        valid = any(v["id"] == voice_id for v in CHINESE_VOICES)
        if not valid:
            return JSONResponse({"error": f"未知声音: {voice_id}"}, status_code=400)
        _current_voice = voice_id
        return {"ok": True, "voice": _current_voice, "engine": "edge"}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@app.post("/engine")
async def set_engine(request: Request):
    """兼容旧接口：仅支持 edge"""
    return {"ok": True, "engine": "edge", "note": "仅支持 edge-tts 引擎"}

@app.post("/tts")
async def tts(request: Request):
    try:
        body = await request.json()
        text = body.get("text", "")
        if not text:
            return JSONResponse({"error": "text required"}, status_code=400)
        filename = f"tts_{abs(hash(text))}.mp3"
        filepath = AUDIO_DIR / filename
        if not filepath.exists():
            communicate = edge_tts.Communicate(text, _current_voice)
            await communicate.save(str(filepath))
        return {"url": f"/audio/{filename}", "file": filename}
    except Exception as e:
        return JSONResponse({"error": str(e)}, status_code=500)

@app.get("/audio/{filename}")
async def audio(filename: str):
    filepath = AUDIO_DIR / filename
    if filepath.exists():
        return FileResponse(str(filepath), media_type="audio/mpeg")
    return JSONResponse({"error": "not found"}, status_code=404)

if __name__ == "__main__":
    print(f"[TTS] Edge-TTS 服务启动, 默认声音: {_current_voice}")
    print(f"[TTS] 可用 {len(CHINESE_VOICES)} 种中文声音")
    uvicorn.run(app, host="0.0.0.0", port=8765)
