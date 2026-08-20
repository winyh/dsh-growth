# 增长获客方法论手册

> 本文是方法细节与来源参考。完整的使用顺序、场景示例、数据规则、实验闭环和边界请先阅读 `docs/增长获客方法论与使用总览.md`。

经典增长方法的统一落地材料见 `references/classic-growth-methods.md`，由 `growth-strategy-planning` 按业务问题选择最小方法组合。本文保留增长主干方法；不要把多个框架叠加成新的汇报负担。

## 使用顺序

```text
增长准备度检查
→ JTBD / ICP
→ PMF 信号
→ North Star 与驱动因素
→ AARRR 漏斗
→ 队列 / 留存 / 增长循环
→ MRR / CAC / LTV / Payback
→ HADI 实验
→ RICE / ICE 排序
→ WBR / MBR 复盘
```

`growth_onboarding` 先检查准备度和方法覆盖；只有在目标、证据和数据基础满足后，才进入下面的增长闭环。
它同时返回当前 SOP 关卡和每一关的通过条件；先完成 `sop.currentStep`，再进入下一步，不要求一次性补齐所有方法。

## JTBD

先描述用户在什么场景下想取得什么进步，再描述产品如何被“雇用”。必须区分功能、社会和情绪层面的需求，避免只用年龄、职位或行业代替真实任务。

## PMF

Sean Ellis Survey 的核心问题是：如果不能继续使用这个产品，你会有什么感受？“非常失望”的比例可以作为产品价值强度的启发式信号。40% 是经验阈值，不是统计学定律，也不能替代真实留存、复购、口碑和付费行为。

## North Star

North Star Metric 应同时满足：代表用户得到的价值、团队能够影响、并且领先指示收入。建议只保留一个北极星指标，再拆成 3–5 个可行动驱动因素。

## AARRR

- Acquisition：用户从哪里来
- Activation：用户是否完成首次有效价值行为
- Retention：用户是否持续回来并获得价值
- Referral：用户是否愿意带来新用户
- Revenue：价值是否形成可持续收入

每个阶段都需要事件、分子、分母、时间窗口、样本量和目标。

## Growth Loops

漏斗描述用户前进路径，增长循环解释结果如何反过来产生新的获客或收入。常见循环包括内容循环、邀请循环、销售循环、产品使用循环和付费再投资循环。循环必须写出输入、动作、输出、回流点和限制条件。

## External Acquisition / Directory Submission

外部目录、产品导航和发现渠道属于 Acquisition / Referral 方案与资源，不是“外链数量”指标。方案设计前要明确目标是产品发现、推荐访问、注册、激活还是收入，并记录候选来源、当前入口、受众相关性、条款、授权要求、建议状态和证据字段。插件只负责筛选、规划、SOP 和复盘，不执行外部网站操作。

默认使用质量优先的 V2 试点方案：每批不超过 10 个站点，先完成质量门，再形成逐站授权清单和人工交接步骤。只有已筛选、已授权的 URL 列表才适合规划 V1 Batch 的规范化、去重、分片和断点恢复。验证码、邮箱验证、2FA、付费、互链、DNS / HTML 修改等需要后续操作者通过原生流程或单独授权完成，插件不得绕过，也不会代为执行。

方案结果首先使用 `planned`、`ready for approval` 和 `not attempted`。如果用户之后提供外部执行证据，再区分 `submitted`、`awaiting approval`、`awaiting email verification`、`published`、`submission outcome unknown`、`submission failed`、`ineligible` 和 `unavailable`。`submission outcome unknown` 在核验账号后台、邮箱和公开页面前禁止重试。只有经过公开页面或可靠回执验证，并且有推荐访问、激活或收入数据回流时，才把它作为增长效果证据。

## AI Search / Discoverability Readiness

AI 搜索可发现性准备度用于判断用户能否理解和发现产品、服务或内容，不是 GEO-PRO 执行能力，也不是排名保证。先按电商、SaaS / B2B、内容或本地服务判断适用性，再审计可抓取与可索引、机器可理解事实、内容可信度和电商 Feed 四层。

默认输出 `ready`、`partial`、`missing`、`not-applicable` 和 `needs-external-validation`，每项绑定证据、负责人、优先级、验收标准和验证方法。没有网站快照、Search Console、结构化数据测试、Feed 或工程资料时，只能输出待核验项，不能声称已经收录、被 AI 引用或带来增长。

固定的 meta 字数、图片大小、允许某个 crawler 或“向 LLM 提交产品”不是通用成功条件。结构化数据、价格、库存、评价和产品事实必须与页面真实内容一致；最终仍以合格访问、注册、激活、购买和收入验证价值。

## Cohort / Retention

不要只看总活跃用户。按注册时间、获客渠道、套餐或用户类型分组，比较不同队列的留存曲线。激活行为与留存的关系是线索，不能直接当作因果关系，需要实验验证。

## HADI

- Hypothesis：明确、可证伪的假设
- Action：对哪个用户、在什么场景做什么变化
- Data：主要指标、护栏指标、样本和采集方式
- Insight：结果、解释、下一轮决策

## RICE / ICE

RICE = Reach × Impact × Confidence ÷ Effort。

ICE = Impact × Confidence × Ease。

评分的价值是让假设透明，而不是把主观判断伪装成精确科学。没有 reach、confidence 或 effort 时，插件会输出“待补充”，不会自动补数字。

## 来源

- AARRR：<https://500.co/content/4-crystal-ball-analytics-tricks-for-accelerating-growth>
- North Star：<https://amplitude.com/books/north-star/about-north-star-framework>
- JTBD：<https://www.christenseninstitute.org/theory/jobs-to-be-done/>
- Growth Loops：<https://www.reforge.com/blog/growth-loops>
- RICE：<https://www.intercom.com/blog/rice-simple-prioritization-for-product-managers/>
- PMF Survey：<https://pmfsurvey.com/>
- Funnel / Cohort / Retention：<https://mixpanel.com/blog/what-is-product-management-analytics/>
