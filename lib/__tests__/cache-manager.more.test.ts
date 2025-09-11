import { describe, it, expect, beforeEach } from 'vitest'
import { CacheManager, cacheManager, createBatcher } from '../cache-manager'

function sleep(ms: number) {
  return new Promise((res) => setTimeout(res, ms))
}

// Ensure localStorage is clean per test that uses it
beforeEach(() => {
  if (typeof window !== 'undefined' && window.localStorage) {
    window.localStorage.clear()
  }
})

describe('CacheManager cleanup and stats', () => {
  it('cleanup removes expired and returns count', async () => {
    const cm = new CacheManager(60_000)
    // Insert two entries with very short TTL
    await cm.getOrFetch('c1', 'a', async () => 'A', { ttl: 5 })
    await cm.getOrFetch('c1', 'b', async () => 'B', { ttl: 5 })
    expect(cm.getStats().totalEntries).toBeGreaterThanOrEqual(2)
    await sleep(15)

    // Before cleanup, they still count as entries but should be expired in stats
    const statsBefore = cm.getStats()
    expect(statsBefore.cacheDetails?.c1.expired).toBe(2)

    const removed = cm.cleanup()
    expect(removed).toBe(2)
    // After cleanup, entries are gone
    expect(cm.has('c1', 'a')).toBe(false)
    expect(cm.has('c1', 'b')).toBe(false)
  })

  it('getStats counts entries and expired correctly', async () => {
    const cm = new CacheManager(60_000)
    await cm.getOrFetch('s1', 'live', async () => 'ok', { ttl: 10_000 })
    await cm.getOrFetch('s1', 'old', async () => 'old', { ttl: 5 })
    await sleep(15)

    const stats = cm.getStats()
    expect(stats.caches.length).toBeGreaterThan(0)
    expect(stats.cacheDetails?.s1.entries).toBe(2)
    expect(stats.cacheDetails?.s1.expired).toBe(1)
  })
})

describe('CacheManager inflight error handling', () => {
  it('clears inflight on error so retries can succeed', async () => {
    const cm = new CacheManager(60_000)
    let calls = 0
    const failing = async () => {
      calls++
      await sleep(5)
      throw new Error('boom')
    }

    // Two concurrent calls should share inflight and both reject
    await expect(Promise.all([
      cm.getOrFetch('err', 'k', failing).catch((e) => { throw e }),
      cm.getOrFetch('err', 'k', failing).catch((e) => { throw e }),
    ])).rejects.toThrow('boom')
    expect(calls).toBe(1)

    // Subsequent call with success should execute again (not stuck inflight)
    const ok = async () => {
      calls++
      return 123
    }
    const value = await cm.getOrFetch('err', 'k', ok)
    expect(value).toBe(123)
    expect(calls).toBe(2)
  })
})

describe('CacheManager localStorage hydration', () => {
  it('hydrates from localStorage and rebuilds tag index', async () => {
    const cm1 = new CacheManager(60_000)
    await cm1.getOrFetch('ls', 'x', async () => 'value', { tags: ['t1', 't2'], ttl: 10_000 })
    expect(cm1.has('ls', 'x')).toBe(true)

    // New instance simulates a reload/rehydration scenario
    const cm2 = new CacheManager(60_000)
    const v = cm2['get']?.('ls', 'x') as unknown as string | null // use method via indexer to avoid TS private restriction in tests
    // If private access is blocked by TS, fallback to public path:
    const value = v ?? await cm2.getOrFetch('ls', 'x', async () => 'miss')
    expect(value).toBe('value')

    // Invalidate by tag should remove the hydrated entry
    const n = cm2.invalidateByTag('t1')
    expect(n).toBe(1)
    expect(cm2.has('ls', 'x')).toBe(false)
  })
})

describe('createBatcher', () => {
  it('batches multiple keys within delay and resolves correctly', async () => {
    // Use a unique cache name to avoid interference across tests
    const cacheName = 'batch-' + Math.random().toString(36).slice(2)
    let handlerCalls = 0

    const enqueue = createBatcher<{ id: number }, number>({
      cacheName,
      delayMs: 20,
      ttl: 1000,
      tags: ['batched'],
      async handler(entries) {
        handlerCalls++
        // Resolve each entry value as id*2
        for (const entry of entries) {
          entry.resolve(entry.original.id * 2)
        }
      },
    })

    const p1 = enqueue({ id: 2 })
    const p2 = enqueue({ id: 3 })
    const [r1, r2] = await Promise.all([p1, p2])
    expect([r1, r2]).toEqual([4, 6])
    expect(handlerCalls).toBe(1)

    // Subsequent call for same key should hit cache
    const r1b = await enqueue({ id: 2 })
    expect(r1b).toBe(4)
  })

  it('rejects unhandled keys in handler', async () => {
    const cacheName = 'batch-miss-' + Math.random().toString(36).slice(2)
    const enqueue = createBatcher<{ id: number }, number>({
      cacheName,
      delayMs: 10,
      async handler(entries) {
        // Only resolve first entry, leave the rest to be auto-rejected
        if (entries[0]) entries[0].resolve(entries[0].original.id)
      },
    })

    const p1 = enqueue({ id: 1 })
    const p2 = enqueue({ id: 2 })
    await expect(p1).resolves.toBe(1)
    await expect(p2).rejects.toBeInstanceOf(Error)
  })
})

describe('cached decorator utility', () => {
  it('caches method results and respects keyGenerator', async () => {
    // Create a class and manually apply the decorator to avoid TS decorator config
    class Svc {
      count = 0
      async compute(a: number, b: number) {
        this.count++
        await sleep(5)
        return a + b
      }
    }

    const svc = new Svc()
    const desc = Object.getOwnPropertyDescriptor(Svc.prototype, 'compute')!
    const decorated = (await import('../cache-manager')).cached(
      'decorator-test',
      (a: number, b: number) => `k:${a},${b}`,
      { ttl: 1000 }
    )
    decorated(Svc.prototype, 'compute', desc)
    Object.defineProperty(Svc.prototype, 'compute', desc)

    // First call computes
    const r1 = await (svc as any).compute(1, 2)
    // Second call with same args hits cache
    const r2 = await (svc as any).compute(1, 2)
    expect(r1).toBe(3)
    expect(r2).toBe(3)
    expect(svc.count).toBe(1)
  })
})

