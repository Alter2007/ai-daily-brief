# 主题：AI 行业动态

默认主题。面向普通职场人，不写给算法工程师。

## 关心什么

大模型与产品发布、企业采购与落地、渠道与定价变化、监管与安全事件。

## 分类

`#产品` `#技术` `#行业` `#风险`

## 信源

include: vendor, research, policy, media
exclude: arxiv, repo, community

> 行业简报读厂商官网、研究机构、政策与媒体；论文（arxiv）和仓库（repo）留给 `research` 与 `github-watch` 主题。
> 社区帖（community，如 Hacker News）不进行业简报——信噪比太低：2026-10-25 实测混进过一条 2 分的个人博客，摘要还带着 `Points: 2` 元数据。

## 加分词（命中 +10，可叠加到 40）

中文：发布 上线 开源 收购 融资 集成 合作 定价 免费 涨价 降价 监管 立法 漏洞 泄露 停服 下线 裁员 模型 智能体 算力 芯片
English：release launch open+source acquire acquisition funding partnership pricing free model api agent benchmark rollout enterprise adoption deal regulation vulnerability lawsuit layoff chip gpu inference

## 减分词（命中 −25，直接压到门槛以下）

> 两类：① 传闻（没有一手来源）② 生活类/消费类内容（不属行业情报）。
> 2026-10-31 实测：TechCrunch 一篇「万圣节装扮」因正文含 vulnerability 被误判成 #风险 选进简报。

中文：传闻 据悉 据说 或将 疑似 未证实 爆料 万圣节 装扮 礼物清单 促销 优惠券 折扣 购物
English：rumor reportedly unconfirmed allegedly gift guide giftguide halloween costume costumes trick-or-treat prime day black friday cyber monday discount coupon shopping list

## 一手源加成

`level: "first-party"` 的信源 +15 分。

## 输出规范

- 最多 5 条
- 每条四行：发生了什么（含日期）/ 为什么重要 / 谁该看 / 原文链接
- 同一事件 7 天内只报一次

## 权重（可选，不写则用默认值）

```yaml
base: 10              # 基础分
per_hit: 10           # 每个命中加分词
hit_cap: 30           # 命中的总加分上限
zero_hit_penalty: -10 # 一个词都没命中：视为不相关
negative_penalty: -25 # 每个命中减分词（传闻类）
first_party: 15       # 一手源加成
fresh_1d: 10          # 1 天内
fresh_3d: 5           # 3 天内
```

想把门槛调松：把 `zero_hit_penalty` 改成 0，或把 `app.json` 的 `min_score` 降到 30。
