/**
 * DSH Vision Cloud browser plugin: a minimal Settings section (pick an app
 * model + test read) plus the paste-to-path image bridge. No tool cards, no
 * artifact previews, no credentials.
 */

import {
  useEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react'
import { Button, Input } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-settings/types'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { installPasteImages } from './paste-images.tsx'

const NS = 'vision-toolkit'
const SETTINGS_ROUTE = '/_dsh/vision-toolkit/settings'

const en = {
  nav: 'Vision Tool',
  settingsTitle: 'Vision Tool',
  settingsIntro: 'Pick a model configured in DSH so vision_cloud_tool can read images through it.',
  model: 'Vision model',
  modelHint: 'Leave "Off" to keep vision_cloud_tool unregistered. Selecting a model registers the tool immediately.',
  off: 'Off (disabled)',
  provider: 'Provider',
  modelName: 'Model',
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
  pluginVersion: 'Plugin',
  positiveInteger: '{field} must be a positive integer.',
  testOk: 'Test read succeeded.',
  testFailed: 'Test read failed',
  noModel: 'Select a vision model and save before testing.',
  pasteToPath: 'Paste-to-path bridge',
  pasteToPathHint: 'Convert pasted images into workspace paths for text-only models. Leave off to keep pastes native.',
  reasoningEffort: 'Thinking effort',
  reasoningDefault: 'Default (model default)',
} as const

type LocaleKey = keyof typeof en

const zh: Record<LocaleKey, string> = {
  nav: '视觉工具',
  settingsTitle: '视觉工具',
  settingsIntro: '选择一个 DSH 应用内已配置的模型，让 vision_cloud_tool 通过它读取图片。',
  model: '视觉模型',
  modelHint: '保持“不开启”则不会注册 vision_cloud_tool；选择模型后立即生效。',
  off: '不开启（默认）',
  provider: '服务商',
  modelName: '模型',
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
  pluginVersion: '插件版本',
  positiveInteger: '{field}必须为正整数。',
  testOk: '测试读取成功。',
  testFailed: '测试读取失败',
  noModel: '请先选择视觉模型并保存，再测试读取。',
  pasteToPath: '粘贴路径桥',
  pasteToPathHint: '把粘贴的图片转换为工作区路径（供纯文本模型使用）。关闭则粘贴保持原生附件。',
  reasoningEffort: '思考程度',
  reasoningDefault: '默认（模型默认）',
}

type Translate = (key: LocaleKey, params?: Record<string, unknown>) => string

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    'vision-toolkit': LocaleKey
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
    throw new Error(failure.error?.message ?? `Vision Cloud request failed with HTTP ${response.status}`)
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

function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string | undefined }) {
  return <label className="dvt-field"><span>{label}</span>{children}{hint === undefined ? null : <small>{hint}</small>}</label>
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

  return (
    <div className="dvt-settings">
      <header className="dvt-settings-header">
        <div><span className="dvt-kicker">DSH plugin</span><h2>{t('settingsTitle')}</h2><p>{t('settingsIntro')}</p></div>
        <div className="dvt-release"><span>{t('pluginVersion')} <strong>{snapshot.pluginVersion}</strong></span></div>
      </header>
      {!snapshot.writable ? <div className="dvt-alert warning">{t('readOnly')}</div> : null}
      {draftError === undefined ? null : <div className="dvt-alert error">{draftError}</div>}
      {state.error === undefined ? null : <div className="dvt-alert error">{state.error}</div>}
      {state.message === 'saved' ? <div className="dvt-alert success">{t('saved')}</div> : null}
      {state.message === 'testOk' ? <div className="dvt-alert success">{t('testOk')}</div> : null}

      <section className="dvt-panel dvt-essential">
        <div className="dvt-panel-title"><div><h3>{t('model')}</h3><p>{t('modelHint')}</p></div><span className={`dvt-badge ${snapshot.enabled ? 'ok' : 'error'}`}>{snapshot.enabled && draft.model !== '' ? draft.model : t('off')}</span></div>
        <Field label={t('model')}>
          <select
            className="dvt-select"
            aria-label={t('model')}
            disabled={!snapshot.writable || busy}
            value={draft.provider !== '' && draft.model !== '' ? modelKey(draft.provider, draft.model) : ''}
            onChange={(event) => { applyModelSelection(event.target.value) }}
          >
            <option value="">{t('off')}</option>
            {providers.map(entry => (
              <optgroup key={entry.provider} label={entry.name}>
                {entry.models.map(model => (
                  <option key={model.id} value={modelKey(entry.provider, model.id)}>{model.name}</option>
                ))}
              </optgroup>
            ))}
          </select>
        </Field>
        {reasoningEfforts.length > 0 ? (
          <Field label={t('reasoningEffort')}>
            <select
              className="dvt-select"
              aria-label={t('reasoningEffort')}
              disabled={busy || draft.model === ''}
              value={draft.reasoningEffort}
              onChange={(event) => { update('reasoningEffort', event.target.value) }}
            >
              <option value="">{t('reasoningDefault')}</option>
              {reasoningEfforts.map(effort => <option key={effort} value={effort}>{effort}</option>)}
            </select>
          </Field>
        ) : null}
        <label className="dvt-check">
          <input type="checkbox" checked={draft.pasteToPath} disabled={busy} onChange={(event) => { update('pasteToPath', event.target.checked) }} />
          <span>{t('pasteToPath')}</span>
          <small>{t('pasteToPathHint')}</small>
        </label>
      </section>

      <div className="dvt-save-row">
        <Button variant="primary" disabled={!snapshot.writable || busy} onClick={save}>{state.action === 'save' ? t('saving') : t('save')}</Button>
        <Button variant="outline" disabled={busy || !snapshot.enabled} onClick={() => { void controller.testRead() }}>{state.action === 'test' ? t('testing') : t('testRead')}</Button>
        <Button variant="outline" disabled={busy} onClick={() => { void controller.load() }}>{t('reload')}</Button>
      </div>

      <details className="dvt-advanced">
        <summary><span><strong>{t('advanced')}</strong><small>{t('advancedHint')}</small></span><span className="dvt-details-chevron" aria-hidden="true">⌄</span></summary>
        <div className="dvt-advanced-body">
          <section className="dvt-panel"><div className="dvt-form-grid">
            <Field label={t('language')}><select className="dvt-select" aria-label={t('language')} disabled={busy} value={draft.language} onChange={(event) => { update('language', event.target.value as 'zh' | 'en') }}><option value="zh">中文</option><option value="en">English</option></select></Field>
            <Field label={t('timeout')}><Input aria-label={t('timeout')} inputMode="numeric" disabled={busy} value={draft.timeoutMs} onChange={(event) => { update('timeoutMs', event.target.value) }} /></Field>
            <Field label={t('maxBytes')}><Input aria-label={t('maxBytes')} inputMode="numeric" disabled={busy} value={draft.maxImageBytes} onChange={(event) => { update('maxImageBytes', event.target.value) }} /></Field>
            <Field label={t('maxPixels')}><Input aria-label={t('maxPixels')} inputMode="numeric" disabled={busy} value={draft.maxImagePixels} onChange={(event) => { update('maxImagePixels', event.target.value) }} /></Field>
            <Field label={t('concurrency')}><Input aria-label={t('concurrency')} inputMode="numeric" disabled={busy} value={draft.concurrency} onChange={(event) => { update('concurrency', event.target.value) }} /></Field>
            <Field label={t('maxImages')}><Input aria-label={t('maxImages')} inputMode="numeric" disabled={busy} value={draft.maxImages} onChange={(event) => { update('maxImages', event.target.value) }} /></Field>
            <Field label={t('allowedDirs')} hint={t('allowedDirsHint')}><textarea aria-label={t('allowedDirs')} rows={3} disabled={busy} value={draft.allowedDirs} onChange={(event) => { update('allowedDirs', event.target.value) }} /></Field>
          </div></section>
        </div>
      </details>
    </div>
  )
}

const CSS = `
.dvt-settings{display:grid;gap:14px;max-width:900px;padding:8px 2px 32px;color:var(--dsw-alias-label-primary)}
.dvt-settings-header{display:flex;justify-content:space-between;gap:20px;align-items:flex-start;padding:4px 2px 12px;margin-bottom:2px;border-bottom:1px solid var(--dsw-alias-border-l1)}.dvt-settings-header h2{font-size:20px;letter-spacing:-.02em;margin:3px 0 5px}.dvt-settings-header p{max-width:620px;margin:0;color:var(--dsw-alias-label-secondary);font-size:12px;line-height:1.5}.dvt-kicker{font-size:10px;text-transform:uppercase;letter-spacing:.1em;color:var(--dsw-alias-state-business-primary);font-weight:700}.dvt-release{display:grid;gap:4px;min-width:170px;padding:9px 11px;border-radius:10px;background:var(--dsw-alias-bg-layer-2);font-size:10px;color:var(--dsw-alias-label-secondary)}.dvt-release span{display:flex;justify-content:space-between;gap:12px;white-space:nowrap}.dvt-release strong{color:var(--dsw-alias-label-primary)}
.dvt-select{width:100%;height:32px;box-sizing:border-box;padding:0 30px 0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;appearance:none;-webkit-appearance:none;background-image:url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='14' height='14' viewBox='0 0 16 16'%3E%3Cpath d='M4 6l4 4 4-4' fill='none' stroke='%23888' stroke-width='1.5' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E");background-repeat:no-repeat;background-position:right 9px center;cursor:pointer}.dvt-select:hover{border-color:var(--dsw-alias-border-l2)}.dvt-select:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}.dvt-select:disabled{opacity:.55;cursor:default}.dvt-select optgroup{font-weight:650;color:var(--dsw-alias-label-secondary)}
.dvt-field textarea{width:100%;box-sizing:border-box;padding:8px 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:8px;background:var(--dsw-alias-bg-layer-1);color:var(--dsw-alias-label-primary);font:inherit;font-size:12px;resize:vertical;min-height:60px}.dvt-field textarea:focus{outline:2px solid var(--dsw-alias-state-business-primary);outline-offset:-1px}.dvt-field textarea:disabled{opacity:.55}
.dvt-check{display:grid;grid-template-columns:auto 1fr;align-items:center;column-gap:8px;row-gap:2px;cursor:pointer}.dvt-check input{width:14px;height:14px;margin:0;accent-color:var(--dsw-alias-state-business-primary);cursor:pointer}.dvt-check span{font-size:12px}.dvt-check small{grid-column:2;font-size:10px;color:var(--dsw-alias-label-caption);line-height:1.4}
.dvt-alert{padding:10px 12px;border-radius:10px;font-size:12px;line-height:1.5}.dvt-alert.warning{background:color-mix(in srgb,var(--dsw-alias-state-warn-primary) 12%,transparent);color:var(--dsw-alias-state-warn-label)}.dvt-alert.error{background:color-mix(in srgb,var(--dsw-alias-state-error-primary) 10%,transparent);color:var(--dsw-alias-state-error-primary)}.dvt-alert.success{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 10%,transparent);color:var(--dsw-alias-state-success-primary)}
.dvt-panel{display:grid;gap:12px;padding:15px;border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);box-shadow:var(--dsw-shadow-lv1)}.dvt-panel-title{display:flex;align-items:flex-start;justify-content:space-between;gap:12px}.dvt-panel-title h3{font-size:14px;margin:0}.dvt-panel-title p{font-size:11px;line-height:1.45;color:var(--dsw-alias-label-secondary);margin:4px 0 0;max-width:620px}.dvt-badge{font-size:10px;padding:3px 8px;border-radius:999px;white-space:nowrap}.dvt-badge.ok{background:color-mix(in srgb,var(--dsw-alias-state-success-primary) 14%,transparent);color:var(--dsw-alias-state-success-primary)}.dvt-badge.error{background:color-mix(in srgb,var(--dsw-alias-label-secondary) 14%,transparent);color:var(--dsw-alias-label-secondary)}
.dvt-form-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px}.dvt-field{display:grid;gap:5px}.dvt-field>span{font-size:11px;color:var(--dsw-alias-label-secondary)}.dvt-field small{font-size:10px;color:var(--dsw-alias-label-caption);line-height:1.4}
.dvt-save-row{display:flex;gap:8px;flex-wrap:wrap}.dvt-essential{border-color:color-mix(in srgb,var(--dsw-alias-state-business-primary) 30%,var(--dsw-alias-border-l1));box-shadow:var(--dsw-shadow-lv1),0 0 0 3px color-mix(in srgb,var(--dsw-alias-state-business-primary) 5%,transparent)}
.dvt-advanced{border:1px solid var(--dsw-alias-border-l1);border-radius:14px;background:var(--dsw-alias-bg-layer-1);overflow:hidden}.dvt-advanced>summary{display:flex;align-items:center;justify-content:space-between;gap:14px;padding:14px 15px;cursor:pointer;list-style:none}.dvt-advanced>summary::-webkit-details-marker{display:none}.dvt-advanced>summary>span:first-child{display:grid;gap:3px}.dvt-advanced>summary strong{font-size:13px}.dvt-advanced>summary small{font-size:10px;line-height:1.45;color:var(--dsw-alias-label-secondary);font-weight:400}.dvt-details-chevron{font-size:15px;opacity:.55;transition:transform .16s ease}.dvt-advanced[open] .dvt-details-chevron{transform:rotate(180deg)}.dvt-advanced-body{display:grid;gap:12px;padding:0 12px 12px}.dvt-advanced-body>.dvt-panel{box-shadow:none}
.dvt-loading{padding:24px;border-radius:12px;background:var(--dsw-alias-bg-layer-2);font-size:12px;color:var(--dsw-alias-label-secondary)}
.dvt-paste-dock{box-sizing:border-box;width:calc(100% - 32px);max-width:var(--dsh-composer-card-max-width,960px);margin:0 auto;display:flex;flex-wrap:wrap;gap:6px;padding:0 2px 6px}.dvt-paste-chip{max-width:100%;height:32px;box-sizing:border-box;display:flex;align-items:center;gap:7px;padding:0 6px 0 10px;border:1px solid var(--dsw-alias-border-l1);border-radius:9px;background:var(--dsw-specific-tip);font-size:12px}.dvt-paste-chip[data-status=copying]{border-color:var(--dsw-alias-state-business-primary)}.dvt-paste-chip[data-status=error]{border-color:var(--dsw-alias-state-error-primary)}.dvt-paste-name{max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dvt-paste-detail{color:var(--dsw-alias-label-caption);max-width:260px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.dvt-paste-chip[data-status=error] .dvt-paste-detail{color:var(--dsw-alias-state-error-primary)}.dvt-paste-chip button{width:20px;height:20px;display:grid;place-items:center;border:0;border-radius:50%;padding:0;background:transparent;color:var(--dsw-alias-label-caption);font:inherit;font-size:16px;cursor:pointer}.dvt-paste-chip button:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.dvt-paste-chip button:disabled{opacity:.4;cursor:default}
@media(max-width:720px){.dvt-settings-header{display:grid}.dvt-form-grid{grid-template-columns:1fr}.dvt-panel-title{flex-direction:column}}
`

function installStyles(): () => void {
  const id = '@anionex/dsh-vision-toolkit/client'
  const existing = document.querySelector<HTMLStyleElement>(`style[data-plugin-css="${id}"]`)
  if (existing !== null) return () => {}
  const style = document.createElement('style')
  style.dataset.plugin = '@anionex/dsh-vision-toolkit'
  style.dataset.pluginCss = id
  style.textContent = CSS
  document.head.appendChild(style)
  return () => { style.remove() }
}

/** Required client services. */
export const inject = ['slots', 'locale', 'remote', 'conversation', 'sessions']

/** Register the Vision Settings section and the paste-to-path bridge. */
export function apply(ctx: ClientContext): void {
  ctx.effect(installStyles, 'dsh-vision-toolkit: styles')
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'dsh-vision-toolkit: locale')
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
  }, 'dsh-vision-toolkit: Settings invalidations')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section',
    id: 'vision-toolkit',
    order: 30,
    label: () => t('nav'),
    inject: () => ({ controller, t }),
  }, SettingsSection))
}
