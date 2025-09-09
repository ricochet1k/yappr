import { getWasmSdk } from './wasm-sdk-service';
import { identity_fetch, get_identity_balance } from '../dash-wasm/wasm_sdk';
import { cacheManager } from '../cache-manager';

export interface IdentityInfo {
  id: string;
  balance: number;
  publicKeys: any[];
  revision: number;
}

export interface IdentityBalance {
  confirmed: number;
  total: number;
}

class IdentityService {
  private readonly CACHE_TTL = 60000; // 1 minute cache

  /**
   * Fetch identity information
   */
  async getIdentity(identityId: string): Promise<IdentityInfo | null> {
    try {
      const cacheName = 'identity:info'
      return await cacheManager.getOrFetch<IdentityInfo | null>(
        cacheName,
        identityId,
        async () => {
          const sdk = await getWasmSdk();
          console.log(`Fetching identity: ${identityId}`);
          const identityResponse = await identity_fetch(sdk, identityId);
          if (!identityResponse) {
            console.warn(`Identity not found: ${identityId}`);
            return null;
          }
          const identity = identityResponse.toJSON();
          console.log('Raw identity response:', JSON.stringify(identity, null, 2));
          console.log('Public keys from identity:', identity.publicKeys);
          const identityInfo: IdentityInfo = {
            id: identity.id || identityId,
            balance: identity.balance || 0,
            publicKeys: identity.publicKeys || identity.public_keys || [],
            revision: identity.revision || 0
          };
          return identityInfo;
        },
        { ttl: this.CACHE_TTL, tags: ['identity'] }
      );
    } catch (error) {
      console.error('Error fetching identity:', error);
      throw error;
    }
  }

  /**
   * Get identity balance
   */
  async getBalance(identityId: string): Promise<IdentityBalance> {
    try {
      const cacheName = 'identity:balance'
      return await cacheManager.getOrFetch<IdentityBalance>(
        cacheName,
        identityId,
        async () => {
          const sdk = await getWasmSdk();
          console.log(`Fetching balance for: ${identityId}`);
          const balanceResponse = await get_identity_balance(sdk, identityId);
          const balance = balanceResponse;
          const balanceInfo: IdentityBalance = {
            confirmed: balance.confirmed || 0,
            total: balance.total || balance.confirmed || 0
          };
          return balanceInfo;
        },
        { ttl: this.CACHE_TTL, tags: ['identity'] }
      );
    } catch (error) {
      console.error('Error fetching balance:', error);
      // Return zero balance on error
      return { confirmed: 0, total: 0 };
    }
  }

  /**
   * Verify if identity exists
   */
  async verifyIdentity(identityId: string): Promise<boolean> {
    try {
      const identity = await this.getIdentity(identityId);
      return identity !== null;
    } catch (error) {
      console.error('Error verifying identity:', error);
      return false;
    }
  }

  /**
   * Get identity public keys
   */
  async getPublicKeys(identityId: string): Promise<any[]> {
    try {
      const identity = await this.getIdentity(identityId);
      return identity?.publicKeys || [];
    } catch (error) {
      console.error('Error fetching public keys:', error);
      return [];
    }
  }

  /**
   * Clear cache for an identity
   */
  clearCache(identityId?: string): void {
    if (identityId) {
      cacheManager.delete('identity:info', identityId)
      cacheManager.delete('identity:balance', identityId)
    } else {
      cacheManager.clear('identity:info')
      cacheManager.clear('identity:balance')
    }
  }

  /**
   * Clear expired cache entries
   */
  cleanupCache(): void {
    // No-op; cacheManager handles cleanup
  }
}

// Singleton instance
export const identityService = new IdentityService();

// Set up periodic cache cleanup
if (typeof window !== 'undefined') {
  setInterval(() => {
    identityService.cleanupCache();
  }, 60000); // Clean up every minute
}
