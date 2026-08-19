/**
 * DSH Vision Tools browser plugin: a minimal Settings section (pick an app
 * model + test read) plus the paste/drop-to-path image bridge. No tool cards,
 * no artifact previews, no credentials.
 */

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import {
  Button,
  IconChevronDownOutline14,
  Input,
  Menu,
  type MenuEntry,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-settings/types'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { installPasteImages } from './paste-images.tsx'

const NS = 'vision-cloud'
const SETTINGS_ROUTE = '/_dsh/vision-cloud/settings'

const en = {
  nav: 'Vision Tools',
  model: 'Vision model',
  modelHint: 'Leave "Off" to keep vision_cloud_tool unregistered. Selecting a model registers the tool immediately. Only models that accept image input are listed.',
  off: 'Off (disabled)',
  testRead: 'Test read',
  testing: 'Testing…',
  save: 'Save and apply',
  saving: 'Saving…',
  reload: 'Reload',
  saved: 'Settings saved.',
  readOnly: 'Settings are read-only.',
  advanced: 'Advanced',
  advancedHint: 'Output language and resource limits.',
  language: 'Output language',
  timeout: 'Request timeout (ms)',
  maxBytes: 'Maximum image bytes',
  maxPixels: 'Maximum image pixels',
  concurrency: 'Concurrent calls per session',
  maxImages: 'Maximum images per call',
  allowedDirs: 'Additional allowed directories',
  allowedDirsHint: 'One path per line. The session workspace is always allowed.',
  positiveInteger: '{field} must be a positive integer.',
  testOk: 'Test read succeeded.',
  testFailed: 'Test read failed',
  noModel: 'Select a vision model and save before testing.',
  pasteToPath: 'Paste/drop-to-path bridge',
  pasteToPathHint: 'Convert pasted or dropped images into workspace paths for text-only models. Leave off to keep image input native.',
  reasoningEffort: 'Thinking effort',
  reasoningEffortHint: 'Pick the reasoning effort the vision model runs with.',
  reasoningDefault: 'Default',
  modelUnsupportedLabel: 'no image input',
} as const

type LocaleKey = keyof typeof en

const zh: Record<LocaleKey, string> = {
  nav: '视觉工具',
  model: '视觉模型',
  modelHint: '保持“不启用”则不会注册 vision_cloud_tool；选择模型后立即生效。此处仅列出支持图片输入的模型。',
  off: '不启用（默认）',
  testRead: '测试读取',
  testing: '测试中…',
  save: '保存设置',
  saving: '保存中…',
  reload: '重新加载',
  saved: '设置已保存。',
  readOnly: '设置为只读，无法修改。',
  advanced: '高级设置',
  advancedHint: '结果语言与资源限制。',
  language: '结果语言',
  timeout: '单次请求超时（毫秒）',
  maxBytes: '单张图片大小上限（字节）',
  maxPixels: '单张图片最大像素数',
  concurrency: '单个会话最大并发数',
  maxImages: '单次调用最多图片数',
  allowedDirs: '允许读取的其他目录',
  allowedDirsHint: '每行一个目录；会话工作目录始终可用。',
  positiveInteger: '{field}必须为正整数。',
  testOk: '测试读取成功。',
  testFailed: '测试读取失败',
  noModel: '请先选择视觉模型并保存，再测试读取。',
  pasteToPath: '粘贴/拖拽路径桥',
  pasteToPathHint: '把粘贴或拖入的图片复制到会话工作区，并插入工作区路径。关闭则图片输入保持原生附件。',
  reasoningEffort: '思考程度',
  reasoningEffortHint: '选择视觉模型使用的 reasoning effort。',
  reasoningDefault: '默认',
  modelUnsupportedLabel: '不支持图片',
}

type Translate = (key: LocaleKey, params?: Record<string, unknown>) => string

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'vision-cloud': LocaleKey
  }
}

interface SettingsValue {
  model?: { provider?: string; model?: string; reasoningEffort?: string }
  language?: 'zh' | 'en'
  timeoutMs?: number
  maxImageBytes?: number
  maxImagePixels?: number
  concurrency?: number
  maxImages?: number
  allowedDirs?: string[]
  pasteToPath?: boolean
}

interface VisionModelEntry {
  id: string
  name: string
  inputModalities: string[]
  reasoningEfforts: string[]
}

interface VisionProviderEntry {
  provider: string
  name: string
  models: VisionModelEntry[]
}

interface SettingsSnapshot {
  schemaVersion: 1
  writable: boolean
  pluginVersion: string
  enabled: boolean
  pasteToPath: boolean
  settings: { value: SettingsValue; revision: number; applies: 'live' }
  providers: VisionProviderEntry[]
}

interface ApiSuccess<T> { ok: true; value: T }
interface ApiFailure { ok: false; error: { code: string; message: string } }

async function apiRequest<T>(init?: RequestInit): Promise<T> {
  const response = await fetch(SETTINGS_ROUTE, { credentials: 'same-origin', ...init })
  const body = await response.json() as ApiSuccess<T> | ApiFailure
  if (!response.ok || !body.ok) {
    const failure = body as ApiFailure
    throw new Error(failure.error?.message ?? `Vision Tools request failed with HTTP ${response.status}`)
  }
  return body.value
}

interface SettingsState {
  status: 'idle' | 'loading' | 'ready' | 'error'
  snapshot?: SettingsSnapshot | undefined
  action?: 'save' | 'test' | undefined
  message?: string | undefined
  error?: string | undefined
}

/** Small external store shared by the Settings route and pushed invalidations. */
export class VisionSettingsController {
  private state: SettingsState = { status: 'idle' }
  private listeners = new Set<() => void>()
  private generation = 0

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  snapshot = (): SettingsState => this.state

  private set(next: SettingsState): void {
    this.state = next
    for (const listener of this.listeners) listener()
  }

  async load(): Promise<void> {
    const generation = ++this.generation
    this.set({ ...this.state, status: 'loading', error: undefined, message: undefined })
    try {
      const snapshot = await apiRequest<SettingsSnapshot>()
      if (generation !== this.generation) return
      this.set({ status: 'ready', snapshot })
    } catch (error) {
      if (generation !== this.generation) return
      this.set({ ...this.state, status: 'error', error: error instanceof Error ? error.message : String(error) })
    }
  }

  refreshIfLoaded(): void {
    if (this.state.status === 'idle' || this.state.action === 'save') return
    void this.load()
  }

  async save(value: SettingsValue, expectedRevision: number): Promise<boolean> {
    this.set({ ...this.state, action: 'save', error: undefined, message: undefined })
    try {
      const snapshot = await apiRequest<SettingsSnapshot>({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'save', expectedRevision, value }),
      })
      this.set({ status: 'ready', snapshot, message: 'saved' })
      return true
    } catch (error) {
      this.set({ ...this.state, action: undefined, error: error instanceof Error ? error.message : String(error) })
      return false
    }
  }

  async testRead(): Promise<void> {
    this.set({ ...this.state, action: 'test', error: undefined, message: undefined })
    try {
      const snapshot = await apiRequest<SettingsSnapshot>({
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'testRead' }),
      })
      this.set({ ...this.state, action: undefined, snapshot, message: 'testOk' })
    } catch (error) {
      this.set({ ...this.state, action: undefined, error: error instanceof Error ? error.message : String(error) })
    }
  }
}

interface Draft {
  provider: string
  model: string
  reasoningEffort: string
  language: 'zh' | 'en'
  timeoutMs: string
  maxImageBytes: string
  maxImagePixels: string
  concurrency: string
  maxImages: string
  allowedDirs: string
  pasteToPath: boolean
}

function draftOf(value: SettingsValue): Draft {
  return {
    provider: value.model?.provider ?? '',
    model: value.model?.model ?? '',
    reasoningEffort: value.model?.reasoningEffort ?? '',
    language: value.language ?? 'zh',
    timeoutMs: String(value.timeoutMs ?? 180000),
    maxImageBytes: String(value.maxImageBytes ?? 10485760),
    maxImagePixels: String(value.maxImagePixels ?? 40000000),
    concurrency: String(value.concurrency ?? 4),
    maxImages: String(value.maxImages ?? 8),
    allowedDirs: (value.allowedDirs ?? []).join('\n'),
    pasteToPath: value.pasteToPath ?? true,
  }
}

function positiveInteger(raw: string, label: string, t: Translate): number {
  const value = Number(raw)
  if (!Number.isSafeInteger(value) || value <= 0) throw new Error(t('positiveInteger', { field: label }))
  return value
}

function valueOf(draft: Draft, t: Translate): SettingsValue {
  const value: SettingsValue = {
    language: draft.language,
    timeoutMs: positiveInteger(draft.timeoutMs, t('timeout'), t),
    maxImageBytes: positiveInteger(draft.maxImageBytes, t('maxBytes'), t),
    maxImagePixels: positiveInteger(draft.maxImagePixels, t('maxPixels'), t),
    concurrency: positiveInteger(draft.concurrency, t('concurrency'), t),
    maxImages: positiveInteger(draft.maxImages, t('maxImages'), t),
    allowedDirs: draft.allowedDirs.split(/\r?\n/).map(entry => entry.trim()).filter(Boolean),
    pasteToPath: draft.pasteToPath,
  }
  if (draft.provider !== '' && draft.model !== '') {
    value.model = {
      provider: draft.provider,
      model: draft.model,
      ...(draft.reasoningEffort.trim() === '' ? {} : { reasoningEffort: draft.reasoningEffort.trim() }),
    }
  }
  return value
}

interface SettingsInjected {
  controller: VisionSettingsController
  t: Translate
}

type SettingsProps = PropsRuntime<'settings.section'> & Partial<SettingsInjected>

/**
 * One DSH settings row: title + description on the left, control on the right,
 * closed by the native hairline separator (mirrors DSH PermissionRow).
 */
function SettingsRow({ title, description, control }: {
  title: string
  description?: string | undefined
  control: ReactNode
}) {
  return (
    <div className="dvt-row">
      <div className="dvt-row-text">
        <div className="dvt-row-title">{title}</div>
        {description === undefined ? null : <div className="dvt-row-desc">{description}</div>}
      </div>
      <div className="dvt-row-control">{control}</div>
    </div>
  )
}

/**
 * DSH selector pill opening a native Menu: the single dropdown used by the
 * vision model, thinking effort, and output language rows.
 */
function SettingsMenu({ label, entries, selectedId, onSelect, disabled, ariaLabel }: {
  label: string
  entries: readonly MenuEntry[]
  selectedId: string
  onSelect: (id: string) => void
  disabled?: boolean | undefined
  ariaLabel: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <Menu
      open={open}
      onClose={() => { setOpen(false) }}
      items={entries}
      selectedId={selectedId}
      onSelect={(id) => {
        setOpen(false)
        onSelect(id)
      }}
      align="end"
      portal
      anchor={(
        <button
          type="button"
          className="dvt-selector"
          aria-label={ariaLabel}
          aria-haspopup="menu"
          aria-expanded={open}
          disabled={disabled}
          onClick={() => { setOpen(value => !value) }}
        >
          <span className="dvt-selector-label">{label}</span>
          <IconChevronDownOutline14 className="dvt-selector-chevron" />
        </button>
      )}
    />
  )
}

/** DSH-styled switch for a boolean row (no native Switch primitive exists). */
function SettingsSwitch({ checked, onChange, disabled, ariaLabel }: {
  checked: boolean
  onChange: (next: boolean) => void
  disabled?: boolean | undefined
  ariaLabel: string
}) {
  return (
    <button
      type="button"
      role="switch"
      className="dvt-switch"
      aria-label={ariaLabel}
      aria-checked={checked}
      disabled={disabled}
      onClick={() => { onChange(!checked) }}
    >
      <span className="dvt-switch-track" data-on={checked ? 'true' : undefined} aria-hidden="true">
        <span className="dvt-switch-thumb" />
      </span>
    </button>
  )
}

/** Encode a provider+model pair into one selectable option value. */
function modelKey(provider: string, model: string): string {
  return JSON.stringify({ provider, model })
}

function SettingsSection({ controller, t }: SettingsProps) {
  if (controller === undefined || t === undefined) return null
  return <LoadedSettings controller={controller} t={t} />
}

function LoadedSettings({ controller, t }: SettingsInjected) {
  const state = useSyncExternalStore(controller.subscribe, controller.snapshot, controller.snapshot)
  const snapshot = state.snapshot
  const [draft, setDraft] = useState<Draft | undefined>(undefined)
  const [draftError, setDraftError] = useState<string | undefined>(undefined)

  useEffect(() => { if (state.status === 'idle') void controller.load() }, [controller, state.status])
  useEffect(() => {
    if (snapshot !== undefined) setDraft(draftOf(snapshot.settings.value))
  }, [snapshot])

  if (state.status === 'idle' || (state.status === 'loading' && snapshot === undefined)) {
    return <div className="dvt-settings"><div className="dvt-loading">{t('testing')}</div></div>
  }
  if (snapshot === undefined || draft === undefined) {
    return <div className="dvt-settings"><div className="dvt-alert error">{state.error ?? t('reload')}</div><Button variant="outline" onClick={() => { void controller.load() }}>{t('reload')}</Button></div>
  }

  const update = <K extends keyof Draft>(key: K, value: Draft[K]): void => setDraft(current => current === undefined ? current : { ...current, [key]: value })
  const providers = snapshot.providers
  const busy = state.action !== undefined
  const selectedModel = providers.find(entry => entry.provider === draft.provider)?.models.find(model => model.id === draft.model)
  const reasoningEfforts = selectedModel?.reasoningEfforts ?? []
  const applyModelSelection = (key: string): void => {
    if (key === '') {
      update('provider', '')
      update('model', '')
      return
    }
    try {
      const parsed = JSON.parse(key) as { provider?: unknown; model?: unknown }
      if (typeof parsed.provider === 'string' && typeof parsed.model === 'string') {
        update('provider', parsed.provider)
        update('model', parsed.model)
      }
    } catch {
      // Ignore malformed keys.
    }
  }

  const save = (): void => {
    try {
      setDraftError(undefined)
      void controller.save(valueOf(draft, t), snapshot.settings.revision)
    } catch (error) {
      setDraftError(error instanceof Error ? error.message : String(error))
    }
  }

  // Provider names become Menu group labels; only image-capable models are
  // selectable rows, exactly as the old optgroup filter did.
  const modelEntries: MenuEntry[] = [{ id: '', label: t('off') }]
  if (selectedModel !== undefined && !selectedModel.inputModalities.includes('image')) {
    modelEntries.push({
      id: modelKey(draft.provider, draft.model),
      label: `${selectedModel.name} · ${t('modelUnsupportedLabel')}`,
      disabled: true,
    })
  }
  for (const entry of providers) {
    const models = entry.models.filter(model => model.inputModalities.includes('image'))
    if (models.length === 0) continue
    modelEntries.push({ type: 'label', id: `group:${entry.provider}`, text: entry.name })
    for (const model of models) {
      modelEntries.push({ id: modelKey(entry.provider, model.id), label: model.name })
    }
  }
  const selectedModelId = draft.provider !== '' && draft.model !== '' ? modelKey(draft.provider, draft.model) : ''
  const modelLabel = selectedModel?.name ?? (draft.model === '' ? t('off') : draft.model)

  return (
    <div className="dvt-settings">
      {!snapshot.writable ? <div className="dvt-alert warning">{t('readOnly')}</div> : null}
      {draftError === undefined ? null : <div className="dvt-alert error">{draftError}</div>}
      {state.error === undefined ? null : <div className="dvt-alert error">{state.error}</div>}
      {state.message === 'saved' ? <div className="dvt-alert success">{t('saved')}</div> : null}
      {state.message === 'testOk' ? <div className="dvt-alert success">{t('testOk')}</div> : null}

      <SettingsRow
        title={t('model')}
        description={t('modelHint')}
        control={(
          <SettingsMenu
            ariaLabel={t('model')}
            label={modelLabel}
            entries={modelEntries}
            selectedId={selectedModelId}
            disabled={!snapshot.writable || busy}
            onSelect={applyModelSelection}
          />
        )}
      />

      {reasoningEfforts.length > 0 ? (
        <SettingsRow
          title={t('reasoningEffort')}
          description={t('reasoningEffortHint')}
          control={(
            <SettingsMenu
              ariaLabel={t('reasoningEffort')}
              label={draft.reasoningEffort === '' ? t('reasoningDefault') : draft.reasoningEffort}
              entries={[
                { id: '', label: t('reasoningDefault') },
                ...reasoningEfforts.map(effort => ({ id: effort, label: effort })),
              ]}
              selectedId={draft.reasoningEffort}
              disabled={busy || draft.model === ''}
              onSelect={(id) => { update('reasoningEffort', id) }}
            />
          )}
        />
      ) : null}

      <SettingsRow
        title={t('pasteToPath')}
        description={t('pasteToPathHint')}
        control={(
          <SettingsSwitch
            ariaLabel={t('pasteToPath')}
            checked={draft.pasteToPath}
            disabled={busy}
            onChange={(next) => { update('pasteToPath', next) }}
          />
        )}
      />

      <AdvancedSettings t={t} draft={draft} busy={busy} update={update} />

      <div className="dvt-actions">
        <Button variant="primary" disabled={!snapshot.writable || busy} onClick={save}>{state.action === 'save' ? t('saving') : t('save')}</Button>
        <Button variant="outline" disabled={busy || !snapshot.enabled} onClick={() => { void controller.testRead() }}>{state.action === 'test' ? t('testing') : t('testRead')}</Button>
        <Button variant="outline" disabled={busy} onClick={() => { void controller.load() }}>{t('reload')}</Button>
      </div>

      <div className="dvt-footnote">{`Vision Cloud · v${snapshot.pluginVersion}`}</div>
    </div>
  )
}

/** Numeric advanced fields, all held as strings in the draft. */
const NUMERIC_FIELDS: ReadonlyArray<readonly [LocaleKey, 'timeoutMs' | 'maxImageBytes' | 'maxImagePixels' | 'concurrency' | 'maxImages']> = [
  ['timeout', 'timeoutMs'],
  ['maxBytes', 'maxImageBytes'],
  ['maxPixels', 'maxImagePixels'],
  ['concurrency', 'concurrency'],
  ['maxImages', 'maxImages'],
]

/** Advanced group: a flat disclosure row over the remaining settings rows. */
function AdvancedSettings({ t, draft, busy, update }: {
  t: Translate
  draft: Draft
  busy: boolean
  update: <K extends keyof Draft>(key: K, value: Draft[K]) => void
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <div className="dvt-row">
        <button
          type="button"
          className="dvt-disclosure"
          aria-expanded={open}
          onClick={() => { setOpen(value => !value) }}
        >
          <span className="dvt-row-text">
            <span className="dvt-row-title">{t('advanced')}</span>
            <span className="dvt-row-desc">{t('advancedHint')}</span>
          </span>
          <IconChevronDownOutline14
            className="dvt-disclosure-chevron"
            {...open ? { 'data-open': 'true' } : {}}
          />
        </button>
      </div>
      {!open ? null : (
        <>
          <SettingsRow
            title={t('language')}
            control={(
              <SettingsMenu
                ariaLabel={t('language')}
                label={draft.language === 'en' ? 'English' : '中文'}
                entries={[{ id: 'zh', label: '中文' }, { id: 'en', label: 'English' }]}
                selectedId={draft.language}
                disabled={busy}
                onSelect={(id) => { update('language', id === 'en' ? 'en' : 'zh') }}
              />
            )}
          />
          {NUMERIC_FIELDS.map(([key, field]) => (
            <SettingsRow
              key={field}
              title={t(key)}
              control={(
                <Input
                  className="dvt-input"
                  aria-label={t(key)}
                  inputMode="numeric"
                  disabled={busy}
                  value={draft[field]}
                  onChange={(event) => { update(field, event.target.value) }}
                />
              )}
            />
          ))}
          <div className="dvt-row dvt-row-stacked">
            <div className="dvt-row-text">
              <div className="dvt-row-title">{t('allowedDirs')}</div>
              <div className="dvt-row-desc">{t('allowedDirsHint')}</div>
            </div>
            <textarea
              className="dvt-textarea"
              aria-label={t('allowedDirs')}
              rows={3}
              disabled={busy}
              value={draft.allowedDirs}
              onChange={(event) => { update('allowedDirs', event.target.value) }}
            />
          </div>
        </>
      )}
    </>
  )
}

const CSS = `
.dvt-settings{display:flex;flex-direction:column;width:100%;max-width:760px;color:var(--dsw-alias-label-primary)}.dvt-settings>.dvt-row:last-of-type{border-bottom:none}
.dvt-row{display:flex;align-items:center;gap:8px;padding:16px 0;border-bottom:1px solid var(--dsw-alias-border-l2)}.dvt-row-text{flex:1;min-width:0;display:flex;flex-direction:column;gap:4px;padding-right:48px}.dvt-row-title{font-size:14px;font-weight:400;line-height:22px;color:var(--dsw-alias-label-primary)}.dvt-row-desc{font-size:12px;font-weight:400;line-height:18px;color:var(--dsw-alias-label-tertiary)}.dvt-row-control{flex:none;display:flex;align-items:center;min-width:0}
.dvt-selector{display:inline-flex;align-items:center;gap:12px;max-width:280px;height:36px;padding:0 14px;border:none;border-radius:18px;background:var(--dsw-alias-bg-module-platform);font:inherit;font-size:14px;line-height:22px;color:var(--dsw-alias-label-primary);cursor:pointer}.dvt-selector:hover:not(:disabled){background:var(--dsw-alias-interactive-bg-hover)}.dvt-selector:disabled{cursor:default;color:var(--dsw-alias-label-dimmed)}.dvt-selector-label{min-width:0;overflow:hidden;white-space:nowrap;text-overflow:ellipsis}.dvt-selector-chevron{flex:none}
.dvt-switch{display:inline-flex;align-items:center;height:36px;padding:0;border:none;background:none;cursor:pointer}.dvt-switch:disabled{cursor:default;opacity:.55}.dvt-switch-track{position:relative;display:inline-block;flex:none;width:28px;height:16px;border-radius:8px;background:var(--dsw-alias-border-l2);transition:background-color 120ms var(--ds-ease-in-out)}.dvt-switch-thumb{position:absolute;top:2px;left:2px;width:12px;height:12px;border-radius:50%;background:var(--dsw-alias-bg-layer-1);transition:transform 120ms var(--ds-ease-in-out)}.dvt-switch-track[data-on=true]{background:var(--dsw-alias-state-business-primary)}.dvt-switch-track[data-on=true] .dvt-switch-thumb{transform:translateX(12px)}
.dvt-disclosure{display:flex;align-items:center;gap:8px;width:100%;padding:0;border:none;background:none;font:inherit;color:inherit;text-align:left;cursor:pointer}.dvt-disclosure-chevron{flex:none;color:var(--dsw-alias-label-tertiary);transition:transform 120ms var(--ds-ease-in-out)}.dvt-disclosure-chevron[data-open=true]{transform:rotate(180deg)}
.dvt-input{width:180px}.dvt-row-stacked{flex-direction:column;align-items:stretch;gap:8px}.dvt-row-stacked .dvt-row-text{padding-right:0}.dvt-textarea{width:100%;box-sizing:border-box;padding:8px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:14px;line-height:22px;resize:vertical}.dvt-textarea:focus{outline:none;border-color:var(--dsw-alias-brand-primary)}.dvt-textarea:disabled{opacity:.55}
.dvt-actions{display:flex;flex-wrap:wrap;gap:8px;padding:16px 0}.dvt-footnote{padding-bottom:8px;font-size:12px;line-height:18px;color:var(--dsw-alias-label-tertiary)}
.dvt-alert{padding:12px 0;font-size:12px;line-height:18px;border-bottom:1px solid var(--dsw-alias-border-l2)}.dvt-alert.warning{color:var(--dsw-alias-state-warn-label)}.dvt-alert.error{color:var(--dsw-alias-state-error-primary)}.dvt-alert.success{color:var(--dsw-alias-state-success-primary)}
.dvt-loading{padding:16px 0;font-size:14px;line-height:22px;color:var(--dsw-alias-label-tertiary)}
.dvt-paste-dock{box-sizing:border-box;width:calc(100% - 32px);max-width:var(--dsh-composer-card-max-width,960px);margin:0 auto;display:flex;flex-wrap:wrap;gap:8px;padding:0 2px 6px}.dvt-paste-item{position:relative;width:64px;height:64px;border-radius:10px;overflow:visible}.dvt-paste-preview{position:relative;width:100%;height:100%;box-sizing:border-box;display:block;overflow:hidden;border:1px solid var(--dsw-alias-border-l1);border-radius:10px;background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary);padding:0;cursor:zoom-in}.dvt-paste-preview:hover{border-color:var(--dsw-alias-border-l2)}.dvt-paste-preview:disabled{cursor:default;opacity:.8}.dvt-paste-preview[data-status=copying]{border-color:var(--dsw-alias-state-business-primary)}.dvt-paste-preview[data-status=error]{border-color:var(--dsw-alias-state-error-primary)}.dvt-paste-preview-img{display:block;width:100%;height:100%;object-fit:cover}.dvt-paste-preview[data-status=copying] .dvt-paste-preview-img{opacity:.5}.dvt-paste-img-text{display:grid;place-items:center;height:100%;color:var(--dsw-alias-label-caption);font-size:11px;padding:0 6px;overflow:hidden}.dvt-paste-status{position:absolute;left:0;right:0;bottom:0;padding:2px 4px;background:linear-gradient(180deg,transparent,rgba(0,0,0,.62));color:#fff;font-size:10px;text-align:center;pointer-events:none;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}.dvt-paste-status[data-kind=error]{background:var(--dsw-alias-state-error-primary);text-align:center;padding:1px 4px}.dvt-paste-remove{position:absolute;top:-7px;right:-7px;width:20px;height:20px;display:grid;place-items:center;border:1px solid var(--dsw-alias-border-l1);border-radius:50%;padding:0;background:var(--dsw-alias-bg-layer-2);color:var(--dsw-alias-label-caption);font:inherit;font-size:14px;line-height:1;cursor:pointer;opacity:0}.dvt-paste-item:hover .dvt-paste-remove,.dvt-paste-remove:focus-visible{opacity:1}.dvt-paste-remove:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dvt-paste-remove:disabled{opacity:0;cursor:default}
.dvt-user-row{flex-direction:column;align-items:flex-end;gap:6px;display:flex}.dvt-user-row[data-pending-steering=true]{opacity:.55}.dvt-user-stack{flex-direction:column;align-items:flex-end;gap:8px;min-width:0;max-width:min(525px,82%);display:flex}.dvt-bubble{background:var(--dsw-specific-bubble);max-width:100%;color:var(--dsw-alias-label-primary);border-radius:22px;padding:10px 16px;font-size:16px;line-height:24px;white-space:pre-wrap;overflow-wrap:anywhere}.dvt-ref-chip{color:var(--dsw-alias-state-business-primary);background:var(--dsw-alias-interactive-bg-hover);border-radius:6px;padding:0 4px;margin:0 1px;display:inline}.dvt-img-gallery{flex-direction:column;align-items:flex-end;gap:8px;max-width:100%;display:flex}.dvt-img-frame{position:relative;overflow:hidden;border:0;padding:0;background:var(--dsw-alias-interactive-bg-hover);border-radius:14px;cursor:zoom-in;display:grid;place-items:center;max-width:100%}.dvt-img-frame img{display:block;width:100%;height:100%;object-fit:cover}.dvt-img-frame[data-variant=tile]{width:64px;height:64px}.dvt-img-frame:not([data-variant]){min-width:64px;min-height:64px}.dvt-img-text{color:var(--dsw-alias-label-caption);font-size:12px;padding:6px 10px}.dvt-img-error{color:var(--dsw-alias-state-error-primary)}.dvt-msg-actions{align-items:center;gap:10px;height:28px;display:flex}.dvt-msg-time{color:var(--dsw-alias-label-tertiary);white-space:nowrap;padding-right:12px;font-size:14px;line-height:24px}@media (hover:hover){[data-time-hover-root] .dvt-msg-time{opacity:0;transition:opacity 80ms}[data-time-hover-root]:hover .dvt-msg-time,[data-time-hover-root]:focus-within .dvt-msg-time{opacity:1}}.dvt-msg-action{width:28px;height:28px;color:var(--dsw-alias-label-tertiary);cursor:pointer;background:0 0;border:0;border-radius:28px;justify-content:center;align-items:center;padding:6px;display:inline-flex;flex:none}.dvt-msg-action:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-secondary)}.dvt-lightbox{position:fixed;inset:0;z-index:99999;display:grid;place-items:center}.dvt-lightbox-mask{position:absolute;inset:0;background:rgba(0,0,0,.7);cursor:zoom-out}.dvt-lightbox-img{position:relative;max-width:90vw;max-height:90vh;border-radius:8px;box-shadow:0 12px 48px rgba(0,0,0,.5)}.dvt-lightbox-close{position:absolute;top:16px;right:16px;width:36px;height:36px;display:grid;place-items:center;border-radius:50%;border:0;background:rgba(255,255,255,.12);color:#fff;cursor:pointer}.dvt-lightbox-close:hover{background:rgba(255,255,255,.22)}
@media(max-width:720px){.dvt-row{align-items:flex-start;flex-direction:column;gap:12px}.dvt-row-text{padding-right:0}.dvt-selector{max-width:100%}.dvt-input{width:100%}.dvt-disclosure{flex-direction:row;align-items:center}}
`

function installStyles(): () => void {
  const id = 'dsh-vision-cloud/client'
  const existing = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${id}"]`)
  if (existing !== null) return () => {}
  const style = document.createElement('style')
  style.dataset.plugin = 'dsh-vision-cloud'
  style.dataset.pluginCss = id
  style.textContent = CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}

/** Required client services. */
export const inject = ['slots', 'locale', 'remote', 'conversation', 'sessions']

/** Register the Vision Settings section and the paste-to-path bridge. */
export function apply(ctx: ClientContext): void {
  ctx.effect(installStyles, 'dsh-vision-cloud: styles')
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-vision-cloud: locale')
  installPasteImages(ctx)
  const t = ctx.locale.bind(NS)
  const controller = new VisionSettingsController()
  ctx.effect(() => {
    const refresh = (): void => { controller.refreshIfLoaded() }
    const legacyRemote = ctx.remote as typeof ctx.remote & {
      $on?: (event: string, listener: () => void) => () => void
    }
    const currentEvents = ctx as unknown as {
      on(event: 'settings/changed', listener: () => void): () => void
    }
    const disposers = typeof legacyRemote.$on === 'function'
      ? [legacyRemote.$on('settings/document-updated', refresh)]
      : [currentEvents.on('settings/changed', refresh)]
    disposers.push(ctx.on('connection/reset', refresh))
    return () => { for (const dispose of disposers) dispose() }
  }, 'dsh-vision-cloud: Settings invalidations')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'vision-cloud',
    order: 30,
    label: () => t('nav'),
    inject: () => ({ controller, t }),
  }, SettingsSection))
}
