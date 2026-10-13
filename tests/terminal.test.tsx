import type { On, RenderElement } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import { metersOf, modelName } from '../hooks/band'
import { fitPlace, gitDirOf, headLabel, homePath } from '../hooks/place'

const STOCK: RenderElement = { type: 'Text', props: {}, children: ['stock row'] }

const FOOTER = (surface: 'terminal' | 'desktop', modes: readonly string[] = [], columns = 100) =>
  ({
    plugin: 'composer-meter',
    viewport: { columns, rows: 30 },
    surface,
    component: 'SessionMode',
    requestId: 'modes',
    props: { modes },
  }) as const

const BAND = (surface: 'terminal' | 'desktop') =>
  ({
    plugin: 'composer-meter',
    viewport: { columns: 120, rows: 30 },
    surface,
    component: 'AbovePrompt',
    requestId: 'band',
    props: { hasSurvey: false, isWorking: false, maxRows: 10, bodyColumns: 115, scroll: {}, view: {} } as never,
  }) as const

// A file tree by path: a string is a file's text, null a directory.
type Tree = Record<string, string | null>

function stubEngine(on: On, cwd: string, tree: Tree) {
  mock.clock(on, { now: 10_000 })
  mock.env(on, { HOME: '/home/me' })
  on('session.cwd', () => ({ value: cwd }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('session.usage', () => ({
    value: {
      startedAt: 0,
      context: { window: 200000, percent: 37 },
      rateLimits: [
        { kind: 'five_hour', percentUsed: 12 },
        { kind: 'seven_day', percentUsed: 85 },
      ],
      cost: { usd: 1.234 },
    } as never,
  }))
  on('config.list', () => ({ value: [{ key: 'effortLevel', label: 'Effort', value: 'high' }] as never }))
  on('session.start', () => ({ cwd }))
  on('ui.render', () => STOCK)
  on('fs.stat', (_$, e) => {
    if (!(e.path in tree)) throw new Error(`ENOENT: ${e.path}`)
    return { value: { kind: tree[e.path] === null ? 'dir' : 'file', size: 0, mtimeMs: 0, isLink: false } }
  })
  on('fs.read', (_$, e) => {
    const text = tree[e.path]
    if (typeof text !== 'string') throw new Error(`ENOENT: ${e.path}`)
    return { value: text }
  })
}

const REPO: Tree = {
  '/home/me/src/app/.git': null,
  '/home/me/src/app/.git/HEAD': 'ref: refs/heads/feature/long-branch-name\n',
}

test('HEAD reads as the branch whole, or detached with a short hash', () => {
  expect(headLabel('ref: refs/heads/main\n')).toBe('main')
  expect(headLabel('ref: refs/heads/feature/x\n')).toBe('feature/x')
  expect(headLabel('1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b\n')).toBe('detached 1a2b3c4')
  expect(headLabel('garbage')).toBeNull()
})

test('a .git file points at the real git directory, absolute or relative', () => {
  expect(gitDirOf('gitdir: /r/.git/worktrees/w\n', '/w')).toBe('/r/.git/worktrees/w')
  expect(gitDirOf('gitdir: ../.git/modules/sub\n', '/r/sub')).toBe('/r/sub/../.git/modules/sub')
  expect(gitDirOf('nonsense', '/r')).toBeNull()
})

test('the home directory shows as ~', () => {
  expect(homePath('/home/me/src/app', '/home/me')).toBe('~/src/app')
  expect(homePath('/home/me', '/home/me/')).toBe('~')
  expect(homePath('/home/meow/x', '/home/me')).toBe('/home/meow/x')
  expect(homePath('/srv/x', undefined)).toBe('/srv/x')
})

test('the path gives way from its left, down to its last directory; the branch never', () => {
  const place = { path: '~/src/deeply/nested/app', head: 'feature/long-branch-name' }
  expect(fitPlace(place, '⎇', 80)).toBe('~/src/deeply/nested/app ⎇ feature/long-branch-name')
  expect(fitPlace(place, '⎇', 40)).toBe('…/nested/app ⎇ feature/long-branch-name')
  expect(fitPlace(place, '⎇', 10)).toBe('…/app ⎇ feature/long-branch-name')
  expect(fitPlace({ path: '~/src/app', head: null }, '⎇', 6)).toBe('…/app')
})

test('meters fill in eighths and warn from 80%; cost drops the plan windows', () => {
  const usage = { context: 37, limits: [{ label: '5h', percent: 12 }, { label: '7d', percent: 96 }] }
  expect(metersOf(usage, true)).toEqual([
    { label: 'context', percent: 37, bar: '▰▰▰▱▱▱▱▱', tone: 'normal' },
    { label: '5h', percent: 12, bar: '▰▱▱▱▱▱▱▱', tone: 'normal' },
    { label: '7d', percent: 96, bar: '▰▰▰▰▰▰▰▰', tone: 'error' },
  ])
  expect(metersOf(usage, false).map(m => m.label)).toEqual(['context'])
  expect(metersOf({ context: null, limits: [] }, true)).toEqual([])
})

test('model ids read as their names', () => {
  expect(modelName('claude-opus-5-5')).toBe('Opus 5.5')
  expect(modelName('claude-opus-5-5[1m]')).toBe('Opus 5.5')
  expect(modelName('claude-fable-5-1')).toBe('Fable 5.1')
  expect(modelName('claude-opus-5')).toBe('Opus 5')
  expect(modelName('claude-sonnet-4-5-20250929')).toBe('Sonnet 4.5')
  expect(modelName('claude-opus-4-20250514')).toBe('Opus 4')
  expect(modelName('us.anthropic.claude-opus-4-1-20250805-v1:0')).toBe('Opus 4.1')
  expect(modelName('claude-haiku-4-5@20251001')).toBe('Haiku 4.5')
  expect(modelName('claude-3-5-sonnet-20241022')).toBe('Sonnet 3.5')
  expect(modelName('claude-3-opus-20240229')).toBe('Opus 3')
  expect(modelName('gpt-oss')).toBe('gpt-oss')
})

test('the terminal band shows context, cost, model and effort; the desktop keeps its own', async ($, on) => {
  stubEngine(on, '/home/me/src/app', REPO)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/home/me/src/app' })

  const terminal = await $.ui.mount(BAND('terminal'))
  expect(await terminal.find({ type: 'Text', text: '▰▰▰▱▱▱▱▱' })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /37% context/ })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: /7d/ })).toBeUndefined()
  expect(await terminal.find({ type: 'Text', text: '$1.23' })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: 'Opus 5.5' })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: / · high/ })).toBeDefined()
  expect(await terminal.find({ type: 'Text', text: 'stock row' })).toBeDefined()
  await terminal.unmount()

  const desktop = await $.ui.mount(BAND('desktop'))
  expect(await desktop.find({ type: 'Text', text: /context/ })).toBeUndefined()
  await desktop.unmount()
})

test('the terminal footer shows the directory and branch; the desktop keeps cost and cache', async ($, on) => {
  stubEngine(on, '/home/me/src/app/hooks', REPO)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/home/me/src/app/hooks' })

  const terminal = await $.ui.mount(FOOTER('terminal'))
  expect(await terminal.find({ type: 'Text', text: '~/src/app/hooks ⎇ feature/long-branch-name' })).toBeDefined()
  await terminal.unmount()

  const desktop = await $.ui.mount(FOOTER('desktop'))
  expect(await desktop.find({ type: 'Text', text: /⎇/ })).toBeUndefined()
  expect(await desktop.find({ type: 'Text', text: /\$1\.23/ })).toBeDefined()
  await desktop.unmount()
})

test("the engine's mode labels stay, and the path gives way for them", async ($, on) => {
  stubEngine(on, '/home/me/src/app/hooks', REPO)
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/home/me/src/app/hooks' })

  const footer = await $.ui.mount(FOOTER('terminal', ['focus'], 86))
  expect(await footer.find({ type: 'Text', text: 'stock row' })).toBeDefined()
  expect(await footer.find({ type: 'Text', text: '…/hooks ⎇ feature/long-branch-name' })).toBeDefined()
})

test('a worktree reads its own HEAD', async ($, on) => {
  stubEngine(on, '/home/me/wt', {
    '/home/me/wt/.git': 'gitdir: /home/me/src/app/.git/worktrees/wt\n',
    '/home/me/src/app/.git/worktrees/wt/HEAD': '1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b\n',
  })
  await $.session.start({ surface: 'terminal', isInteractive: true, cwd: '/home/me/wt' })

  const footer = await $.ui.mount(FOOTER('terminal'))
  expect(await footer.find({ type: 'Text', text: '~/wt ⎇ detached 1a2b3c4' })).toBeDefined()
})
