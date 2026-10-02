# batapha-mods

Batapha 的 Claude Code 插件市场。

## Tracking

提示框上方的两行条：

- 第 1 行，用量：运行状态 · ctx（绿/黄/红，按官方阈值）· 5h 限额 · 周限额
- 第 2 行，金额：本会话按 API 标价折算的金额 · 提示缓存倒计时 · 各模型 token（主对话 + 子代理）· 详情 · ✕
- 第 3 行起，进度条：每个步骤一个短条，完成的为绿色，未完成的为灰色

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
