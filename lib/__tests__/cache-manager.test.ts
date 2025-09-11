import { describe, it, expect } from 'vitest'
import { CacheManager } from '../cache-manager'

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms))
}

describe('CacheManager.safeStringify', () => {
  it('produces stable output for different key orders', () => {
    const a = { b: 1, a: 2, c: { y: 2, x: 1 } }
    const b = { a: 2, b: 1, c: { x: 1, y: 2 } }
    const sa = CacheManager.safeStringify(a)
    const sb = CacheManager.safeStringify(b)
    expect(sa).toBe(sb)
  })
})

describe('CacheManager basic caching', () => {
  it('deduplicates inflight fetches for same key', async () => {
    const cm = new CacheManager(60_000)
    let calls = 0
    const fetcher = async () => {
      calls++
      await sleep(20)
      return 42
    }

    const p1 = cm.getOrFetch<number>('test', 'key', fetcher)
    const p2 = cm.getOrFetch<number>('test', 'key', fetcher)
    const [r1, r2] = await Promise.all([p1, p2])

    expect(r1).toBe(42)
    expect(r2).toBe(42)
    expect(calls).toBe(1)
  })

  it('respects ttl and expires entries', async () => {
    const cm = new CacheManager(60_000)
    await cm.getOrFetch('ttl', 'k', async () => 'x', { ttl: 5 })
    expect(cm.has('ttl', 'k')).toBe(true)
    await sleep(15)
    // has() triggers expiry check internally
    expect(cm.has('ttl', 'k')).toBe(false)
  })

  it('invalidates by tag', async () => {
    const cm = new CacheManager(60_000)
    await cm.getOrFetch('t', 'a', async () => 'A', { tags: ['group1'] })
    await cm.getOrFetch('t', 'b', async () => 'B', { tags: ['group2'] })
    expect(cm.has('t', 'a')).toBe(true)
    expect(cm.has('t', 'b')).toBe(true)

    const n = cm.invalidateByTag('group1')
    expect(n).toBe(1)
    expect(cm.has('t', 'a')).toBe(false)
    expect(cm.has('t', 'b')).toBe(true)
  })
})

