#!/usr/bin/env tsx
/** 5级双向强度(-2~+2) 校准测试 */
import { PerceptionAnalyzer } from '../src/m3/PerceptionAnalyzer.js';
const A = new PerceptionAnalyzer();

const C: [string,string,-2|-1|0|1|2][] = [
  ['0-天气','今天天气不错',0],['0-工作','报告已经发给你了',0],
  ['0-时间','现在几点了',0],['0-吃饭','晚上一起吃饭吧',0],
  ['+1关心','今天辛苦了吧早点休息',1],['+1问候','你还好吗有点担心你',1],
  ['+1开心','今天真的好开心',1],['+1喜欢','我好喜欢你',1],
  ['+1想念','今天特别想你',1],['+1夸你','你今天穿那件裙子真好看',1],
  ['+1渴望','我想要你现在就想要',1],['+1抚摸','我想摸你全身',1],
  ['+1抱你','我想从后面抱着你',1],['+1吻你','我想吻你从脖子一路往下',2],
  ['+2蕾丝','想到你穿黑色蕾丝的样子我就受不了',1],
  ['+2压你','我想把你压在墙上狠狠干你',1],
  ['+2操你','我想操你让你在我身下叫',2],
  ['+2高潮','我要干到你高潮为止',2],
  ['+2失控','你每次叫床的声音都让我失控',2],
  ['+2占有','你是我的只能是我的',2],
  ['+2融合','我想和你融为一体到死都不分开',2],
  ['-1敷衍','哦知道了',0],['-1低落','今天心情不太好',-1],
  ['-1失望','你让我很失望',-1],['-1孤独','我觉得好孤独没有人理解我',-1],
  ['-1受伤','你根本不在乎我的感受',-1],
  ['-1愤怒','我受够了你永远都是这样',-1],
  ['-1自私','你这个人真的太自私了',-1],
  ['-2绝望','我恨你永远不想再见到你',-2],
];

function lvl(p:any,t:string):-2|-1|0|1|2{
  const pos=[Math.max(p.pleasure,0),p.intimacy,p.sexual_attraction,p.sensory_craving,p.energy_merge,p.possessiveness,p.ecstasy,p.arousal].sort((a,b)=>b-a);
  const neg=[Math.abs(Math.min(p.pleasure,0)),p.aggression,Math.abs(Math.min(p.dominance,0))].sort((a,b)=>b-a);
  const pc=pos[0]>0.3?pos[0]*0.6+pos[1]*0.4:pos[0];
  const nc=neg[0]>0.3?neg[0]*0.6+neg[1]*0.4:neg[0];
  const comp=t.includes("不太好")||t.includes("不好")||t.includes('失望')||t.includes('孤独')||t.includes('愤怒')||t.includes('受够')||t.includes('自私')||t.includes('恨')||t.includes('不在乎')||t.includes('低落');
  const care=!comp&&p.pleasure<-0.3&&p.sincerity>0.4&&p.aggression<0.2;
  let pol='z',raw=0;
  if(care){pol='p';raw=Math.min(pc+0.15,0.45);}
  else if(pc>nc&&pc>0.08){pol='p';raw=pc;}
  else if(nc>pc&&nc>0.08){pol='n';raw=nc;}
  let lv=0;
  if(raw>=0.5){const sd=pol==='p'?pos[1]:neg[1];lv=sd>0.08?2:1;}
  else if(raw>=0.1)lv=1;
  if(pol==='p')return lv as 1|2;
  if(pol==='n')return(-lv)as-1|-2;
  return 0;
}

const VT:Record<number,string>={'-2':'-2寒','-1':'-1凉','0':'0中性','1':'+1暖','2':'+2炽'};
let ok=0,fail=0;
console.log('\n═══ 5级双向校准 ═══\n');
for(const[l,q,e]of C){
  const a=lvl(A.analyzeText(q).perception,q);const p=a===e;
  if(p)ok++;else fail++;
  console.log(`${p?'✅':'❌'} ${l.padEnd(10)} exp=${String(e).padStart(2)} act=${String(a).padStart(2)} ${VT[a]}`);
  if(!p){const r=A.analyzeText(q).perception;
    console.log(`  dims: pl=${r.pleasure.toFixed(2)} int=${r.intimacy.toFixed(2)} sex=${r.sexual_attraction.toFixed(2)} sens=${r.sensory_craving.toFixed(2)} agg=${r.aggression.toFixed(2)} ener=${r.energy_merge.toFixed(2)}`);}
}
console.log(`\n═══ ${ok}/${ok+fail} 通过  ${fail} 失败 ═══`);
