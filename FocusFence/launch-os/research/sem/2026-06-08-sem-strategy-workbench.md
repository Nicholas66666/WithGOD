# SEM 策略工作台：圣经智能手表首轮 Google Search

日期：2026-06-08

## 当前结论状态

状态：已形成第一版可执行策略包，但仍需 Google Keyword Planner / Google Ads forecast 复核最终出价和可投量。

当前已经完成的是第一层数据地基：4 个核心场景的 15 个种子词、每个种子词最多 50 条 SEMrush `phrase_related` 扩展词、每个种子词最多 50 条 `phrase_questions` 问题词，以及一组补充扩展词。现在已有 1161 行 SEMrush 原始/扩展记录，去重后形成 922 个候选关键词。

最新可执行输出见：`research/sem/2026-06-08-sem-strategy-package.md`。

已生成：

- 关键词优先级：`data/processed/semrush-keyword-priority.json`
- 否定关键词：`data/processed/semrush-negative-keywords.json`
- SEM 计划摘要：`data/processed/semrush-sem-plan-summary.json`
- 决策日志：`decisions/006-google-search-content-bridge-test.md`

初步判断：

- 焦虑/经文/祷告词有真实搜索量，但大量词 CPC 很低，更像免费内容消费意图。
- `christian anger management`、`anger management classes` 等解决方案词 CPC 高，但可能偏课程/咨询，不天然适合直接卖硬件，需要谨慎判断页面承接。
- 冲突/关系场景的原始种子词表现弱，但补充扩展后已从 4 个唯一词增加到 97 个，方向主要集中在 marriage prayer、relationship prayer、forgiveness、arguing with a fool、marriage restoration 等。
- 第一阶段 Search 若可行，大概率不是“直接产品页硬卖”，而是“场景内容页/Scripture reset 页 -> 一键硬件入口”的转化路径。
- 第一阶段可以做 Search 小预算验证，但不建议大规模投放；首轮真正要验证的是“内容解决方案 -> 一键硬件入口 -> $149 购买意愿”这座桥是否成立。

## 数据来源

- SEMrush Keyword Overview：`launch-os/data/raw/semrush/us-*.csv`
- SEMrush Related Keywords：`launch-os/data/raw/semrush/us-phrase_related-*.csv`
- SEMrush Paid Results：`launch-os/data/raw/semrush-paid/us-phrase_adwords-*.csv`
- 标准化数据：`launch-os/data/processed/semrush-keywords.json`
- 去重关键词宇宙：`launch-os/data/processed/semrush-keyword-universe.json`
- 付费结果汇总：`launch-os/data/processed/semrush-paid-results.json`、`semrush-paid-domain-summary.json`、`semrush-paid-no-results.json`
- SEMrush API 文档：`https://developer.semrush.com/api/seo/keyword-reports/`

## 当前关键词数据摘要

截至本轮：

- 原始/扩展记录：1161 行
- 唯一关键词：922 个
- 去重后总搜索量：约 2,038,440
- 初筛推荐动作分布：
  - 从 922 个唯一词中生成 220 个首轮 SEM 候选词。
  - 生成 44 个否定关键词。
  - 候选词中 178 个适合内容页承接后转产品，38 个需要 Google Keyword Planner 复核，4 个适合 SEO/内容沉淀。
  - 四个核心场景均已覆盖：焦虑/平安 47 个、愤怒/反应前暂停 31 个、压力/崩溃 68 个、冲突/关系 19 个。

注意：脚本输出已经过一轮人工策略修正，但仍不是最终可投账户清单。真正投放前需从 220 个候选词收窄到 20-40 个 exact/phrase 词，并用 Google Keyword Planner 复核。

## Paid Results 第一轮结果

本轮对 35 个代表词拉取 SEMrush `phrase_adwords` paid results，每个词最多 10 条结果。

结果：

- 有 paid result 行：39
- 覆盖域名：22
- 无 paid result 的配置关键词：24

### 真实出现的高频付费域名

| 域名 | 覆盖词数 | 代表关键词 | 代表落地页 |
|---|---:|---|---|
| `courseforanger.com` | 3 | `anger management classes online` / `anger management classes` / `anger management course` | `https://courseforanger.com/` |
| `worshipcenter.org` | 3 | `bible verses for anxiety` / `prayer for anxiety` / `scripture for anxiety` | `https://www.worshipcenter.org/blog/10-verses-to-pray-when-youre-fighting-anxiety` |
| `angermasters.com` | 2 | `anger management classes online` / `anger management classes` | `https://angermasters.com/` |
| `courseable.com` | 2 | `anger management classes online` / `anger management course` | `https://courseable.com/subject/anger-management-course/` |
| `forbes.com` | 2 | `anger management classes online` / `anger management classes` | `https://www.forbes.com/health/l/best-online-therapy/` |
| `hallow.com` | 2 | `hallow app cost` / `hallow app` | `https://try.hallow.com/` |

### 无 paid results 的重要词

以下词本轮没有返回 paid domain：

- faith wearable：`christian smart ring`、`christian wearable`
- App 商业词：`prayer app`、`christian prayer app`、`christian meditation app`、`daily devotional app`、`bible study app`、`ai bible app`、`ai prayer app`
- 关系/冲突：`prayer for marriage`、`marriage prayer`、`prayer for relationship`、`marriage trouble bible`、`bible verses on marriage problems`
- 焦虑长尾：`bible verses for worry`、`what is a good prayer for anxiety`

解释：

这说明很多看起来相关或有 CPC 的词，在 SEMrush 当前 paid results 中没有稳定广告主。它们不应被直接当作首轮投放主力词；更适合做内容页、SEO、Google Keyword Planner 校验，或作为后续低预算探索。

## 高价值早期信号

### 1. 内容需求真实存在，但未必可直接卖硬件

代表词：

- `bible verses for anxiety`：14,800 / CPC 0.02 / competition 0.46
- `prayer for anxiety`：12,100 / CPC 0.17 / competition 0.36
- `scripture for anxiety`：5,400 / CPC 0.02 / competition 0.54

解释：

这些词证明焦虑场景下的 Scripture/prayer 搜索需求真实存在。但 CPC 低，说明付费商业竞争弱，用户可能只是想马上获得免费经文或祷告文本。因此首轮不能直接假设“Search -> 产品页 -> $149 硬件购买”能成立。

### 2. 解决方案词商业意图更强，但可能偏离产品

代表词：

- `christian anger management`：90 / CPC 3.78 / competition 0.99
- `anger management classes`：27,100 / CPC 3.95 / competition 0.65

解释：

这些词商业意图更强，但用户可能在找课程、咨询、治疗或线下服务。我们的产品如果承接，要强调“反应前暂停、Scripture reset、事后复盘”，不能伪装成 anger management therapy。

### 3. 冲突/关系场景原始词不足

代表词：

- `bible verses for conflict`：40 / CPC 1.58 / competition 0.03
- `prayer before difficult conversation`：0

解释：

不是这个场景没有需求，而是我们当前词表达可能不接近真实搜索语言。下一步要扩展到 relationship/marriage/arguing/forgiveness/difficult people 等搜索方式。

扩展后新信号：

- `prayer for marriage`：2,400 / CPC 0.04 / competition 0.22
- `marriage prayer`：1,600 / CPC 0.25 / competition 1.00
- `prayer for relationship`：1,300 / CPC 0.99 / competition 0.02
- `marriage trouble bible`：1,000 / CPC 0.03 / competition 0.26
- `bible verses on marriage problems`：880 / CPC 0.03 / competition 0.26

解释：

冲突/关系更适合用 marriage、relationship、forgiveness、arguing 等语言找需求，而不是只用 abstract conflict。它仍然更像内容/祷告承接，不是直接产品词。

### 4. 参考产品词提供了更商业化入口

代表词：

- `hallow app`：14,800 / CPC 15.56 / competition 0.26
- `hallow app cost`：1,900 / CPC 35.37 / competition 0.23
- `hallow prayer app`：1,900 / CPC 4.09 / competition 0.21
- `prayer app`：1,900 / CPC 1.50 / competition 0.08
- `christian prayer app`：880 / CPC 2.18 / competition 0.02

解释：

这些词说明 faith app / prayer app 方向有商业出价，但多数可能是竞品、品牌或 App 下载意图。它们未必适合首轮直接投，但非常适合作为参考产品、竞品 paid results 和落地页策略研究入口。

Paid results 修正：

- `hallow app` 与 `hallow app cost` 有 Hallow 自身 paid result，落地页是 `try.hallow.com`。
- `hallow prayer app`、`prayer app`、`christian prayer app`、`christian meditation app` 本轮未返回 paid results。
- 因此第一轮不宜假设 prayer app 泛词已有稳定付费市场；Hallow 更像是品牌/价格词防守与再捕获。

## 付费落地页观察

### Worship Center：内容页承接焦虑经文词

来源：SEMrush paid result，关键词包括 `bible verses for anxiety`、`prayer for anxiety`、`scripture for anxiety`。

页面结构：

- 标题直接承接搜索意图：`10 Verses to Pray When You're Fighting Anxiety`。
- 开头先解释 peace/anxiety 的属灵框架，再直接给经文。
- 页面主要交付免费内容，没有明显产品销售。

对我们的启发：

- 焦虑经文词可以投到内容页，但用户期待的是“马上给我经文/祷告”。
- 我们的产品 CTA 不能过早硬卖，应放在用户获得短内容之后，解释“一键入口解决的是那个焦虑袭来时的摩擦”。

### CourseForAnger / AngerMasters / Courseable：高商业意图交易页

来源：SEMrush paid result，关键词包括 `anger management classes`、`anger management classes online`、`anger management course`。

页面结构共同点：

- 首屏直接承诺 Online Anger Management Class / Requirement Online。
- 强价格和行动入口：例如 starting at $25、Start Now、Pick Your Class。
- 明确信任证明：court acceptance、certificate、guarantee、certified instructor、testimonials。
- 用户意图高度交易化，很多是 court/legal/probation/employment requirement。

对我们的启发：

- `anger management` 系列词商业意图强，但与我们的 wearable 偏差很大。
- 如果投这些词，必须谨慎避开 court/certificate/legal intent，否则流量质量会错。
- 更适合提炼一个独立页面：`Christian Anger Reset`，只承接“反应前暂停/信仰辅助”意图，不承诺治疗、课程、证书或法律合规。

### Hallow：品牌词/价格词到 App 下载页

来源：SEMrush paid result，关键词包括 `hallow app`、`hallow app cost`。

页面结构：

- 首屏强调 “#1 Christian Prayer App”。
- 用名人/权威人物、海量 sessions、habit/streak、reviews 建立信任。
- CTA 是 `TRY HALLOW FOR FREE`，进入 onboarding。

对我们的启发：

- Faith app 转化强调“peace + habit + trusted guides + free trial”。
- 我们没有 free app-only trial 作为主转化时，不能照搬 Hallow 的低摩擦模型。
- 但可以学习它把 “Find Peace / Build Habit / Pray Your Way” 变成极简首屏利益点。

## 参考产品与页面研究清单

以下是第一批公开研究对象，后续要逐个做落地页结构、CTA、信任信息和转化路径拆解。

| 类型 | 参考对象 | URL | 当前观察重点 |
|---|---|---|---|
| Christian meditation app | Abide | `https://abide.com/` | 用 Christian meditation、sleep、stress relief、free trial 承接焦虑/压力需求；强评价、订阅、研究数据和 trial CTA。 |
| Catholic prayer app | Hallow | `https://play.google.com/store/apps/details?id=app.hallow.android` | 大规模 prayer/meditation/sleep 内容库，用 stress/anxiety/distracted 叙事转 App 下载。 |
| Bible app/content platform | YouVersion Anxiety resources | `https://help.youversion.com/l/en/article/r6yj25q0yk-resources-for-anxiety` | 直接按 Anxiety/Peace/Depression 给经文、计划、祷告，典型内容需求承接。 |
| Bible plan platform | YouVersion Plans | `https://www.youversion.com/` | 免费 Bible Plans、Prayer、Friends、习惯化路径；适合学习内容到留存。 |
| Faith wearable | Glorify Ring | `https://www.glorify.global/` | 直接 faith-centered wearable 参考，重点研究硬件叙事、日常 routine、祷告/反思与设备合理性。 |
| Christian meditation app | Abide App Store | `https://apps.apple.com/us/app/abide-christian-meditation/id726031617` | App Store 文案覆盖 anxiety、trust、healing、worship；评分和订阅价格可作信任/定价参考。 |
| AI Bible app | Bible Chat | `https://thebiblechat.com/` | AI faith app 方向，研究如何表达 peace/support、daily Scripture 和问答。 |
| AI Bible app | AI Bible Chat | `https://aibiblechat.com/` | 明确把 “What does the Bible say about anxiety?” 作为使用场景。 |
| AI prayer/mental wellness | PrayAI | `https://prayai.org/` | AI prayer generation + Christian mental health + Bible study AI 的组合包装。 |
| Scripture AI/meditation | BM Bible & AI | `https://www.bmbible.com/` | anxiety/fear/relationships/purpose + AI chat + guided prayers + streak/mood tracking。 |

## 需要继续补充的参考类型

- Christian counseling / Christian therapy 页面：看商业意图词如何承接。
- Anger management course 页面：看高 CPC 解决方案词如何构建信任与转化。
- Mental health content -> product 页面：学习内容页如何转 App/课程/订阅。
- Wearable/habit product 页面：学习硬件为什么比 App 更合理。
- Prayer/Devotional newsletter 页面：学习免费内容到关系建立。

## 初步页面策略假设

### 直接产品页不适合作为全部 Search 流量入口

原因：

- 大量高量词是 `bible verses...` / `prayer...`，用户期望马上获得内容。
- 直接展示 $149 硬件可能显得跳跃，除非词本身已经是解决方案意图。

### 更可能有效的页面类型

1. `Bible Verses for Anxiety` 内容页
   - 先给可用经文和短 prayer。
   - 再解释为什么焦虑袭来时，手机 App 不一定是最低摩擦入口。
   - 产品 CTA：`Press once when anxiety hits.`

2. `Prayer Before You React` 场景页
   - 面向愤怒、争吵、快要后悔的瞬间。
   - 先给 30 秒 reset / James 1:19 / short prayer。
   - 产品 CTA：一键暂停、震动、低打扰 Scripture reset。

3. `Christian Anger Reset` 解决方案页
   - 不冒充治疗或课程。
   - 定位为 reaction moment wearable + Scripture-guided debrief。
   - 谨慎使用 anger management 词，避免医疗/治疗承诺。

4. `Scripture Companion Wearable` 产品页
   - 只承接较高商业意图或品牌/产品教育后流量。
   - 重点讲硬件入口、14-21 天发货、$149、成熟品牌、无蜂窝套餐、退货/隐私/FAQ。

## 下一步数据动作

1. 拉取 `phrase_questions`，补足问题型内容词。
2. 针对冲突/关系重新扩词。已完成第一轮，后续需要人工筛选。
3. 针对解决方案词扩词。已完成第一轮，后续需要检查 paid results。
4. 拉取 paid results / ads history，用来识别哪些域名真的在买这些词。
5. 从 922 个唯一词中筛选 100-300 个进入可执行候选库，并标注 match type、ad group、landing page type。
6. 对 `worshipcenter.org`、`courseforanger.com`、`angermasters.com`、`courseable.com`、`hallow.com` 进行更完整页面拆解。

## 暂不下的结论

现在不能说“Google SEM 值得投”或“不值得投”。当前只能说：

- Search 需求存在。
- 直接硬件转化风险高。
- 内容承接后转产品的路径更符合数据。
- Paid results 显示真实广告主集中在两类：内容/教会页和 anger management 交易页；faith wearable 与多数 prayer app 泛词本轮没有 paid results。
- 仍需要把 922 个词收窄到 100-300 个候选词，再决定首轮投放结构。
