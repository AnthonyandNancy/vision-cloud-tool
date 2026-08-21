# vision-cloud-tool 双向 Draft Media 兼容修正 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复文本/多模态模型切换时的双向 draft 图片迁移、rc8 最新 selection 竞态和 native-only request 的 `vision_cloud_tool` 暴露问题，同时保持 rc6/rc7/rc8 的 feature-detected 兼容。

**Architecture:** 在现有 `PasteImageController` 内把 `Map<string, Promise<void>>` 替换为每 session 的 generation/dirty/latest-wins 调度器，并让同一个 reconciliation 根据最终 verdict 在 BRIDGE、NATIVE、DISPLAY_PREVIEW 三种表示之间做非破坏迁移。`prompt-assembly.ts` 在 waterfall 最后基于最终 provider/model 和真实 `VisionImageInputs` 对 `assembled.tools` 做 request-scope hard gate；没有 native-only 条件时保留现有 path/URL routing。

**Tech Stack:** TypeScript, React 18, DeepSeek Harness Cordis client contracts, `@deepseek-ai/dsh-client-ui-conversation` public draft-image APIs, Vitest 4, Testing Library/jsdom, pnpm.

## Global Constraints

- 支持 DeepSeek Harness `0.1.0-rc.6`、`0.1.0-rc.7`、`0.1.0-rc.8`；生产代码只做 capability/API feature detection。
- 不得在生产代码中根据 `rc6`、`rc7`、`rc8`、`dshVersion` 或 semver 比较分支。
- 只有 `inputModalities` 明确包含 `image` 才允许真实 native image；`text` 和 `unknown` 必须 text-safe bridge。
- provider + model 是完整 selection identity；DOM label 只能是最后 compatibility fallback。
- selection generation、draft occurrence/ref、draft revision 和 record ownership 在每个异步 mutation 前后都必须重新确认；旧任务不得覆盖最新 selection。
- 所有 migration 都遵守“目标表示 admission 成功后才删除源表示”；失败必须保留源图，不丢图。
- DISPLAY_PREVIEW 只用于 UI，不能作为真实 native image 发送；submit guard 只是最后一道安全兜底，不能是正常切换流程。
- `conversation.createDraftImages`、`conversation.draftImages`、`conversation.releaseDraftImages`、`input.addImages`、`input.removeImage` 都必须 feature-detect；缺失时走已存在的兼容 fallback 或安全阻止发送。
- 保留 `@deepseek-ai/dsh-client-ui-input-trigger` 的 `inputTriggers` 与旧 `ctx.slash` 注册路径。
- 不访问 Harness 私有 attachment 目录；只使用公开 draft/attachment contracts 和当前 record 持有的 `File`。
- 每个 production behavior change 先写并观察失败测试，再写最小 production change，再运行 focused test 和完整相关测试。

---

## File map and responsibilities

### Files to modify

- `src/client/paste-images.tsx` — model-directory authoritative selection、per-session reconciliation scheduler、native↔bridge migration、preview cleanup、unknown submit guard。
- `src/prompt-assembly.ts` — final assembly native-only hard gate；保留 image+path/URL 的合法工具场景。
- `tests/paste-images-client.spec.ts` — A–F、I、K 的 draft migration、race、unknown、API fallback tests；更新旧的 unknown expectation。
- `tests/prompt-assembly.spec.ts` — G/H 和 stale contribution cleanup tests。
- `tests/compatibility-contract.spec.ts` — 如新增的 public-shape contract 需要集中登记，则补充 rc6/rc7/rc8 fixture；不在 production 中携带版本分支。
- `docs/compatibility-matrix.md` — 只有所有自动化测试通过后补充双向 draft/assembly hard-gate evidence，不改无关历史说明。

### Files to inspect but not redesign

- `src/model-capability.ts` — 保持现有 tri-state resolver/catalog adapter；只有 failing compatibility test 明确证明需要修正时才改。
- `src/vision-context.ts` — 使用现有 `VisionImageInputs` 语义；不把任意 text `sha256:` 或 path 伪装成 native attachment。
- `src/system-prompt.ts` — 不以提示词文案代替 assembly hard gate；只在 focused test 证明文字需要同步时做最小文案修正。

---

### Task 1: Add the native-only prompt assembly hard gate

**Files:**
- Modify: `tests/prompt-assembly.spec.ts`
- Modify: `src/prompt-assembly.ts`

**Interfaces:**
- Consumes: `PromptAssembly`, `VisionImageInputs`, `resolveModelCapability()`, `VISION_TOOL_NAME`, `VISION_TOOL_SECTION_NAME`, `VISION_IMAGE_CONTEXT_NAME`。
- Produces: a private `removeVisionContributions(assembled: PromptAssembly): void` helper and a native-only predicate inside `applyVisionPromptEnrichment()`; no new public export is required.

- [ ] **Step 1: Write the failing native-only and path/URL tests**

Append these cases to the existing `describe('applyVisionPromptEnrichment: agent-preset tool gate', ...)` block in `tests/prompt-assembly.spec.ts`:

```ts
it('removes the vision tool, section, and context when an image model has only native image blocks', async () => {
  const resolveModelInfo = vi.fn().mockResolvedValue({ inputModalities: ['text', 'image'] })
  const ctx = fakeContext({ resolveModelInfo } as unknown as Context['llm'])
  const agent = {
    session: {
      events: [{
        type: 'user/message',
        data: {
          kind: 'user',
          content: [{
            type: 'image',
            attachment: { attachmentId: 'sha256:native', mediaType: 'image/png', bytes: 10 },
          }],
        },
      }],
    },
  } as unknown as Agent
  const assembled = assembly({
    tools: [VISION_SCHEMA as never, { name: 'other_tool' } as never],
    sections: [
      { name: VISION_TOOL_SECTION_NAME, text: 'stale tool guidance' },
      { name: 'other:section', text: 'keep me' },
    ],
    contexts: [
      { name: VISION_IMAGE_CONTEXT_NAME, text: 'stale native attachment context' },
      { name: 'other:context', text: 'keep me' },
    ],
    variables: { provider: 'p', model: 'image-model' },
  })

  const result = await applyVisionPromptEnrichment(ctx, assembled, { scope: {}, agent })

  expect(result.tools.map(tool => tool.name)).toEqual(['other_tool'])
  expect(result.sections.map(section => section.name)).toEqual(['other:section'])
  expect(result.contexts.map(context => context.name)).toEqual(['other:context'])
  expect(resolveModelInfo).toHaveBeenCalledWith('p', 'image-model', undefined)
})

it('keeps the vision tool for an image model when a path or URL remains routable', async () => {
  const resolveModelInfo = vi.fn().mockResolvedValue({ inputModalities: ['image'] })
  const ctx = fakeContext({ resolveModelInfo } as unknown as Context['llm'])
  const agent = {
    session: {
      events: [{
        type: 'user/message',
        data: {
          kind: 'user',
          content: [
            { type: 'image', attachment: { attachmentId: 'sha256:native', mediaType: 'image/png' } },
            { type: 'text', text: '[Pasted image available at absolute path: "C:\\work\\external.png"] https://img.example/external.png' },
          ],
        },
      }],
    },
  } as unknown as Agent
  const assembled = assembly({
    tools: [VISION_SCHEMA as never],
    variables: { provider: 'p', model: 'image-model' },
  })

  const result = await applyVisionPromptEnrichment(ctx, assembled, { scope: {}, agent })

  expect(result.tools.map(tool => tool.name)).toContain(VISION_TOOL_NAME)
  expect(result.sections.some(section => section.name === VISION_TOOL_SECTION_NAME)).toBe(true)
  const context = result.contexts.find(context => context.name === VISION_IMAGE_CONTEXT_NAME)
  expect(context?.text).toContain('external.png')
  expect(context?.text).toContain('https://img.example/external.png')
  expect(context?.text).not.toContain('sha256:native')
})

it('removes stale plugin context as well as section when the final tool list is scoped away', async () => {
  const ctx = fakeContext({ resolveModelInfo: vi.fn() } as unknown as Context['llm'], DENIED_SCOPE)
  const assembled = assembly({
    tools: [{ name: 'run_code' } as never],
    sections: [{ name: VISION_TOOL_SECTION_NAME, text: 'stale' }],
    contexts: [{ name: VISION_IMAGE_CONTEXT_NAME, text: 'stale' }],
  })

  const result = await applyVisionPromptEnrichment(ctx, assembled, { scope: DENIED_SCOPE })

  expect(result.sections).toEqual([])
  expect(result.contexts).toEqual([])
})
```

- [ ] **Step 2: Run the focused tests and verify the expected red failure**

Run:

```bash
pnpm exec vitest run tests/prompt-assembly.spec.ts -t "native image blocks|path or URL|stale plugin context"
```

Expected: the native-only case fails because `vision_cloud_tool` is still in `assembled.tools`; the path/URL case may expose the exact context shape needed by the existing scanner. Do not change production code before seeing this failure.

- [ ] **Step 3: Implement the smallest assembly mutation helpers**

In `src/prompt-assembly.ts`, add the following helper beside `hasNativeVisionTool`:

```ts
function removeVisionContributions(assembled: PromptAssembly): void {
  assembled.tools = assembled.tools.filter(tool => tool.name !== VISION_TOOL_NAME)
  const sectionIndex = assembled.sections.findIndex(section => section.name === VISION_TOOL_SECTION_NAME)
  if (sectionIndex >= 0) assembled.sections.splice(sectionIndex, 1)
  const contextIndex = assembled.contexts.findIndex(context => context.name === VISION_IMAGE_CONTEXT_NAME)
  if (contextIndex >= 0) assembled.contexts.splice(contextIndex, 1)
}
```

Replace the early no-tool branch with:

```ts
if (!hasNativeVisionTool(assembled)) {
  removeVisionContributions(assembled)
  return assembled
}
```

After `inputs` is collected and before adding/updating the plugin section, insert:

```ts
if (
  capability === 'image'
  && inputs.attachments.length > 0
  && inputs.paths.length === 0
  && inputs.urls.length === 0
) {
  removeVisionContributions(assembled)
  return assembled
}
```

Do not remove the existing `routeInputs()` path/URL behavior. The hard gate must only run when at least one direct native image exists and no external input remains.

- [ ] **Step 4: Run focused and existing prompt tests**

Run:

```bash
pnpm exec vitest run tests/prompt-assembly.spec.ts tests/vision-context.spec.ts
```

Expected: all prompt assembly and vision-context tests pass, including the existing text model and image+path tests.

- [ ] **Step 5: Commit the isolated prompt change**

```bash
git add src/prompt-assembly.ts tests/prompt-assembly.spec.ts
git commit -m "fix: hard-gate vision tool for native image requests"
```

---

### Task 2: Add failing client tests for bidirectional migration and latest selection

**Files:**
- Modify: `tests/paste-images-client.spec.ts`

**Interfaces:**
- Consumes: existing `fakeClient()`, `inputMachine()`, `rc8InputMachine()`, `armTakeover()`, `flushTasks()`, `file()`, and `PasteImageController` test surface.
- Produces: regression tests that fail against the current one-way `reconcileDraftMedia()` and Promise-map scheduler.

- [ ] **Step 1: Add a deferred-response test helper**

Add this helper after `flushTasks()` in `tests/paste-images-client.spec.ts`:

```ts
function deferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((resolvePromise, rejectPromise) => {
    resolve = resolvePromise
    reject = rejectPromise
  })
  return { promise, resolve, reject }
}
```

- [ ] **Step 2: Write the failing bridge → native test without submit**

Add this test after the existing native-to-bridge test:

```ts
it('promotes a live bridge draft to one native image immediately after switching to an image model', async () => {
  let current = { provider: 'p', model: 'text-model' }
  const listeners = new Set<() => void>()
  const directory = {
    store: {
      getSnapshot: () => ({ current }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
  }
  let createCount = 0
  const draftFace = {
    createDraftImages: vi.fn((files: readonly File[]) => files.map(file => ({
      id: createCount++ === 0 ? 'display-preview' : 'native-promoted',
      file,
      previewUrl: 'blob:preview',
    }))),
    releaseDraftImage: vi.fn(),
    releaseDraftImages: vi.fn(),
  }
  const bench = fakeClient('保留这段文字', ['slash'], false, {
    modelDirectories: { directoryFor: vi.fn(() => directory) },
    conversation: draftFace,
  })
  composer()
  vi.stubGlobal('fetch', vi.fn(async (url: unknown) => {
    const params = new URL(String(url), 'http://localhost').searchParams
    return new Response(JSON.stringify({ takeover: params.get('model') !== 'image-model' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })
  }))

  await armTakeover()
  const textarea = document.querySelector<HTMLTextAreaElement>('[data-composer-card] textarea')
  if (textarea === null) throw new Error('composer textarea missing')
  textarea.dispatchEvent(clipboardEvent('', [file('promote.png', 'image/png', [1, 2, 3])]))
  await flushTasks()
  expect(bench.input.state.getSnapshot().occurrences).toHaveLength(1)
  expect(bench.input.state.getSnapshot().imageIds).toEqual(['display-preview'])

  current = { provider: 'p', model: 'image-model' }
  for (const listener of listeners) listener()
  await flushTasks()

  const snapshot = bench.input.state.getSnapshot()
  expect(snapshot.imageIds).toEqual(['native-promoted'])
  expect(snapshot.occurrences).toEqual([])
  expect(snapshot.draft).toBe('保留这段文字')
  expect(draftFace.releaseDraftImage).toHaveBeenCalledWith('display-preview')
  bench.dispose()
})
```

Add one sibling regression in the same client describe: start `source()?.codec.serialize(ref, signal)` with a deferred POST response, switch to the image model while that bridge copy is pending, and assert after the selection callback that the draft has one native id and no bridge occurrence. Resolve the POST afterward and assert the serialization promise settles without reintroducing an occurrence or preview. This covers a copy-in-flight selection change without making upload completion part of normal migration.

- [ ] **Step 3: Write the failing newest-selection-wins race test**

Add this test in the same describe block:

```ts
it('runs the final text migration after a delayed image verdict instead of returning the old reconciliation', async () => {
  let current = { provider: 'p', model: 'image-model' }
  const listeners = new Set<() => void>()
  const directory = {
    store: {
      getSnapshot: () => ({ current }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
  }
  const native = file('race.png', 'image/png', [1, 2, 3])
  const draftFace = {
    draftImages: vi.fn(() => [{ id: 'native-race', file: native, previewUrl: 'blob:native' }]),
    releaseDraftImages: vi.fn(),
  }
  const first = deferred<Response>()
  const second = deferred<Response>()
  const fetchMock = vi.fn((url: unknown) => {
    const model = new URL(String(url), 'http://localhost').searchParams.get('model')
    return model === 'image-model' ? first.promise : second.promise
  })
  const bench = fakeClient('不要覆盖', ['slash'], false, {
    modelDirectories: { directoryFor: vi.fn(() => directory) },
    conversation: draftFace,
  })
  composer()
  vi.stubGlobal('fetch', fetchMock)
  await armTakeover()
  bench.input.addImages(['native-race'])

  current = { provider: 'p', model: 'text-model' }
  for (const listener of listeners) listener()
  current = { provider: 'p', model: 'image-model' }
  for (const listener of listeners) listener()

  first.resolve(new Response(JSON.stringify({ takeover: false }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  await flushTasks()
  expect(bench.input.state.getSnapshot().imageIds).toEqual(['native-race'])

  current = { provider: 'p', model: 'text-model' }
  second.resolve(new Response(JSON.stringify({ takeover: true }), { status: 200, headers: { 'Content-Type': 'application/json' } }))
  for (const listener of listeners) listener()
  await flushTasks()

  expect(bench.input.state.getSnapshot().imageIds).toEqual([])
  expect(bench.input.state.getSnapshot().occurrences).toHaveLength(1)
  expect(bench.input.state.getSnapshot().draft).toContain('不要覆盖')
  bench.dispose()
})
```

- [ ] **Step 4: Change the unknown verdict regression expectation to the new invariant**

Replace the existing test named `keeps native draft images when the fresh model verdict is unknown` with a test that supplies a real `draftImages` result and asserts bridge migration:

```ts
it('routes a native draft through the bridge when the capability verdict is unknown', async () => {
  const listeners = new Set<() => void>()
  const directory = {
    store: {
      getSnapshot: () => ({ current: { provider: 'p', model: 'unknown-model' } }),
      subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    },
  }
  const native = file('unknown.png', 'image/png', [1, 2, 3])
  const draftFace = {
    draftImages: vi.fn(() => [{ id: 'unknown-native', file: native, previewUrl: 'blob:native' }]),
    releaseDraftImages: vi.fn(),
  }
  const bench = fakeClient('未知模型也要安全', ['slash'], false, {
    modelDirectories: { directoryFor: vi.fn(() => directory) },
    conversation: draftFace,
  })
  composer()
  vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('capability unavailable') }))
  await armTakeover()
  bench.input.addImages(['unknown-native'])
  for (const listener of listeners) listener()
  await flushTasks()

  expect(bench.input.state.getSnapshot().imageIds).toEqual([])
  expect(bench.input.state.getSnapshot().occurrences).toHaveLength(1)
  expect(draftFace.releaseDraftImages).toHaveBeenCalledTimes(1)
  expect(bench.input.notify).toHaveBeenCalledWith(
    'error',
    expect.stringContaining('text-safe fallback'),
  )
  bench.dispose()
})
```

- [ ] **Step 5: Run client tests and verify the expected red failures**

Run:

```bash
pnpm exec vitest run tests/paste-images-client.spec.ts -t "promotes a live bridge|final text migration|unknown"
```

Expected: bridge→native fails because no promotion path exists; the delayed-selection test fails because the existing Promise map returns the old task; the new unknown expectation fails because current code leaves native ids unchanged. Stop here until the failure causes are visible.

---

### Task 3: Implement the per-session scheduler and bidirectional migrations

**Files:**
- Modify: `src/client/paste-images.tsx`
- Modify: `tests/paste-images-client.spec.ts` only when a failing test needs a contract fixture correction discovered in Task 2

**Interfaces:**
- Consumes: `ModelPick`, `PasteRecord`, `DraftMediaAttachment`, `ConversationDraftFace`, input `state`, `insertReference`, `insertText`, `addImages`, `removeImage`.
- Produces: private methods `requestDraftReconciliation(sessionId: string): void`, `runDraftReconciliation(sessionId: string, state: ReconcileState): Promise<void>`, `promoteBridgeDraftToNative(sessionId: string, input: ReturnType<PasteImageController['inputFor']>, expectedSelectionKey: string): Promise<boolean>`, and CAS-aware `bridgeNativeDraft(...): Promise<boolean>`.
- The migration helpers have these exact signatures and responsibilities: `bridgeFilesForCurrentDraft(sessionId: string, input: ReturnType<PasteImageController['inputFor']>): Array<{ ref: string; file: File }>`, `admitBridgeFilesAsNative(input: ReturnType<PasteImageController['inputFor']>, files: readonly { ref: string; file: File }[]): Promise<{ ids: readonly string[]; attachments: readonly DraftMediaAttachment[] } | undefined>`, `admitBridgeFilesByReplay(input: ReturnType<PasteImageController['inputFor']>, files: readonly { ref: string; file: File }[]): Promise<{ ids: readonly string[]; attachments: readonly DraftMediaAttachment[] } | undefined>`, `selectionStillCurrent(sessionId: string, expectedSelectionKey: string, input: ReturnType<PasteImageController['inputFor']>): boolean`, `removeAdmittedImages(input: ReturnType<PasteImageController['inputFor']>, ids: readonly string[], attachments: readonly DraftMediaAttachment[]): void`, `removePromotedOccurrences(sessionId: string, input: ReturnType<PasteImageController['inputFor']>, refs: readonly string[]): boolean`, and `detachPromotedPreviews(sessionId: string, input: ReturnType<PasteImageController['inputFor']>, refs: readonly string[]): void`.

- [ ] **Step 1: Add the latest-wins state types and replace the Promise map**

Near `VerdictEntry`, add:

```ts
interface ReconcileState {
  generation: number
  dirty: boolean
  running: boolean
}
```

Replace:

```ts
private readonly subscribedDirectories = new Set<string>()
private readonly reconciliations = new Map<string, Promise<void>>()
```

with:

```ts
private readonly subscribedDirectories = new Set<string>()
private readonly directoryUnsubscribes = new Map<string, () => void>()
private readonly reconciliationStates = new Map<string, ReconcileState>()
```

Change the store callback in `subscribeDirectory()` to flush the verdicts, prefetch the latest selection, and call `requestDraftReconciliation(sessionId)`. Store the returned unsubscribe in `directoryUnsubscribes`; do not subscribe twice for one session.

- [ ] **Step 2: Implement the scheduler before the migration logic**

Add the following control flow, keeping the actual migration in `reconcileCurrentDraft()`:

```ts
private requestDraftReconciliation(sessionId: string): void {
  const state = this.reconciliationStates.get(sessionId) ?? { generation: 0, dirty: false, running: false }
  state.generation += 1
  state.dirty = true
  this.reconciliationStates.set(sessionId, state)
  if (state.running) return
  state.running = true
  void this.runDraftReconciliation(sessionId, state)
}

private async runDraftReconciliation(sessionId: string, state: ReconcileState): Promise<void> {
  try {
    while (state.dirty) {
      state.dirty = false
      const generation = state.generation
      await this.reconcileCurrentDraft(sessionId, generation)
      if (state.generation !== generation) state.dirty = true
    }
  } catch (error) {
    console.warn('dsh-vision-cloud could not reconcile draft images with the selected model', error)
  } finally {
    state.running = false
    if (state.dirty) this.requestDraftReconciliation(sessionId)
  }
}
```

`reconcileCurrentDraft()` must obtain the current `ModelPick`, compute `verdictKey`, read the input in a try/catch, await `refreshVerdict`, then re-check both the current key and the current session before any migration. A missing key or missing verdict is unknown/text-safe, not confirmed image.

- [ ] **Step 3: Make no-model and unknown verdicts conservative**

In `refreshVerdict()`, change the no-key result from `Promise.resolve(false)` to `Promise.resolve(undefined)`. Keep `syncTakeover()` returning `undefined` for no model signal so paste/drop remains held and text-safe.

In `guardedSubmit()`, do not forward a native id directly when `key === undefined`; route the ids through the same `bridgeNativeDraft()` path and release the submit only after bridge insertion succeeds. If the draft-image surface cannot supply a File, keep the submit held and notify instead of sending an unconfirmed native image.

- [ ] **Step 4: Refactor native-to-bridge migration to use source-preserving CAS**

Keep the public method signature used by the submit guard:

```ts
private async bridgeNativeDraft(
  sessionId: string,
  input: ReturnType<PasteImageController['inputFor']>,
  imageIds: readonly string[],
  admitPreviews = true,
  expectedSelectionKey?: string,
): Promise<boolean>
```

Implement the following order:

1. Filter `nativePreviews` ids and read `conversation.draftImages(nativeIds)`.
2. Clone and validate every File.
3. Snapshot the current draft and strip only plugin-owned leaked bridge markup when present. If the snapshot no longer contains all requested native ids, return false.
4. Create the bridge batch and call `insertExistingRefs()` while retaining the original native ids.
5. Re-check `expectedSelectionKey` (when provided), session id, phase, and that every original native id still exists. If the check fails, remove the just-inserted occurrences using their current offsets, delete only the newly owned records, and leave native ids untouched.
6. Call `removeImage()` for each original native id only after the check passes; then release the original draft attachments.
7. Call `changed()` through the existing insertion/cleanup path so the dock and reference consumers re-render immediately.

The submit guard passes `admitPreviews = false`; normal selection reconciliation may preserve the existing DISPLAY_PREVIEW UI policy. A failed `createDraftImages`/`draftImages`/`removeImage` surface must leave the source representation intact and emit a user-visible error.

- [ ] **Step 5: Implement bridge-to-native promotion with feature detection**

Add these two private methods, so the public draft-image path and the legacy fallback have explicit return contracts:

```ts
private async promoteBridgeDraftToNative(
  sessionId: string,
  input: ReturnType<PasteImageController['inputFor']>,
  expectedSelectionKey: string,
): Promise<boolean> {
  const files = this.bridgeFilesForCurrentDraft(sessionId, input)
  if (files.length === 0) return false
  const admitted = await this.admitBridgeFilesAsNative(input, files)
  if (admitted === undefined) return false
  if (!this.selectionStillCurrent(sessionId, expectedSelectionKey, input)) {
    this.removeAdmittedImages(input, admitted.ids, admitted.attachments)
    return false
  }
  if (!this.removePromotedOccurrences(sessionId, input, files.map(entry => entry.ref))) {
    this.removeAdmittedImages(input, admitted.ids, admitted.attachments)
    return false
  }
  this.detachPromotedPreviews(sessionId, input, files.map(entry => entry.ref))
  return true
}

private async admitBridgeFilesAsNative(
  input: ReturnType<PasteImageController['inputFor']>,
  files: readonly { ref: string; file: File }[],
): Promise<{ ids: readonly string[]; attachments: readonly DraftMediaAttachment[] } | undefined> {
  const face = this.conversationDraftService()
  const shell = input as unknown as { addImages?: (ids: readonly string[]) => boolean }
  if (typeof face?.createDraftImages === 'function' && typeof shell.addImages === 'function') {
    const attachments = face.createDraftImages(files.map(entry => entry.file))
    if (attachments.length !== files.length) {
      face.releaseDraftImages?.(attachments)
      return undefined
    }
    const ids = attachments.map(attachment => attachment.id)
    if (!shell.addImages(ids) || !ids.every(id => input.state.getSnapshot().imageIds.includes(id))) {
      face.releaseDraftImages?.(attachments)
      return undefined
    }
    return { ids, attachments }
  }
  return this.admitBridgeFilesByReplay(input, files)
}
```

`admitBridgeFilesByReplay()` must synchronously dispatch the same guarded paste fallback used by `releaseNatively()`, compare `imageIds` before and after dispatch, and return `undefined` when no new id can be confirmed. It must never delete a bridge occurrence on exception alone. The implementation must satisfy this exact public-path feature check:

```ts
const face = this.conversationDraftService()
const shell = input as unknown as {
  addImages?: (ids: readonly string[]) => boolean
  removeImage?: (id: string) => void
}
if (typeof face?.createDraftImages !== 'function' || typeof shell.addImages !== 'function') {
  return this.admitBridgeFilesByReplay(input, files)
}
```

For the public path:

- collect only `recordsFor(occurrences)` whose batch session equals `sessionId` and whose `records.get(ref)` is the same object;
- call `face.createDraftImages(files)` as a receiver method, require one attachment per record, then call `shell.addImages(ids)`;
- verify all new ids are in `input.state.imageIds`, the current selection key still equals `expectedSelectionKey`, and every target occurrence still exists;
- only after those checks remove the bridge occurrence/reference with current `draftRev`/offset, detach the old DISPLAY_PREVIEW id for the same ref, and retain the new native id;
- `removePromotedOccurrences()` must use a fresh occurrence lookup and direct input CAS rather than the public `remove()` wrapper, because `remove()` intentionally refuses records whose batch is currently uploading; an in-flight bridge copy may finish its existing request, but it must not prevent the draft migration or recreate the occurrence;
- on any failure release newly created attachments, remove any newly admitted ids if possible, and leave the bridge record/occurrence and old preview intact.

If the public image APIs are absent, reuse the current synthetic `releaseNatively()` fallback only when a before/after `imageIds` comparison proves that native admission happened. Otherwise leave bridge intact. Never delete an occurrence based solely on the absence of an exception.

- [ ] **Step 6: Reconcile both directions from one current snapshot**

Replace the existing `reconcileDraftMedia()` body with a call from `reconcileCurrentDraft()` that computes:

```ts
const snapshot = input.state.getSnapshot()
const previewIds = new Set(/* current-session nativePreviews */)
const nativeIds = snapshot.imageIds.filter(id => !previewIds.has(id))
const bridgeRecords = this.recordsFor(occurrencesOf(snapshot)).filter(record => record.batch.sessionId === sessionId)
```

Then apply:

```text
verdict === false -> promoteBridgeDraftToNative when bridgeRecords exist
verdict !== false  -> bridgeNativeDraft when nativeIds exist
```

The current selection key must be passed into either migration. A selection with no key or an unavailable GET never calls the promotion path. A draft containing both representations must converge to exactly one direction; DISPLAY_PREVIEW ids are cleaned separately and are never fed back into native-to-bridge.

- [ ] **Step 7: Keep UI and lifecycle state synchronized**

After successful insertion/removal, publish through the existing controller `changed()` and input state mutations; do not rely only on a React component’s local effect. Ensure `subscribeDirectory()` disposers are invoked by a controller cleanup method registered from the `ctx.effect()` cleanup in `installPasteImages()`:

```ts
for (const unsubscribe of this.directoryUnsubscribes.values()) unsubscribe()
this.directoryUnsubscribes.clear()
this.reconciliationStates.clear()
```

Do not remove either `ctx.inject(['slash'], ...)` or `ctx.inject(['inputTriggers'], ...)` registration.

- [ ] **Step 8: Run the client regression tests**

Run:

```bash
pnpm exec vitest run tests/paste-images-client.spec.ts
```

Expected: A–F, existing rc8 inline occurrence tests, submit guard tests, preview cleanup tests, route retry tests, and both trigger-service compatibility tests pass.

- [ ] **Step 9: Commit the client state-machine change**

```bash
git add src/client/paste-images.tsx tests/paste-images-client.spec.ts
git commit -m "fix: reconcile draft media for latest model selection"
```

---

### Task 4: Strengthen rc6/rc7/rc8 contract coverage and compatibility documentation

**Files:**
- Modify: `tests/model-capability.spec.ts` only if a new resolver shape test is needed
- Modify: `tests/compatibility-contract.spec.ts`
- Modify: `tests/paste-images-client.spec.ts` for missing-surface fallback coverage
- Modify: `docs/compatibility-matrix.md`

**Interfaces:**
- Consumes: public feature-shaped fixtures; no version-based production branch.
- Produces: explicit automated evidence for rc6 legacy APIs, rc7 catalog fallback, rc8 model-directory selection and missing draft-image surfaces.

- [ ] **Step 1: Add the failing missing-surface compatibility test**

Add a test that creates `fakeClient()` without `modelDirectories` and without `conversation` draft-image methods, pastes a file through the existing bridge path, and asserts the source codec remains registered and serializes the record. Add a second assertion that a model-directory service whose `directoryFor()` throws falls back to the DOM label and does not throw.

Use this concrete shape:

```ts
it('keeps the rc6 bridge path alive when newer selection and draft-image surfaces are absent', async () => {
  const bench = fakeClient('', ['slash'])
  composer()
  await armTakeover()
  const textarea = document.querySelector<HTMLTextAreaElement>('[data-composer-card] textarea')
  if (textarea === null) throw new Error('composer textarea missing')
  textarea.dispatchEvent(clipboardEvent('', [file('rc6.png', 'image/png', [1])]))
  await flushTasks()

  const occurrence = bench.input.state.getSnapshot().occurrences[0]
  if (occurrence === undefined) throw new Error('bridge occurrence missing')
  const codec = bench.source()?.codec
  if (codec === undefined) throw new Error('legacy trigger source missing')
  await expect(codec.serialize(occurrence.ref, new AbortController().signal)).resolves.toContain('rc6.png')
  bench.dispose()
})
```

Add an rc8-shaped fixture in `tests/compatibility-contract.spec.ts` that provides `modelDirectories.directoryFor(sessionId).store.getSnapshot().current` with `{ provider, model }` and a `subscribe()` method; assert the fixture is shape-tolerant without importing a release-specific package.

- [ ] **Step 2: Run the compatibility tests and inspect the contract result**

Run:

```bash
pnpm exec vitest run tests/compatibility-contract.spec.ts tests/model-capability.spec.ts tests/paste-images-client.spec.ts -t "rc6|rc7|rc8|surface|catalog|directory"
```

Expected: the new contract assertions either pass with the Task 3 feature-detected implementation or fail with an actual missing API guard; do not weaken assertions to hide a runtime throw. If all of these tests already pass, make no production change in this task and continue with the documentation evidence.

- [ ] **Step 3: Make only compatibility-preserving production adjustments**

If the red test identifies a production gap, keep the fix structural:

- guard `ctx.get`, `modelDirectories`, `directoryFor`, `store.getSnapshot`, and `store.subscribe` by method presence;
- call `resolveModelInfo` with two arguments when no signal was supplied and with three when a signal was explicitly supplied, preserving `tests/model-capability.spec.ts` expectations;
- use exact `listModels()` entries only after resolver failure;
- retain legacy bridge insertion when draft-image APIs are absent;
- retain both trigger service registrations and the `registryIdentity()` de-duplication.

Do not add a release string, numeric comparison, or test-name-based production behavior.

- [ ] **Step 4: Run all compatibility-focused tests**

Run:

```bash
pnpm exec vitest run tests/compatibility-contract.spec.ts tests/model-capability.spec.ts tests/file-references.spec.ts tests/paste-images-client.spec.ts
```

Expected: all rc6/rc7/rc8 contract fixtures pass under the installed rc6 dependency floor.

- [ ] **Step 5: Update the compatibility matrix with evidence**

Add rows to `docs/compatibility-matrix.md` stating:

```text
- bridge occurrences with a held File promote to native only on confirmed image capability;
- native draft ids demote immediately on text/unknown selection, before submit;
- native-only image assembly removes vision_cloud_tool schema, section, and context;
- image+path/URL assembly retains the tool for external inputs;
- rc7/rc8 evidence is feature-shaped contract coverage unless a real runtime is installed.
```

Do not state that real rc7/rc8 GUI/E2E passed when only fixtures ran.

- [ ] **Step 6: Commit compatibility coverage**

```bash
git add tests/compatibility-contract.spec.ts tests/model-capability.spec.ts tests/paste-images-client.spec.ts docs/compatibility-matrix.md
git commit -m "test: cover bidirectional media rc compatibility"
```

---

### Task 5: Full verification and final review

**Files:**
- Inspect all changed files and git diff; no new production file is expected.

**Interfaces:**
- Consumes: commits from Tasks 1–4.
- Produces: fresh build/test/typecheck/portable evidence and an explicit rc6/rc7/rc8 verification boundary.

- [ ] **Step 1: Run the focused regression suites**

```bash
pnpm exec vitest run tests/prompt-assembly.spec.ts tests/paste-images-client.spec.ts
```

Expected: zero failures, including tests that do not call `submit()` for model-switch migrations.

- [ ] **Step 2: Run the full unit suite**

```bash
pnpm test
```

Expected: Vitest exits with code 0 and reports zero failed tests.

- [ ] **Step 3: Run the compatibility suite**

```bash
pnpm test:compat
```

Expected: the configured compatibility contract files pass under the installed rc6 surface.

- [ ] **Step 4: Run TypeScript builds and no-emit checks**

```bash
pnpm build
pnpm exec tsc -p tsconfig.json --noEmit
pnpm exec tsc -p tsconfig.client.json --noEmit
pnpm exec tsc -p tsconfig.client.public.json --noEmit
```

Expected: all commands exit 0; `pnpm build` produces host/client artifacts through the package’s existing build pipeline.

- [ ] **Step 5: Run portable verification and forbidden-version checks**

```bash
pnpm verify:portable
git diff --check
git grep -n -E "0\\.1\\.0-rc|rc[.]?[678]|dshVersion|semver" -- src || true
```

Expected: portable verification and diff check exit 0; the final grep has no release-branch production matches. Version labels may remain in tests/docs.

- [ ] **Step 6: Inspect the final diff for scope and race safety**

```bash
git status --short --branch
git diff HEAD~3..HEAD --stat
git diff HEAD~3..HEAD -- src/client/paste-images.tsx src/prompt-assembly.ts tests/paste-images-client.spec.ts tests/prompt-assembly.spec.ts
```

Confirm manually from the diff:

- no `setTimeout`/fixed delay/repeated click was added for reconciliation;
- no submit test is used to prove normal model-switch UI migration;
- old tasks check latest selection before destructive mutation;
- bridge admission precedes bridge occurrence deletion;
- native bridge creation precedes native id deletion;
- preview ids never enter native-to-bridge source ids;
- native-only assembly removes actual schema entries, not just system text;
- `ctx.slash` and `inputTriggers` remain present.

- [ ] **Step 7: Record the verification boundary**

Final report must distinguish:

```text
rc6: actual installed dependency build/tests and legacy fallback evidence
rc7: feature-shaped resolver/catalog contract evidence; real runtime only if available
rc8: feature-shaped modelDirectories/inline occurrence/draft API evidence; real GUI/E2E only if available
```

If rc7/rc8 real Harness packages are unavailable, state that explicitly and do not claim full runtime compatibility beyond the tested public shapes.
