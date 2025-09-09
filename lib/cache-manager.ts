/**
 * Centralized cache management for yappr
 * Provides coordinated caching with proper invalidation strategies
 */

export interface CacheEntry<T> {
  data: T
  timestamp: number
  ttl: number
  tags?: string[]
}

export interface CacheOptions {
  ttl?: number
  tags?: string[]
}

export class CacheManager {
  private caches = new Map<string, Map<string, CacheEntry<any>>>()
  private tagIndex = new Map<string, Set<string>>()
  private inflight = new Map<string, Promise<any>>()
  private batchQueues = new Map<string, {
    keys: Set<string>
    resolvers: Map<string, { resolve: (v: any) => void, reject: (e: any) => void }>
    timer?: number | NodeJS.Timeout
    options: CacheOptions & { delayMs: number }
    handler: (keys: string[]) => Promise<Record<string, any>>
  }>()
  private cleanupInterval?: NodeJS.Timeout
  private storagePrefix = 'yappr_cache:'

  constructor(private defaultTtl: number = 300000) { // 5 minutes default
    this.startCleanup()
  }

  /**
   * Get or create a named cache
   */
  private getCache(cacheName: string): Map<string, CacheEntry<any>> {
    if (!this.caches.has(cacheName)) {
      this.caches.set(cacheName, new Map())
    }
    return this.caches.get(cacheName)!
  }

  /**
   * Set a cache entry
   */
  private set<T>(
    cacheName: string,
    key: string,
    data: T,
    options: CacheOptions = {}
  ): void {
    const cache = this.getCache(cacheName)
    const { ttl = this.defaultTtl, tags = [] } = options

    const entry: CacheEntry<T> = {
      data,
      timestamp: Date.now(),
      ttl,
      tags
    }

    cache.set(key, entry)

    // Update tag index
    const cacheKey = `${cacheName}:${key}`
    tags.forEach(tag => {
      if (!this.tagIndex.has(tag)) {
        this.tagIndex.set(tag, new Set())
      }
      this.tagIndex.get(tag)!.add(cacheKey)
    })

    // Persist to localStorage if available
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const storageKey = this.storagePrefix + cacheKey
        window.localStorage.setItem(storageKey, JSON.stringify(entry))
      } catch (e) {
        // Ignore storage errors (e.g., quota)
        console.warn('CacheManager: persist failed', e)
      }
    }
  }

  /**
   * Get a cache entry
   */
  private get<T>(cacheName: string, key: string): T | null {
    const cache = this.getCache(cacheName)
    let entry = cache.get(key)

    if (!entry) {
      // Try to hydrate from localStorage
      if (typeof window !== 'undefined' && window.localStorage) {
        const cacheKey = `${cacheName}:${key}`
        const storageKey = this.storagePrefix + cacheKey
        const raw = window.localStorage.getItem(storageKey)
        if (raw) {
          try {
            const parsed = JSON.parse(raw) as CacheEntry<T>
            entry = parsed
            cache.set(key, parsed)
            // Rebuild tag index lazily
            const tags = parsed.tags || []
            tags.forEach(tag => {
              if (!this.tagIndex.has(tag)) this.tagIndex.set(tag, new Set())
              this.tagIndex.get(tag)!.add(cacheKey)
            })
          } catch {
            // Corrupt entry; remove
            window.localStorage.removeItem(storageKey)
          }
        }
      }
      if (!entry) return null
    }

    // Check if expired
    if (Date.now() - entry.timestamp > entry.ttl) {
      this.delete(cacheName, key)
      return null
    }

    return entry.data
  }

  /**
   * Check if a cache entry exists and is valid
   */
  has(cacheName: string, key: string): boolean {
    return this.get(cacheName, key) !== null
  }

  /**
   * Delete a specific cache entry
   */
  delete(cacheName: string, key: string): boolean {
    const cache = this.getCache(cacheName)
    const entry = cache.get(key)
    
    if (entry) {
      // Remove from tag index
      const cacheKey = `${cacheName}:${key}`
      entry.tags?.forEach(tag => {
        this.tagIndex.get(tag)?.delete(cacheKey)
        if (this.tagIndex.get(tag)?.size === 0) {
          this.tagIndex.delete(tag)
        }
      })
    }

    const deleted = cache.delete(key)

    // Remove from localStorage
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const storageKey = this.storagePrefix + `${cacheName}:${key}`
        window.localStorage.removeItem(storageKey)
      } catch {}
    }

    return deleted
  }

  /**
   * Clear all entries in a named cache
   */
  clear(cacheName: string): void {
    const cache = this.getCache(cacheName)
    
    // Remove all entries from tag index
    for (const [key, entry] of Array.from(cache.entries())) {
      const cacheKey = `${cacheName}:${key}`
      entry.tags?.forEach(tag => {
        this.tagIndex.get(tag)?.delete(cacheKey)
        if (this.tagIndex.get(tag)?.size === 0) {
          this.tagIndex.delete(tag)
        }
      })
    }
    
    cache.clear()

    // Remove from localStorage
    if (typeof window !== 'undefined' && window.localStorage) {
      const prefix = this.storagePrefix + cacheName + ':'
      try {
        const keys = Object.keys(window.localStorage)
        for (const k of keys) {
          if (k.startsWith(prefix)) window.localStorage.removeItem(k)
        }
      } catch {}
    }
  }

  /**
   * Invalidate all cache entries with specific tags
   */
  invalidateByTag(tag: string): number {
    const entries = this.tagIndex.get(tag)
    if (!entries) {
      return 0
    }

    let invalidated = 0
    for (const cacheKey of Array.from(entries)) {
      const [cacheName, key] = cacheKey.split(':', 2)
      if (this.delete(cacheName, key)) {
        invalidated++
      }
    }

    return invalidated
  }

  /**
   * Invalidate multiple tags
   */
  invalidateByTags(tags: string[]): number {
    let totalInvalidated = 0
    tags.forEach(tag => {
      totalInvalidated += this.invalidateByTag(tag)
    })
    return totalInvalidated
  }

  /**
   * Get cache statistics
   */
  getStats(cacheName?: string): {
    caches: string[]
    totalEntries: number
    totalTags: number
    cacheDetails?: { [cacheName: string]: { entries: number; expired: number } }
  } {
    const cacheNames = cacheName ? [cacheName] : Array.from(this.caches.keys())
    let totalEntries = 0
    const cacheDetails: { [name: string]: { entries: number; expired: number } } = {}

    cacheNames.forEach(name => {
      const cache = this.caches.get(name)
      if (cache) {
        let expired = 0
        const now = Date.now()
        
        for (const entry of Array.from(cache.values())) {
          if (now - entry.timestamp > entry.ttl) {
            expired++
          }
        }
        
        cacheDetails[name] = {
          entries: cache.size,
          expired
        }
        totalEntries += cache.size
      }
    })

    return {
      caches: Array.from(this.caches.keys()),
      totalEntries,
      totalTags: this.tagIndex.size,
      ...(cacheName ? {} : { cacheDetails })
    }
  }

  /**
   * Clean up expired entries
   */
  cleanup(): number {
    let cleaned = 0
    const now = Date.now()

    for (const [cacheName, cache] of Array.from(this.caches.entries())) {
      const expiredKeys: string[] = []
      
      for (const [key, entry] of Array.from(cache.entries())) {
        if (now - entry.timestamp > entry.ttl) {
          expiredKeys.push(key)
        }
      }
      
      expiredKeys.forEach(key => {
        if (this.delete(cacheName, key)) {
          cleaned++
        }
      })
    }

    console.log(`Cache cleanup: removed ${cleaned} expired entries`)
    return cleaned
  }

  /**
   * Start automatic cleanup
   */
  private startCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
    }
    
    this.cleanupInterval = setInterval(() => {
      this.cleanup()
    }, 60000) // Cleanup every minute
  }

  /**
   * Stop automatic cleanup
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval)
      this.cleanupInterval = undefined
    }
  }

  /**
   * Clear all caches
   */
  clearAll(): void {
    this.caches.clear()
    this.tagIndex.clear()
    if (typeof window !== 'undefined' && window.localStorage) {
      try {
        const keys = Object.keys(window.localStorage)
        for (const k of keys) {
          if (k.startsWith(this.storagePrefix)) window.localStorage.removeItem(k)
        }
      } catch {}
    }
  }

  /**
   * Get from cache, otherwise fetch and store, de-duplicating in-flight requests.
   */
  async getOrFetch<T>(
    cacheName: string,
    key: string,
    fetcher: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    const cached = this.get<T>(cacheName, key)
    if (cached !== null) return cached

    const inflightKey = `${cacheName}:${key}`
    const existing = this.inflight.get(inflightKey)
    if (existing) return existing

    const p = (async () => {
      try {
        const result = await fetcher()
        this.set(cacheName, key, result, options)
        return result
      } finally {
        this.inflight.delete(inflightKey)
      }
    })()

    this.inflight.set(inflightKey, p)
    return p
  }

  /**
   * Fetch a batch of keys with a single call. Caches each key separately.
   */
  async getOrFetchBatch<T>(
    cacheName: string,
    keys: string[],
    batchFetcher: (missingKeys: string[]) => Promise<Record<string, T>>, // returns mapping
    options: CacheOptions = {}
  ): Promise<Record<string, T>> {
    const result: Record<string, T> = {}
    const missing: string[] = []

    // Resolve cached
    for (const key of keys) {
      const cached = this.get<T>(cacheName, key)
      if (cached !== null) {
        result[key] = cached
      } else {
        missing.push(key)
      }
    }

    // If all cached, return
    if (missing.length === 0) return result

    // Deduplicate inflight per key
    const fetchNeeded: string[] = []
    const awaiting: Array<Promise<void>> = []

    for (const key of missing) {
      const inflightKey = `${cacheName}:${key}`
      const existing = this.inflight.get(inflightKey)
      if (existing) {
        awaiting.push(existing.then((v: any) => { result[key] = this.get<T>(cacheName, key)! }))
      } else {
        fetchNeeded.push(key)
      }
    }

    // Fire batch fetch for those not already inflight
    if (fetchNeeded.length > 0) {
      const inflightKeys = fetchNeeded.map(k => `${cacheName}:${k}`)
      const p = (async () => {
        try {
          const fetched = await batchFetcher(fetchNeeded)
          for (const k of fetchNeeded) {
            if (k in fetched) {
              const val = fetched[k]
              this.set(cacheName, k, val, options)
              result[k] = val
            }
          }
        } finally {
          inflightKeys.forEach(k => this.inflight.delete(k))
        }
      })()
      inflightKeys.forEach(k => this.inflight.set(k, p))
      awaiting.push(p.then(() => {}))
    }

    await Promise.all(awaiting)
    return result
  }

  /**
   * Enqueue a key for a named batch within a small delay window, then resolve via handler.
   */
  enqueueBatch<T>(
    batchName: string,
    key: string,
    handler: (keys: string[]) => Promise<Record<string, T>>,
    options: CacheOptions & { delayMs?: number } = {}
  ): Promise<T> {
    const delayMs = options.delayMs ?? 25
    if (!this.batchQueues.has(batchName)) {
      this.batchQueues.set(batchName, {
        keys: new Set(),
        resolvers: new Map(),
        options: { ttl: options.ttl, tags: options.tags, delayMs },
        handler: handler as any
      })
    }

    const queue = this.batchQueues.get(batchName)!

    return new Promise<T>((resolve, reject) => {
      queue.keys.add(key)
      queue.resolvers.set(key, { resolve, reject })

      if (queue.timer) return
      queue.timer = setTimeout(async () => {
        const keys = Array.from(queue.keys)
        const resolvers = new Map(queue.resolvers)
        // reset queue
        queue.keys.clear()
        queue.resolvers.clear()
        queue.timer = undefined

        try {
          const data = await queue.handler(keys)
          for (const k of keys) {
            const r = resolvers.get(k)
            if (!r) continue
            if (k in data) {
              r.resolve(data[k])
            } else {
              r.reject(new Error('Missing batched result for key: ' + k))
            }
          }
        } catch (e) {
          resolvers.forEach((r) => r.reject(e))
        }
      }, delayMs) as any
    })
  }
}

// Singleton instance
export const cacheManager = new CacheManager()

// Cleanup on page unload
if (typeof window !== 'undefined') {
  window.addEventListener('beforeunload', () => {
    cacheManager.stopCleanup()
  })
}

/**
 * Cache decorator for methods
 */
export function cached(
  cacheName: string,
  keyGenerator?: (...args: any[]) => string,
  options: CacheOptions = {}
) {
  return function (target: any, propertyKey: string, descriptor: PropertyDescriptor) {
    const originalMethod = descriptor.value

    descriptor.value = async function (...args: any[]) {
      const key = keyGenerator ? keyGenerator(...args) : JSON.stringify(args)
      return await cacheManager.getOrFetch(
        cacheName,
        key,
        async () => await originalMethod.apply(this, args),
        options
      )
    }

    return descriptor
  }
}

export default cacheManager
