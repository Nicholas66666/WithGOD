# SEM 策略工作台：圣经智能手表首轮 Google Search

日期：2026-06-08

## 当前结论状态

状态：进行中，不能下最终投放结论。

当前已经完成的是第一层数据地基：4 个核心场景的 15 个种子词、每个种子词最多 50 条 SEMrush `phrase_related` 扩展词、每个种子词最多 50 条 `phrase_questions` 问题词，以及一组补充扩展词。现在已有 1161 行 SEMrush 原始/扩展记录，去重后形成 922 个候选关键词。

初步判断：

- 焦虑/经文/祷告词有真实搜索量，但大量词 CPC 很低，更像免费内容消费意图。
- `christian anger management`、`anger management classes` 等解决方案词 CPC 高，但可能偏课程/咨询，不天然适合直接卖硬件，需要谨慎判断页面承接。
- 冲突/关系场景的原始种子词表现弱，但补充扩展后已从 4 个唯一词增加到 97 个，方向主要集中在 marriage prayer、relationship prayer、forgiveness、arguing with a fool、marriage restoration 等。
- 第一阶段 Search 若可行，大概率不是“直接产品页硬卖”，而是“场景内容页/Scripture reset 页 -> 一键硬件入口”的转化路径。

## 数据来源

- SEMrush Keyword Overview：`launch-os/data/raw/semrush/us-*.csv`
- SEMrush Related Keywords：`launch-os/data/raw/semrush/us-phrase_related-*.csv`
- 标准化数据：`launch-os/data/processed/semrush-keywords.json`
- 去重关键词宇宙：`launch-os/data/processed/semrush-keyword-universe.json`
- SEMrush API 文档：`https://developer.semrush.com/api/seo/keyword-reports/`

## 当前关键词数据摘要

截至本轮：

- 原始/扩展记录：1161 行
- 唯一关键词：922 个
- 去重后总搜索量：约 2,038,440
- 初筛推荐动作分布：
  - 适合内容页承接后转产品：190
  - 需要 Google Keyword Planner 复核：更多词进入该区间，后续需人工收窄
  - 适合直接投 Search：初筛约 21+，集中在 anger management、prayer app、Hallow app、Bible app 等解决方案或参考产品词
  - 适合否定关键词：21
  - 适合 SEO/内容沉淀：问题型关键词增加后明显增多
  - 暂不建议使用：低量或明显无关词

注意：推荐动作是脚本初筛，不是最终策略。最终要结合 SERP、落地页、竞品广告和人工复核。

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

## 暂不下的结论

现在不能说“Google SEM 值得投”或“不值得投”。当前只能说：

- Search 需求存在。
- 直接硬件转化风险高。
- 内容承接后转产品的路径更符合数据。
- 需要竞品 paid results 和落地页拆解后，才能决定首轮投放结构。
