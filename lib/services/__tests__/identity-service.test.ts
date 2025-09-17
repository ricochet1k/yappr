import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../wasm-sdk/wasm_sdk', () => ({
  identity_fetch: vi.fn(async (_sdk, id: string) => ({
    toJSON: () => ({ id, balance: 1234, publicKeys: [{ id: 1 }], revision: 2 })
  })),
  get_identity_balance: vi.fn(async (_sdk, id: string) => ({ confirmed: 100, total: 150 }))
}))

vi.mock('../wasm-sdk-service', () => ({ getWasmSdk: vi.fn(async () => ({})) }))

import { identityService } from '../identity-service'
import { cacheManager } from '../../cache-manager'

describe('identityService', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    identityService.clearCache()
  })

  it('getIdentity fetches and caches identity info', async () => {
    const info = await identityService.getIdentity('user-1')
    expect(info).toEqual({ id: 'user-1', balance: 1234, publicKeys: [{ id: 1 }], revision: 2 })
    const cached = await identityService.getIdentity('user-1')
    expect(cached).toEqual(info)
  })

  it('getBalance returns totals and caches', async () => {
    const bal = await identityService.getBalance('user-2')
    expect(bal).toEqual({ confirmed: 100, total: 150 })
    const bal2 = await identityService.getBalance('user-2')
    expect(bal2).toEqual(bal)
  })

  it('verifyIdentity returns false on error', async () => {
    const spy = vi.spyOn(identityService as any, 'getIdentity').mockRejectedValueOnce(new Error('boom'))
    const ok = await identityService.verifyIdentity('bad')
    expect(ok).toBe(false)
    spy.mockRestore()
  })

  it('getPublicKeys returns [] on error', async () => {
    const spy = vi.spyOn(identityService as any, 'getIdentity').mockRejectedValueOnce(new Error('boom'))
    const keys = await identityService.getPublicKeys('user-1')
    expect(keys).toEqual([])
    spy.mockRestore()
  })
})

