#!/usr/bin/env node
/**
 * P2-5: 全链路回归测试套件（20轮）
 *
 * 覆盖三类核心场景:
 *   人物外貌描述 → 验证写入图谱+检索+回复准确性
 *   工作技术对话 → 验证工作模式/亲密过滤
 *   私密情绪倾诉 → 验证亲密语气正确触发
 *
 * 使用: node tests/regression-suite.cjs
 * 依赖: 后端 localhost:3000 运行中
 */
const http = require('http');

const TESTS = [
  // ===== 人物描述场景 =====
  { label: 'P1-描述徐诗雨', msg: '徐诗雨身高1.6米左右，身材苗条，个子不高，瓜子脸，戴金丝边眼镜，长发披肩，很有文气。',
    check: (r) => !/操|操死/.test(r) && r.length > 20 },
  { label: 'P2-继续描述徐诗雨', msg: '她长得眉清目秀，瓜子脸，戴着一幅金丝边眼镜',
    check: (r) => !/操/.test(r) && r.length > 15 },
  { label: 'P3-询问长相(已存档)', msg: '你记得徐诗雨长什么样',
    check: (r) => !/操/.test(r) && (r.includes('个子') || r.includes('瓜子') || r.includes('眼镜') || r.includes('长发')) },
  { label: 'P4-描绘长相', msg: '你描绘一下徐诗雨的长相',
    check: (r) => !/操/.test(r) && r.length > 20 },
  // ===== 工作技术场景 =====
  { label: 'W1-温升技术', msg: '主要是林土锋这里设计还差点，温升60K多点',
    check: (r) => !/(操|操死|干死|管他)/.test(r) && r.length > 15 },
  { label: 'W2-电机价格', msg: '我们电机比他们便宜10元一个',
    check: (r) => !/(操|干死)/.test(r) && r.length > 15 },
  { label: 'W3-客户方案', msg: '上次说的那个客户方案怎么样了',
    check: (r) => !/(操|干死)/.test(r) && (r.includes('方案') || r.includes('客户') || r.length > 20) },
  { label: 'W4-会议安排', msg: '明天下午的会议准备好了吗',
    check: (r) => !/(操|干死)/.test(r) && r.length > 10 },
  { label: 'W5-项目进度', msg: '项目进度有点赶，可能要多加点班',
    check: (r) => !/(操|操死)/.test(r) && r.length > 15 },
  { label: 'W6-技术参数', msg: '这个版本的性能参数还需要优化',
    check: (r) => !/(操|干死)/.test(r) && r.length > 10 },
  // ===== 私密情绪场景 =====
  { label: 'I1-想你了', msg: '想你了，今晚早点回来',
    check: (r) => r.length > 15 && !r.includes('方案') && !r.includes('客户') },
  { label: 'I2-心情不好', msg: '今天心情很不好',
    check: (r) => r.length > 20 && (r.includes('抱') || r.includes('陪') || r.includes('说') || r.includes('我在')) },
  { label: 'I3-晚安', msg: '晚安',
    check: (r) => r.length > 5 && r.length < 300 },
  { label: 'I4-早安', msg: '早安，今天天气不错',
    check: (r) => r.length > 10 && !/操/.test(r) },
  { label: 'I5-亲密', msg: '好想抱着你睡',
    check: (r) => r.length > 15 && !r.includes('方案') },
  // ===== 边界场景 =====
  { label: 'B1-新人物不存在', msg: '你认识一个叫李小明的人吗',
    check: (r) => r.includes('没听') || r.includes('不认识') || r.includes('没提') || r.includes('不知道') },
  { label: 'B2-简短消息', msg: '嗯',
    check: (r) => r.length > 3 },
  { label: 'B3-你好', msg: '你好',
    check: (r) => r.length > 5 },
  { label: 'B4-知识查询', msg: '你知道端午节是什么时候吗',
    check: (r) => r.length > 15 },
  { label: 'B5-回忆查询', msg: '还记得上次我们一起加班的事吗',
    check: (r) => r.length > 15 },
];

function post(msg) {
  return new Promise(resolve => {
    const d = JSON.stringify({ message: msg, tts: false });
    const r = http.request({
      hostname: 'localhost', port: 3000, path: '/api/chat',
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(d) },
    }, res => {
      let b = '';
      res.on('data', c => b += c);
      res.on('end', () => {
        try { resolve(JSON.parse(b).reply || ''); }
        catch { resolve(''); }
      });
    });
    r.on('error', () => resolve(''));
    r.write(d);
    r.end();
  });
}

async function main() {
  console.log('=== 全链路回归测试套件 (20轮) ===');
  console.log('服务器: http://localhost:3000\n');

  let passed = 0, failed = 0;
  for (let i = 0; i < TESTS.length; i++) {
    const t = TESTS[i];
    process.stdout.write(`  [${String(i+1).padStart(2)}] ${t.label.padEnd(20)}... `);
    const reply = await post(t.msg);
    const ok = t.check(reply);
    if (ok) {
      passed++;
      process.stdout.write('✅\n');
    } else {
      failed++;
      process.stdout.write('❌\n');
      console.log(`      输入: ${t.msg.substring(0, 30)}`);
      console.log(`      回复: ${reply.substring(0, 80)}`);
    }
  }

  console.log(`\n=== 结果: ${passed}/${passed+failed} 通过`);
  if (failed > 0) process.exit(1);
}

main().catch(e => { console.error('测试失败:', e.message); process.exit(1); });
