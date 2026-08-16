# dsh-vision-cloud 全场景真实测试案例

> 覆盖方案 ①–⑥ 的验收测试。所有"真实场景"均基于当前运行实例实测：
> 插件 `dsh-vision-cloud@0.1.7`（安装副本与工作区 `lib/` 哈希一致）、DSH Web GUI
> `http://127.0.0.1:57053`、工作区 `D:\code\ai\dsh-vision-toolkit`。
>
> 用例分层：
> - **R 系列**：缺陷复现/回归（当前版本按实测行为应为 ❌，修复后转 ✅；已附当前版本实测证据）
> - **E 系列**：真实运行时手工 E2E 全场景矩阵（在 Web GUI 里实际操作）
> - **A 系列**：自动化用例（`tests/`，可直接落库；标注所属修复编号与红绿状态）
>
> **方案2 落地记录（2026-08-15）**：显示层不再依赖消息 markdown 渲染器，改为插件以 **priority -1 阴影注册**
> `conversation.chat.node` 槽位的 `user`/`steering` 两个 key（DSH 槽位规则：同 key 最低优先级渲染；注册出错即让位给产品视图）。
> 阴影视图复刻产品 `UserStyleBubble`（原生图走 `loadImage` 大图、`/skill` `@agent` 引用芯片、JsonBlock 附加块、复制/时间操作行），
> 并把桥接标记（绝对路径行 + `![name](<file-route>)`）渲染为真实图片、隐藏路径文本——文本模型照旧拿到路径调 `vision_cloud_tool`，
> 多模态模型照旧走原生直看。绑定缺陷（`createDraftImages` 失 `this` 崩溃）同步修复。L3 的"回退方案"已转为正式实现，见 3.8。

---

## 0. 测试环境基线（2026-08-15 实测）

### 0.1 官方模型能力表（来源：live `GET /_dsh/vision-cloud/settings`）

| provider | model id | inputModalities | 测试角色 |
| --- | --- | --- | --- |
| deepseek-official | deepseek-v4-flash | `[text]` | 文本代表 |
| deepseek-official | deepseek-v4-pro | `[text]` | 文本代表 |
| abrdns | DeepSeek-V4-Flash-0731 | `[text]` | 文本代表 |
| abrdns | DeepSeek-V4-Pro-0813 | `[text]` | 文本代表 |
| bohe | deepseek-v4-flash-0731 / glm-5.2 | `[text]` | 文本代表 |
| abrdns | Qwen3.8-Max / Kimi-K3 | `[text, image]` | 多模态代表 |
| tabitoken | claude-opus-4-8 / claude-opus-5（及 thinking） | `[text, image]` | 多模态代表 |
| agnes-ai | Agnes 2.0/2.5 Flash | `[text, image]` | 多模态代表 |

> 用例中固定用 **`DeepSeek-V4-Pro-0813`（文本，A）** 与 **`Qwen3.8-Max`（多模态，M）** 代表两类模型；必要时换用同角色模型复测。

### 0.2 插件配置基线

- `vision-cloud.model = agnes-ai / agnes-2.5-flash`（reasoningEffort max，language en）——插件启用，`vision_cloud_tool` 已注册，系统提示段已注入
- `pasteToPath = true`（桥接开启）

### 0.3 证据点位（每条用例都标出"在哪看结果"）

| 观察点 | 位置/方法 |
| --- | --- |
| 裁决接口 | `GET /_dsh/vision-cloud/paste-images?sessionId=<id>&model=<label>&(provider=&model=)`，返回 `{"takeover":bool}` |
| 桥接上传证据 | 工作区 `.dsh-vision-cloud\tmp\pasted-images\<sha256(sessionId)前20位>\<uuid>-<filename>` 出现新文件 |
| 消息形态 | 会话气泡里是**图片缩略图**还是 `[pasted image: xxx.png]` / 路径文本 |
| 工具调用 | 会话中出现 `vision_cloud_tool` 调用卡片（有 = 调工具；无 = 模型直接看图） |
| 模型回答 | 内容是否基于图片（如描述图片主体），还是回复"请上传 png"等提示语 |
| 设置联动 | 视觉云设置页切换模型后 badge 状态、测试读取结果 |
| 裁决实测基线 | 见 R2 内"当前版本实测"表（修复前的错误行为已被抓取） |

### 0.4 快速判定命令（PowerShell）

```powershell
# 1) 裁决接口判定（把 sessionId 换成当前会话）
$base='http://127.0.0.1:57053'
Invoke-RestMethod "$base/_dsh/vision-cloud/paste-images?model=Qwen3.8-Max"
Invoke-RestMethod "$base/_dsh/vision-cloud/paste-images?sessionId=<当前会话id>&model=Qwen3.8-Max"

# 2) 桥接上传证据
Get-ChildItem -Recurse .dsh-vision-cloud\tmp\pasted-images -File | Select-Object LastWriteTime, FullName

# 3) 模型能力表
(Invoke-RestMethod "$base/_dsh/vision-cloud/settings").value.providers | ForEach-Object {
  $_.models | ForEach-Object { "$($_.id) => $($_.inputModalities -join ',')" }
}
```

---

## 1. R 系列：缺陷复现/回归用例（当前版本 ❌ → 修复后 ✅）

每条含：布置 → 操作步骤 → 【当前版本实际表现（含判据）】 → 【修复后预期】 → 方案锚点。

### R1 先多模态发过消息 → 切文本 → 粘贴图片：应桥接，实际弹 PNG 提示（对应问题 1）

- **布置**：会话当前模型 = A（文本）；插件 pasteToPath=true。
- **步骤**：
  1. 切换模型为 M（多模态），发送任意一条消息（制造 `request/context` 事件）；
  2. 切换模型为 A（文本），**不发送**；
  3. 在输入框粘贴一张 png 截图。
- **当前版本实际**：裁决用会话 `requestContext()`（仍是 M），返回 `takeover:false` → 不拦截 → 原生附件发送给文本模型 → DSH 拒绝，弹
  "当前模型不支持图片，请切换支持图片的模型"（`MODEL_DOES_NOT_SUPPORT_IMAGES`）或 "仅支持 PNG、JPG、WebP、GIF 格式的图片"（`image.unsupportedType`）。
  证据：该"仅支持 PNG…"字符串存在于 DSH `dsh-client-ui-conversation` 包（zh/en 文案 `image.modelUnsupported` / `image.unsupportedType`）。
- **修复后预期**：粘贴即桥接 → 出现图片芯片（带缩略图）→ 发送后消息含绝对路径 → AI 调用 `vision_cloud_tool` 正常回答；不出现任何 PNG/不支持提示。
- **方案锚点**：①（裁决优先级）+ ②（客户端给显式 provider/model）+ ⑤（显示）。

### R2 先文本发过消息 → 切多模态 → 粘贴图片：应原生，实际误桥接（对应问题 2 的前半）

- **步骤**：1. 模型 A 发一条消息；2. 切到 M，不发送；3. 粘贴一张 png。
- **当前版本实测**（对 live 裁决接口抓取，2026-08-15）：

  | 请求 | 实测返回 | 判定 |
  | --- | --- | --- |
  | `?model=Qwen3.8-Max`（无 sessionId） | `{"takeover":false}` | ✅ |
  | `?sessionId=<当前会话>&model=Qwen3.8-Max` | `{"takeover":true}` | ❌ 应为 false |
  | `?sessionId=<当前会话>&model=DeepSeek-V4-Pro-0813` | `{"takeover":true}` | ✅ |
  | `?sessionId=<bogus>&model=Qwen3.8-Max` | `{"takeover":false}` | ✅（标签兜底生效） |

  原因：宿主 `takeoverVerdict` 一旦查到会话就用 `requestContext()`（最后一条 `request/context` 事件 = 旧模型 A）覆盖客户端标签 → 把 M 误判为文本 → 桥接。
- **当前版本表现**：粘贴被桥接成 `[pasted image: xxx.png]` → 消息里只有路径文本，M 看不到图 → 只能又调用 `vision_cloud_tool`（"多模态模型还是调用工具"）。
- **修复后预期**：裁决以**当前选择** M 为准 → `takeover:false` → 原生附件、气泡显示图片 → 模型直接看图回答，**不出现** `vision_cloud_tool` 调用卡片。
- **方案锚点**：①②。自动回推：R2 的表格即 A3/A4 用例预期。

### R3 多模态模型首次粘贴（裁决未决竞态）：应原生，实际被兜底桥接（对应问题 2 的后半）

- **步骤**：1. 刚打开页面 / 刚切换模型到 M（裁决缓存未命中或 pending）；2. 立即 Ctrl+V 粘贴图片（不先点输入框触发 focusin 预取）。
- **当前版本实际**：`shouldTakeover` 对"未决/无缓存"兜底返回 `true`（客户端空缓存 60 秒 `VERDICT_MAX_AGE_MS` 后同样复现）→ 首次粘贴被桥接 → M 收不到图 → 调用工具。
- **修复后预期（③ 拦下-问清-再决定）**：裁决未知时 `preventDefault` → 异步取裁决 → M：合成 paste 事件重放给原生处理器（图片正常显示，模型直接看图）；A：走桥接。**任何时机粘贴都不再错**。
- **方案锚点**：③。

### R4 文本模型桥接后：图片全程不可见（对应问题 3）

- **步骤**：模型 = A；粘贴 png → 发送。
- **当前版本实际**：输入区芯片只显示文件名（无缩略图）；消息气泡只有
  `[Pasted image available at absolute path: "..."]`；`vision_cloud_tool` 结果只渲染 JSON 文本。全程看不到图片本身。
- **修复后预期（⑤，方案2 阴影渲染实现）**：芯片显示 local blob 缩略图；`serialize` 输出"绝对路径文本 + `![文件名](/_dsh/vision-cloud/paste-images/file?…)`"，消息气泡由插件阴影渲染器显示为**大图网格 + 干净文字**（路径文本对模型保留、对显示隐藏）；文本模型仍拿到路径并调用工具回答。
- **方案锚点**：⑤（现由 3.8 阴影渲染器承载）。

### R5 多模态模型收到原生图片仍调用工具（对应问题 2 的提示部分）

- **步骤**：模型 = M（确保原生图片成功进入消息）；发送一张图 + "描述这张图"。
- **当前版本实际**：系统提示段（插件启用即注入，无条件）："To read or analyze an image … use the vision_cloud_tool …" → 模型照做，调用工具产生额外一次 LLM 请求。
- **修复后预期（④）**：提示改为能力条件式（"消息里你能直接看到图片时直接看图，**不要**调用 vision_cloud_tool"；**仅当图片不直接可见时**——纯文本模型、以及任何模型面对 URL/工作区路径/附件 id——才调用工具）→ M 收到原生图直接回答，无工具调用卡片；A 场景、M+URL 场景（E20）仍正常调用。
- **方案锚点**：④。

### R6 桥接路由 404 一次 → 永久失效（韧性）

- **步骤**：在无 `webServer` 的 profile（或断连）下：文本模型下粘贴图片一次（GET 裁决 404）→ 恢复连接 → 再粘贴。
- **当前版本实际**：`routeAvailable` 被永久置 `false`，此后所有粘贴走原生 → 文本模型弹 PNG 提示，且无任何插件级说明。
- **修复后预期（⑥）**：限频重试（如每 30s 一次机会）而非永久关闭；持续不可用时 `input.notify` 明示"图片桥不可用，图片将按原生方式发送"。
- **方案锚点**：⑥。

---

## 2. E 系列：真实运行时手工 E2E 全场景矩阵

> 执行环境 = 本文档 0 章基线。代表模型：**A（文本）= DeepSeek-V4-Pro-0813；M（多模态）= Qwen3.8-Max**。
> "当前版本"列按 R 系列实测结论填写（修复前执行该矩阵即复现三个缺陷）。

| ID | 场景 | 操作步骤 | 观察点与预期（修复后） | 当前版本 | 自动映射 |
| --- | --- | --- | --- | --- | --- |
| E1 | 文本+单图粘贴 | A 下粘贴 png 截图 → 发送"描述这张图" | 芯片带缩略图；消息=路径文本+图片；AI 调 `vision_cloud_tool` 且回答基于图片 | 芯片无图、可能弹 PNG 提示 | A5/A8/A10 |
| E2 | 文本+多图粘贴 | A 下同时粘贴 png+jpg+webp（3 张） | 3 芯片；发送后工具一次读 3 图；`.dsh-vision-cloud/tmp/pasted-images` 新增 3 文件 | 同上 | A5（复用到现有多图用例） |
| E3 | 文本+拖拽多图 | A 下拖 2 张图入输入框 | 同粘贴桥接；原生 drop 处理器未被触发（无原生附件） | 同上 | A6 |
| E4 | 文本+非白名单格式 | A 下粘贴 .bmp / .svg 图片 | 桥接受理并写入 `.bmp/.svg` 文件；发送后工具报 `unsupported image format`（已知限制，见第 5 章） | 同左（文档化行为） | A7 |
| E5 | 多模态+粘贴 | M 下粘贴 png → 发送 | 原生图片显示在输入框与气泡；模型直接看图作答；**无** `vision_cloud_tool` 卡片 | 常被误桥接或调工具（R2/R3） | A3/A4/A9 |
| E6 | 多模态+拖拽 | M 下拖图入框 | 原生附件 | 同 E5 | A3/A4/A9 |
| E7 | 切换序：多→文 | M 发过消息 → 切 A → 粘贴 | 见 R1（桥接生效，无 PNG 提示） | ❌ R1 | A2/A3 |
| E8 | 切换序：文→多 | A 发过消息 → 切 M → 粘贴 | 见 R2（原生，无工具调用） | ❌ R2（实测裁决错误） | A2/A3/A4 |
| E9 | 切换序：多→多 / 文→文 | 同类模型间切换后粘贴 | 多→多原生；文→文桥接；裁决与当前选择一致 | 首次粘贴可能撞 60s 缓存竞态（R3） | A2/A3 |
| E10 | 切换后未发送即粘贴 | 任意切换 → 不发送 → 粘贴 | 裁决=当前选择（客户端显式 provider/model + 模型目录订阅，`requestContext` 过期不影响） | 依赖过期 requestContext | A2/A3/A4 |
| E11 | 原生图挂草案再切文本 | M 下粘贴（原生附件留存）→ 切 A → 直接发送 | DSH 自身行为：发送被拒并弹不支持提示（插件无法转换既有附件，第 5 章）。文档化缓解：删除附件行重新粘贴即可走桥接 | 同左 | — |
| E12 | pasteToPath=false | 关闭桥接，A/M 下粘贴 | 全程原生路径：M 正常；A 按 DSH 原生行为弹提示（符合预期） | 同左 | A1 |
| E13 | URL 图片读取 | 对 A 说"读 https://…/x.png 描述" | 工具接受并以 .png/.jpg/.jpeg/.gif/.webp 直链读取；非图片 URL（API/HTML/json）在发起网络前被拒 | 同左 | 现有 `runtime-url-guard.spec.ts` |
| E14 | 附件 id 读取 | M 会话中原生图发送后，对 A 用 `sha256:…` id 读图 | 工具从会话历史解析附件并读取 | 同左 | A11 |
| E15 | 消息气泡图片具备授权边界 | 修复⑤后：A 下桥接发送的图片 | 同会话可查看 `/_dsh/vision-cloud/paste-images/file`；**跨会话 404、目录穿越 400** | 无此路由 | A12–A15 |
| E16 | 系统提示条件化 | M 下带图提问（E5）与 A 下带图提问（E1）各一 | M 直接看图作答（3 次复测 ≥2 次不调用工具；④ 是提示级软约束，偶发违规属模型行为、不判插件缺陷但需记录）；A 正常调工具；**M+URL 图仍调工具（E20）** | M 也调工具 | A9 + 提示文案断言 |
| E17 | 设置联动 | 设置页切换视觉模型 off→agnes→off | 工具注册/注销随之切换；"测试读取"成功/失败提示正确 | 同左 | 现有 config/web 用例 + A16 |
| E18 | 路由不可用告警 | 停掉 web 路由后在 A 下粘贴 | 限频重试；若仍不可用，通知用户"桥不可用"（不再永久静默失效） | 永久静默失效（R6） | A17 |
| E19 | 上限与失败反馈 | A 下粘贴 21 张图 / 超 maxImageBytes 的图 | 芯片 error、`notify` 报错、草案回滚（现有行为，回归确认） | 同左 | 现有 `paste-images-client.spec.ts` |
| E20 | 多模态+URL/附件图片（v2 补） | M 下让 AI"读 https://…/x.png 描述" | M 无法"看到"URL 内容，**仍必须**调用 `vision_cloud_tool` 读取并作答（④ 措辞保留 URL/路径例外，A9 断言之） | 同左（防止 ④ 误杀） | A9 例外断言 |
| E21 | 子代理会话粘贴（v2 补） | 子代理会话输入框粘贴图片 | 子代理文本模型走上桥接（`modelDirectories` 对子代理抛错/`subagentAddress` 非空时依次回退：DOM 标签 → session requestContext） | ② 未容错会白屏/走原生被拒 | A2 新增回退断言 |

**E 系列通过标准（DoD）**：
1. E1–E10、E15–E21 全部符合"观察点与预期"列；
2. E7/E8（问题 1/2 的直接复现路径）不再出现任何 R 系列现象；
3. 全过程中 `.dsh-vision-cloud/tmp/pasted-images` 新文件时间戳与桥接操作一一对应（桥接发生时必有文件，未桥接时无文件）；
4. 每条用例留证据：裁决接口返回值 / 截图（芯片、气泡、卡片）/ 粘贴目录列表。

---

## 3. A 系列：自动化用例（落入 `tests/`）

> 基线命令：`pnpm test`（`vitest run tests`）。客户端用例 `@vitest-environment jsdom`，复用
> `tests/paste-images-client.spec.ts` 已有 `fakeClient/composer/file/clipboardEvent/armTakeover` 工装。
> 红绿状态：❌=当前版本失败（复现缺陷，修复后转绿）；✅=可直接通过。

### A 编号索引（E 表"自动映射"列在此对应）

| 编号 | 用例 | 落点 | 状态 |
| --- | --- | --- | --- |
| A1 | pasteToPath=false 时裁决/上传路由 404，粘贴走原生 | `paste-images.spec.ts` | ✅ 现有行为，回归确认 |
| A2 | 模型目录订阅：切换模型 → 清裁决缓存 + 立即预取 | `paste-images-client.spec.ts` | ✅ |
| A3 | 显式 provider/model 优先于过期 requestContext（3.1 第一则） | `paste-images.spec.ts` | ✅（R2 炸点已修复） |
| A4 | 标签/目录兜底扫描（3.1 第二、三、四则） | `paste-images.spec.ts` | ✅ |
| A5 | serialize = 绝对路径 + markdown 内联图（3.5） | `paste-images-client.spec.ts` | ✅ |
| A6 | 文本模型下拖拽走桥接、原生 drop 未触发 | 现有 drop 用例 | ✅ 现有 |
| A7 | image/bmp、image/svg 桥接落盘行为（E4/L2） | `paste-images.spec.ts` | ✅ 现有行为，回归确认 |
| A8 | 只读文件路由 200 + 正确 media type + nosniff（3.2 第一则） | `paste-images.spec.ts` | ✅ |
| A9 | 系统提示文案断言（3.7） | `system-prompt.spec.ts` 新文件 | ✅ |
| A10 | 芯片缩略图渲染 + objectURL revoke（3.5 第二则） | `paste-images-client.spec.ts` | ✅ |
| A11 | 会话历史附件 id（`sha256:…`）解析读取 | 现有 runtime/粘贴用例 | ✅ 现有 |
| A12 | 文件路由目录穿越拒绝（3.2 第二则） | `paste-images.spec.ts` | ✅ |
| A13 | 跨会话文件私有（3.2 第三则） | `paste-images.spec.ts` | ✅ |
| A14 | 未知文件 404（3.2 第四则） | `paste-images.spec.ts` | ✅ |
| A15 | 文件路由在 pasteToPath=false 时同样拒绝 | `paste-images.spec.ts` | ✅ |
| A16 | 设置 off→on→off：工具与提示段注册/注销联动 | 现有 config / web 用例 + 新增 | ✅ 现有 |
| A17 | 裁决路由 404 韧性恢复 + notify 告警（3.6） | `paste-images-client.spec.ts` | ✅ |
| A18 | 挂起裁决→多模态：合成重放原生 paste（3.3 第一则） | `paste-images-client.spec.ts` | ✅ |
| A19 | 挂起裁决→文本：桥接插入（3.3 第二则） | `paste-images-client.spec.ts` | ✅ |
| A20 | 挂起裁决请求失败（404/超时）→ 兜底桥接 + 一次性 notify（3.3 决策规则） | `paste-images-client.spec.ts` | ✅ |
| A21 | 原生路径优先走公开注入 API（`createDraftImages`+`addImages`），合成事件仅作退化路径（3.3 实现约束） | `paste-images-client.spec.ts` | ✅ |
| A21b | `createDraftImages` 以接收者绑定方式调用（问题 2 崩溃回归） | `paste-images-client.spec.ts` | ✅ |
| A22 | chat.node 阴影注册：`user`/`steering` 两 key、priority -1、locale 'conversation' | `paste-images-client.spec.ts` | ✅ |
| A23 | 桥接标记解析与渲染：路径行隐藏、file-route 渲染为 `<img>`、非桥接 markdown 原样（3.8） | `user-message-view.spec.ts` 新文件 | ✅ |
| A24 | 阴影视图复刻产品气泡：原生图 loadImage 渲染/重试/灯箱、引用芯片、JsonBlock、复制/时间（3.8） | `user-message-view.spec.ts` 新文件 | ✅ |
| A25 | 无模型信号（harness agent 输入框无模型选择器）paste/drop → **text-safe 桥接**而非原生放行（3.9） | `paste-images-client.spec.ts` | ✅ |
| A26 | `syncTakeover` 无信号返回 `undefined`（挂起）而非 `false`（原生放行）——3.9 核心回归 | `paste-images-client.spec.ts`（A25 两用例覆盖） | ✅ |
| A27 | 桥接 tile URL-only drop 再物化：preventDefault + 裁决链，绝不文本泄露（3.10） | `paste-images-client.spec.ts` | ✅ |
| A28 | URL-only paste 同 3.10 链；跨插件普通文本放行（3.10） | `paste-images-client.spec.ts` | ✅ |
| A29 | 文件+URL 混合 payload（tile 拖回带 files）清洗：URL 进不了草稿、同名 record 复用（3.11） | `paste-images-client.spec.ts` | ✅ |

### 3.1 宿主裁决优先级（修复①②，A3/A4）— 追加到 `tests/paste-images.spec.ts`

```ts
// 显式 provider/model 参数与 requestContext() 冲突时以显式参数为准（R2 回归）
it('prefers the explicit provider/model pair over a stale session requestContext', async () => {
  const cwd = await workspace()
  const { base } = await setupVerdict({
    sessions: { get: (id: string) => id === 'session-1' ? sessionWithModel(cwd, 'abrdns', 'Qwen3.8-Max') : undefined }, // 会话残留多模态
    logger: { warn: vi.fn() },
    llm: {
      listProviders: () => [],
      listModels: async () => [],
      resolveModelInfo: async (_p: string, model: string) => ({ inputModalities: model === 'Qwen3.8-Max' ? ['text', 'image'] : ['text'] }),
    },
  })
  // 当前选择是文本模型 → 即使 requestContext 说是多模态也必须桥接
  const text = await (await fetch(`${base}${PASTE_IMAGES_ROUTE}?sessionId=session-1&provider=abrdns&model=DeepSeek-V4-Pro-0813`)).json() as { takeover: boolean }
  expect(text.takeover).toBe(true)   // ❌ 当前版本（无参数支持，实际走 requestContext 返回 false）
  // 当前选择是多模态 → 即使 requestContext 说是文本也必须原生
  const multi = await (await fetch(`${base}${PASTE_IMAGES_ROUTE}?sessionId=session-1&provider=abrdns&model=Qwen3.8-Max`)).json() as { takeover: boolean }
  expect(multi.takeover).toBe(false) // ❌ 当前版本（实测返回 true，正是 R2 的炸点）
})

it('keeps the label scan when provider/model params and session are absent', async () => {
  const { base } = await setupVerdict({ sessions: { get: () => undefined }, logger: { warn: vi.fn() }, llm: {/* 目录含 Qwen3.8-Max=[text,image]、DeepSeek-V4-Pro-0813=[text] */} })
  expect((await (await fetch(`${base}${PASTE_IMAGES_ROUTE}?model=Qwen3.8-Max`)).json()).takeover).toBe(false)
  expect((await (await fetch(`${base}${PASTE_IMAGES_ROUTE}?model=DeepSeek-V4-Pro-0813`)).json()).takeover).toBe(true)
})

it('fails safe to takeover when explicit pair capability cannot be resolved', async () => {
  // resolveModelInfo 抛错且目录无此模型 → takeover:true
})

it('returns takeover:false for an empty request (no model information at all)', async () => {
  // ?model=&sessionId=<bogus> → false（保持现状，避免误伤原生流程）
})
```

### 3.2 桥接文件只读路由（修复⑤，A8/A12/A13/A14/A15）— 追加到 `tests/paste-images.spec.ts`

> 实现注意：只读文件路由是**独立同源路径**（如 `${PASTE_IMAGES_ROUTE}/file`，注册 `kind:'exact'`），
> 必须先于现有裁决 GET 分支处理；不接受 POST、只绑定插件管理的 paste root（realpath + `ensurePathInside`）。

```ts
it('serves a bridged image back to its owning session with the right media type', async () => {
  const cwd = await workspace(); const { base, upload } = await setup(cwd)
  const posted = await (await upload('view.png', 'image/png', Uint8Array.of(1, 2, 3))).json() as { value: { absolutePath: string } }
  const name = basename(posted.value.absolutePath)
  const resp = await fetch(`${base}${PASTE_IMAGES_ROUTE}/file?sessionId=session-1&name=${name}`)
  expect(resp.status).toBe(200)
  expect(resp.headers.get('content-type')).toBe('image/png')
  expect(resp.headers.get('x-content-type-options')).toBe('nosniff')
  await expect(resp.arrayBuffer()).resolves.toEqual(Uint8Array.of(1, 2, 3).buffer)
})

it('rejects file reads that escape the session paste root', async () => {
  // name=..%2F..%2Fsecret.png → 400；name=../../x.png → 400
})

it('keeps each session\'s bridged files private', async () => {
  // session-1 上传 → session-2 同名读取 → 404；未知 session → 400
})

it('answers 404 when the managed file does not exist', async () => { /* name=missing.png → 404 */ })
```

### 3.3 客户端"拦下-问清-再决定"（修复③，A18/A19/A20/A21）— 追加到 `tests/paste-images-client.spec.ts`

> **实现决策（v2 审计修正）**：
> 1. 原生路径**优先用公开注入 API**：`conversation.createDraftImages(files)` + 输入壳 `addImages(ids)`（与 DSH
>    composer bar 同款路径），字节级原样进原生附件管线——**不依赖 `DataTransfer` 构造与 `isTrusted`**；
>   仅在壳面无 `addImages` 时才回退合成事件重放。
> 2. 裁决请求**失败**（404/超时/解析失败）时：单次粘贴内兜底**桥接**（文本安全方向），同时 `notify` 一次性
>    告警（与 A17 共享频控），不静默、不循环等裁决。
> 3. 文本与文件混合粘贴：文本段照常插入，文件按最终裁决走原生或桥接，两者在同一原子重放中完成。

```ts
// fetch 裁决为多模态（takeover:false）：插件必须把事件原样交还原生处理器（合成重放）
it('replays a pending-verdict paste natively when the model turns out multimodal', async () => {
  const bench = fakeClient('')
  const textarea = composer()
  const nativePaste = vi.fn()
  textarea.addEventListener('paste', nativePaste)
  let resolveVerdict!: (value: { takeover: boolean }) => void
  vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => {
    resolveVerdict = (body) => resolve(new Response(JSON.stringify(body), {
      status: 200, headers: { 'Content-Type': 'application/json' },
    }))
  }))) // 裁决挂起
  const event = clipboardEvent('', [file('one.png', 'image/png', [1])])
  textarea.dispatchEvent(event)
  expect(event.defaultPrevented).toBe(true)                     // 已被拦下
  expect(nativePaste).not.toHaveBeenCalled()                    // 原生尚未收到
  resolveVerdict({ takeover: false })
  await vi.waitFor(() => {
    expect(nativePaste).toHaveBeenCalledTimes(1)                // 合成重放一次，且不再经过插件
    expect(bench.input.state.getSnapshot().occurrences).toEqual([]) // 未产生桥接引用
  })
  bench.dispose()
})

it('bridges a pending-verdict paste when the model turns out text-only', async () => {
  // 同一挂起手法：resolveVerdict({ takeover: true }) → 插入桥接引用、原生未收到、serialize 可用
})
```

### 3.4 客户端模型目录订阅（修复②，A2）— 追加到 `tests/paste-images-client.spec.ts`

```ts
it('reads the current selection from ctx.modelDirectories and flushes the verdict on change', async () => {
  // fake modelDirectories：store.getSnapshot().current={provider:'abrdns',model:'Qwen3.8-Max'}；store.subscribe 注册监听
  // 1) GET 请求带 provider/model（断言 URL 查询串）
  // 2) 触发 store 变更（模拟切模型）→ 断言旧裁决缓存被清、对新选择发起新的裁决请求
  // 3) modelDirectories 缺失时回退 DOM aria-label 扫描（同 composer() 工装）
})
```

### 3.5 序列化输出与缩略图（修复⑤，A5/A10）— 追加到 `tests/paste-images-client.spec.ts`

```ts
it('serializes each bridged image as an absolute path plus an inline markdown image', async () => {
  // codec.serialize → 同时包含：
  // - 绝对路径文本（模型调工具可见）
  // - ![...](/_dsh/vision-cloud/paste-images/file?sessionId=session-1&name=...) → 消息气泡显示图片
})

it('renders a real thumbnail in the paste dock chip and revokes its object URL', () => {
  // render(dock) → img.src 以 blob: 开头；移除芯片后 URL.revokeObjectURL 被调用
})
```

### 3.6 路由韧性（修复⑥，A17）— 追加到 `tests/paste-images-client.spec.ts`

```ts
it('recovers from a transient 404 instead of disabling the bridge forever', async () => {
  // 第一次裁决 GET 返回 404 → 后续粘贴仍会再次请求（限频重试），并在持续失败时调用 input.notify
})
```

### 3.7 系统提示文案（修复④，A9）— 新文件 `tests/system-prompt.spec.ts`

```ts
import { describe, expect, it } from 'vitest'
import { buildVisionPrompt } from '../src/vision-prompt.ts'

it('instructs image-capable models to answer directly and forbids vision_cloud_tool', () => {
  const text = SYSTEM_PROMPT_TOOL_SECTION // 导出 index.ts 中提示段为常量
  expect(text.toLowerCase()).toMatch(/可以直接看到图片|do not call vision_cloud_tool/i)
})

it('still routes text-only models to vision_cloud_tool with path/URL/attachment id', () => {
  expect(text.toLowerCase()).toMatch(/无法直接看到|only when.*cannot see|use the vision_cloud_tool/i)
})

it('keeps the URL/path exception for image-capable models', () => {
  // 多模态模型无法"看到" URL/路径内容 → 提示必须继续允许调用 vision_cloud_tool 读 URL（E20 防回归）
  expect(text.toLowerCase()).toMatch(/url|path.*not visible|仍.*调用|still.*call/i)
})
```

> 提示段建议从 `src/index.ts` 抽成 `src/vision-prompt.ts` 导出的常量，便于上例直接断言文案，避免行为回归。

### 3.8 消息阴影渲染器（方案2，A22/A23/A24）— 新文件 `src/client/user-message-view.tsx` + `tests/user-message-view.spec.ts`

> **为什么必须阴影**：DSH 用户消息气泡把文本块按**纯文本**渲染（无 markdown），所以桥接产生的
> "路径行 + 内联图 markdown" 无法靠任何文本技巧显示成图片——这就是问题 1（文本模型会话气泡泄露
> `[Pasted image available at absolute path: ...]` 原始文本）的根因。修复手段是插件以 **priority -1**
> 注册 `conversation.chat.node` 槽位的 `user`/`steering` key（DSH 规则：同 key 最低优先级渲染；条目渲染出错会被
> 槽位运行时移出，产品视图自动复位）。

```ts
// 关键行为清单（tests/user-message-view.spec.ts 已覆盖）
// 1) extractBridgeMarkup：剥掉路径行与 ![...](<file-route>) 标记 → 图片 URL 列表 + 干净文本；
//    非桥接 markdown 原样保留（用户气泡本来就是纯文本）
// 2) splitContent：text 连接 / image 块收集 / 其余走 JsonBlock（复刻产品 contentParts）
// 3) singleFit：240px 长边、宽高比钳制 [0.25,4]、不放大（复刻产品 MessageImage 展示规则）
// 4) 原生图：loadImage(attachment) promise → <img>；失败显示点击重试；成功点击开灯箱（body portal）
// 5) 桥接图：<img src="/_dsh/vision-cloud/paste-images/file?sessionId=...&name=...">，no-store 路由 + keyed 重挂载重试
// 6) 文本气泡：MessageText + /skill、@agent 引用芯片 + white-space 保护
// 7) 操作行：复制按钮（Tooltip + copied 反馈）+ 消息时间（hover 显示，同产品 time-hover-root 语义）
// 8) 注册面：key='user' 与 key='steering' 各一条，priority:-1，locale:'conversation'（槽位运行时合成 t）
```

### 3.9 无模型信号 → text-safe 桥接（A25/A26）— 推翻 L4，2026-08-16 harness 实锤

> **事故**（2026-08-16 08:07，harness agent GUI，会话日志 `agentHome/41683fc5`）：用户在
> DeepSeek-V4-Flash-0731（文本，pi-ai/abrdns）会话里拖入图片并发送 → `pi-ai model "DeepSeek-V4-Flash-0731"
> does not support image input / UNSUPPORTED_CONTENT`。日志显示新消息 = **原生图片附件块 + 文本**（无桥接标记）：
> harness agent 输入框**没有模型选择器**（无 DOM 标签、无 modelDirectories 信号），旧代码在
> `syncTakeover()` 里把"无信号"错误地返回 `false`（等同"确认多模态"）→ `handlePaste/handleDrop` 不
> `preventDefault` 直接放行 → 原生管线把图片块塞进消息 → pi-ai 对文本模型整体拒绝。
> 对比会话 `agentHome/2f05ec7f`（08:20，同环境）：模型拿到路径文本并自行调用 `vision_cloud_tool` 识图，链路正常。

**修改**（全部在 `src/client/paste-images.tsx`）：

1. `syncTakeover`：`verdictKey` 为 `undefined`（无信号）时返回 `undefined`（挂起）而非 `false`——"无信号"≠"确认多模态"；
2. `handlePaste` / `handleDrop` 挂起分支的"无信号"走向从 `releaseNatively` 改为 `finishBridge`（text-safe，与 verdict 不可得时 GA20 的兜底方向一致）。

**为何可推翻 L4**：留原生只在"确认多模态"时有收益；无信号时原生放行对 pi-ai 文本模型是**必炸**
（UNSUPPORTED_CONTENT），而桥接降级只是让（可能的）多模态模型拿到路径文本——识图由
`vision_cloud_tool` 保证，对显示层阴影渲染器照样出大图。桌面端有完整模型信号的路径完全不变。

---

### 3.10 桥接 tile 拖回输入框：URL-only drop/paste 再物化（A27/A28）— 2026-08-16 harness 实锤

> **事故**（2026-08-16 11:0x，harness agent GUI，会话日志 `agentHome/b98c935b`）：用户把已发送气泡里的
> 桥接图片 tile **拖回输入框**。这类拖拽浏览器**不带 `files`**，payload 只有（浏览器绝对化后的）文件路由
> URL 文本（`http://127.0.0.1:57631/_dsh/vision-cloud/paste-images/file?sessionId=...&name=...`）。旧代码
> `files.length === 0 → return false`（不 preventDefault）→ 原生文本域把 URL + 相邻的路径标注 + markdown
> 整段按普通文本塞进草稿 → 发送后消息 = 纯文本 → 气泡泄露裸标注（路径行 + `![...](<route>)`），与桌面端
> （拖 tile 前的气泡正常显示大图）行为不一致。日志实锤：该消息内容为单一 text 块，无任何图片块。
>
> 附带观察：同批消息里有一条 CJK 文本出现乱码（"什么应用"→ `ʲôӦ`），同样经 URL-drop 原生文本路径——本节修复拦截后该路径不复存在；若其它入口仍能触发，另行排查 harness 消息管线编码。

**修改**（全部在 `src/client/paste-images.tsx` + `tests/paste-images-client.spec.ts`）：

1. `bridgeRefsFromPayload`：files 为空时扫描 `dataTransfer`/`clipboardData` 的 `text/uri-list` 等全部 flavor，命中 `/_dsh/vision-cloud/paste-images/file?...` 路由（含浏览器绝对化 URL、markdown 包裹形式）→ 解析 `sessionId` + `name`；
2. `handleDrop`/`handlePaste`：命中时一律 `preventDefault`（URL/标注文本**永不落入草稿**），再走同一 verdict 链：
   - 确认多模态 → `fetchBridgeFile` 从会话授权 file 路由取回字节 → `releaseNatively` 插**真实图片块**（直连视觉 + 原生气泡，与拖新图一致）；
   - 文本/无信号/裁决不可得 → `bridgeDroppedRefs`：优先复用同一标签页已上传的同名 record（`findUploadedRecord`，零下载零重传）；否则下载字节按普通 File 桥接（serialize 时重新落盘）。fetch 失败 → 一次性 notify，绝不回退成文本；
3. 非本插件路由的普通文本 drop/paste 继续放行原生（不误伤从文档拖文本）。

---

### 3.11 tile 拖回输入框：文件+URL 混合 payload 的文本清洗与 record 复用（A29）— 2026-08-16 harness 实锤

> **事故**（2026-08-16，harness agent GUI，会话 `session-b98c935b`，端口 49996）：3.10 修复后再次观察到曝光
> 事件——把消息里的桥接图片 tile 拖回输入框，草稿还是出现了
> `http://127.0.0.1:49996/_dsh/vision-cloud/paste-images/file?sessionId=...&name=<uuid>-file.png [pasted image: file.png]`
> 的裸文本。会话日志实锤：本次拖拽的 payload **既带 `files`（host 把图片物化为通用 `File('file.png')`），
> 又在拖拽文本里放了文件路由 URL**（`url-<uuid> + [Pasted image…] + ![file.png](<route>) + route`）。
> 3.10 的 `bridgeRefsFromPayload` 只处理 `files.length === 0` 的 URL-only 形态；files 分支把原始拖拽文本
> 透传进桥接草稿 → URL 泄露。**这是 payload 形态设想的第二次修正：tile 拖回 =「File + URL 文本」双轨。**

**修改**（`src/client/paste-images.tsx` + `tests/paste-images-client.spec.ts`）：

1. `sanitizeBridgeText`：URL-only 与 files 分支共用的文本清洗器。当文本包含 `/_dsh/vision-cloud/paste-images/file?` 时，
   剥掉所有桥接标记——markdown 图片 + 裸 file-route URL（含浏览器绝对化）、绝对/相对路径标注行、
   `[pasted image: …]` 芯片标签、host 物化标记 `url-<uuid>[-name][.ext]`——只留真正的用户文本（如「帮我看看」）；
2. `finishPayload`：files 分支统一入口。清洗后若只剩「1 file + 1 匹配 ref + 空文本」，直接
   `findUploadedRecord(refs[0])` 复用本标签页已上传的同名 record（`insertExistingRefs`，零重传）；否则
   `finishBridge` 走常规上传。复用键 = URL `name` 参数（如 `e313d5f3-…-file.png`），**不是** payload 的
   File 名（`file.png`）——拖回物化时文件名已泛化；
3. `bridgeRefsFromPayload` 在 paste 与 drop 两处无条件计算（命中才进入 refs 分支，files 分支拿到 `refs` 供复用判定）；`settlePaste` 同步携带 `refs`。

**回归红线**（A29 四用例）：URL/标注/`url-` 标记在 files 共存时也不得进入草稿；带真实文字的 tile
拖回保留文字 + 单引用；同 label 二次拖回零 POST；file+URL paste 与 drop 同等待遇。

---

## 4. 执行顺序与门禁

1. **阶段 0｜基线取证**：跑 R1–R6（当前版本预期 ❌，记录证据：裁决返回值截图、气泡截图、目录列表）。
2. **阶段 1｜实现**：按 ①→②→③→④→⑤→⑥ 顺序落地（每步跑对应 A 用例）。
3. **阶段 2｜回归**：R1–R6 全部转 ✅；`pnpm test` 全绿（现有 100+ 用例 + 新增 A 系列）。
4. **阶段 3｜全场景 E2E**：E1–E19 全量过一遍，按 2 章 DoD 收证据。
5. **门禁**：E7/E8 两条"问题 1/2 直达路径"必须由证据链闭环（裁决接口返回值 + 消息形态 + 无 PNG 提示/无工具卡片）。

---

## 5. 已知限制与既定决策（写入用例预期，不再当缺陷报）

| # | 行为 | 决策 |
| --- | --- | --- |
| L1 | E11：多模态期原生附件 + 切文本后直接发送 | DSH 宿主按 `MODEL_DOES_NOT_SUPPORT_IMAGES` 拒绝并提示，属 DSH 自身行为；插件无公开 API 转换既有草案附件。缓解：删除附件行后重新粘贴（此时裁决已是当前选择，走桥接） |
| L2 | E4：bmp/svg 等非白名单格式 | 桥接只负责搬运落盘；`vision_cloud_tool` 按 `paths.ts` 白名单（.png/.jpg/.jpeg/.gif/.webp）拒绝。后续可选改进：桥接端先行拒收并在芯片上即时报错 |
| L3 | 修复⑤的气泡内联图片 | 已由 3.8 阴影渲染器实现：插件自带 `user`/`steering` 气泡视图（priority -1 阴影），不再依赖 DSH 消息 markdown 渲染器——用户气泡本来就是纯文本渲染，markdown 内联图从未可行。桥接消息对模型仍是"路径文本"，对显示是大图 + 干净文字 |
| L4 | 空裁决（无任何模型信息）| **2026-08-16 反转为 `takeover:true`（桥接）**（3.9）。旧决策（原生）在 harness agent 输入框无模型信号的场景下把图片块塞进 pi-ai 文本模型请求，必炸 UNSUPPORTED_CONTENT（会话 41683fc5 实锤）。桥接方向对两种模型都安全：多模态降级为路径文本 + `vision_cloud_tool` 识图 |
| L5 | 自定义模型能力完全不可解析（`resolveModelInfo` 抛错 + 目录无记录）| 宿主兜底 `takeover:true` 是硬币两面：文本模型受益、多模态模型首次粘贴被误桥接（R3 类）。v2 决策：保留该方向 + 日志记录；如实际出现可加设置项"该模型强制原生/强制桥接"（需观察再定） |