# BizAgentBench 第22题 · DSH 自动回归测试

使用已安装 DSH Desktop 的真实内核和当前 Evolith 插件，将一条正式评分通过的第22题轨迹完整回放。模型响应及业务工具返回固定，消除模型波动；不请求真实模型，不调用生产 Memory，不写入用户聊天或记忆。

## 运行

仓库根目录执行 `npm ci --ignore-scripts`，然后执行 `npm test`。只跑本样例可执行 `npm run test:bizagent`。环境、报告与退出码统一由 [测试入口](../../README.md) 管理，不需要在此目录另装依赖。

可选变量：

| 变量 | 用途 |
|---|---|
| `DSH_BRIDGE_ROOT` | 待测试的插件目录，默认当前插件仓库根目录 |
| `DSH_KERNEL_ROOT` | 完整内核的 `node_modules`，默认当前安装 Desktop 的 app.asar 内目录 |
| `DSH_JSDOM_ENTRY` | jsdom 入口绝对路径；省略时查找本测试安装的依赖 |
| `DSH_TEST_OUTPUT` | 输出目录；省略时创建独立时间戳目录 |
| `DSH_TEST_NODE` | 指定运行时；覆盖默认 Desktop Helper |

成功退出码为 0，任一检查失败退出码为 1；启动环境缺失也会非零退出。结果页为 `index.html`，机器报告为 `report.json`，每个子场景保存 `.json` 和 `.events.json`；发生失败也保留已发生的事件，便于定位。

## 覆盖范围

完整轨迹包含 **46轮用户请求、121次 Actor 响应、209次业务工具调用**。最后一条用户致谢是官方执行结束后的模拟器终止消息，没有对应 Actor 响应，单独保留在 fixture 来源说明中，不额外造一轮模型回答。

1. **Evolith 关闭**：完整回放，Memory 请求为0，没有注入；工具名称、参数、调用ID和完整结果逐一一致。
2. **Evolith 开启**：同一完整回放；真实 pre-step、消息追加、TokenMeter、窗口移出和后台 complete/expose 队列。N8/B4；第5、9、13……45轮增量注入，段内模型可见前缀只追加；只移出已提交的轨迹，原始公共历史不掺入记忆块。
3. **每轮结束**：真实 Agent.status 回到 idle，发出 idle 事件，turn/end 为 completed，原生 turnBoundary 关闭；工具及记忆消息不会增加业务轮数。
4. **后台记忆提交人为挂起**：故意不返回 complete，Actor 依然能够结束并回到 idle；之后释放挂起并排空队列。
5. **Memory prepare 故障**：注入明确失败，主模型仍按原输入完成全部步骤，原生 turn/end 为 completed 并回到 idle；错误保存在本地诊断中。
6. **前端记忆隐藏**：用真实插件 CSS、已安装 DSH 的消息 key 函数及 jsdom 计算样式；11个注入块隐藏，普通用户文本及回复可见，原始事件和模型输入仍含记忆。

以上按6个测试场景输出。对段内前缀的比较忽略仅用于日志归属的 message.id/source，但保留角色、内容、工具调用及结果关联；不是测量远端缓存命中率。

## 测试替身与限制

- AgentLoop、Session、ToolRuntime、原生工具执行器、TokenMeter 使用实际安装的 DSH 代码；Evolith 使用工作目录中的实际插件代码。
- 模型是固定响应 Adapter；工具由原生 DSH 工具管道执行，返回保存的业务结果，不重新执行金融世界状态。
- Memory 是本地 N8/B4 接口测试替身，检查发送协议、提交边界及队列；不重新运行真实 BM25、writer 或弱监督模型。插入的记忆明确标记为 integration fixture。
- 使用简短固定 system prompt，并固定注册本题用到的工具。这不是 Desktop 全部插件配置或原生自动压缩的覆盖测试。
- 前端检查是消息隐藏的 DOM/CSS 检查，**不等于完整 Electron 窗口端到端测试**，不能排除前端连接/状态订阅导致的“深度求索中”残留。
- fixture 中的 strict_success=true 是**原执行评分**，不会把回放成功冒充重新评分或当前模型准确率。

来源：`reports/bizagent_incremental_vs_baseline4x3_flash1017_20261116/case22_audit/baseline_r1_022.json.gz`。fixture 只保留合成 benchmark 的公共用户对话、Actor 回复、Actor 工具调用及返回、原评分和来源哈希；不含模型密钥、用户模拟器私有工具或内部 reasoning。

新增真实内核验证：Actor 调用记忆验证工具，保存可追溯证据，并在连接授权撤销后检查工具撤下。

新增中途开启验证：分别从第2轮、第6轮开启，完整回放46轮；检查历史补传、首次记忆注入、后续检索、系统提示保留、窗口移出和每轮日志重开。
