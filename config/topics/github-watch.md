# 主题：GitHub 单站专题

只盯 GitHub 上指定的仓库。适合追一个项目的发版节奏。

## 关心什么

- 新 release 与 tag
- 破坏性变更、迁移说明
- 重要的默认分支提交（过滤 merge/版本号）

## 分类

`#release` `#breaking` `#commit`

## 加分词（命中 +10）

release feat breaking security fix 性能 迁移 弃用

## 减分词（命中 −10）

chore docs ci test style

## 输出规范

- 最多 5 条
- 每条写清仓库名 + 版本号 + 发生了什么变化
- 没有新 release 时输出「今日无新版本」，不要拿旧 release 凑数

## 配置

只读取 `config/sources/github.json` 里的仓库列表；`--source github` 时自动只用这一套。
