# Agent 规则文件调研与本项目采用方案

版本：v0.1  
日期：2026-08-13  
状态：规则体系决策记录

## 1. 结论先行

本项目采用：

```text
AGENTS.md       跨工具、根级、唯一规则事实源
CLAUDE.md       Claude Code 兼容入口，引用 AGENTS.md
CODEX.md        人工/兼容入口；Codex 实际读取 AGENTS.md
子目录/AGENTS.md 只写该目录的补充或更严格约束
docs/            长篇架构、研究、计划、审计和决策，不全部常驻上下文
```

不要为 Claude、Codex、Copilot、Cursor 各维护一份同义规则。工具不同的加载入口可以存在，但行为规则只能有一个来源。

## 2. 一手资料得到的规则

### 2.1 Claude Code 官方建议

Anthropic 的官方指南把 `CLAUDE.md` 定义为项目记忆：根目录文件负责架构、约定和命令，子目录文件负责局部规则；建议提交到 Git。官方建议根文件保持短而高密度，重点写命令、约定、三句话架构、硬约束和已知陷阱，不把完整 API 文档、历史、显而易见的目录树和团队并不遵守的愿望写进去。它还建议：同一问题被 Agent 犯错两次时再补规则，并定期删除过时内容。

对本项目的转译：根 `AGENTS.md` 只保留高频硬规则，详细 Provider/API/剪辑契约进入 `docs/`，否则每次任务都会被无关信息稀释。

### 2.2 Codex 官方 AGENTS.md 机制

Codex 官方文档说明：它从全局目录和项目根开始，沿当前路径逐级发现 `AGENTS.override.md` 或 `AGENTS.md`，按根到近处的顺序合并，越近的文件优先；默认总大小有上限，复杂仓库应使用嵌套文件拆分。官方还建议把代码审查规则放在最接近被审查代码的文件中。

对本项目的转译：根文件写产品和工程底线，未来可以为 `apps/desktop`、`packages/media`、`packages/exchange` 添加子目录规则；临时实验用 `AGENTS.override.md`，不把临时规则污染团队基线。

### 2.3 GitHub Copilot 官方机制

GitHub 支持仓库级 `copilot-instructions.md`、路径级 `.github/instructions/*.instructions.md` 和 Agent 使用的 `AGENTS.md`；多个规则可以同时生效，但官方明确提醒尽量避免冲突。说明文档还把“降低构建/验证失败、减少 Agent 无效探索、限制在两页内”作为生成仓库规则的目标。

对本项目的转译：规则要写“怎么判断完成”和“改动后跑什么”，而不是只写价值观。路径规则必须足够窄，不能把全局产品战略复制到每个包。

### 2.4 高质量真实仓库的写法

OpenAI Codex 自己的 `AGENTS.md` 是很好的工程样例：它同时写了模块边界、禁止改动的环境变量、精确命令、公共 API 约束、破坏性变化检查、集成测试要求、文件大小和变更规模上限。它把“不要做什么”和“安全替代路径是什么”放在一起，而不是只说禁止。

`agents.md` 开源规范仓库的样例则覆盖了开发环境、测试、lint、提交/PR 要求。它把 `AGENTS.md` 定位为 README 给 Agent 的补充：README 介绍项目，AGENTS 说明 Agent 如何安全高效地工作。

## 3. 我们采用的写作原则

每条规则尽量满足：

1. **可执行**：写“先读什么、运行什么、禁止什么”，少写抽象口号；
2. **可验证**：规则后面能对应测试、命令、fixture、diff 检查或用户走查；
3. **有范围**：全局规则进根文件，局部规则下沉，不靠一份超长文件覆盖所有情况；
4. **有替代路径**：禁止直接写数据库时，同时说明应通过哪个 service/command；
5. **只保留高信号**：API 详情、长篇背景、历史决定和示例放在文档链接中；
6. **规则和能力分离**：`AGENTS.md` 说明行为、边界和工作流；Skill/脚本说明如何完成一个复杂能力；
7. **单一事实源**：工具入口可以多个，正文只维护一份。

## 4. 本项目的分层计划

现在根目录只有 `AGENTS.md`、`CLAUDE.md`、`CODEX.md`。随着代码增长，按以下方式增加：

```text
AGENTS.md
├── apps/desktop/AGENTS.md      Electron/IPC/窗口/权限
├── packages/media/AGENTS.md    媒体探针、代理、转写、索引
├── packages/providers/AGENTS.md Provider、上传、轮询、成本和 fixture
├── packages/exchange/AGENTS.md RenderIR、FFmpeg、FCPXML、剪映适配器
└── docs/AGENTS.md               文档命名、决策记录和证据等级
```

嵌套文件不替代根规则；它们只增加局部规则或把更严格的检查落到更近的代码。

## 5. 反模式

- 在 `AGENTS.md` 里粘贴完整 API 文档、长篇产品历史或整个 README；
- 同时维护 AGENTS、CLAUDE、CODEX、Copilot 四份正文；
- 写“始终写高质量代码”这类无法验证的口号；
- 写团队实际上不会执行的规则；
- 把一次事故的细节永久塞进根文件，导致上下文越来越胖；
- 只写禁止事项，不写安全替代路径；
- 规则要求运行不存在的命令，或把未经验证的命令当作事实；
- 让 Agent 在一个大文件里同时负责领域规则、Provider 调用、UI 状态和渲染。

## 6. 维护节奏

- 新项目/新模块建立时，先补最近作用域的 `AGENTS.md`，再开始并行开发；
- 一个规则被验证为长期、全局、反复需要时才提升到根文件；
- 每次架构、命令、目录或验证门变化时同步规则；
- 每季度或每个大版本删除过时规则；
- 规则变更要像代码一样 review，至少检查：是否重复、是否冲突、是否能验证、是否增加无关上下文。

## 7. 参考来源

- [Anthropic: Give Claude context — CLAUDE.md and better prompts](https://support.claude.com/en/articles/14553240-give-claude-context-claude-md-and-better-prompts)
- [OpenAI: Custom instructions with AGENTS.md](https://developers.openai.com/codex/guides/agents-md)
- [OpenAI Codex repository AGENTS.md](https://github.com/openai/codex/blob/main/AGENTS.md)
- [GitHub: Adding repository custom instructions](https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/add-custom-instructions/add-repository-instructions)
- [agents.md open format and examples](https://agents.md/)

