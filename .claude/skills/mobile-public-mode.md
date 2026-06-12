# 手机公网模式 · Mobile Public Mode

## 用途
让手机通过 HTTPS 公网访问太虚境，支持电话模式（麦克风语音对话）。

## 前提条件
- 本机所有服务已启动（3001/5174/8765/7200/8100）
- 手机与电脑不在同一局域网时使用

---

## 一、启动命令（按顺序）

```bash
# 1. 启动生产服务器（替换 Vite 开发服务器，手机更稳定）
node D:\wenstar\ui\serve-production.cjs

# 2. 启动 Cloudflare Tunnel（HTTPS 公网隧道）
D:\wenstar\data\webui\cloudflared.exe tunnel --url http://localhost:5174

# 3. 从日志中提取 HTTPS URL
# 隧道启动后约12秒，日志显示：
# https://xxx-xxx-xxx.trycloudflare.com
```

> 或直接双击桌面 `启动手机公网模式.bat` 一键完成。

---

## 二、手机端操作

1. 手机浏览器打开 `https://xxx-xxx-xxx.trycloudflare.com`（每次启动不同）
2. 点击 **📞 电话模式** 按钮
3. 浏览器弹出麦克风权限 → **允许**
4. 直接说话，玉瑶会回复并朗读

---

## 三、铁律

### 3.1 代码更新后必须重建+重启
任意前端代码修改后，必须执行：

```bash
cd D:\wenstar\ui && npx vite build
# 然后重启生产服务器 + 隧道
```

否则手机端刷新后还是旧代码。

### 3.2 每次更新后要刷新手机网页
手机浏览器缓存强，更新代码后手机端需要手动刷新页面（下拉刷新或地址栏回车）。

### 3.3 修改前后端通信必须验证
涉及 `/api/chat`、`/audio/`、音频播放的改动，必须通过隧道做 5 轮对话测试：

```bash
for i in 1 2 3 4 5; do
  curl -s -X POST "https://隧道地址/api/chat" \
    -H "Content-Type: application/json" \
    -d '{"message":"测试'$i'","tts":true}' | python3 -c \
    "import json,sys;d=json.load(sys.stdin);print('audio' if d.get('audio_url') else 'no')"
done
```

### 3.4 隧道地址会变
`trycloudflare.com` 每次重启隧道地址都会变。固定域名需配 Cloudflare 认证隧道。

---

## 四、架构

```
手机 → Cloudflare Tunnel(HTTPS) → 本机:5174(生产服务)
                                         ↓
                                proxy /api/ → 3001(玉瑶)
                                proxy /audio/ → 3001(音频)
```

## 五、音频关键代码

路径: `ui/src/services/chatService.ts`

音频使用相对路径 `/audio/tts_xxx.mp3`，由生产服务器/Vite 的代理转发到 3001。**不要硬编码 `localhost:3001` 前缀**，手机端无法访问。

---

## 六、常见故障

| 现象 | 原因 | 修复 |
|:-----|:-----|:------|
| HTTPS 打不开 | 隧道未启动或地址变了 | 重启 `启动手机公网模式.bat` |
| 麦克风弹窗不出现 | 用了 HTTP 不是 HTTPS | 必须用 `https://*.trycloudflare.com` |
| 有回复但无声音 | 音频路径写死 localhost | 检查 `chatService.ts` 音频路径应为相对路径 |
| 一说话就断 | 手机浏览器权限问题 | 检查麦克风权限/用 Chrome 浏览器 |
| 更新代码后页面空白 | 缓存了旧 JS | 手机端刷新页面 |
