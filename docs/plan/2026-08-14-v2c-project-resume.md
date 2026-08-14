# V2c：本地项目列表与创作工作流恢复

日期：2026-08-14
状态：已实现，packaged UI smoke 已通过
范围：恢复 Project、Script、Storyboard、ShootTask、Take 和 CapturePackage；不包含云端同步、冲突合并和项目归档

## 用户结果

用户重新打开同一个本地工作区后，可以在“创作项目”页面看到之前保存的项目，点击“继续编辑”恢复：

```text
workspace/catalog.sqlite
→ Project 列表
→ Project payload 中的 script/storyboard/capture package/task IDs
→ 完整脚本、分镜、拍摄任务和 Take
→ 回到创作工作台继续修改或进入 AI 剪辑
```

## 合同与边界

- `desktop:list-projects` 只返回当前 workspace 的项目摘要：ID、标题、阶段、revision 和更新时间；不向 renderer 暴露绝对路径或数据库连接。
- `desktop:load-project({ projectId })` 先校验 workspace ownership，再按项目阶段读取脚本、分镜、拍摄包和任务：仅完成脚本的项目可以恢复脚本与已保存的拍摄计划；payload 已声明但实际缺失的引用返回可理解错误，不拼出“看起来完整”的假项目。
- `takesByTask` 由主进程按任务读取，renderer 只获得已校验的 Take 结构；选择/导入仍通过原有 IPC。
- UI 恢复不会调用 TikHub、APIMart 或任何模型；恢复是本地事实读取，不是重新生成。
- 仍未实现跨窗口编辑冲突合并、远程同步、项目删除/归档和历史版本时间线。

## 验收

- storage test 断言工作区重启后 `listProjectsForWorkspace` 能返回已保存项目。
- `npm run typecheck`、`npm test -- --run`、`npm run build` 通过。
- packaged UI smoke 先在“仅确认脚本”阶段点击继续编辑并断言恢复脚本和保存的拍摄计划；再完成创作→Take→AI 剪辑→导出，二次断言同一项目、脚本、分镜、至少一个拍摄任务和拍摄包均能恢复。

## Interaction contract

- idle/empty：工作区没有项目时显示明确空状态，仍可直接在下方开始新项目。
- loading/disabled：初次读取显示“正在读取本地项目…”而不是短暂冒充空列表；点击“继续编辑”后禁用所有项目载入按钮，并把当前按钮改为“载入中…”，避免并发覆盖编辑状态。
- success：Project/Script 完整时可恢复脚本阶段；已经进入拍摄阶段的项目必须同时返回 Storyboard/Tasks/CapturePackage 才显示拍摄工作流。成功后用绿色 `role=status` 提示当前恢复到了哪个阶段。
- error：任一引用缺失或跨工作区时使用 `role=alert`，保留用户当前表单内容，不清空成半个项目。
- keyboard/labels：项目恢复动作使用原生按钮并保留可见 focus ring；项目阶段、revision 和更新时间不是只靠颜色表达。
- long/large data：项目标题允许换行；首屏最多显示最近 8 个项目，后续项目搜索/分页单独实现，不让恢复区无限增长。

## 失败路径

- 未选择工作区：不显示本地项目列表，保留选择工作区入口。
- 项目不存在、跨工作区或 payload 引用缺失：IPC 返回错误，UI 保留当前编辑内容，不覆盖成空白状态。
- 旧项目 schema 不兼容：catalog migration/解析失败被显式显示；不会静默降级到演示项目冒充本地数据。
