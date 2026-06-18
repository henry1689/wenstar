const fs = require('fs');
let c = fs.readFileSync('D:/wenstar/src/webui/chat.ts', 'utf8');

const start = c.indexOf('const proactivePatterns: Array<{ match: RegExp; prefix: string }> = [');
if (start < 0) { console.log('FAIL'); process.exit(1); }

// Find the end of this block: look for 2 blank lines after "已悄悄记住"
const marker = '💡 我已悄悄记住啦～';
const mIdx = c.indexOf(marker, start);
if (mIdx < 0) { console.log('MARKER NOT FOUND'); process.exit(1); }
// Find the closing of the if block: 4 closing brackets/parens
const afterM = c.indexOf('}\n\n      // ── 角色扮演检测', mIdx);
if (afterM < 0) { console.log('END NOT FOUND'); process.exit(1); }
const end = afterM + '}\n\n'.length;

const block = c.substring(start, end);
const replacement = '      // [停用] 自动提取聊天信息到知识库（知识库应只用于文件/资料）\n      // 原 proactivePatterns 5 个匹配模式已禁用\n      // 用户信息由 FamilyGraph.integrateFromEntity() 自动管理\n      // 如需手动添加知识，请使用 📚 知识库按钮上传文件\n';

c = c.replace(block, replacement);
fs.writeFileSync('D:/wenstar/src/webui/chat.ts', c, 'utf8');
console.log('DONE');
