import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../secure-storage', () => {
  const mem = new Map<string, string>()
  return {
    getPrivateKey: (id: string) => mem.get(id) || null,
    storePrivateKey: (id: string, wif: string) => { mem.set(id, wif) },
    clearPrivateKey: (id: string) => { mem.delete(id) },
    clearAllPrivateKeys: () => mem.clear(),
  }
})

vi.mock('../biometric-storage', () => ({
  biometricStorage: { isAvailable: vi.fn(async () => true) },
  getPrivateKeyWithBiometric: vi.fn(async (id: string) => null),
  storePrivateKeyWithBiometric: vi.fn(async () => {}),
  clearBiometricPrivateKey: vi.fn(async () => {}),
}))

import { keyManager } from '../key-manager'

describe('keyManager', () => {
  beforeEach(() => {
    keyManager.clearAllSessionKeys()
  })

  it('stores and retrieves private key via local provider', async () => {
    await keyManager.storePrivateKey('id-1', 'WIF1', { ttlMs: 100 })
    const pk = await keyManager.getPrivateKey('id-1')
    expect(pk).toBe('WIF1')
  })

  it('clears private key', async () => {
    await keyManager.storePrivateKey('id-2', 'WIF2')
    await keyManager.clearPrivateKey('id-2')
    const pk = await keyManager.getPrivateKey('id-2')
    expect(pk).toBeNull()
  })

  it('supports pluggable provider', async () => {
    const calls: string[] = []
    keyManager.useProvider({
      getPrivateKey: async (id) => { calls.push('get:'+id); return 'WIFX' },
      storePrivateKey: async (id, wif) => { calls.push('store:'+id+':'+wif); return true },
      clearPrivateKey: async (id) => { calls.push('clear:'+id) },
    })
    await keyManager.storePrivateKey('id-3', 'W3')
    const pk = await keyManager.getPrivateKey('id-3')
    await keyManager.clearPrivateKey('id-3')
    expect(pk).toBe('WIFX')
    expect(calls[0]).toBe('store:id-3:W3')
    expect(calls.includes('get:id-3')).toBe(true)
    expect(calls.includes('clear:id-3')).toBe(true)
  })
})

