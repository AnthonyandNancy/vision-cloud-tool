# vision-cloud-tool 双向 Draft Media 与 rc6/rc7/rc8 兼容修正设计

**Date:** 2026-08-20  
**Status:** Approved conversational design; awaiting written-spec review  
**Scope:** `feat/vision-cloud-rc-compatibility`，DeepSeek Harness `0.1.0-rc.6`、`0.1.0-rc.7`、`0.1.0-rc.8` 的公开 capability/API surface 兼容

## 1. Goal

修复两个相关缺陷：

1. 文本模型下已被 Vision Cloud 接管的 draft 图片，在切换到明确支持 `image` 的主模型后，必须恢复为 Harness 原生 image attachment；
2. 多模态模型下的原生 draft 图片，在切换到文本或未知模型后，必须在用户点击 Send 以前变为 bridge reference，并立即反映在 composer UI 中。

同时，主模型能够直接看见当前 native image 且本轮没有其他非 native image 输入时，必须在最终 prompt assembly 中结构性移除 `vision_cloud_tool`、其 system section 和 image context，而不能只依靠提示词劝阻模型。

生产行为只使用 capability/API feature detection，不读取 Harness 版本号，不添加 `rc6`/`rc7`/`rc8` 分支。

## 2. Existing evidence and root cause

当前分支已经具备：

- `modelDirectories.directoryFor(sessionId).store` 的优先读取与订阅；
- `resolveModelInfo`/`listModels` tri-state capability adapter；
- text-only bridge record、display-only native preview 和 submit guard；
- `native → bridge` 的初步实现；
- rc8 full inline `@label` occurrence span 测试。

根因有四个：

1. `reconcileDraftMedia` 以 `Map<sessionId, Promise>` 去重；已有 Promise 运行时的新 selection event 会被直接返回，导致旧 selection 完成后没有最新 reconciliation；
2. reconciliation 入口先要求 `before.imageIds.length > 0`，因此没有 bridge occurrence → native 的反向路径；
3. native-to-bridge mutation 没有把 selection、draft revision、record ownership 作为完整的目标提交条件；
4. `prompt-assembly.ts` 只把 native attachment 从 context 中过滤掉，最终 `assembled.tools` 仍可能暴露 `vision_cloud_tool`。

## 3. Chosen approach

采用“现有 `PasteImageController` 内的会话级最新选择状态机”方案，不引入与当前任务无关的全面 service 重构。

### 3.1 Rejected alternatives

- **局部特殊 case：** 改动表面较小，但 migration、preview 和竞态仍分散，无法可靠表达 latest-selection invariant。
- **全面抽出 DraftMediaService：** 边界更彻底，但会扩大 rc6 fallback、现有测试工装和 UI 连接面的回归风险；当前需求可以在 controller 内建立清晰的状态边界。

## 4. Selection identity and latest-wins scheduler

### 4.1 Authoritative selection

selection identity 始终包含 provider 与 model：

```ts
interface ModelSelection {
  provider?: string
  model?: string
  label: string
}
```

读取优先级：

1. `ctx.get('modelDirectories')?.directoryFor(sessionId)?.store.getSnapshot().current`；
2. 其他明确的 session/model API（若目标运行时提供）；
3. 现有兼容来源；
4. DOM model selector `aria-label`，只在前述 API 不存在或不可用时使用。

`modelDirectories` 可用但 `directoryFor` 或 snapshot 读取抛错时，必须安全回退，不得让子代理 composer 崩溃。provider 与 model 一起形成 selection key；label 不能覆盖已读取的完整 pair。

### 4.2 Per-session scheduler

替换当前 `Map<string, Promise<void>>` 语义，使用每 session 状态：

```ts
interface ReconcileState {
  generation: number
  dirty: boolean
  running: boolean
}
```

每次 model directory store callback：

```text
generation += 1
dirty = true
start runner if not running
```

runner 在旧任务结束后检查 `dirty`，并针对最新 selection 再运行；不因为已有 Promise 而吞掉新请求。不使用 `setTimeout`、固定延迟或重复 click。

每个异步边界和 destructive mutation 前后都验证：

- sessionId 仍指向同一 session；
- selection key/generation 仍是最新；
- input phase 仍为 `plain`；
- draft occurrence/ref、native image id 和 record 仍属于当前 draft；
- 需要保留的普通文本仍由当前 input state 提供。

旧任务的 capability verdict、draft snapshot 或 migration result 不得覆盖新 selection。

## 5. Draft media state machine

插件自己的 record 表示与 Harness image id 分层：

| 表示 | 判定 | 模型发送语义 |
| --- | --- | --- |
| `BRIDGE` | 当前 draft 有 `source === 'vision-cloud-pasted-image'` occurrence，`records.get(ref)` 持有 File | text-safe reference/path；由 text/unknown 模型通过 `vision_cloud_tool` 读取 |
| `NATIVE` | `input.state.imageIds` 中的 id 不在 `nativePreviews` | Harness 原生 image attachment |
| `DISPLAY_PREVIEW` | `nativePreviews` 中的 id 映射到 bridge ref | 只用于文本模型 UI；submit 前必须移除，不是模型可见 native image |

状态 invariant：

```text
capability === image && record File 可用 -> 当前 draft 优先 NATIVE
capability === text || capability === unknown -> 当前 draft 不得发送真实 NATIVE
```

DISPLAY_PREVIEW 允许继续提供缩略图，但不得被当作 NATIVE 参与模型发送或再次 bridge。

## 6. Native → bridge migration

触发条件：最新 selection 的 verdict 为 `takeover: true` 或 verdict 不可确定；即 text 和 unknown 都采用 text-safe bridge。

流程：

1. 从当前 `imageIds` 中排除 DISPLAY_PREVIEW ids；通过 feature-detected `conversation.draftImages(ids)` 取得真实 `DraftMediaAttachment`。
2. 在 destructive mutation 前 clone 每个 File，保留原生 attachment 作为 rollback source。
3. 使用当前 draft cursor 和 selection/draft CAS 创建 `PasteRecord`，插入 bridge occurrences；普通文本不被整体重写。插入失败时删除本次新 record 并恢复 draft。
4. 重新读取 input state，确认原 native ids、目标 occurrences、selection key 和 session 仍有效。若用户删除图片、目标 occurrence 被编辑破坏、或 selection 已变化，停止并保留原 native 表示；必要时回滚刚插入的 occurrences。
5. 目标 bridge insertion 成功后，才调用 `input.removeImage(id)`；之后调用 `releaseDraftImages(attachments)`。
6. 可按现有 text bridge UI 策略建立 DISPLAY_PREVIEW，但该 preview 必须记录在 `nativePreviews`，submit guard 会先删除它；真实 native id 不得残留。

若 `draftImages` 或 `removeImage` surface 不存在，不能猜测 File 或访问私有 attachment 目录。保持原 native draft，并让 submit guard 阻止未知/文本模型收到非法 native image，同时向用户报告兼容 API 不可用。

## 7. Bridge → native migration

触发条件：最新 selection 明确得到 `takeover: false`，并且当前 draft 中有本 session 的插件 bridge occurrence。

流程：

1. 只扫描当前 session、当前 occurrence 仍为插件 SOURCE、且 `records.get(ref)` 与 record ownership 匹配的记录；普通 path、URL、历史消息引用不进入此流程。
2. 优先使用原始 `PasteRecord.file`，不下载自身 bridge path。
3. 若存在 `conversation.createDraftImages` 与 `input.addImages`，创建 draft attachments 并按顺序 admission。创建数量必须与目标 records 相等；`addImages` 返回失败时释放新 attachments 并保持 bridge/旧 preview 不变。
4. admission 成功后重新定位当前 occurrence/ref。用户在等待期间修改普通文本时使用最新 offset/draftRev，不覆盖无关文本；用户删除目标图片或 selection 已变化时移除新 admission 并放弃。
5. 只有目标 native ids 已经成功进入 input state 且 selection 仍为 image，才删除对应 bridge occurrence/reference。
6. 清理该 ref 的 `nativePreviews`、display preview id、bridge bookkeeping；最终只留下真实 native ids，不留下 `[pasted image: ...]`、插件 absolute-path 提示、bridge URL/markdown 或重复 preview。

在新 draft-image API 不存在的 runtime 中，使用已有 feature-detected native admission fallback；只有能够从 input state 确认新的 native image 已进入 draft 时，才允许删除 bridge occurrence。无法确认成功则保持 bridge，不丢图。

## 8. Capability and compatibility rules

`src/model-capability.ts` 保持 tri-state：

- `resolveModelInfo(provider, model)` 与带 optional signal 的调用形式都支持；
- resolver 不存在或失败时，尝试 `listModels(provider)` 的 exact `id`/`name`；
- 只有数组 `inputModalities` 明确包含 `image` 才返回 `image`；
- 非空但没有 `image` 返回 `text`；
- 缺失、空、格式错误、没有 exact entry 或所有 API 失败返回 `unknown`。

客户端 takeover GET 的映射保持保守：

```text
false       -> confirmed image
true        -> text-safe bridge
undefined   -> unknown/text-safe bridge
```

`ctx.slash` 和 `@deepseek-ai/dsh-client-ui-input-trigger` 的 `inputTriggers` 注册路径都保留，且同一 Cordis registry 只注册一次。

不读取或比较 Harness release string，不访问私有 attachment object path，不硬编码 `rc8` 分支。

## 9. Prompt assembly hard gate

`applyVisionPromptEnrichment` 使用最终 assembly 的 provider/model 解析 capability。基于真实 `VisionImageInputs` 计算：

```text
directNativeOnly =
  capability === image
  && inputs.attachments.length > 0
  && inputs.paths.length === 0
  && inputs.urls.length === 0
```

此处 `attachments` 仅来自真正的 user `type: 'image'` block；普通 `sha256:` 文本、workspace path、URL 不是 native attachment。

当 `directNativeOnly` 为真：

- 从 `assembled.tools` 移除名称为 `vision_cloud_tool` 的 schema；
- 移除 `VISION_TOOL_SECTION_NAME`；
- 移除 `VISION_IMAGE_CONTEXT_NAME`；
- 返回同一个 assembly。

当 capability 为 image 但存在 path 或 URL：

- 保留 tool、section、context；
- 继续排除直接可见 native attachments，保留 path/URL 的 vision context。

text、unknown、无 model variables 或 tool 已被 preset 隐藏时不 hard-gate。没有 tool 的 scope 只清理可能残留的插件 section/context，并且不执行 capability lookup。

## 10. Test design

新增/修改测试必须先以失败测试证明缺陷，再写 production code。重点场景：

- **A：text → image**：bridge occurrence + File 在切换后变为一个 native id；ordinary text 保持；occurrence、bridge path 和 preview bookkeeping 被清理；不调用 submit。
- **B：image → text**：native id 在切换 callback 后立即变为 bridge occurrence；文件名/reference 可见；ordinary text 保持；测试不调用 submit。
- **C：text → image → text**：第一个 capability request 延迟；最终 draft 与最后 text selection 一致。
- **D：image → text → image**：最终只保留 native；无 bridge marker、absolute path、bridge URL/markdown 或 duplicate preview。
- **E：selection query in flight**：旧 verdict 完成后不得 mutation，最新 selection runner 必须执行。
- **F：unknown capability/GET failure**：不得把真实 native image 放行给未知模型；有 File 时转 bridge，API 不足时保留并阻止 submit。
- **G：image + native-only prompt assembly**：`assembled.tools` 不含 vision tool，Vision section/context 不存在。
- **H：image + path/URL**：vision tool 仍存在且外部输入 context 保留。
- **I：rc6 feature surface**：无 `modelDirectories`/draft-image 新 surface 时插件不崩溃，legacy trigger 和 bridge fallback 保持。
- **J：rc7 resolver/catalog surface**：resolver 失败时 exact catalog fallback 工作。
- **K：rc8 model directory**：store 的 provider/model 是 authoritative，selection callback 立即触发 reconciliation，不读取 DOM label 作为主路径。

现有 rc8 inline occurrence span、submit guard、display preview removal、`slash`/`inputTriggers` alias 和 route retry tests 必须保持通过。

## 11. Validation and known verification boundary

实现完成后执行：

```text
pnpm build
pnpm test
pnpm verify:portable
pnpm test:compat
pnpm exec tsc -p tsconfig.json --noEmit
pnpm exec tsc -p tsconfig.client.json --noEmit
pnpm exec tsc -p tsconfig.client.public.json --noEmit
```

另行检查 production `src/` 不包含 release-version branching（允许测试与文档出现版本 fixture label）。

当前工作区实际安装的是 rc6 peer/development surface。rc7/rc8 通过 feature-shaped contract fixtures 和公开类型形状测试；如果没有真实独立 Harness 环境，不把 fixture 结果写成真实 rc7/rc8 GUI/E2E 通过。最终报告单独列出：

- 已执行的 rc6 build/test 证据；
- rc7/rc8 contract 证据；
- 未能验证的真实 rc7/rc8 runtime/API surface；
- 任何因运行时缺失而只能依赖 feature detection 的 fallback。

## 12. Official references consulted

- [DeepSeek Harness rc8 release](https://github.com/deepseek-ai/deepseek-harness/releases/tag/dsh-v0.1.0-rc.8)
- [DeepSeek Harness rc8 README](https://github.com/deepseek-ai/deepseek-harness/blob/dsh-v0.1.0-rc.8/README.md)
- Existing repository compatibility matrix: `docs/compatibility-matrix.md`
- Installed rc6 public declarations for `ConversationController.createDraftImages/draftImages/releaseDraftImages` and `SessionInputShell.addImages/removeImage`.
