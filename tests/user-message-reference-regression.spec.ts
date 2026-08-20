// @vitest-environment jsdom

import { describe, expect, it } from 'vitest'
import { createElement } from 'react'
import { render } from '@testing-library/react'
import { splitContent, UserMessageNodeShadow } from '../src/client/user-message-view.tsx'

describe('user message reference regression', () => {
  it('does not send unknown future blocks to JsonBlock by default', () => {
    const unknown = { type: 'future-rc8-block', payload: { path: 'x.png' } }
    const { container } = render(createElement(UserMessageNodeShadow, {
      node: { data: { content: [unknown] } },
      t: (key: string) => key,
    } as never))
    expect(container.querySelector('[data-primitives="json-block"]')).toBeNull()
  })

  it('does not decorate @file references as agent chips', () => {
    const { container } = render(createElement(UserMessageNodeShadow, {
      node: { data: { content: [{ type: 'text', text: '@image.png @"image with spaces.png" @agent /skill' }] } },
      t: (key: string) => key,
    } as never))
    const chips = Array.from(container.querySelectorAll('.dvt-ref-chip'))
    expect(chips.map(chip => chip.textContent)).toEqual([' @agent', ' /skill'])
  })
})
