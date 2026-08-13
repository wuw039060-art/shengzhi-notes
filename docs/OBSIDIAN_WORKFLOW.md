# Obsidian 工作流

声织笔记最适合作为个人知识库的“音视频入口工具”。

## 推荐 Vault 结构

```text
Vault/
  00 Inbox/
  10 Sources/
    Podcasts/
    Meetings/
    Courses/
    Interviews/
    Livestreams/
  20 Permanent Notes/
  30 Projects/
  40 Assets/
```

## 推荐流程

1. 把原始音视频文件放入临时素材文件夹。
2. 添加到声织笔记。
3. 选择最接近的 Prompt 模板。
4. 生成 Markdown。
5. 保存到 `00 Inbox/` 或对应的 source 文件夹。
6. 在 Obsidian 里补充元数据、标签和双链。
7. 从原始转写稿中提炼永久笔记或项目素材。

## Frontmatter 模板

```yaml
---
type: transcript-note
source_type: podcast
status: inbox
created: 2026-07-08
speaker:
topic:
tags:
  - transcript
  - source-note
---
```

## 推荐标签

```text
#transcript
#source-note
#podcast
#meeting
#course
#interview
#livestream
#digital-asset
```

## 三种笔记类型

Source note：

```text
基本忠实于原始音视频内容的 Markdown 文档。
```

Permanent note：

```text
用你自己的话重新写过的小笔记，并链接回 source note。
```

Asset note：

```text
可复用的摘录、金句、论点、框架、案例或内容模块。
```

## 为什么重要

声织笔记不是单纯的转写工具。它帮助你把被动媒体变成可搜索、可链接、可引用、可复用的结构化知识。
