# lbh-mods

LBH 的 Claude Code 插件市场。

## Tracking

提示框上方的两行条：

- 第 1 行，用量：运行状态 · ctx（绿/黄/红，按官方阈值）· 5h 限额 · 周限额 · 提示缓存倒计时
- 第 2 行，金额：本会话按 API 标价折算的金额 · 各模型 token（主对话 + 子代理）· 详情 · ✕

另外有：多步任务的实时进度条（改编自 zycck/claude-mods 的 plan-progress，MIT）、阶段完成提示音、需要你决定时响铃、限额 80%/95% 提醒、按模板自动命名会话。

### 安装

```
/plugin marketplace add <GitHub 用户名>/claude-mods
/plugin install tracking@lbh-mods
```

如果之前装过 plan-progress，先卸载它，两者的进度条会重复：

```
/plugin uninstall plan-progress@zycck-mods
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
