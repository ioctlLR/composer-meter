import type { PlaceSnap } from '../types'
import { widthOf } from './width'

// Where the session is, for the footer's right: its directory and git's HEAD. register.tsx
// reads them from the files git keeps, so no git process runs.

export const slashed = (path: string): string => path.replace(/\\/g, '/').replace(/(.)\/+$/, '$1')

// The directory, with the home directory as `~`.
export function homePath(cwd: string, home: string | undefined): string {
  const path = slashed(cwd)
  const root = home === undefined || home === '' ? '' : slashed(home)

  if (root === '' || root === '/') {
    return path
  }

  return path === root ? '~' : path.startsWith(`${root}/`) ? `~${path.slice(root.length)}` : path
}

// HEAD's text as a label: the branch whole, or `detached` and the commit's short hash.
export function headLabel(head: string): string | null {
  const text = head.trim()
  const ref = /^ref:\s*(\S+)$/.exec(text)?.[1]

  if (ref !== undefined) {
    return ref.replace(/^refs\/heads\//, '')
  }

  return /^[0-9a-f]{7,}$/i.test(text) ? `detached ${text.slice(0, 7)}` : null
}

// A worktree's or submodule's `.git` is a file naming the real git directory, absolute
// or relative to where the file is.
export function gitDirOf(pointer: string, dir: string): string | null {
  const target = /^gitdir:\s*(.+)$/m.exec(pointer)?.[1]?.trim()

  if (target === undefined || target === '') {
    return null
  }

  return /^([a-z]:)?\//i.test(slashed(target)) ? slashed(target) : `${dir}/${slashed(target)}`
}

// The directory above, or null at the top: `/`, or a drive (`C:`).
export const parentOf = (dir: string): string | null => {
  const cut = dir.lastIndexOf('/')

  return cut < 0 || dir === '/' ? null : cut === 0 ? '/' : dir.slice(0, cut)
}

// The place in `budget` cells: the branch whole, the path cut from its left at a
// directory boundary, never past its last directory.
export function fitPlace(place: PlaceSnap, glyph: string, budget: number): string {
  const tail = place.head === null ? '' : ` ${glyph} ${place.head}`
  const room = budget - widthOf(tail)
  const parts = place.path.split('/')

  if (widthOf(place.path) <= room || parts.length === 1) {
    return place.path + tail
  }

  let kept = parts.at(-1) ?? ''

  for (let i = parts.length - 2; i >= 0; i--) {
    const wider = `${parts[i]}/${kept}`

    if (widthOf(`…/${wider}`) > room) {
      break
    }

    kept = wider
  }

  return `…/${kept}${tail}`
}
