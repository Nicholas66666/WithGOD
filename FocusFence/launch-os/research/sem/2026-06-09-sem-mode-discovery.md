# SEM 大方向发散与验证：跨赛道模式池

日期：2026-06-09

## 研究目的

先不进入具体关键词和落地页细节，而是判断“圣经智能手表”第一阶段 SEM 应该采用哪类获客模式。目标是发散多个跨赛道可迁移方向，用 SEMrush paid results 和 keyword overview 做初筛，把明显不适合的方向排除，保留值得进一步验证的方向。

## 数据来源

- SEMrush `phrase_adwords` paid results：
  - `data/raw/semrush-mode-discovery-paid/`
  - `data/processed/semrush-mode-discovery-paid-summary.json`
  - `data/processed/semrush-mode-discovery-by-mode.json`
- SEMrush `phrase_this` keyword overview：
  - `data/raw/semrush-mode-discovery-overview/`
  - `data/processed/semrush-mode-discovery-enriched.json`
  - `data/processed/semrush-mode-discovery-enriched-by-mode.json`
- 之前跨赛道抽样：
  - `data/raw/semrush-cross-sector-paid/`
  - `data/processed/semrush-cross-sector-paid-summary.json`

## 被测试的方向

本轮测试 12 类方向，每类抽 5 个代表词：

1. review/comparison to product：测评/榜单到商品。
2. quiz/diagnostic to plan：测验/诊断到方案。
3. alternative to habit/app：替代手机/坏习惯。
4. bad habit reduction product：减少坏习惯到实体小商品。
5. moment intervention tool：即时干预工具。
6. scripts/templates to product/service：沟通脚本/模板到服务。
7. routine/challenge to subscription/product：routine/challenge 到订阅或商品。
8. gift/problem recipient：礼品/送给某类人的商品。
9. relationship/family course/service：关系/婚姻服务。
10. physical anchor/reminder product：物理锚点/提醒器商品。
11. faith/general commercial adjacent：信仰商业邻近词。
12. decision/moment faith content：信仰当下时刻内容。

## SEMrush 结果摘要

| 方向 | 抽样词数 | 有 paid results 的词数 | 总 paid rows | 总搜索量 | 平均 CPC | 初判 |
|---|---:|---:|---:|---:|---:|---|
| relationship/family course/service | 5 | 3 | 8 | 5,340 | 11.17 | 商业化最强，但治疗/咨询意图重，不能直接照搬 |
| faith/general commercial adjacent | 5 | 1 | 3 | 18,310 | 0.69 | 有商业邻近需求，适合产品包装和内容页 |
| quiz/diagnostic to plan | 5 | 1 | 1 | 2,250 | 1.93 | paid 证据弱，但页面机制很适合桥接 |
| review/comparison to product | 5 | 0 | 0 | 8,610 | 0.80 | 有量和商业竞争，但 paid search 证据弱，适合 SEO/affiliate 思路 |
| routine/challenge to subscription/product | 5 | 0 | 0 | 5,130 | 0.86 | 有量但 paid 证据弱，适合内容/留存，不适合首轮 SEM 主方向 |
| physical anchor/reminder product | 5 | 0 | 0 | 2,850 | 0.62 | 与产品定位贴近，但 paid search 证据弱 |
| bad habit reduction product | 5 | 0 | 0 | 2,470 | 0.54 | 商品类逻辑可学，但与信仰场景不够贴 |
| gift/problem recipient | 5 | 0 | 0 | 2,270 | 0.53 | 适合季节/礼品包装，不适合当前首轮主验证 |
| moment intervention tool | 5 | 0 | 0 | 1,750 | 0.88 | 产品贴合度高，但 paid 证据弱；适合小额 exact test / SEO |
| scripts/templates to product/service | 5 | 0 | 0 | 1,530 | 0.81 | 内容可做，SEM 不优先 |
| alternative to habit/app | 5 | 0 | 0 | 570 | 1.71 | 战略叙事强，搜索量弱 |
| decision/moment faith content | 5 | 0 | 0 | 320 | 0.08 | 极贴近产品但量太小，不能做主方向 |

## 值得保留验证的方向

### 方向 A：内容痛点 + 解决方案类别

跨赛道类比：

- `best mattress for back pain` -> mattress。
- `best anti snoring mouthpiece` -> mouthpiece。
- `dark spot corrector` -> skincare product。
- `4 month sleep regression` -> baby sleep course。

数据判断：

- 上一轮跨赛道数据支持这个方向：当词从纯 how-to 进入产品/解决方案类别，paid results 明显更容易出现。
- 这是目前最稳的跨赛道公式。

圣经手表对应：

- 不是 `bible verses for anxiety` 这种纯内容词。
- 也不是 `AI Bible Watch` 这种无需求品类词。
- 应该找“经文/祷告 + action / reset / overwhelmed / anger / before reacting”的中间词。

建议动作：

- 保留为 SEM 主路径。
- 下一步扩词应围绕：`scripture reset`、`prayer reset`、`prayer before reacting`、`bible verses when overwhelmed`、`be slow to anger bible verse`、`prayer for peace of mind`。

### 方向 B：Quiz / Diagnostic / Choose Your Moment

跨赛道类比：

- Hims / Keeps：hair loss content -> quiz -> treatment plan。
- Mattress：sleep/back pain content -> mattress quiz -> product。
- Skincare：skin concern -> quiz -> prescription/product。
- Rise Science：`sleep quiz` paid result。

数据判断：

- 本轮 `sleep quiz` 有 paid result，整体搜索量不大，但 CPC 和竞争说明它可商业化。
- 这个方向不是关键词主方向，而是落地页桥接机制。

圣经手表对应：

- 内容页不要直接只放 `Buy Now`。
- 可以设置 `Choose your hardest moment`：
  - Anxiety rising
  - About to react
  - Overwhelmed
  - Relationship conflict
  - Need a daily Scripture rhythm

建议动作：

- 保留为落地页机制。
- 在内容页第一段价值交付后加入软 CTA：`Find your one-button Scripture reset`。

### 方向 C：Relationship / Family Support

跨赛道类比：

- `online marriage counseling`：Volume 4,400，CPC 20.50，paid_count 5。
- `christian marriage counseling online`：Volume 390，CPC 11.94，paid_count 1。
- `couples therapy app`：Volume 390，CPC 7.62，paid_count 2。

数据判断：

- 这是本轮商业化最强方向，但用户意图偏 counseling / therapy / service。
- 不能直接买高意图治疗词卖硬件。

圣经手表对应：

- 适合做“冲突前暂停 / 祷告前置 / words you do not want to regret”的内容桥接。
- 不适合承诺 counseling、therapy、marriage repair。

建议动作：

- 作为第二优先级小额验证。
- 关键词应避开 `therapy`、`counseling`、`coach`，优先找 `prayer for relationship conflict`、`prayer before difficult conversation`、`bible verses for marriage problems` 等。

### 方向 D：Faith Commercial Adjacent

数据：

- `daily devotional for women`：Volume 9,900，CPC 0.59，Competition 0.99，paid_count 3。
- `prayer journal`：Volume 6,600，CPC 0.43，Competition 1.00，paid_count 0。
- `bible study journal`：Volume 1,600，CPC 0.40，Competition 1.00，paid_count 0。

判断：

- 信仰内容 + 商品/日常工具的商业需求存在。
- 但它更像 devotional/journal/gift/ecommerce，不是当下情绪 reset。

圣经手表对应：

- 可以把产品包装成 `daily devotional companion`、`prayer rhythm device`、`Scripture companion`。
- 不适合作为首轮 Search 主路径，因为词意图可能更偏书、journal、女性 devotional。

建议动作：

- 保留为产品包装与 SEO / shopping / gift angle。
- SEM 首轮只小范围 test，不做主预算。

### 方向 E：Physical Anchor / Reminder Product

数据：

- `prayer bracelet`：Volume 1,300，CPC 0.57，Competition 1.00，paid_count 0。
- `anxiety bracelet`：Volume 1,300，CPC 0.48，Competition 1.00，paid_count 0。
- `mindfulness bracelet`：Volume 210，CPC 0.80，Competition 0.99，paid_count 0。

判断：

- 搜索量和竞争显示有商品需求，但 paid search 文本广告证据弱。
- 可能更适合 Shopping、Amazon、SEO、社媒/礼品，而非 Google Search 文本广告。

圣经手表对应：

- 强烈适合作为产品包装：physical anchor、always with you、on your wrist、one-button reminder。
- 不适合作为首轮 Search 主关键词方向。

建议动作：

- 保留为页面叙事与视觉卖点。
- 后续可做 Google Shopping / Meta / Pinterest / gift 页面。

## 应该排除或暂缓的方向

### 1. 纯信息泛词

例子：

- `how to sleep better`
- `how to stop snoring`
- `how to get baby to sleep`
- `bible verses for anxiety`

判断：

- 可以做 SEO/内容沉淀。
- 直接 SEM 转硬件风险高。
- 若投，只能小额测试内容 CTA，不能作为主预算。

### 2. Generic review/best product

例子：

- `best posture corrector`
- `best sunrise alarm clock`
- `best light therapy lamp`

数据：

- 有搜索量和竞争，但本轮 paid results 为 0。

判断：

- 这个方向可能更多由 SEO/affiliate/Amazon/Shopping 承接，不适合我们现在用 Search 文本广告强行切入。

### 3. Digital detox / screen time alternative

例子：

- `screen time alternative`：Volume 20。
- `doom scrolling alternative`：Volume 20。
- `reduce screen time`：Volume 390。

判断：

- 战略叙事很好，但搜索量太小。
- 可放入页面 copy，不做 SEM 主方向。

### 4. Moment intervention tool 泛词

例子：

- `panic attack help now`：Volume 10。
- `breathing device for anxiety`：Volume 90。
- `how to calm down when angry`：Volume 1,600 但 paid_count 0。

判断：

- 产品 fit 强，但 paid evidence 弱。
- 可以做 SEO / exact 小额测试，不作为主预算。

### 5. Gift/problem recipient

例子：

- `christian gifts for men`：Volume 1,900，Competition 1.00。
- `spiritual gifts for women`：Volume 210。

判断：

- 适合季节性礼品包装。
- 当前上线首轮不建议作为主 SEM 验证方向。

## 当前方向优先级

### P1：内容痛点 + 解决方案类别 / action moment

这是最值得做 SEM 首轮验证的方向。

核心不是泛经文，而是“用户正在寻找一个可以行动的属灵/情绪 reset”。

页面方向：

- `Bible Verses for Anxiety` -> `Make this reset one press away`
- `Prayer Before You React`
- `Scripture for Overwhelmed Moments`

### P2：Quiz / Choose Your Moment 桥接机制

这不是独立广告方向，而是落地页结构。

页面 CTA：

- `Choose your hardest moment`
- `Find your one-button Scripture reset`
- `What moment do you need help returning from?`

### P3：Relationship conflict / prayer before conversation

商业化证据强，但要避开 therapy/counseling。

页面方向：

- `Prayer Before a Difficult Conversation`
- `Scripture Before the Argument`
- `Return Before You React`

### P4：Faith daily companion / devotional tool

作为产品包装和 SEO 方向保留。

页面方向：

- `A Scripture companion for the moments and rhythms of your day`
- `Not another app. A physical anchor for prayer.`

### P5：Gift / physical anchor / reminder

作为后续季节性或社媒/Shopping 方向。

不作为首轮 Google Search 主方向。

## 对下一步关键词工作的要求

下一步不应该只扩 `bible verses...`，而应为每个方向建立词池：

1. Action moment 词池：react、overwhelmed、calm down、before saying、slow to anger、peace of mind。
2. Scripture reset 词池：scripture reset、prayer reset、short prayer、one minute prayer。
3. Relationship conflict 词池：difficult conversation、marriage conflict prayer、argument prayer、forgiveness scripture。
4. Daily companion 词池：daily devotional companion、prayer reminder、scripture reminder、prayer journal 替代。
5. Physical anchor/gift 词池：prayer bracelet、Christian wearable、encouragement gift、spiritual gift。

每个词池都要分清：

- 可投 Search。
- 只做 SEO。
- 只做页面包装。
- 只做后续 Meta/Shopping/gift。
- 应否定或暂缓。
