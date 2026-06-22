#!/usr/bin/env node
/**
 * FIX-2: FamilyGraph 全局脏节点清洗
 * 删除所有非真实人物的 person 类型节点及其边。
 * 执行前自动备份 family_graph.db。
 * 使用: node scripts/clean-familygraph-nodes.cjs
 */
const fs = require("fs");
const path = require("path");

const BACKUP_DIR = path.join(__dirname, "..", "data", "backups");
const FG_PATH = path.join(__dirname, "..", "data", "webui", "knowledge", "family_graph.db");

// 300+ 常见姓氏（百家姓常用部分）
const SURNAMES = new Set('赵钱孙李周吴郑王冯陈褚卫蒋沈韩杨朱秦尤许何吕施张孔曹严华金魏陶姜戚谢邹喻柏水窦章云苏潘葛奚范彭郎鲁韦昌马苗凤花方俞任袁柳丰鲍史唐费廉岑薛雷贺倪汤滕殷罗毕郝邬安常乐于时傅皮卞齐康伍余元卜顾孟平黄和穆萧尹姚邵湛汪祁毛禹狄米贝明臧计伏成戴谈宋茅庞熊纪舒屈项祝董梁杜阮蓝闵席季麻强贾路娄危江童颜郭梅盛林刁钟徐邱骆高夏蔡田樊胡凌霍虞万支柯昝管卢莫柯房裘缪干解应宗丁宣贲邓郁单杭洪包诸左石崔吉钮龚程嵇邢滑裴陆荣翁荀羊於惠甄曲家封芮羿储靳汲邴糜松井段富巫乌焦巴弓牧隗山谷车侯宓蓬全郗班仰秋仲伊宫宁仇栾暴甘钭厉戎祖武符刘景詹束龙叶幸司韶郜黎蓟薄印宿白怀蒲邰从鄂索咸籍赖卓蔺屠蒙池乔阴郁胥能苍双闻莘党翟谭贡劳逄姬申扶堵冉宰郦雍郤璩桑桂濮牛寿通边扈燕冀郏浦尚农温别庄晏柴瞿阎充慕连茹习宦艾鱼容向古易慎戈廖庾终暨居衡步都耿满弘匡国文寇广禄阙东欧殳沃利蔚越夔隆师巩厍聂晁勾敖融冷訾辛阚那简饶空曾毋沙乜养鞠须丰巢关蒯相查后荆红游竺权逮盍益桓公'.split(''));

function isRealPersonName(name) {
  if (name === '我') return true;
  if (name.length < 2 || name.length > 4) return false;

  // 白名单：明确是真实人物
  const whitelist = ['徐诗雨','熊勇','张中山','赵明辉','王建国','刘芳','林土锋','宁清华','陈雪花','陈斌','陈锋华','曾美容','谢德','宁文','陈瑜','熊梓铭','熊梓玥','老张','老李','小时','阿珍'];
  if (whitelist.includes(name)) return true;

  // 亲属称谓
  const kinship = ['妈妈','爸爸','老公','老婆','儿子','女儿','爷爷','奶奶','哥哥','姐姐','弟弟','妹妹','外公','外婆','祖父','祖母','母亲','父亲','孩子','兄弟','姐妹','妈','爸','奶奶'];
  if (kinship.includes(name)) return true;

  // 明确垃圾模式
  if (/那|这|的$|了$|在|就|是|和$|很|都|别|说|叫|管|老[想说叫问]|时我|家人|和你|们$|周[都二]|和姐/.test(name)) return false;

  // 常见词汇（不是人名）
  const commonWords = ['强调','从前','厉害','现在','小时','金库','左右','项目','农历','阴历','同事','客户','从前','厉害','小时','车载','左右','项目','平常','从前','现在','方便','强调','管你','时你','那时','那年','那时','那晚','那天','那个','那么','说说','知道','可以','可能','不要','因为','所以','然后','而且','或者','虽然','但是','如果','就是','平胸','水彩画','简称','单的','丁点','花样','从前','从前','从前','水彩','车载','小时','小时','小时'];
  if (commonWords.some(w => name.includes(w))) return false;

  // 至少包含一个姓氏且在"我"的 acquaintance_of 边中存在（有人真正提到过）
  for (const ch of name) {
    if (SURNAMES.has(ch)) return true;
  }
  return false;
}

async function main() {
  if (!fs.existsSync(FG_PATH)) {
    console.error("family_graph.db 不存在:", FG_PATH);
    process.exit(1);
  }

  // 备份
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const bakName = `family_graph_global_cleanup_${Date.now()}.db`;
  fs.copyFileSync(FG_PATH, path.join(BACKUP_DIR, bakName));
  console.log("已备份:", bakName);

  const initSqlJs = require("sql.js");
  const SQL = await initSqlJs();
  const buf = fs.readFileSync(FG_PATH);
  const db = new SQL.Database(buf);

  // 1. 找出所有非真实人名的 person 节点
  const allNodes = db.exec("SELECT id, name, properties FROM nodes WHERE type = 'person'");
  if (!allNodes[0]?.values) { console.log("无节点"); db.close(); return; }

  const toDelete = [];
  const kept = [];
  for (const row of allNodes[0].values) {
    const id = row[0];
    const name = row[1];
    if (isRealPersonName(name)) {
      kept.push(name);
    } else {
      toDelete.push({ id, name });
    }
  }

  console.log("\n真实人物:", kept.length, "个");
  console.log("脏节点:", toDelete.length, "个");
  console.log("\n即将删除的脏节点:");
  for (const n of toDelete) console.log(" ", n.name);

  // 2. 删除脏节点及其边
  let deletedEdges = 0;
  for (const n of toDelete) {
    // 先删边
    const edgeDel = db.exec("DELETE FROM edges WHERE source_id = ? OR target_id = ?", [n.id, n.id]);
    if (edgeDel[0]?.affectedRows) deletedEdges += edgeDel[0].affectedRows;
    // 再删节点
    db.exec("DELETE FROM nodes WHERE id = ?", [n.id]);
  }

  console.log("\n已删除边:", deletedEdges, "条");
  console.log("已删除节点:", toDelete.length, "个");

  // 3. 保存
  const data = db.export();
  fs.writeFileSync(FG_PATH + ".new", Buffer.from(data));
  fs.renameSync(FG_PATH + ".new", FG_PATH);
  db.close();

  console.log("\n清洗完成！");
  console.log("剩余真实人物:", kept.join(", "));
}

main().catch(e => { console.error("清洗失败:", e.message); process.exit(1); });
