# SEM 策略包：圣经智能手表首轮 Google Search

日期：2026-06-08

## 结论

建议第一阶段可以做 Google Search，但只能做“小预算、窄范围、内容页承接”的验证，不建议直接进入大规模投放，也不建议把主要流量直接导向 $149 产品页。

核心理由：

- SEMrush 已形成 922 个唯一候选关键词，并从中筛出 220 个 SEM 候选词、44 个否定关键词。
- 四个核心场景都有搜索需求：焦虑/平安 47 个候选词，愤怒/反应前暂停 31 个，压力/崩溃 68 个，冲突/关系 19 个。
- 需求最大的词大多是 `bible verses...`、`scripture...`、`prayer...`，用户期待先获得免费经文、祷告或短内容。直接卖 $149 硬件的跳跃太大。
- SEMrush paid results 显示，焦虑/经文词真实有广告主，但多是教会内容页；`anger management` 有强商业广告主，但多是 court/course/certificate 意图，不适合我们的硬件。
- Faith wearable 方向已有 Glorify Ring 这类公开参考，但 `christian smart ring`、`christian wearable` 在本轮 SEMrush paid results 未返回广告结果，不能把“faith wearable 品类词”当作首轮主力。

第一阶段推荐的判断是：Google Search 不是用来证明新品类，而是用来验证已经存在的痛点搜索能否被“内容解决方案 -> 一键 Scripture companion”转化。若这个桥接不成立，应快速暂停 Search，转向 Meta/内容种草/再营销。

## 数据资产

- 关键词宇宙：`launch-os/data/processed/semrush-keyword-universe.json`
- 关键词优先级：`launch-os/data/processed/semrush-keyword-priority.json`
- 否定关键词：`launch-os/data/processed/semrush-negative-keywords.json`
- SEM 计划摘要：`launch-os/data/processed/semrush-sem-plan-summary.json`
- Paid results：`launch-os/data/processed/semrush-paid-results.json`
- Paid domain summary：`launch-os/data/processed/semrush-paid-domain-summary.json`
- 原始 API 文件：`launch-os/data/raw/semrush/` 与 `launch-os/data/raw/semrush-paid/`

## 关键词优先级摘要

| 广告组 | 候选词数 | SEMrush 去重搜索量 | 首轮动作 |
|---|---:|---:|---|
| A01 焦虑经文与祷告 | 47 | 150,930 | 第一优先级，小预算内容页测试 |
| A03 压力崩溃与平安 | 68 | 191,180 | 第一优先级，但先排除泛 encouragement 词 |
| A02 反应前暂停与愤怒 reset | 31 | 41,180 | 第二优先级，只投 Scripture/slow-to-anger，不投 course/court |
| A04 冲突关系与婚姻祷告 | 19 | 15,360 | 第二优先级，适合内容页或 SEO/再营销 |
| A05 Prayer/Bible App 替代需求 | 7 | 122,400 | 暂不作为首轮主力，需要 Google Keyword Planner 复核 |
| R01 待复核长尾 | 48 | 680,720 | 暂不直接投，过泛，容易消耗预算 |

## 首轮推荐投放结构

### Campaign 1：Scripture Reset - Anxiety & Peace

目标：验证焦虑、担心、平安相关内容需求能否转化为产品兴趣。

广告组：

- A01 焦虑经文与祷告
- A03 压力崩溃与平安中的高贴合词

首轮关键词：

| 关键词 | Volume | CPC | Competition | Match | 页面 |
|---|---:|---:|---:|---|---|
| `bible verses for anxiety` | 14,800 | 0.02 | 0.46 | phrase | 焦虑经文/祷告内容页 |
| `prayer for anxiety` | 12,100 | 0.17 | 0.36 | phrase | 焦虑经文/祷告内容页 |
| `scripture for anxiety` | 5,400 | 0.02 | 0.54 | phrase | 焦虑经文/祷告内容页 |
| `bible verses about anxiety` | 9,900 | 0.02 | 0.46 | phrase | 焦虑经文/祷告内容页 |
| `prayer for peace of mind` | 3,600 | 0.16 | 0.43 | phrase | 平安 Scripture Reset 页 |
| `prayer for strength and peace` | 1,900 | 0.25 | 0.91 | phrase | 平安 Scripture Reset 页 |
| `bible verses about peace and comfort` | 1,900 | 0.02 | 0.78 | phrase | 平安 Scripture Reset 页 |

广告文案方向：

- Headline：`Bible Verses for Anxiety`
- Headline：`A One-Button Scripture Reset`
- Headline：`Return Before Anxiety Takes Over`
- Description：`Read a short prayer first. Then see how a wearable Scripture companion helps you return before you react.`
- Description：`Built for the moments when opening your phone is already too much.`

注意：广告不要暗示治疗焦虑，不用 medical claim。页面先给经文/祷告，再给产品桥接。

### Campaign 2：Prayer Before You React

目标：验证愤怒、快要反应、需要暂停的 Scripture 需求。这个方向最贴合硬件“一键入口”的独特性，但关键词量比焦虑小。

首轮关键词：

| 关键词 | Volume | CPC | Competition | Match | 页面 |
|---|---:|---:|---:|---|---|
| `bible verses about anger` | 4,400 | 0.01 | 0.18 | phrase | Christian Anger Reset 页 |
| `scriptures on anger` | 1,900 | 0.02 | 0.23 | exact | Christian Anger Reset 页 |
| `be slow to anger bible verse` | 1,000 | 3.81 | 0.00 | exact | Prayer Before You React 页 |
| `bible verses on anger` | 1,300 | 0.01 | 0.18 | phrase | Christian Anger Reset 页 |
| `scripture about anger` | 720 | 0.02 | 0.23 | exact | Christian Anger Reset 页 |

广告文案方向：

- Headline：`Prayer Before You React`
- Headline：`Scripture for Anger Moments`
- Headline：`Press Once. Return First.`
- Description：`A short Scripture reset for the moment before words come out.`
- Description：`Not a therapy course. A faith-centered pause you can reach in one press.`

强限制：不要投 `anger management classes`、`anger management course`、`court approved anger management`、`certificate` 等词。这些词 paid results 强，但意图错。

### Campaign 3：Marriage / Relationship Prayer

目标：低预算验证关系冲突内容是否能承接到“反应前暂停”。这个方向先低优先级，因为 paid results 没有明显商业广告主，且产品桥接需要页面讲得很精细。

首轮关键词：

| 关键词 | Volume | CPC | Competition | Match | 页面 |
|---|---:|---:|---:|---|---|
| `marriage prayer` | 1,600 | 0.25 | 1.00 | phrase | 婚姻祷告内容页 |
| `prayer for marriage` | 2,400 | 0.04 | 0.22 | phrase | 婚姻祷告内容页 |
| `prayer for relationship` | 1,300 | 0.99 | 0.02 | phrase | 关系祷告内容页 |
| `bible verses on marriage problems` | 880 | 0.03 | 0.26 | exact | 关系/冲突内容页 |
| `prayer for relationship restoration` | 320 | 3.10 | 0.01 | exact | 关系/冲突内容页 |

页面桥接：先提供祷告，再提出“很多冲突不是因为不知道经文，而是那一秒没有入口”，再介绍一键 wearable。

## 否定关键词

首轮必须加入的否定方向：

- 课程/法律：`anger management classes`、`anger management classes online`、`anger management course`、`court`、`certificate`、`probation`、`parole`、`court approved`、`mandated`、`requirement`
- 免费素材：`pdf`、`printable`、`wallpaper`、`image`、`clipart`、`coloring`、`tattoo`
- 儿童/教学：`kids`、`children`、`lesson`、`worksheet`、`sermon`
- 泛 quote：`bible quotes`、`biblical bible quotes`、`inspirational bible quotes`、`uplifting bible quotes`
- 医疗敏感：`therapy`、`therapist`、`treatment`、`medication`、`disorder`

解释：很多 quote 类词搜索量高，但用户更可能找社交素材或摘抄，不是“当下需要被带回神面前”的场景。anger course 类词 CPC 高但错配严重，尤其不能为了商业意图而让页面承诺课程、证书或治疗。

## 页面策略

### 页面 1：Bible Verses for Anxiety

首屏：

- H1：`Bible Verses for Anxiety`
- 副标题：`A short Scripture reset for the moment anxiety rises.`
- 首屏先给 3-5 条经文和一句短祷告。
- 首屏下方 CTA：`Need this before you reach for your phone?`

内容结构：

1. 先交付经文与短祷告。
2. 解释“焦虑袭来时，打开手机可能引入更多干扰”。
3. 展示一键手表如何提供 Scripture / prayer / reflection 入口。
4. 产品模块：$149、14-21 天发货、成熟品牌、隐私、退货、FAQ。

### 页面 2：Prayer Before You React

首屏：

- H1：`Prayer Before You React`
- 副标题：`A one-minute Scripture reset for the words you do not want to regret.`
- 先给 30 秒 prayer + James 1:19 / slow-to-anger 相关经文。

内容结构：

1. 先帮助用户暂停。
2. 明确不是 therapy / anger management class。
3. 解释手表价值：不用拿手机、不用打字、不用进入通知流。
4. CTA：`Press once. Return before you react.`

### 页面 3：Scripture Companion Wearable

只给以下流量：

- 再营销用户。
- 内容页点击 CTA 后的用户。
- Google Keyword Planner 复核后仍有明确商业意图的 app / Bible companion 词。

必须包含：

- 产品真实图。
- $149。
- 14-21 天发货。
- 配送、退货、客服、隐私。
- App 与硬件关系。
- 不使用 Founder Batch / first production run。
- 不承诺治疗、不替代牧者/教会/专业帮助。

## 参考产品和页面拆解

| 对象 | 来源 | 观察 | 对我们的启发 |
|---|---|---|---|
| Worship Center anxiety page | SEMrush paid result + 页面 | `bible verses for anxiety` 等词导向教会内容页，页面先给经文和祷告 | 焦虑词必须先满足内容需求，不宜直接硬卖 |
| CourseForAnger | SEMrush paid result + 页面 | 首屏直接 Online Anger Management Class，$25 起，court/legal/probation/certificate | 高商业意图但错配，作为否定词证据 |
| AngerMasters | SEMrush paid result + 页面 | 课程、价格、certificate、NAMA instructor、court acceptance | 不应复制 therapy/course 承诺 |
| Courseable | SEMrush paid result + 页面 | “Fulfill Your Anger Management Requirement Online”，法院接受保证和退款 | 证明 anger management 词交易强，但不是我们的用户意图 |
| Hallow | SEMrush paid result + 页面 | `hallow app` / `hallow app cost` 有付费结果，页面用 free trial、peace、habit、reviews | Faith app 转化靠低摩擦 trial；我们要用内容页降低 $149 跳跃 |
| Abide | 公开页面 | Christian meditation、sleep、stress、100k 评价、7 天 free trial、$39.99/year | 学习 stress/anxiety 到 faith habit 的叙事与信任结构 |
| Glorify Ring | 公开页面 | faith-centered wearable，prayer/reflection/routine，waitlist，physical anchor | 证明 faith wearable 可以讲“physical anchor”，但 category SEM 需求未证实 |
| Bible Chat | 公开页面 | AI trained on Scripture，pastors/theologians guidance，prayer/journal/verse generator | AI faith 产品要处理神学可信度和“不是随便 AI”的信任问题 |
| BM Bible & AI | 公开页面 | anxiety/fear/relationships/purpose，AI chat、guided prayers、streak、mood tracking | App 功能可作为软件侧参考，但硬件要突出一键入口 |
| BibleScroll | 公开页面 | “Scroll the Word, Not the World”，用 stress 示例、mood search、habit 替代 doom scrolling | 我们可以学习“减少手机干扰”的反向手机叙事 |

## 7 天小预算测试方案

前提：先做好至少 2 个内容页和 1 个产品页，不满足页面条件不建议投。

建议预算：

- 总预算：$300-$500 / 7 天。
- Day 1-2：只投 Campaign 1，$40-$60/day。
- Day 3-4：若 CTR 与页面互动达标，加入 Campaign 2，$20-$40/day。
- Day 5-7：根据页面点击 CTA、加购、结账启动情况，把预算集中到表现最好的一组。

观察指标：

- CTR：内容词低于 3% 说明广告/关键词承接弱。
- CPC：若实际 CPC 显著高于 SEMrush 预期，需收窄 exact/phrase。
- 内容页停留：短内容页平均停留低于 20 秒，说明页面没有交付搜索意图。
- CTA 点击率：内容页到产品 CTA 低于 2%，说明“内容 -> 硬件”桥太弱。
- Add to Cart / Checkout：7 天内没有任何加购或 checkout start，需要暂停扩量。
- Purchase：若首轮能出 1 单，继续小步扩；若只有内容互动没有商业行为，需要重写桥接或转再营销。

继续标准：

- 至少一个广告组 CTR >= 4%。
- 内容页 CTA 点击率 >= 3%。
- 有 add to cart 或 checkout start。
- 用户搜索词报告没有大量错配。

暂停标准：

- 100 次点击后没有任何 CTA 点击。
- 200 次点击后没有 add to cart / checkout start。
- 搜索词报告大量进入 free quote / printable / therapy / court class。
- CPC 远高于预估且页面行为弱。

转向标准：

- 如果内容页互动好但产品 CTA 弱，转向 Meta/短视频/再营销，用 Search 做内容获客或 SEO，不继续买冷流量硬转产品。
- 如果 Search 点击质量差，优先停 Search，把预算转向信仰人群兴趣/创作者/UGC/落地页再营销。

## 需要 Google Keyword Planner 复核

必须复核：

- `bible verses for anxiety`
- `prayer for anxiety`
- `scripture for anxiety`
- `prayer for peace of mind`
- `be slow to anger bible verse`
- `marriage prayer`
- `prayer for relationship`
- `hallow app`
- `hallow app cost`
- `christian prayer app`
- `bible app`
- `prayer app`

复核目的：

- 确认 Google Ads 可投量级。
- 看真实 top of page bid。
- 看 exact / phrase forecast。
- 看 broad match 是否会扩到无关搜索。
- 看品牌词和 App 词的实际竞争成本。

## 当前最终建议

第一阶段可以投 Google Search，但只建议投“内容解决方案页验证”，不建议投“产品页冷启动硬转化”。首轮最值得测试的是焦虑/平安与反应前暂停，因为它们最能证明硬件入口的独特价值：用户不是不知道经文，而是关键时刻没有一个比手机更低摩擦的入口。

真正要验证的不是“有没有人搜经文”，这个已经成立；而是“读完一段经文/祷告后，有没有足够多的人认同一键硬件入口的必要性，并愿意为 $149 付费”。如果这个桥接无法成立，Google Search 就不应成为首轮主渠道。
