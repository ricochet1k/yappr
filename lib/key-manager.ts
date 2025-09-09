'use client'

// Centralized private key management with pluggable providers

import { getPrivateKey as getFromSecure, storePrivateKey as storeInSecure, clearPrivateKey as clearFromSecure, clearAllPrivateKeys as clearAllFromSecure } from './secure-storage'

type MaybePromise<T> = T | Promise<T>

export interface PrivateKeyProvider {
  // Return WIF private key for an identity or null if not available
  getPrivateKey(identityId: string): MaybePromise<string | null>
  // Optional explicit store hook (for wallets that need to persist/authorize)
  storePrivateKey?(identityId: string, privateKeyWif: string, options?: { ttlMs?: number; persistBiometric?: boolean }): MaybePromise<boolean>
  // Optional clear hook
  clearPrivateKey?(identityId: string): MaybePromise<void>
}

class LocalKeyProvider implements PrivateKeyProvider {
  async getPrivateKey(identityId: string): Promise<string | null> {
    // 1) Try in-memory secure storage
    const sessionPk = getFromSecure(identityId)
    if (sessionPk) return sessionPk

    // 2) Try biometric-protected storage if available
    try {
      const { biometricStorage, getPrivateKeyWithBiometric } = await import('./biometric-storage')
      const isAvailable = await biometricStorage.isAvailable()
      if (!isAvailable) return null
      const pk = await getPrivateKeyWithBiometric(identityId)
      if (pk) {
        // Rehydrate into secure memory to avoid repeated prompts
        storeInSecure(identityId, pk, 3600000)
        return pk
      }
    } catch (e) {
      // Best-effort; fall through
      console.warn('LocalKeyProvider biometric retrieval failed:', e)
    }

    return null
  }

  async storePrivateKey(identityId: string, privateKeyWif: string, options?: { ttlMs?: number; persistBiometric?: boolean }): Promise<boolean> {
    const { ttlMs = 3600000, persistBiometric = false } = options || {}
    // Store in secure in-memory storage
    storeInSecure(identityId, privateKeyWif, ttlMs)

    // Optionally persist with biometric for longer-lived retrieval
    if (persistBiometric) {
      try {
        const { biometricStorage, storePrivateKeyWithBiometric } = await import('./biometric-storage')
        const available = await biometricStorage.isAvailable()
        if (available) {
          await storePrivateKeyWithBiometric(identityId, privateKeyWif)
        }
      } catch (e) {
        console.warn('LocalKeyProvider biometric store failed:', e)
      }
    }
    return true
  }

  async clearPrivateKey(identityId: string): Promise<void> {
    clearFromSecure(identityId)
    try {
      const { clearBiometricPrivateKey } = await import('./biometric-storage')
      await clearBiometricPrivateKey(identityId)
    } catch {
      // ignore
    }
  }
}

class KeyManager {
  private provider: PrivateKeyProvider

  constructor() {
    this.provider = new LocalKeyProvider()
  }

  useProvider(provider: PrivateKeyProvider) {
    this.provider = provider
  }

  get currentProvider(): PrivateKeyProvider {
    return this.provider
  }

  async getPrivateKey(identityId: string): Promise<string | null> {
    return await this.provider.getPrivateKey(identityId)
  }

  async storePrivateKey(identityId: string, privateKeyWif: string, options?: { ttlMs?: number; persistBiometric?: boolean }): Promise<boolean> {
    if (this.provider.storePrivateKey) {
      return await this.provider.storePrivateKey(identityId, privateKeyWif, options)
    }
    // Fallback: if provider has no store, cache locally for session
    const local = new LocalKeyProvider()
    return await local.storePrivateKey(identityId, privateKeyWif, options)
  }

  async clearPrivateKey(identityId: string): Promise<void> {
    if (this.provider.clearPrivateKey) {
      await this.provider.clearPrivateKey(identityId)
      return
    }
    const local = new LocalKeyProvider()
    await local.clearPrivateKey(identityId)
  }

  // Utility: clear all session-stored keys (local only)
  clearAllSessionKeys(): void {
    clearAllFromSecure()
  }
}

export const keyManager = new KeyManager()

// Re-export types for convenience
export type { PrivateKeyProvider as KeyProvider }
