import { describe, expect, it } from 'vitest'
import { normalizeDshFileReference } from '../src/file-references.ts'
import { resolveModelCapability } from '../src/model-capability.ts'
import { collectImageInputs } from '../src/vision-context.ts'
import { splitContent } from '../src/client/user-message-view.tsx'

type ContractFixture = {
  name: string
  llm: Record<string, unknown>
  content: readonly unknown[]
}

const fixtures: ContractFixture[] = [
  {
    name: 'rc6 legacy resolver and content blocks',
    llm: {
      resolveModelInfo: async () => ({ inputModalities: ['text'] }),
    },
    content: [{ type: 'text', text: '@image.png' }, { type: 'image', attachment: { attachmentId: 'sha256:rc6' } }],
  },
  {
    name: 'rc7 resolver plus exact catalog fallback',
    llm: {
      resolveModelInfo: async () => { throw new Error('catalog-only fixture') },
      listModels: async () => [{ id: 'model-rc7', inputModalities: ['text', 'image'] }],
    },
    content: [{ type: 'text', text: '@"space image.webp"' }, { type: 'tool-result', content: [] }],
  },
  {
    name: 'rc8 extensible unknown block',
    llm: {
      resolveModelInfo: async () => ({ inputModalities: [] }),
      listModels: async () => [{ id: 'model-rc8', inputModalities: [] }],
    },
    content: [{ type: 'text', text: '@[session](dsh-session:rc8) @agent' }, { type: 'future-rc8-block', payload: {} }],
  },
]

describe('DSH release compatibility contracts', () => {
  it.each(fixtures)('$name keeps the public plugin contracts shape-tolerant', async fixture => {
    const capability = await resolveModelCapability(fixture.llm, 'provider', fixture.name.includes('rc7') ? 'model-rc7' : fixture.name.includes('rc8') ? 'model-rc8' : 'model')
    expect(['image', 'text', 'unknown']).toContain(capability)

    const split = splitContent(fixture.content)
    expect(split.text).toBeTypeOf('string')
    expect(split.images).toBeInstanceOf(Array)
    expect(split.rest).toBeInstanceOf(Array)

    const session = { events: [{ data: { kind: 'user', content: fixture.content } }] }
    const inputs = collectImageInputs(session as never)
    expect(inputs.attachments).toBeInstanceOf(Array)
    expect(inputs.paths).toBeInstanceOf(Array)
    expect(inputs.urls).toBeInstanceOf(Array)
  })

  it.each([
    ['0.1.0-rc.6', '@image.png', 'image.png'],
    ['0.1.0-rc.7', '@./image.png', './image.png'],
    ['0.1.0-rc.8', '@"image with spaces.png"', 'image with spaces.png'],
  ])('%s accepts the same DSH file reference contract', (_release, raw, expected) => {
    expect(normalizeDshFileReference(raw)).toEqual({ kind: 'file', value: expected })
  })
})
