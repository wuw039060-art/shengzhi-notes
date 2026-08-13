# GitHub 提交与黑客松展示清单

本文档只描述公开提交步骤，不包含任何个人账号、仓库地址或本机路径。

## 1. 创建仓库

在 GitHub 新建一个空仓库。不要勾选自动创建 README、License 或 .gitignore，因为这些文件已经在本地准备好。

推荐设置：

- Visibility：按比赛要求选择 Public。
- Description：把音视频转成适合 Obsidian 的 Markdown 知识笔记。
- Topics：`electron`、`ffmpeg`、`asr`、`markdown`、`obsidian`、`transcription`、`knowledge-base`。

## 2. 本地首次提交

在 PowerShell 中进入 GitHub 上传版目录，然后执行：

```powershell
git init
git branch -M main
git add .
git status --short
git diff --cached --stat
git commit -m "Initial public release: 声织笔记 v0.2.17"
git remote add origin https://github.com/<你的账号>/<仓库名>.git
git push -u origin main
```

把尖括号里的占位内容替换为你自己的信息，不要把占位符原样执行。

## 3. 提交前隐私检查

```powershell
git status --short
git ls-files
git grep -n -I -E "api[_-]?key|secret|password|token|C:\\\\Users\\\\|D:\\\\"
```

搜索结果中出现字段名或示例占位符是正常的；如果出现真实密钥、姓名、私人仓库地址或本机绝对路径，先移除再提交。

确认以下内容不在 `git ls-files` 中：

- `node_modules/`
- `outputs/`
- `resources/ffmpeg/*.exe`
- 设置文件、错误日志、转写稿和原始媒体
- `.codex/`、`.agents/`、迁移摘要或私人设计链接

## 4. 发布安装包

安装包约 200 MB，不要执行 `git add` 把它放进源码历史。GitHub 普通 Git 文件限制为 100 MB，安装包应上传到 Releases：

1. 打开仓库的 Releases。
2. 创建标签 `v0.2.17`。
3. 标题填写 `声织笔记 v0.2.17`。
4. 使用 `docs/RELEASE_TEMPLATE.md` 作为说明。
5. 把 `声织笔记 Setup 0.2.17.exe` 拖入 Release assets。
6. 发布后，把 Release 下载链接补到 README。

## 5. 黑客松展示顺序

建议用 90 秒完成一次端到端展示：

1. 展示拖入音视频和自动格式检测。
2. 选择一个 Prompt 模板，强调正文保留 70%-80%。
3. 开始串行转录，说明这样可避免接口并发超时。
4. 展示任务状态、暂停和失败日志。
5. 展示长 Markdown 预览滚动和保存。
6. 打开 GitHub 仓库，展示架构、隐私说明、源码检查和 Release。

演示时使用无个人信息的短样例媒体和单独创建的低额度 API Key。演示结束后撤销该 Key。
