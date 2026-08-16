import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

/**
 * Validate the built `lib/client.js` plugin bundle against the DSH
 * client-modules contract:
 * - the bundle only REGISTERS a factory; side effects run at materialization;
 * - the factory's synchronous `require(spec)` resolves seed words (react et
 *   al.) from the host table;
 * - local specifiers must resolve through the bundle's private `__modules`
 *   table (`./<name>.js`), never re-enter the host `require`.
 *
 * The bundle is executed via `Function` (exactly how the product shell runs
 * it: a plain script load) rather than through vitest's module transform,
 * which rewrites this generated file and breaks on its layout.
 *
 * Regression: a local import lacking its `.tsx`/`.ts` suffix compiles to
 * `require("./user-message-view")` with no build rewrite applied, so the
 * loader fell back to the host `require`, which failed with "missed the
 * module table" (the DSH loader only answers registered factories;
 * cross-plugin imports are forbidden) and the client entry was dropped from
 * the web profile ("failed to import loader entry").
 */

const libRoot = join(dirname(dirname(fileURLToPath(import.meta.url))), 'lib')
const bundleSource = readFileSync(join(libRoot, 'client.js'), 'utf8')

describe('lib/client.js runtime bundle', () => {
  it('rewrites every local import to a .js module-table key', () => {
    expect(bundleSource).toContain('__load_("./user-message-view.js")')
    expect(bundleSource).toContain('__load_("./paste-images.js")')
    expect(bundleSource).not.toContain('__load_("./user-message-view")')
    expect(bundleSource).toContain('__modules["./user-message-view.js"]')
  })

  it('materializes the client entry with no host-table misses', () => {
    const registry = new Map<string, { exports: unknown }>()
    const register = (id: string, exports: unknown): void => {
      registry.set(id, { exports })
    }

    // The DSH seed table the "web" profile boot manifest answers to plugin
    // factories (bundled frontend `staticModules`), stubbed with the values
    // the product build actually uses at module scope.
    register('react', {
      useState: (initial: unknown) => [initial, () => undefined],
      useEffect: () => undefined,
      useCallback: (fn: unknown) => fn,
      useMemo: () => () => undefined,
      useRef: () => ({ current: undefined }),
      useSyncExternalStore: () => 0,
      memo: (fn: unknown) => fn,
      createElement: (type: string) => ({ type, props: {} }),
      Fragment: undefined,
      type: {} as unknown,
    })
    register('react/jsx-runtime', { jsx: () => ({ type: 'jsx', props: {} }), jsxs: () => ({ type: 'jsxs', props: {} }) })
    register('react-dom', { createPortal: (node: unknown) => node })
    register('@deepseek-ai/dsh-client-ui-primitives', {
      Button: () => undefined,
      Input: () => undefined,
      Card: () => undefined,
      Group: () => undefined,
      IconWithText: () => undefined,
      toggleType: 'slider',
    })

    const hostRequire = (spec: string): unknown => {
      const entry = registry.get(spec)
      if (entry === undefined) {
        throw new Error(`unexpected host require ${JSON.stringify(spec)}`)
      }
      return entry.exports
    }

    const handoffs: Array<{ id: string; factory: (require: (spec: string) => unknown) => unknown }> = []
    const fakeWindow = {
      __ModuleLoader__: {
        load: (handoff: { id: string; factory: (require: (spec: string) => unknown) => unknown }) => {
          handoffs.push(handoff)
        },
      },
    }
    // The product shell loads plugin bundles as plain scripts, so run the
    // artifact the same way instead of through vitest's module transform.
    Function('window', bundleSource)(fakeWindow)

    expect(handoffs.map(handoff => handoff.id)).toEqual(['dsh-vision-cloud'])

    // Simulate what the DSH module loader does when the host imports the
    // client entry: it materializes the registered factory with its own
    // `require` (seed → static → memoized → registered factory).
    const handoff = handoffs[0]!
    const exports = handoff.factory(hostRequire) as { apply?: unknown }
    expect(exports.apply).toBeDefined()
  })
})