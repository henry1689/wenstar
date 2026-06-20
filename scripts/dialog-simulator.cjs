#!/usr/bin/env node
/**
 * 太虚境·对话模拟器（48小时无人值守）
 *
 * 每小时向聊天 API 发送一条消息，模拟用户交互。
 * 话题涵盖：回忆、工作、情绪、家庭、日常闲聊。
 * 用于观测 Step 2 的四类隐患。
 */
const http = require('http');

const HOST = 'http://localhost:3000';
const MESSAGES = [
  // 回忆类（触发记忆检索）
  '还记得上次我们一起加班的事吗',
  '我以前有个同事人挺好的',
  '突然想起来好久以前的事',
  // 工作类（功能性记忆）
  '明天有个会要开',
  '最近项目进度怎么样',
  '我下周要出差一趟',
  // 情绪类（低落→安慰推送）
  '今天真的很累，什么都不想干',
  '心情不太好，感觉有点烦躁',
  '最近压力好大，好想休息',
  // 家庭类（家族触发）
  '我妈今天打电话来了',
  '周末想回家看看',
  '家里人都挺好的',
  // 日常闲聊（低价值测试）
  '今天天气不错',
  '吃了吗',
  '好无聊啊',
  // 跟进指代（P0-2 bug验证）
  '那个同事后来怎么样了',
  '出差是去上海',
  // 亲密类
  '想你了',
  '今晚早点回来',
  // 混合话题
  '端午节快到了，想吃粽子',
  '好久没出去玩了',
  '你记得徐诗雨吗',
];

function postMessage(msg) {
  return new Promise((resolve) => {
    const data = JSON.stringify({ message: msg, tts: false });
    const u = new URL(HOST + '/api/chat');
    const req = http.request({
      hostname: u.hostname,
      port: u.port,
      path: u.pathname,
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) },
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        try { const j = JSON.parse(body); resolve(j.reply ? j.reply.length : 0); }
        catch { resolve(0); }
      });
    });
    req.on('error', () => resolve(0));
    req.write(data);
    req.end();
  });
}

async function main() {
  console.log('[模拟] 对话模拟器启动（48小时）');
  let msgIdx = 0;

  const interval = setInterval(async () => {
    const msg = MESSAGES[msgIdx % MESSAGES.length];
    msgIdx++;
    const len = await postMessage(msg);
    console.log(`[模拟] +${new Date().toISOString().substring(11, 19)} "${msg}" → ${len}字`);
  }, 3600000); // 每小时

  // 48小时后停止
  setTimeout(() => {
    clearInterval(interval);
    console.log('[模拟] 48小时运行结束');
  }, 48 * 3600 * 1000);
}

main().catch(err => console.error('[模拟] 错误:', err));
