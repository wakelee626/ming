# 《大明余烬》设计文档（数据权威参考）

> 明末崇祯朝（1628–1644）架空历史策略游戏。玩家扮演皇帝，逐季下旨推演国运。
> 本文档是**数据与游戏逻辑的权威参考**；`data/*.json`、`engine.mjs`、`server.mjs` 实现须与本文件一致，冲突时以本文件为准。

## 0. 设计原则

- **AI 只是推演官**：所有 AI 输出经服务端 schema 校验与数值封顶；需配置 DeepSeek 密钥方可游玩。
- **确定性结算**：幂等（receipts + revision）、原子写盘（tmp + rename）。
- **密钥永不下发前端**；AI 调用按 gameId 串行 + 每局 token 预算。
- **多用户隔离**：登录后每个用户一套独立存档；会话持久化（重启不掉线）。
- **架空历史风味**：允许因决策出现超越时代的科技/制度，由 AI 输出解锁理由文案。

## 1. 时间：季度与年份

- `turn` ∈ **0..67**（68 季 = 17 年）。每季一回合。
- 年份 `year = 1628 + floor(turn/4)`；季节 `season = ['春','夏','秋','冬'][turn % 4]`。
- **春季触发年度历史大事**（`turn % 4 === 0`）；**夏秋冬三季触发季节小事件**（从 `minor-events.json` 按条件确定性选取），每季必有事件。
- 结局判定：`turn === 68`（17 年结束），或民心/军备/朝局任一项 ≤ 0（提前亡国）。

## 2. State Schema

```
state = {
  id, revision, turn,                                  // turn 0..67
  stats: [国库, 民心, 军备, 朝局],                        // 国库=万两(无上限)，后三项 0–100
  title, story, summary,
  pending: [ { text, delta:[4], due } ],                // 延迟事件（due 为季度序号）
  log: [ { year, season, decree, narrative, reactions:[], delta:[4], due:[], mode } ],
  counsel: [ { ministerId, year, season, message, reply } ],   // 意见册（进言记录，最近 200 条）
  flags: [ string ],                                     // 事件链标记（抉择 sets / 小事件 requires|blocks）
  receipts: [], ending,
  ministers: [ Minister ], offices: [ Office ],
  provinces: [ Province ], armies: [ Army ], rivals: [ Rival ],
  tech:  { unlocked:[id], progress:{ id:0..100 } },
  civic: { unlocked:[id], progress:{ id:0..100 } },
  frontier: { manchu, relations },                      // 辽东局势
  privy: 万两,                                           // 内库（皇帝私帑）
  tokensUsed,
}

Minister = { id, name, style, office, faction, loyalty,
             ability:{civil,military,finance,diplomacy}, trait, bio, alive, relation,
             age, prestige, health }
Office   = { id, title, duty, mod:{stat,value}, holder }   // duty ∈ 户/漕/兵/边/工/刑/吏/礼/言
Province = { id, name, tax, popular, garrison, develop, status }   // 各 0–100
Army     = { id, name, unitType, province, men, morale, training, equipment, commander }
Rival    = { id, name, title, side, strength, ambition, relation, influence, trait, alive, bio }
```

### 2.1 国势聚合规则

- `国库`（stats[0]）= 独立白银池，**万两，无上限**。归零**不亡国**，而是「财政危机」：欠饷欠俸每季持续侵蚀民心(-2)/军备(-3)/朝局(-2)，由 AI 推演出新的时局与连锁后果。
- `民心`（stats[1]）= Σ 省 popular / 省数。
- `军备`（stats[2]）= Σ 省 garrison / 省数。
- `朝局`（stats[3]）= Σ 存活大臣 loyalty / 人数。

### 2.2 内库（皇帝私帑）

- `privy` = 内库（万两，无上限），起始 **200 万两**。
- 每季自动 **+5 万两**（皇庄/矿税/进贡）。
- 玩家可「发内帑」：`/api/turn` 可选字段 `privyRelease`（0..privy 的整数），把内库银转入国库。

### 2.3 意见册（进言记录）

- `counsel`：每次与大臣对话（`/api/chat`）追加一条 `{ ministerId, year, season, message, reply }`，保留最近 200 条，随存档持久化。

### 2.4 财政模型（贴合史实）

明末最大问题是财政危机，财政数据贴合史实：

- **岁入（动态）**：`taxIncome = round(Σ provinces.tax / 8)`（万两/季），随各省税赋浮动，初始约 99 万两/季。
- **岁出（动态）**：军费 `militaryCost = round(Σ armies.men × 0.0005)`（随总兵力浮动，初始约 126 万两/季）；另宗室俸禄固定 100 万两/季、官员俸禄固定 25 万两/季。
- **财政赤字**：每季净约 **-152 万两**（初始），随税赋与兵力变化，是游戏的核心压力源。
- **欠饷侵蚀士气**：当国库低于本季军费（`militaryCost`）时，所有军队士气 -2。
- **三饷加派**（AI 依圣旨推演，`LEVIES`）：辽饷（年 500 万两）、剿饷（年 280 万两）、练饷（年 730 万两），增收但激化民变、损民心。
- **起始国库（太仓银）**：约 **600 万两**。
- **内库（内帑）**：起始 200 万两，每季 +5 万两（皇庄/矿税/进贡），可发内帑救急。

## 3. 政策（12 项）

> 政策数值（delta）仅为**设计参考**，AI 模式下**不直接结算**——服务器只把政策名作为圣旨交给 AI 推演（纯 AI 推演）。唯二确定性效果见下。

| # | 政策 | 国库(万两) | 民心 | 军备 | 朝局 |
|---|---|---|---|---|---|
| 0 | 清查贪墨 | +20 | -1 | 0 | +1 |
| 1 | 减赋赈济 | -25 | +4 | 0 | +1 |
| 2 | 整军备战 | -30 | -1 | +3 | +1 |
| 3 | 调和朝局 | -5 | +1 | -1 | +3 |
| 4 | 商运筹饷 | +15 | +1 | -1 | -1 |
| 5 | 招募屯田 | -10 | +2 | +2 | -1 |
| 6 | 加派三饷 | +80 | -6 | +2 | -3 |
| 7 | 裁撤驿站 | +15 | -3 | 0 | -2 |
| 8 | 开海通商 | +25 | +2 | -1 | -2 |
| 9 | 宗室禄米改革 | +30 | +1 | 0 | -4 |
| 10 | 对清议和 | +20 | 0 | -4 | -5 |
| 11 | 编练新军 | -40 | -1 | +6 | -1 |

确定性效果（与 AI 推演并存）：整军备战 → 全军训练/装备 +1；招募屯田 → 全军兵力 +250。其余政策的数值效果全部由 AI 依圣旨推演。

## 4. 省份（16 区域）

两京十三省 + 辽东：`beizhili, nanzhili, shandong, shanxi, henan, shaanxi, sichuan, huguang, jiangxi, zhejiang, fujian, guangdong, guangxi, yunnan, guizhou, liaodong`。

`status` 由数值推导（客户端 `provinceStatus`）：garrison≤28→兵弱；popular≤30→民变；develop≤42 且 popular≤42→旱灾；garrison≥58 且 develop≤45→边警；develop≤30→凋敝；popular≥66 且 develop≥62→繁荣；popular≥55 且 develop≥55→富庶；否则平稳。

## 5. 大臣与官职

- 大臣 37 人（`data/ministers.json`），含忠臣/奸佞/边将/宦官/海商，属性：忠诚、关系、四维能力、性格、派系、年龄、威望、健康。
- 预置官职 15 席（首辅、内阁、六部尚书/侍郎、都察院、漕运、辽东/陕西巡抚等）；另有动态自拟：席位上限 `15 + floor(朝局/20)`；设职耗 30 万两 + 朝局 -3。
- 三种交互：对话 `/api/chat`（回复同时记入意见册）、下达任务（随 `/api/turn` 的 `orders`）、任免官职 `/api/office`。

## 6. 军队与将领

- 军队 19 支（`data/armies.json`），兵种：京营/边军/步兵/骑兵/水师；属性：兵力、士气、训练、装备、驻地、将领。
- 将领任命 `/api/army`（appoint/dismiss），将领须为存活大臣；有将领的军队每季训练 +1。
- 政策影响（整军/屯田）、历史事件折损（松锦之战等）。

## 7. 科技树 + 市政树

- 节点含 `tier/prereqs/cost/effects`，锁定→可用→已解锁三态；解锁须满足前置链。
- 决策累积 `progress`（由 AI 推演分配），达标且前置满足即解锁；解锁时 `effects`（国库万两/民心/军备/朝局）一次性生效。
- 科技树 34 节点、市政树 26 节点（`data/tech.json`、`data/civic.json`），延伸至未来科技。

## 8. 事件系统（春季大事 + 季节小事件）

- **春季历史大事** `data/events.json`：17 件，覆盖 1628–1644 每年一件，按 `year` 在春季触发。
  每事件：`{ id, year, title, text, effects:{delta,provinces,frontier,armies,rivals}, choices:[{label,effects,sets?}], variants? }`。
- **夏秋冬小事件** `data/minor-events.json`：27 件（夏 8 / 秋 9 / 冬 10），按 `season`（1=夏 2=秋 3=冬）、`weight`（加权随机）、`requires`（需含指定标记）、`blocks`（含指定标记则不触发）确定性选取，每季必有一件。
- **多分支事件链**：玩家抉择 `sets` 写入 `state.flags`；后续事件经 `variants`（条件变体：`requires` 命中则改写文本/效果）或小事件 `requires`/`blocks` 形成分支。
- 基础效果 + 玩家抉择效果确定性结算；AI 模式将事件织入叙事（勿重复计入 delta）。

## 9. 辽东局势（后金战线）

- `frontier = { manchu, relations }`（0–100）。
- `manchu` 每季自然 **+1**（`边` 类官职在任 -1，关系 ≥60 再 -1）；`manchu ≥ 100` → 破关（辽东 garrison -10、国库 -80 万两、全国民心 -5，回落到 70）。
- 历史事件可飙升 manchu（己巳之变 +5、松锦之战 +6 等）。

## 10. 对立角色（14 位）与对敌行动

`data/rivals.json`，两大阵营：

- **后金/清（7）**：皇太极（后金大汗→清太宗）、多尔衮（贝勒→摄政王）、豪格、多铎、阿济格、济尔哈朗、范文程。
- **流寇（7）**：李自成（闯王）、张献忠（大西王）、高迎祥、罗汝才、刘宗敏、牛金星、李岩。

字段：`id/name/title/side/strength(军力)/ambition(野心)/relation(关系)/influence(势力)/trait/alive/bio`。

对敌行动 `/api/rival`（`{rivalId, action}`）：

| 行动 | 适用 | 效果 | 代价 |
|---|---|---|---|
| 围剿 | 流寇 | 军力 -8 | 国库 -40 万两 |
| 招抚 | 流寇 | 军力 -10、关系 +15 | 国库 -30 万两 |
| 议和 | 后金 | 关系 +20、后金威胁 -8、关系 +15 | 国库 -40 万两、朝局 -2 |
| 离间 | 全部 | 野心 -10、军力 -3 | 国库 -20 万两 |

历史事件改变对立角色（己巳之变→皇太极/多尔衮 +5；皇太极称帝→改号清太宗；松锦之战→+8；皇太极崩→皇太极死、多尔衮升摄政王；甲申之变→李自成 +20）。

## 11. AI 推演

- **网关**：`DEEPSEEK_BASE_URL`（默认 `https://napi.t.e0b.cc/v1`，第三方网关）；模型默认 `deepseek-v4-pro`（`deepseek-v4-flash` 无权限）。
- 主回合 `/api/turn`：AI 返回富 JSON（title/narrative/summary/delta/reactions/delayed/provinces/ministers/tech/civic）。
- **健壮校验**（推理模型输出偶有偏差，不整回合 502）：核心 delta 钳制（delta[0] ±200、delta[1..3] ±18 且总和缩放至 ≤18）；省份/大臣条目跳过非法项（未知 id、越界值）；`delayed` 缺省为空数组；标题/叙事/纪要长度与 reactions 仍严格校验。
- 对话 `/api/chat`：返回 reply（≤240 字）+ loyaltyDelta/relationDelta（±10）；超时 60 秒。
- 上下文发送：省份、大臣（含四维）、军队、对立角色、内库、辽东、科技市政、延迟事件、历史事件。

## 12. AI 配置（用户自配模型）

- 每个用户可配置自己的 `{apiKey, model, baseUrl}`（存于账号 `aiConfig`），留空则回退服务器默认。
- `/api/aiconfig`（`{apiKey, model, baseUrl}`）保存配置。
- 有效 AI 环境按「用户配置优先、服务器 env 兜底」合并；`aiConfigured`/`aiModel`/`hasOwnAi` 随公开状态返回（密钥不回传前端）。

## 13. 多用户登录与会话

- 注册 `/api/signup`、登录 `/api/login`、退出 `/api/logout`（用户名 2–20 位、密码 6–64 位，scrypt 加盐哈希）。
- 会话 token 放 `Authorization: Bearer <token>`（header，非 cookie，天然免 CSRF）；会话持久化到 `data/sessions.json`（重启不掉线）。
- 每用户存档 `data/saves/<userId>.json`；`AUTH=1` 才强制登录，未设时单机 `local` 用户。
- 监听地址由 `HOST` 控制（默认 127.0.0.1，线上设 0.0.0.0）。

## 14. 立绘

- 25 位大臣画像（`dist/portraits/*.jpg|png` + `dist/portraits.json`），来源标注 Wikimedia Commons / 百度百科 / 网络收录（含 license）。
- 无传世画像的 12 位（多为阉党/酷吏）前端显示「暂无可靠画像」。

## 15. API 契约

| 方法/路径 | 请求体 | 说明 |
|---|---|---|
| GET `/api/game` | — | 返回公开状态（需登录） |
| POST `/api/signup` | `{username, password}` | 注册，返回 `{token, ...公开状态}` |
| POST `/api/login` | `{username, password}` | 登录，返回 `{token, ...公开状态}` |
| POST `/api/logout` | — | 退出（带 Authorization） |
| POST `/api/aiconfig` | `{apiKey, model, baseUrl}` | 保存用户 AI 配置 |
| POST `/api/turn` | `{gameId, revision, requestId, mode, policy?|decree?, orders?, eventChoice?, privyRelease?}` | 推进一季 |
| POST `/api/chat` | `{gameId, revision, requestId, ministerId, message}` | 大臣对话，返回 + `reply/relationDelta/loyaltyDelta` |
| POST `/api/office` | `{gameId, revision, requestId, action:create|appoint|dismiss|remove, title?, duty?, officeId?, ministerId?}` | 官职管理 |
| POST `/api/army` | `{gameId, revision, requestId, action:appoint|dismiss, armyId, ministerId?}` | 军队将领 |
| POST `/api/rival` | `{gameId, revision, requestId, rivalId, action:围剿|招抚|议和|离间}` | 对敌行动 |
| POST `/api/reset` | `{gameId, revision}` | 重新开始 |

`GET /api/game` 返回：`{ state, aiConfigured, aiModel, hasOwnAi, authRequired, policies:[标签], duties:[户漕兵边工刑吏礼言], techTree, civicTree, event }`。
所有 POST 返回公开状态；错误返回 `{error}` 且 HTTP 非 2xx。

## 16. 数据文件

`data/{policies,provinces,ministers,offices,armies,rivals,tech,civic,events,minor-events,titles}.json`；运行时数据 `data/{save.json,saves/,users.json,sessions.json}`（不纳入版本管理）。

## 17. 测试

`node --test`（45 项）：schema 校验（含钳制/跳过非法项）、季度/事件时机（春季大事 + 季节小事件 + 事件链 flags/variants）、动态财政（岁入随税赋/军费随兵力/欠饷蚀士气）、省份聚合、大臣命令、官职/将领、对立角色与对敌行动、科技解锁、内库发帑、意见册、辽东局势、AI 适配与限流、多用户注册/登录/隔离、HTTP 持久化/幂等/并发/重启。
