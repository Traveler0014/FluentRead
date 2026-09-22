# FluentRead Lite（个人精简分支）

## 分支定位

本目录描述 `lite` 分支的裁剪规则。`lite` 是个人自用分支，目标是把 FluentRead 收窄成
「只做网页翻译」的小工具：保留全文 / 划词 / 悬浮 / 快捷 / 输入框等核心翻译路径和全部
在线翻译服务，移除所有会引入重型二进制依赖或复杂学习套件的功能。

- 上游同步仍走 `main`（官方镜像 + fork 的 CI）。
- 发布产物走 `lite`（`pnpm build:lite` / fork 的 Build CRX 工作流）。
- 裁剪的**唯一事实来源**是 `lite/exclude.json`；本文件解释取舍理由，不重复维护列表。

## 收录与移除原则

保留：

- 无重型二进制依赖、行为直观、围绕"翻译当前网页"的功能。
- 所有在线翻译服务（`src/providers/translation`）、术语库、翻译统计、模型用量。
- 全部界面语言包（i18n 不裁剪）。

移除：

- 引入额外重型二进制（wasm / OCR / PDF / 字典）的功能。
- 功能复杂、学习成本高、与"翻译小工具"边界不符的整套学习/写作/阅读子系统。

## 被移除的内容与理由

| 移除对象 | 理由 |
| --- | --- |
| `local-translation` | 本地模型翻译，wllama wasm 约 8 MB |
| `local-tts` | 本地语音合成，ONNX TTS wasm 约 22.5 MB |
| `video-subtitle` | 视频字幕翻译，ONNX jsep wasm 约 20.6 MB，另含 3 个 MAIN world 桥入口 |
| `image-translation` + `area-translation` | 依赖 Tesseract OCR 语言包约 3.9 MB |
| `document-translation` | 依赖 pdfjs 约 2.5 MB |
| `vocabulary` 单词本 / 学习中心 | 依赖本地 ECDICT 词库约 4.2 MB |
| `reading-assistant` + `services/harness` + `core/harness` | 翻译卡片 / 阅读理解学习套件，无独立二进制但代码与存储面较大 |
| `writing-assistant` + `services/writing` | 写作助手建立在 harness 之上，随上一条一并移除 |
| `ecdict-core.json` 本地词典源 | 划词词典只保留在线词典源 |
| 设置分区 | 翻译卡片、图片翻译、圈选翻译、视频字幕、写作助手、学习中心 |

保留但有说明：

- `translation-stats`、`model-usage` 保留；`model-usage` 被核心翻译运行时用于用量记账，不可移除。
- `offscreen` 入口保留：在线划词朗读与 Chrome 内置翻译仍依赖它。
- `qqMailFrame` / `shadowBridge` 入口保留：属于网页翻译注入路径。

## 与上游同步的流程

1. `git checkout main && git pull origin main && git push fork main`（官方同步与 fork CI）。
2. `git checkout lite && git merge main`。
3. 冲突处理规则：
   - 被移除功能目录/文件出现 modify/delete 冲突 → 保持删除（`git rm`）。
   - 组合根（`src/app/background/messageRuntime.ts`、`src/app/content/*`、
     `src/app/offscreen/*`、`src/features/settings/model/navigation.ts`、
     `src/features/settings/ui/SettingsSections.vue`）出现冲突 → 按本分支的精简实现为准，
     只挑回与保留功能相关的上游改动。
   - `wxt.config.ts` 中重型资产/入口的过滤逻辑必须保留。
4. 合并后运行 `pnpm build:lite` 与 `node scripts/lite/verify-lite.mjs` 校验产物无残留。

## 校验

```bash
pnpm build:lite
node scripts/lite/verify-lite.mjs
```

`verify-lite.mjs` 断言产物不再包含 `lite/exclude.json` 中列出的重型资产与入口，
避免一次上游合并把 52 MB wasm 悄悄带回来。

## 当前成果

- 解包体积：80 MB → **10.3 MB**；Chrome zip：24 MB → **3.3 MB**。
- Chrome MV3 与 Firefox MV2 均构建通过，`pnpm verify:extension-manifests` 已适配 lite（跳过 OCR 断言）。
- userscript 构建与 verifier 通过。
- 测试：`pnpm test:audit`、`test:architecture`、`test:unit`、`test:functional`、`test:regression` 全绿；`test:coverage` 四维 100%。
- 本仓已适配的文件：
  - `wxt.config.ts`：新增 `LITE_EXCLUDED_ENTRYPOINTS` 与 `entrypoints:found` 过滤，移除重型 wasm/OCR 注入。
  - `scripts/lite/verify-lite.mjs`、`.github/workflows/build-crx.yml`（新增 `lite` 分支触发与 `latest-lite` 滚动 release）。
  - `scripts/testing/verify-extension-manifests.mjs`（lite 感知）。
  - `tests/test-matrix.json`、`vitest.coverage.config.ts`、`tests/architecture/verificationOwnership.test.ts` 已同步裁剪。

## 待补（已知覆盖缺口）

裁剪时删除了部分测试；其中约 23 个**保留模块**因此失去严格覆盖率门禁，已被移出
`vitest.coverage.config.ts`。后续如要恢复质量，应针对这些模块重写测试并重新纳入四维 100%：

`src/app/background/capabilityRegistry.ts`、`contextMenuActions.ts`、`contextMenuPreferences.ts`、
`src/app/content/mainWorldBridgeLifecycle.ts`、`src/app/offscreen/messageRouter.ts`、
`src/core/config/areaTranslation.ts`、`src/core/config/localTts.ts`、
`src/core/context-menu/domain.ts`、`presentation.ts`、
`src/core/i18n/messages/legacy-corrections.ts`、`runtime-feedback.ts`、
`src/features/full-page-translation/background/stateHandlers.ts`、
`src/features/selection-translation/background/offscreenAdapter.ts`、`selectionTtsSynthesis.ts`、`wordLookupHandler.ts`、
`src/features/selection-translation/content/contextMenuBridge.ts`、
`src/features/settings/background/openOptionsHandler.ts`、`src/features/settings/model/dataBackup.ts`、
`src/platform/offscreen/client.ts`、`extensionClient.ts`、`firefoxDocument.ts`、
`src/platform/shadow-ui/pageBridgeCore.ts`、`src/shared/onnx/wasmBinary.ts`。

另外，`src/core/config` 中已移除功能的配置字段（video / image / area / localTts / selectionArea 等）目前**保留为惰性配置**，
未从 `Config` 模型删除，以降低与上游 `config/model.ts` 的冲突面；如需进一步精简可单独立项清理。
