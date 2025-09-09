'use client'

import { useEffect, useMemo, useState } from 'react'
import { cacheManager } from '@/lib/cache-manager'

export default function CacheDevPage() {
  const [stats, setStats] = useState<any>(null)
  const [tag, setTag] = useState('')
  const [cacheName, setCacheName] = useState('')
  const [localCount, setLocalCount] = useState(0)

  const refresh = () => {
    const s = cacheManager.getStats()
    setStats(s)
    if (typeof window !== 'undefined') {
      const keys = Object.keys(localStorage).filter(k => k.startsWith('yappr_cache:'))
      setLocalCount(keys.length)
    }
  }

  useEffect(() => {
    refresh()
  }, [])

  const caches = useMemo(() => (stats?.caches || []) as string[], [stats])

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-2xl font-semibold">Cache Dev Tools</h1>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="p-4 border rounded">
          <h2 className="font-medium mb-2">Summary</h2>
          <div className="text-sm space-y-1">
            <div>Total caches: {caches.length}</div>
            <div>Total entries (memory): {stats?.totalEntries ?? 0}</div>
            <div>Total tags: {stats?.totalTags ?? 0}</div>
            <div>localStorage entries (yappr_cache:*): {localCount}</div>
          </div>
          <div className="mt-3 flex gap-2">
            <button className="px-3 py-1 border rounded" onClick={() => { cacheManager.cleanup(); refresh() }}>Cleanup Expired</button>
            <button className="px-3 py-1 border rounded" onClick={() => { cacheManager.clearAll(); refresh() }}>Clear All</button>
            <button className="px-3 py-1 border rounded" onClick={refresh}>Refresh</button>
          </div>
        </div>

        <div className="p-4 border rounded">
          <h2 className="font-medium mb-2">Invalidate By Tag</h2>
          <div className="flex gap-2">
            <input className="border px-2 py-1 flex-1" placeholder="tag (e.g., doctype:post)" value={tag} onChange={e => setTag(e.target.value)} />
            <button className="px-3 py-1 border rounded" onClick={() => { cacheManager.invalidateByTag(tag); refresh() }}>Invalidate</button>
          </div>
        </div>
      </div>

      <div className="p-4 border rounded">
        <h2 className="font-medium mb-2">Caches</h2>
        <div className="text-sm grid grid-cols-1 md:grid-cols-2 gap-3">
          {caches.map((name: string) => (
            <div key={name} className="p-3 border rounded">
              <div className="font-mono text-xs">{name}</div>
              <div className="mt-2 flex gap-2">
                <button className="px-3 py-1 border rounded" onClick={() => { cacheManager.clear(name); refresh() }}>Clear</button>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

