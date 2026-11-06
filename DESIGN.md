# 《大明余烬》设计文档（数据权威参考）

> 明末崇祯朝（1628–1644）架空历史策略游戏。玩家扮演皇帝，逐季下旨推演国运。
> 本文档是**数据与游戏逻辑的权威参考**；`data/*.json`、`engine.mjs`、`server.mjs` 实现须与本文件一致，冲突时以本文件为准。
> 分工：**UI 由 GPT 负责**（只改 `dist/index.html`、`dist/client.js`）；**数据与逻辑由本仓库维护者负责**。

## 0. 设计原则

- **AI 只是推演官**：所有 AI 输出经服务端 schema 校验与数值封顶；无密钥时走确定性规则 fallback，游戏可完整游玩。
- **确定性结算**：幂等（receipts + revision）、原子写盘（tmp + rename）。
- **密钥永不下发前端**；AI 调用按 gameId 串行 + 每局 token 预算。
- **架空历史风味**：允许因决策出现超越时代的科技/制度，由 AI 输出解锁理由文案。

## 1. 时间：季度与年份

- `turn` ∈ **0..67**（68 季 = 17 年）。每季一回合。
- 年份 `year = 1628 + floor(turn/4)`；季节 `season = ['春','夏','秋','冬'][turn % 4]`。
- **历史事件只在春季触发**（`turn % 4 === 0`），其余三季 `event === null`。
- 结局判定：`turn === 68`（17 年结束），或任一国势 ≤ 0（提前亡国）。

## 2. State Schema

```
state = {
  id, revision, turn,                                  // turn 0..67
  stats: [国库, 民心, 军备, 朝局],                        // 国库=万两(无上限)，后三项 0–100
  title, story, summary,
  pending: [ { text, delta:[4], due } ],                // 延迟事件（due 为季度序号）
  log: [ { year, season, decree, narrative, reactions:[], delta:[4], due:[], mode } ],
  receipts: [], ending,
  ministers: [ Minister ], offices: [ Office ],
  provinces: [ Province ], armies: [ Army ],
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
```

### 2.1 国势聚合规则

- `国库`（stats[0]）= 独立白银池，**万两，无上限**。归零**不亡国**，而是「财政危机」：欠饷欠俸每季持续侵蚀民心(-2)/军备(-3)/朝局(-2)，由 AI 推演出新的时局与连锁后果。
- `民心`（stats[1]）= Σ 省 popular / 省数。
- `军备`（stats[2]）= Σ 省 garrison / 省数。
- `朝局`（stats[3]）= Σ 存活大臣 loyalty / 人数。

### 2.2 内库（皇帝私帑）

- `privy` = 内库（万两，无上限），起始 **200 万两**。
- 每季自动 **+1 万两**（皇庄/矿税/进贡）。
- 玩家可「发内帑」：`/api/turn` 可选字段 `privyRelease`（0..privy 的整数），把内库银转入国库。

## 3. 政策（每季量级）

| # | 政策 | 国库(万两) | 民心 | 军备 | 朝局 |
|---|---|---|---|---|---|
| 0 | 清查贪墨 | +20 | -1 | 0 | +1 |
| 1 | 减赋赈济 | -25 | +4 | 0 | +1 |
| 2 | 整军备战 | -30 | -1 | +3 | +1 |
| 3 | 调和朝局 | -5 | +1 | -1 | +3 |
| 4 | 商运筹饷 | +15 | +1 | -1 | -1 |
| 5 | 招募屯田 | -10 | +2 | +2 | -1 |

规则模式附带：整军备战 → 全军训练/装备 +1；招募屯田 → 全军兵力 +250；科技/市政进度 +6（按 `POLICY_TECH` 映射）。

## 4. 省份（16 区域）

两京十三省 + 辽东：`beizhili, nanzhili, shandong, shanxi, henan, shaanxi, sichuan, huguang, jiangxi, zhejiang, fujian, guangdong, guangxi, yunnan, guizhou, liaodong`。

`status` 由数值推导（客户端 `provinceStatus`）：garrison≤28→兵弱；popular≤30→民变；develop≤42 且 popular≤42→旱灾；garrison≥58 且 develop≤45→边警；develop≤30→凋敝；popular≥66 且 develop≥62→繁荣；popular≥55 且 develop≥55→富庶；否则平稳。

## 5. 大臣与官职

- 大臣 37 人（`data/ministers.json`），含忠臣/奸佞/边将/宦官/海商，属性：忠诚、关系、四维能力、性格、派系、年龄、威望、健康。
- 官职动态自拟：席位上限 `6 + floor(朝局/20)`；设职耗 30 万两 + 朝局 -3。
- 三种交互：对话 `/api/chat`、下达任务（随 `/api/turn` 的 `orders`）、任免官职 `/api/office`。

## 6. 军队与将领

- 军队 11 支（`data/armies.json`），兵种：京营/边军/步兵/骑兵/水师；属性：兵力、士气、训练、装备、驻地、将领。
- 将领任命 `/api/army`（appoint/dismiss），将领须为存活大臣；有将领的军队每季训练 +1。
- 政策影响（整军/屯田）、历史事件折损（松锦之战等）。

## 7. 科技树 + 市政树

- 节点含 `tier/prereqs/cost/effects`，锁定→可用→已解锁三态；解锁须满足前置链。
- 决策累积 `progress`（规则 +6/季，AI 可自由分配），达标且前置满足即解锁；解锁时 `effects`（国库万两/民心/军备/朝局）一次性生效。
- 科技树 34 节点、市政树 26 节点（`data/tech.json`、`data/civic.json`），延伸至未来科技。

## 8. 历史事件时间线

`data/events.json`：13 件，按 `year`（1628–1644）在**春季**触发。
每事件：`{ id, year, title, text, effects:{delta,provinces,frontier,armies}, choices:[{label,effects}] }`。
基础效果 + 玩家抉择效果确定性结算；AI 模式将事件织入叙事（勿重复计入 delta）。

## 9. 辽东局势（后金战线）

- `frontier = { manchu, relations }`（0–100）。
- `manchu` 每季自然 **+1**（`边` 类官职在任 -1，关系 ≥60 再 -1）；`manchu ≥ 100` → 破关（辽东 garrison -10、国库 -80 万两、全国民心 -5，回落到 70）。
- 历史事件可飙升 manchu（己巳之变 +5、松锦之战 +6 等）。

## 10. AI 推演

- 主回合 `/api/turn`：AI 返回富 JSON（title/narrative/summary/delta/reactions/delayed/provinces/ministers/tech/civic）。
- 校验：delta[0]（国库万两）±200，delta[1..3] ±18 且三者总和 ≤18；延迟 delta[0] ±50、delta[1..3] ±5；省份 delta ±8；大臣 loyalty/relation ±15；tech/civic progress 0–100、unlock 合法且前置满足。
- 对话 `/api/chat`：返回 reply（≤240 字）+ loyaltyDelta/relationDelta（±10）。
- 上下文发送：省份、大臣（含四维）、军队、内库、辽东、科技市政、延迟事件、历史事件。

## 11. API 契约

| 方法/路径 | 请求体 | 说明 |
|---|---|---|
| GET `/api/game` | — | 返回公开状态（见下） |
| POST `/api/turn` | `{gameId, revision, requestId, mode, policy?|decree?, orders?, eventChoice?, privyRelease?}` | 推进一季 |
| POST `/api/chat` | `{gameId, revision, requestId, ministerId, message}` | 大臣对话，返回 + `reply/relationDelta/loyaltyDelta` |
| POST `/api/office` | `{gameId, revision, requestId, action:create|appoint|dismiss|remove, title?, duty?, officeId?, ministerId?}` | 官职管理 |
| POST `/api/army` | `{gameId, revision, requestId, action:appoint|dismiss, armyId, ministerId?}` | 军队将领 |
| POST `/api/reset` | `{gameId, revision}` | 重新开始 |

`GET /api/game` 返回：`{ state, aiConfigured, policies:[标签], duties:[户漕兵边工刑吏礼言], techTree, civicTree, event }`。
所有 POST 返回公开状态；错误返回 `{error}` 且 HTTP 非 2xx。

## 12. 数据文件

`data/{policies,provinces,ministers,offices,armies,tech,civic,events,titles}.json`。

## 13. 测试

`node --test`（35 项）：schema 校验、季度/事件时机、省份聚合、大臣命令、官职/将领、科技解锁、内库发帑、辽东局势、AI 适配与限流、HTTP 持久化/幂等/并发/重启。
