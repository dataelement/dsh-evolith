# Evolith 插件统一测试

安装、升级和打包均不会自动执行测试。没有 preinstall/install/postinstall/prepare 等测试钩子，仅手动调用入口时运行。

## 一条命令

仓库根目录执行：

```sh
npm ci --ignore-scripts
npm test
```

默认依次执行：

| 阶段 | 源码 | 内容 |
|---|---|---|
| 语法 | `scripts/run-tests.mjs` | 主入口、前后端JS、统一运行器和测试代码的语法检查 |
| 插件单元 | `test/*.test.js` | 会话授权、隐私开关、连接设置、后台队列、重试、工具公共轨迹、控件、管理页面及测试报告失败判定 |
| 当前内核 | `test/evolith-runtime.test.js` | 同一组关键运行时测试在已安装Desktop内核上再验证，不只检查开发依赖版本 |
| BizAgent集成 | `tests/integration/bizagent/run.mjs` | 第22题固定轨迹，真实 AgentLoop / Session / ToolRuntime / TokenMeter / 插件，记忆开关、窗口、状态、接口错误、后台阻塞、前端隐藏 |

每个阶段均保留日志；某阶段失败后继续收集独立阶段的结果，最后整体返回非零退出码。子进程有超时上限，超时会终止并按失败记录。测试结果缺失、空测试或不一致的统计不会作为通过。

## 结果

终端会显示通过/失败数量与完整报告路径。

- `test-results/index.html`：最新一次报告入口。
- `test-results/latest.json`：最新一次结果指针。
- `test-results/<时间戳>/report.json`：机器可读的分阶段结果、计数、版本、耗时。
- 同目录的 `*.log`：各阶段标准输出和报错。
- 同目录的 `bizagent/`：6项集成检查、两种模式的逐轮状态、完整事件及独立HTML。

生成报告由 `.gitignore` 排除。测试代码和合成fixture属于源码；npm发布白名单不包含测试、脚本、fixture、报告或node_modules。

## 环境

- 开发依赖由仓库 `package-lock.json` 固定；建议 Node 24。
- macOS优先使用 `/Applications/DSH Desktop.app` 的运行时及内核，不启动/重启用户应用。
- 无Desktop环境时设置 `DSH_TEST_NODE` 为Node可执行文件，`DSH_KERNEL_ROOT` 为完整DSH 0.2.2内核的node_modules。普通Node无法直接加载Electron ASAR，不能只指定ASAR路径而不使用相应运行时。
- `DSH_TEST_RESULTS` 可指定统一报告根目录。
- `DSH_JSDOM_ENTRY` 可显式指定DOM检查依赖；默认使用本仓库的jsdom。
- `npm run test:unit` 和 `npm run test:bizagent` 是显式部分运行，HTML/JSON/终端会标明哪些阶段未执行，不能视为完整检查通过。

## 测试范围

[BizAgent样例说明](integration/bizagent/README.md)。它包含46轮用户请求、121次固定Actor响应、209次工具调用。末尾无Actor响应的模拟器终止致谢不计入回放轮数。

模型和Memory接口使用本地替身，业务工具返回固定历史结果：无真实模型token开销、无生产Memory请求、无金融系统写入。原轨迹通过不代表重新执行了正式评分。前端覆盖DOM/CSS隐藏，不覆盖完整Electron窗口状态同步、全部Desktop插件组合、远端弱监督/BM25/writer或原生自动压缩。本脚本仅覆盖插件仓库；服务端Python/SDK测试仍由各自工程管理。

新增真实内核验证：Actor 调用记忆验证工具，保存可追溯证据，并在关闭 Evolith 后检查工具撤下。
