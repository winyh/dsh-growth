# AI 搜索可发现性资源

这组资源把 AI 搜索、生成式搜索和商品发现准备度整理成可审计、可排序、可交接的增长方法。它不是 GEO-PRO 能力，也不是实时网站扫描器、代码修改器或外部提交工具。

## 适用范围

适用于希望判断“用户通过搜索、AI 问答或 AI 购物场景能否理解和发现我”的团队。先判断业务类型，再决定哪些检查项适用：

| 业务类型 | 优先检查 |
| --- | --- |
| 电商 / 商品 | Product、Offer、价格、库存、配送、退换货、Merchant Center / Feed |
| SaaS / B2B | Organization、产品事实、使用场景、买家角色、对比页、案例和可信来源 |
| 内容 / 媒体 | Article、作者、主题覆盖、内部链接、引用来源和内容更新 |
| 本地 / 服务 | Organization、LocalBusiness、服务范围、联系方式、评价和本地页面 |

## 使用顺序

1. 明确目标：产品发现、品牌认知、合格访问、注册、激活、购买或收入。
2. 判断适用性：区分 `required`、`recommended`、`not-applicable` 和 `needs-external-validation`。
3. 建立证据矩阵：每项记录当前状态、来源、负责人、优先级和限制。
4. 生成准备度方案：先处理阻断发现的问题，再处理内容和转化问题。
5. 设计验证：把预期变化连接到抓取 / 索引、访问、注册、激活和收入，而不是承诺排名或 AI 引用。

## 输出状态

- `ready`：有当前证据且符合适用条件；
- `partial`：已有实现但信息、范围或证据不完整；
- `missing`：缺少关键实现或资料；
- `not-applicable`：业务类型不需要；
- `needs-external-validation`：必须由网站、Search Console、Merchant Center、日志或工程检查确认。

没有网站快照、Search Console、结构化数据测试结果或 Feed 资料时，插件只能输出待核验项，不得声称网站已经满足要求。

## 不应直接照搬的建议

- 固定的 meta description 字数、图片尺寸或文件大小不是所有业务的通用成功条件；
- 允许某一个 AI crawler 不等于一定被 AI 系统引用；
- “向 LLM 提交产品”只适用于存在明确官方入口的特定购物或平台场景；
- Product / Offer / Review 等结构化数据必须与页面真实内容一致，不能为了展示而虚构；
- 任何检查通过都不保证排名、引用、收录或转化。

## 参考来源

- Salesforce：[Ecommerce AI-Readiness SEO & LLM Search Checklist](https://www.salesforce.com/commerce/ai/ai-readiness-seo-checklist/)
- Google Search Central：[Optimizing your website for generative AI features](https://developers.google.com/search/docs/fundamentals/ai-optimization-guide)
- Google Search Central：[AI features and your website](https://developers.google.com/search/docs/appearance/ai-features)
- Google Search Central：[Product structured data](https://developers.google.com/search/docs/appearance/structured-data/product)
