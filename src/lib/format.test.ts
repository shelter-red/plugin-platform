import { describe, expect, it, vi } from 'vitest'

vi.stubGlobal('window', { localStorage: { getItem: () => null } })
vi.stubGlobal('document', { documentElement: { lang: '' } })
const { formatBytes } = await import('./format')

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1024, '1 KiB'],
    [1024 * 1024, '1 MiB'],
    [5_000_000_000, '4.66 GiB'],
    [100 * 1024 ** 2, '100 MiB'],
  ])('formats %i bytes as %s', (value, expected) => {
    expect(formatBytes(value)).toBe(expected)
  })

  it.each([-1, Number.NaN, Number.POSITIVE_INFINITY])('rejects invalid byte count %s', (value) => {
    expect(formatBytes(value)).toBeNull()
  })
})
