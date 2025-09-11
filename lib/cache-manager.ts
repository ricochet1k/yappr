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
   * Stable stringify for cache keys (sorts object keys recursively)
   */
  static safeStringify(value: any): string {
    const seen = new WeakSet()
    const stringify = (val: any): any => {
      if (val === null || typeof val !== 'object') return val
      if (seen.has(val)) return '[Circular]'
      seen.add(val)
      if (Array.isArray(val)) return val.map(stringify)
      const keys = Object.keys(val).sort()
      const out: any = {}
      for (const k of keys) out[k] = stringify(val[k])
      return out
    }
    return JSON.stringify(stringify(value))
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

    if (cleaned > 0) {
      console.log(`Cache cleanup: removed ${cleaned} expired entries`)
    }
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
  /** Convenience: object-key variant (use JSON.stringify with stable order) */
  async getOrFetchByObject<T>(
    cacheName: string,
    keyObject: any,
    fetcher: () => Promise<T>,
    options: CacheOptions = {}
  ): Promise<T> {
    const key = CacheManager.safeStringify(keyObject)
    return this.getOrFetch(cacheName, key, fetcher, options)
  }
}

/**
 * Strongly-typed batcher factory using object keys and stable stringification.
 */
export function createBatcher<K, T>(config: {
  cacheName: string
  delayMs?: number
  ttl?: number
  tags?: string[]
  handler: (entries: Array<{ original: K; resolve: (v: T) => void; reject: (e: any) => void }>) => Promise<void>
}) {
  const { cacheName, delayMs = 25, ttl, tags, handler } = config
  let timer: number | NodeJS.Timeout | undefined
  type Resolver = { resolve: (v: T) => void; reject: (e: any) => void }
  type Entry = { original: K; resolvers: Resolver[]; settled: boolean; resolve: (v: T) => void; reject: (e: any) => void }
  let batch = new Map<string, Entry>()

  async function runBatch() {
    timer = undefined
    const current = batch
    batch = new Map<string, Entry>()
    try {
      const entries = Array.from(current.values())
      await handler(entries)
      // Fail any unresolved entries to avoid hanging promises
      current.forEach((entry, k) => {
        if (!entry.settled) {
          entry.resolvers.forEach(r => r.reject(new Error('Missing batched result for key: ' + k)))
        }
      })
    } catch (e) {
      current.forEach((entry) => entry.resolvers.forEach(r => r.reject(e)))
    }
  }

  // Return a lightweight enqueue function
  return async function enqueue(keyObject: K): Promise<T> {
    const key = CacheManager.safeStringify(keyObject)
    return cacheManager.getOrFetch<T>(
      cacheName,
      key,
      () => new Promise<T>((resolve, reject) => {
        const existing = batch.get(key)
        if (existing) {
          existing.resolvers.push({ resolve, reject })
        } else {
          const entry: Entry = {
            original: keyObject,
            resolvers: [{ resolve, reject }],
            settled: false,
            resolve: (v: T) => { entry.settled = true; entry.resolvers.forEach(r => r.resolve(v)) },
            reject: (e: any) => { entry.settled = true; entry.resolvers.forEach(r => r.reject(e)) }
          }
          batch.set(key, entry)
        }
        if (!timer) {
          timer = setTimeout(runBatch, delayMs)
        }
      }),
      { ttl, tags }
    )
  }
}

// Singleton instance
export const cacheManager = new CacheManager()

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
