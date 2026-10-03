# batapha-mods

Batapha 的 Claude Code 插件市场。

## Tracking

提示框上方的三行条，每行都是同样的 4 列，列之间用竖细线分隔，行与行之间用横细线分隔。每格都是"符号 · 数字 · 文字"一组：同一列里数字栏一样宽、文字栏一样宽，所以数字和文字各自上下对齐，整组再放在列的正中；空闲、详情这类没有数字的格子文字直接居中。宽度都用整数百分比，终端和桌面版一致。全部同一字号、不加粗：数字白色（到警告档才变黄/红），说明文字灰色，颜色只放在圆环、状态点和进度段上。

| | 第 1 列 | 第 2 列 | 第 3 列 | 第 4 列 |
| --- | --- | --- | --- | --- |
| 第 1 行 | 上下文（圆环绿/黄/红，按官方阈值） | 5 小时限额 | 7 天限额 | 状态点（空闲灰 / 运行中绿 / 等你黄） |
| 第 2 行 | 提示缓存倒计时 | 本会话金额（按 API 标价） | 用量最大的模型：金额 · token | 详情 › |
| 第 3 行 | 当前任务 | 步骤分段（完成绿、未完成灰） | 完成数/步骤数 | 完成比例 |

另外有：多步任务的实时进度条（改编自 zycck/claude-mods 的 plan-progress，MIT）、提示音（只在需要你回复、本轮对话结束、额度用完时响，任务或阶段完成、出错都不响）、限额 80%/95% 弹提示、按模板自动命名会话。

### 安装

终端版 Claude Code：

```
/plugin marketplace add Batapha/tracking
/plugin install tracking@batapha-mods
```

桌面 App 里 /plugin 会打开插件商店：选“本地插件”，上传 plugins/tracking 文件夹（里面直接有 .claude-plugin/plugin.json），不要选仓库根目录。

如果之前装过 plan-progress，先卸载它，两者的进度条会重复：

```
/plugin uninstall plan-progress@zycck-mods
```

### 更新

> 0.2.1 起市场名从 lbh-mods 改为 batapha-mods。之前用 lbh-mods 装过的，先运行 `claude plugin marketplace remove lbh-mods`，再按上面的安装命令重装。

在 Mac 的终端（不是 Claude Code 里）运行，然后重启 Claude Code：

```
claude plugin marketplace update batapha-mods
claude plugin update tracking@batapha-mods
```

### 命令

| 命令 | 作用 |
| --- | --- |
| `/tracking` | 显示或隐藏用量条 |
| `/tracking-detail` | 打开详情面板：各模型、各子代理的 token 和金额；有子代理在跑时，第 2 行的“详情 ›”会变成“子代理 N ›”，点开先列出每个子代理的状态、当前工具和用时 |
| `/tracking-demo` | 显示一条示例进度条 |
| `/tracking-sounds` | 试听所有提示音 |
| `/tracking-clear` | 清掉所有进度条 |

设置项在 `/plugin` → tracking → 配置 里修改。

### 用文字控制

插件注册了一个工具 `mcp__tracking__control`，在对话里直接说就行，例如：

- “隐藏用量条” / “显示用量条”
- “清掉进度条”、“打开 Tracking 详情”
- “关掉多步任务先建进度条”、“关掉提示音”、“不显示 5h 和周限额”
- “Tracking 现在什么设置？”

设置的改动和在 `/plugin` → tracking → 配置 里改是一样的，会保存下来，插件随即重新加载。
