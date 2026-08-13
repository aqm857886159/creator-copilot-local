# V2a 本地媒体事实实施记录

日期：2026-08-14  
状态：media package 与最小 Electron IPC/UI 导入入口已实现；尚未接入真实 Job scheduler 和 catalog manifest 提交

## 本切片的用户结果

给定一个本地视频和一个已存在的工作区，系统可以在不调用云端 AI 的情况下：

```text
视频文件
→ MIME/大小校验
→ SHA-256
→ ffprobe 归一化事实
→ 工作区 originals 原件副本
→ derived/proxies 代理视频
→ derived/thumbnails 缩略图
→ 三个带 hash/父子关系的 Artifact manifest
```

## 代码边界

- `packages/media/src/index.ts`：`LocalMediaImporter`、`FfmpegToolchain`、ffprobe 归一化、原子文件写入、hash 和产物关系。
- 默认仅支持视频扩展名（mp4/mov/m4v/webm/mkv/avi）；不把未知文件误送到 FFmpeg 视频链路。
- ffmpeg/ffprobe 可通过路径和 `CommandRunner` 注入，测试和后续 bundled binary 不依赖 PATH。
- 临时输出文件和最终文件在同一目录；命令失败会清理本次创建的产物，避免把半成品登记为事实。
- 输出路径始终由系统生成并限制在真实工作区根目录内；manifest 的相对路径统一为 `/` 分隔。
- Electron 主进程持有文件选择和媒体执行；renderer 只通过 preload 的 `importMedia()` 得到脱敏的事实和相对产物清单。

## 失败和恢复边界

- 源文件不存在、不是普通文件、超大小上限、不是视频或工作区不存在：在写入前拒绝。
- ffprobe/ffmpeg 失败、取消或输出缺失：删除本次 importer 创建的原件/代理/缩略图，不产生成功结果。
- 已存在同一 hash 的原件不会覆盖；后续 catalog 层以 artifactId/idempotencyKey 做去重。
- 当前 importer 返回 manifest，但还没有在 SQLite 中提交 manifest；下一步由 media Job handler 在一个可观察 receipt 中完成提交。

## 验证

- `npm run typecheck` ✅
- `npm test` ✅（4 files / 15 tests）
- `npm run build` ✅
- 真实 FFmpeg smoke ✅：生成 1 秒 320×568 MP4，成功输出约 20KB 代理和 JPEG 缩略图，并返回 1000ms duration。
- Electron built-dist startup smoke ✅：构建产物可启动，媒体 runtime ESM 可被主进程动态加载。

## 明确后置

- Electron utility process、进度/取消 IPC 和 scheduler polling；当前 IPC 是单次调用，尚未提供进度流。
- Windows bundled FFmpeg、签名、hash/许可证清单；
- CFR/VFR/旋转/无音频/双音轨/损坏媒体 redacted fixture；
- SQLite artifact transaction、orphan GC、项目重定位和媒体 manifest backup；
- ASR/OCR/镜头切分/VLM，不能因为 ffprobe 成功就宣称媒体理解已经完成。
