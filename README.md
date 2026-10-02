# batapha-mods

Batapha 的 Claude Code 插件市场。

## Tracking

提示框上方的三行条，每行都是同样的 4 列：列宽按内容自动计算，列与列之间的空隙相等，上下对齐，行与行之间用细线分隔：

| | 第 1 列 | 第 2 列 | 第 3 列 | 第 4 列（靠右） |
| --- | --- | --- | --- | --- |
| 第 1 行 | ctx（绿/黄/红，按官方阈值） | 5h 限额 | 周限额 | 运行状态（空闲 / 运行中 / 等你） |
| 第 2 行 | 提示缓存倒计时 | 本会话金额（按 API 标价） | 用量最大的模型 token 和金额 | 详情 |
| 第 3 行 | 当前任务 | 步骤分段（完成绿、未完成灰） | 完成数 / 步骤数 | 完成比例 |

另外有：多步任务的实时进度条（改编自 zycck/claude-mods 的 plan-progress，MIT）、需要你决定时响铃、限额 80%/95% 提醒、按模板自动命名会话。

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
| `/tracking-detail` | 打开详情面板：各模型、各子代理的 token 和金额 |
| `/tracking-demo` | 显示一条示例进度条 |
| `/tracking-sounds` | 试听所有提示音 |
| `/tracking-clear` | 清掉所有进度条 |

设置项在 `/plugin` → tracking → 配置 里修改。
