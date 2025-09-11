'use client'

// Import the WASM SDK types we need
import { WasmSdk } from './dash-wasm/wasm_sdk'

// Import the centralized WASM service
import { wasmSdkService } from './services/wasm-sdk-service'
import { YAPPR_CONTRACT_ID } from './constants'
// No per-document querying; use services for data access and transitions
// Note: Post/profile querying now lives in services

export class DashPlatformClient {
  private sdk: WasmSdk | null = null
  private identityId: string | null = null
  private isInitializing: boolean = false
  
  constructor() {
    // SDK will be initialized on first use
  }
  
  /**
   * Initialize the SDK using the centralized WASM service
   */
  public async ensureInitialized() {
    if (this.sdk || this.isInitializing) {
      // Already initialized or initializing
      while (this.isInitializing) {
        // Wait for initialization to complete
        await new Promise(resolve => setTimeout(resolve, 100))
      }
      return
    }
    
    this.isInitializing = true
    
    try {
      // Use the centralized WASM service
      const network = (process.env.NEXT_PUBLIC_NETWORK as 'testnet' | 'mainnet') || 'testnet'
      const contractId = YAPPR_CONTRACT_ID
      
      console.log('DashPlatformClient: Initializing via WasmSdkService for network:', network)
      
      // Initialize the WASM SDK service if not already done
      await wasmSdkService.initialize({ network, contractId })
      
      // Get the SDK instance
      this.sdk = await wasmSdkService.getSdk()
      
      console.log('DashPlatformClient: WASM SDK initialized successfully via service')
    } catch (error) {
      console.error('DashPlatformClient: Failed to initialize WASM SDK:', error)
      throw error
    } finally {
      this.isInitializing = false
    }
  }
  
  /**
   * Set the identity ID for document operations
   * This is called by the auth system after identity verification
   */
  setIdentity(identityId: string) {
    this.identityId = identityId
    console.log('DashPlatformClient: Identity set to:', identityId)
  }
  
  // Note: Post creation now lives in postService.createPost
  
  // Note: Post/profile query helpers have been removed; use services instead
  
  /**
   * Get key type name
   */
  private getKeyTypeName(type: number): string {
    const types = ['ECDSA_SECP256K1', 'BLS12_381', 'ECDSA_HASH160', 'BIP13_SCRIPT_HASH', 'EDDSA_25519_HASH160']
    return types[type] || 'UNKNOWN'
  }
  
  /**
   * Get key purpose name
   */
  private getKeyPurposeName(purpose: number): string {
    const purposes = ['AUTHENTICATION', 'ENCRYPTION', 'DECRYPTION', 'TRANSPORT', 'SYSTEM', 'VOTING']
    return purposes[purpose] || 'UNKNOWN'
  }
  
  /**
   * Get security level name
   */
  private getSecurityLevelName(level: number): string {
    const levels = ['MASTER', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW']
    return levels[level] || 'UNKNOWN'
  }
}

// Singleton instance
let dashClient: DashPlatformClient | null = null

export function getDashPlatformClient(): DashPlatformClient {
  if (!dashClient) {
    dashClient = new DashPlatformClient()
  }
  return dashClient
}

// Reset the client (useful for handling errors)
export function resetDashPlatformClient(): void {
  if (dashClient) {
    dashClient = null
  }
}
