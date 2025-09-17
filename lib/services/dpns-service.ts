import { 
  dpns_convert_to_homograph_safe,
  dpns_is_valid_username,
  dpns_is_contested_username,
  dpns_register_name,
  dpns_is_name_available
} from '../wasm-sdk/wasm_sdk';
import { DPNS_CONTRACT_ID, DPNS_DOCUMENT_TYPE } from '../constants';
import { cacheManager, createBatcher, CacheManager } from '../cache-manager';
import { getWasmSdk } from './wasm-sdk-service';

interface DpnsDocument {
  $id: string;
  $ownerId: string;
  $revision: number;
  $createdAt?: number;
  $updatedAt?: number;
  label: string;
  normalizedLabel: string;
  normalizedParentDomainName: string;
  preorderSalt: string;
  records: {
    identity?: string;  // This is the actual field name used in DPNS
    dashUniqueIdentityId?: string;
    dashAliasIdentityId?: string;
  };
  subdomainRules?: {
    allowSubdomains: boolean;
  };
}

// Batchers
const enqueueAllUsernames = createBatcher<{ identityId: string }, string[]>({
  cacheName: 'dpns:usernames',
  delayMs: 25,
  ttl: 3600000,
  tags: ['dpns'],
  handler: async (entries) => {
    const { safeGetDocuments } = await import('./dapi-helpers')
    const ids = entries.map(e => e.original.identityId).filter(Boolean)
    if (!ids.length) return;
    
    const resp = await safeGetDocuments(
      DPNS_CONTRACT_ID,
      DPNS_DOCUMENT_TYPE,
      [['records.identity', 'in', ids]],
      [['records.identity', 'asc']],
      100,
      null,
      null
    )
    const docs = Array.isArray(resp) ? resp : (resp?.documents || [])
    const byIdentity = new Map<string, string[]>()
    for (const doc of docs as any[]) {
      const rec = (doc.records || (doc.data && doc.data.records)) || {}
      const identity = rec.identity || rec.dashUniqueIdentityId || rec.dashAliasIdentityId
      const label = (doc.label || (doc.data && doc.data.label)) as string
      const parent = (doc.normalizedParentDomainName || (doc.data && doc.data.normalizedParentDomainName) || 'dash') as string
      if (identity && label) {
        const list = byIdentity.get(identity) || []
        list.push(`${label}.${parent}`)
        byIdentity.set(identity, list)
      }
    }
    // Resolve for each entry
    for (const entry of entries) {
      const list = byIdentity.get(entry.original.identityId) || []
      entry.resolve(list)
    }
  }
})

const enqueueBestUsernameByIdentity = createBatcher<{ identityId: string }, string | null>({
  cacheName: 'dpns:reverse',
  delayMs: 25,
  ttl: 3600000,
  tags: ['dpns'],
  handler: async (entries) => {
    const ids = entries.map(e => e.original.identityId)
    const allMap = await Promise.all(ids.map(id => enqueueAllUsernames({ identityId: id })))
    entries.forEach((entry, idx) => {
      const names = allMap[idx] || []
      if (names.length === 0) {
        entry.resolve(null)
      } else {
        const sorted = names.sort((a, b) => {
          const la = a.split('.')[0]
          const lb = b.split('.')[0]
          const ca = dpns_is_contested_username(la) ? 1 : 0
          const cb = dpns_is_contested_username(lb) ? 1 : 0
          if (ca !== cb) return cb - ca
          return a.localeCompare(b)
        })
        entry.resolve(sorted[0])
      }
    })
  }
})

const enqueueIdentityByUsername = createBatcher<{ label: string; parent?: string }, string | null>({
  cacheName: 'dpns:forward',
  delayMs: 25,
  ttl: 3600000,
  tags: ['dpns'],
  handler: async (entries) => {
    const sdk = await getWasmSdk()
    // normalize and bucket by parent
    const normalized = entries.map(e => ({ label: e.original.label.toLowerCase(), parent: (e.original.parent || 'dash').toLowerCase() }))
    const byParent = new Map<string, Set<string>>()
    normalized.forEach(({ label, parent }) => {
      if (!byParent.has(parent)) byParent.set(parent, new Set())
      byParent.get(parent)!.add(label)
    })
    const parentKeys = Array.from(byParent.keys())
    for (let i = 0; i < parentKeys.length; i++) {
      const parent = parentKeys[i]
      const labels = Array.from(byParent.get(parent)!)
      const { safeGetDocuments } = await import('./dapi-helpers')
      const resp = await safeGetDocuments(
        DPNS_CONTRACT_ID,
        DPNS_DOCUMENT_TYPE,
        [
          ['normalizedLabel', 'in', labels],
          ['normalizedParentDomainName', '==', parent]
        ],
        null,
        100,
        null,
        null
      )
      const docs = Array.isArray(resp) ? resp : (resp?.documents || [])
      // Build map of label->owner
      const map = new Map<string, string>()
      for (let j = 0; j < docs.length; j++) {
        const doc: any = docs[j]
        const label = (doc.normalizedLabel || (doc.data && doc.data.normalizedLabel)) as string
        const owner = doc.$ownerId || doc.ownerId
        if (label && owner) map.set(label, owner)
      }
      // Resolve any entries for this parent
      entries.forEach((entry, idx) => {
        const { label, parent: p } = normalized[idx]
        if (p === parent) {
          entry.resolve(map.get(label) || null)
        }
      })
    }
  }
})

class DpnsService {
  private readonly CACHE_TTL = 3600000; // 1 hour cache for DPNS

  /**
   * Get all usernames for an identity ID
   */
  async getAllUsernames(identityId: string): Promise<string[]> {
    try {
      const usernames = await enqueueAllUsernames({ identityId })
      console.log(`DPNS: Found ${usernames.length} usernames for identity ${identityId}`)
      return usernames
    } catch (error) {
      console.error('DPNS: Error fetching all usernames:', error);
      return [];
    }
  }

  /**
   * Sort usernames by contested status (contested usernames first)
   */
  sortUsernamesByContested(usernames: string[]): string[] {
    return usernames.sort((a, b) => {
      const aContested = dpns_is_contested_username(a.split('.')[0]);
      const bContested = dpns_is_contested_username(b.split('.')[0]);
      
      if (aContested && !bContested) return -1;
      if (!aContested && bContested) return 1;
      
      // If both contested or both not contested, sort alphabetically
      return a.localeCompare(b);
    });
  }

  /**
   * Resolve a username for an identity ID (reverse lookup)
   * Returns the best username (contested usernames are preferred)
   */
  async resolveUsername(identityId: string): Promise<string | null> {
    try {
      const best = await enqueueBestUsernameByIdentity({ identityId })
      return best
    } catch (error) {
      console.error('DPNS: Error resolving username:', error)
      return null
    }
  }

  /**
   * Resolve an identity ID from a username
   */
  async resolveIdentity(username: string): Promise<string | null> {
    try {
      const normalized = username.toLowerCase().replace(/\.dash$/, '')
      return await enqueueIdentityByUsername({ label: normalized, parent: 'dash' })
    } catch (error) {
      console.error('DPNS: Error resolving identity:', error)
      return null
    }
  }

  /**
   * Check if a username is available
   */
  async isUsernameAvailable(username: string): Promise<boolean> {
    try {
      const normalizedUsername = username.toLowerCase().replace('.dash', '');
      
      // Try native availability check first (more efficient)
      try {
        const sdk = await getWasmSdk();
        const isAvailable = await dpns_is_name_available(sdk, normalizedUsername);
        console.log(`DPNS: Username ${normalizedUsername} availability (native): ${isAvailable}`);
        return isAvailable;
      } catch (error) {
        console.warn('DPNS: Native availability check failed, trying identity resolution:', error);
      }
      
      // Fallback: Check by trying to resolve identity
      const identity = await this.resolveIdentity(normalizedUsername);
      const isAvailable = identity === null;
      console.log(`DPNS: Username ${normalizedUsername} availability (fallback): ${isAvailable}`);
      return isAvailable;
    } catch (error) {
      console.error('DPNS: Error checking username availability:', error);
      // If error, assume not available to be safe
      return false;
    }
  }

  /**
   * Search for usernames by prefix with full details
   */
  async searchUsernamesWithDetails(prefix: string, limit: number = 10): Promise<Array<{ username: string; ownerId: string }>> {
    try {
      // Remove .dash suffix if present for search
      const searchPrefix = prefix.toLowerCase().replace(/\.dash$/, '');
      
      // Search DPNS names by prefix
      console.log(`DPNS: Searching usernames with prefix: ${searchPrefix}`);
      
      const { safeGetDocuments } = await import('./dapi-helpers')
      const documents = await safeGetDocuments(
        DPNS_CONTRACT_ID,
        DPNS_DOCUMENT_TYPE,
        [
          ['normalizedLabel', 'startsWith', searchPrefix],
          ['normalizedParentDomainName', '==', 'dash']
        ],
        [['normalizedLabel', 'asc']],
        limit,
        null,
        null
      );
      
      // The response is an array of documents
      if (documents && Array.isArray(documents)) {
        console.log(`DPNS: Found ${documents.length} documents`);
        
        // Map documents to results with owner IDs
        const results = documents.map((doc: any) => {
          // Access the data field which contains the DPNS document fields
          const data = doc.data || doc;
          const label = data.label || data.normalizedLabel || 'unknown';
          const parentDomain = data.normalizedParentDomainName || 'dash';
          const ownerId = doc.ownerId || doc.$ownerId || '';
          
          return {
            username: `${label}.${parentDomain}`,
            ownerId: ownerId
          };
        });
        
        return results;
      }
      
      return [];
    } catch (error) {
      console.error('DPNS: Error searching usernames with details:', error);
      return [];
    }
  }

  /**
   * Search for usernames by prefix
   */
  async searchUsernames(prefix: string, limit: number = 10): Promise<string[]> {
    try {
      // Remove .dash suffix if present for search
      const searchPrefix = prefix.toLowerCase().replace(/\.dash$/, '');
      
      // Search DPNS names by prefix
      console.log(`DPNS: Searching usernames with prefix: ${searchPrefix}`);
      console.log(`DPNS: Using contract ID: ${DPNS_CONTRACT_ID}`);
      console.log(`DPNS: Document type: ${DPNS_DOCUMENT_TYPE}`);
      
      // Build where clause for starts-with query on normalizedLabel
      const where = [
        ['normalizedLabel', 'startsWith', searchPrefix],
        ['normalizedParentDomainName', '==', 'dash']
      ] as Array<[string, string, unknown]>;
      const orderBy = [['normalizedLabel', 'asc']] as Array<[string, 'asc' | 'desc']>;
      
      console.log('DPNS: Query where clause:', JSON.stringify(where));
      console.log('DPNS: Query orderBy:', JSON.stringify(orderBy));
      
      const { safeGetDocuments } = await import('./dapi-helpers')
      const documents = await safeGetDocuments(
        DPNS_CONTRACT_ID,
        DPNS_DOCUMENT_TYPE,
        where,
        orderBy,
        limit,
        null,
        null
      );
      
      console.log('DPNS: Search response:', documents);
      console.log('DPNS: Response type:', typeof documents);
      console.log('DPNS: Is array?:', Array.isArray(documents));
      
      // The response is an array of documents
      if (documents && Array.isArray(documents)) {
        console.log(`DPNS: Found ${documents.length} documents`);
        
        // Map documents to usernames
        const usernames = documents.map((doc: any) => {
          console.log('DPNS: Processing document:', doc);
          
          // Access the data field which contains the DPNS document fields
          const data = doc.data || doc;
          const label = data.label || data.normalizedLabel || 'unknown';
          const parentDomain = data.normalizedParentDomainName || 'dash';
          
          console.log('DPNS: Document fields:', { 
            label: data.label, 
            normalizedLabel: data.normalizedLabel, 
            parentDomain: data.normalizedParentDomainName,
            ownerId: doc.ownerId || doc.$ownerId
          });
          
          return `${label}.${parentDomain}`;
        });
        
        return usernames;
      }
      
      console.log('DPNS: No documents found in response');
      return [];
    } catch (error) {
      console.error('DPNS: Error searching usernames:', error);
      return [];
    }
  }

  /**
   * Register a new username
   */
  async registerUsername(
    label: string, 
    identityId: string, 
    publicKeyId: number,
    onPreorderSuccess?: () => void
  ): Promise<any> {
    try {
      // Validate the username first
      if (!dpns_is_valid_username(label)) {
        throw new Error(`Invalid username format: ${label}`);
      }

      // Check if it's contested
      if (dpns_is_contested_username(label)) {
        console.warn(`Username ${label} is contested and will require masternode voting`);
      }

      // Check availability with a retry on DAPI address exhaustion
      const sdk = await getWasmSdk();
      let isAvailable: boolean | null = null
      try {
        isAvailable = await dpns_is_name_available(sdk, label);
      } catch (e: any) {
        const msg = (e && (e.message || String(e))) || ''
        if (msg.includes('no available addresses')) {
          console.warn('DPNS: No available DAPI addresses; reinitializing SDK and retrying once...')
          try {
            const { wasmSdkService } = await import('./wasm-sdk-service')
            const cfg = wasmSdkService.getConfig()
            if (cfg) await wasmSdkService.reinitialize(cfg)
            const sdk2 = await getWasmSdk()
            isAvailable = await dpns_is_name_available(sdk2, label)
          } catch (inner) {
            // If retry fails, surface a friendlier error
            throw new Error('Dash Platform temporarily unavailable (no DAPI addresses). Please try again shortly.')
          }
        } else {
          throw e
        }
      }
      if (!isAvailable) {
        throw new Error(`Username ${label} is already taken`);
      }

      // Resolve private key via centralized key manager
      const { keyManager } = await import('../key-manager');
      const privateKeyWif = await keyManager.getPrivateKey(identityId);
      if (!privateKeyWif) {
        throw new Error('Private key not available. Please log in again.');
      }

      // Register the name (DAPI can return flaky Internal errors even on success)
      console.log(`Registering DPNS name: ${label}`);
      let result: any
      try {
        result = await dpns_register_name(
          sdk,
          label,
          identityId,
          publicKeyId,
          privateKeyWif,
          onPreorderSuccess || null
        );
      } catch (e: any) {
        const msg = (e && (e.message || String(e))) || ''
        // Known intermittent error from DAPI: treat as potentially successful and verify
        if (msg.includes('Missing response message') || msg.includes('transport error') || msg.includes('Internal')) {
          console.warn('DPNS: Registration returned transient error, verifying outcome...')
          try {
            // If the name is now unavailable, assume registration succeeded
            const stillAvailable = await dpns_is_name_available(sdk, label)
            if (stillAvailable === false) {
              console.log('DPNS: Name is no longer available; assuming registration succeeded')
              result = { assumed: true }
            } else {
              // Try resolve identity by username and compare owner
              const resolvedOwner = await this.resolveIdentity(label)
              if (resolvedOwner && resolvedOwner === identityId) {
                console.log('DPNS: Username resolves to our identity; assuming registration succeeded')
                result = { assumed: true }
              } else {
                throw e
              }
            }
          } catch (verifyErr) {
            // Could not verify success; surface clearer message
            throw new Error('Failed to register DPNS name due to a transient network issue. Please try again, or click "I just registered my username" after a minute.')
          }
        } else {
          throw e
        }
      }

      // Clear cache for this identity
      this.clearCache(undefined, identityId);

      return result;
    } catch (error) {
      console.error('Error registering username:', error);
      throw error;
    }
  }

  /**
   * Validate a username according to DPNS rules
   */
  validateUsername(label: string): {
    isValid: boolean;
    isContested: boolean;
    normalizedLabel: string;
  } {
    const isValid = dpns_is_valid_username(label);
    const isContested = dpns_is_contested_username(label);
    const normalizedLabel = dpns_convert_to_homograph_safe(label);

    return {
      isValid,
      isContested,
      normalizedLabel
    };
  }

  /**
   * Get username validation error message
   */
  getUsernameValidationError(username: string): string | null {
    if (!username) {
      return 'Username is required';
    }
    
    if (username.length < 3) {
      return 'Username must be at least 3 characters long';
    }
    
    if (username.length > 20) {
      return 'Username must be 20 characters or less';
    }
    
    if (!/^[a-zA-Z0-9_]+$/.test(username)) {
      return 'Username can only contain letters, numbers, and underscores';
    }
    
    if (username.startsWith('_') || username.endsWith('_')) {
      return 'Username cannot start or end with underscore';
    }
    
    if (username.includes('__')) {
      return 'Username cannot contain consecutive underscores';
    }
    
    // Additional DPNS validation
    const validation = this.validateUsername(username);
    if (!validation.isValid) {
      return 'Username does not meet DPNS requirements';
    }
    
    if (validation.isContested) {
      return 'This username is contested and requires masternode voting';
    }
    
    return null;
  }


  /**
   * Clear cache entries
   */
  clearCache(username?: string, identityId?: string): void {
    if (username) {
      cacheManager.delete('dpns:forward', username.toLowerCase())
    }
    if (identityId) {
      cacheManager.delete('dpns:reverse', identityId)
    }
    if (!username && !identityId) {
      cacheManager.clear('dpns:forward')
      cacheManager.clear('dpns:reverse')
    }
  }
}

// Singleton instance
export const dpnsService = new DpnsService();
