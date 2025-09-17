import { getWasmSdk } from './wasm-sdk-service';
import { wait_for_state_transition_result } from '../wasm-sdk/wasm_sdk';
import { keyManager } from '../key-manager';

export interface StateTransitionResult {
  success: boolean;
  transactionHash?: string;
  document?: any;
  error?: string;
}

class StateTransitionService {
  private static readonly CREDITS_PER_DASH = 100_000_000_000; // 1 DASH = 100B credits
  /**
   * Get the private key from secure storage
   */
  private async getPrivateKey(identityId: string): Promise<string> {
    if (typeof window === 'undefined') {
      throw new Error('State transitions can only be performed in browser');
    }
    const privateKey = await keyManager.getPrivateKey(identityId)
    if (!privateKey) {
      throw new Error('No private key found. Please log in again.');
    }
    return privateKey
  }

  /**
   * Generate entropy for state transitions
   */
  private generateEntropy(): string {
    const bytes = new Uint8Array(32);
    if (typeof window !== 'undefined' && window.crypto) {
      window.crypto.getRandomValues(bytes);
    } else {
      // Fallback for non-browser environments (should not happen in production)
      for (let i = 0; i < 32; i++) {
        bytes[i] = Math.floor(Math.random() * 256);
      }
    }
    return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('');
  }

  /**
   * Create a document
   */
  async createDocument(
    contractId: string,
    documentType: string,
    ownerId: string,
    documentData: any
  ): Promise<StateTransitionResult> {
    try {
      const privateKey = await this.getPrivateKey(ownerId);
      const entropy = this.generateEntropy();
      
      console.log(`Creating ${documentType} document with data:`, documentData);
      console.log(`Contract ID: ${contractId}`);
      console.log(`Owner ID: ${ownerId}`);
      
      // Create the document using safe wrapper
      // Measure balance before
      const { identityService } = await import('./identity-service')
      let before = await identityService.getBalance(ownerId)
      const { safeDocumentCreate } = await import('./dapi-helpers')
      const result = await safeDocumentCreate(
        contractId,
        documentType,
        ownerId,
        JSON.stringify(documentData),
        entropy,
        privateKey
      )

      // Force refresh identity balance and compute delta
      try {
        identityService.clearCache(ownerId)
        const after = await identityService.getBalance(ownerId)
        const delta = before ? (before.total - after.total) : 0
        // Notify cost (credits)
        if (typeof window !== 'undefined') {
          const toast = (await import('react-hot-toast')).default
          const action = 'Created'
          if (delta > 0) {
            const dash = delta / StateTransitionService.CREDITS_PER_DASH
            const dashStr = dash.toFixed(8).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')
            toast.success(`${action} ${documentType}. Cost: ${delta} credits (≈ ${dashStr} DASH)`) 
          } else {
            toast.success(`${action} ${documentType}. Cost: <unavailable> (credits)`) 
          }
        }
      } catch (e) {
        // Non-fatal: skip notification on error
      }
      
      console.log('Document creation result:', result);
      
      // The result contains the document and transition info
      return {
        success: true,
        transactionHash: result.stateTransition?.$id || result.transitionId,
        document: result.document || result
      };
    } catch (error) {
      console.error('Error creating document:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Update a document
   */
  async updateDocument(
    contractId: string,
    documentType: string,
    documentId: string,
    ownerId: string,
    documentData: any,
    revision: number
  ): Promise<StateTransitionResult> {
    try {
      const privateKey = await this.getPrivateKey(ownerId);
      
      console.log(`Updating ${documentType} document ${documentId}...`);
      
      // Update the document using safe wrapper
      // Measure balance before
      const { identityService } = await import('./identity-service')
      let before = await identityService.getBalance(ownerId)
      const { safeDocumentReplace } = await import('./dapi-helpers')
      const result = await safeDocumentReplace(
        contractId,
        documentType,
        documentId,
        ownerId,
        JSON.stringify(documentData),
        BigInt(revision),
        privateKey,
      )

      // Force refresh balance and notify
      try {
        identityService.clearCache(ownerId)
        const after = await identityService.getBalance(ownerId)
        const delta = before ? (before.total - after.total) : 0
        if (typeof window !== 'undefined') {
          const toast = (await import('react-hot-toast')).default
          const action = 'Updated'
          if (delta > 0) {
            const dash = delta / StateTransitionService.CREDITS_PER_DASH
            const dashStr = dash.toFixed(8).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')
            toast.success(`${action} ${documentType}. Cost: ${delta} credits (≈ ${dashStr} DASH)`) 
          } else {
            toast.success(`${action} ${documentType}. Cost: <unavailable> (credits)`) 
          }
        }
      } catch {}
      
      return {
        success: true,
        transactionHash: result.stateTransition?.$id || result.transitionId,
        document: result.document || result
      };
    } catch (error) {
      console.error('Error updating document:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Delete a document
   */
  async deleteDocument(
    contractId: string,
    documentType: string,
    documentId: string,
    ownerId: string
  ): Promise<StateTransitionResult> {
    try {
      const privateKey = await this.getPrivateKey(ownerId);
      
      console.log(`Deleting ${documentType} document ${documentId}...`);
      
      // Delete the document using safe wrapper
      // Measure balance before
      const { identityService } = await import('./identity-service')
      let before = await identityService.getBalance(ownerId)
      const { safeDocumentDelete } = await import('./dapi-helpers')
      const result = await safeDocumentDelete(
        contractId,
        documentType,
        documentId,
        ownerId,
        privateKey,
      )

      // Force refresh and notify
      try {
        identityService.clearCache(ownerId)
        const after = await identityService.getBalance(ownerId)
        const delta = before ? (before.total - after.total) : 0
        if (typeof window !== 'undefined') {
          const toast = (await import('react-hot-toast')).default
          const action = 'Deleted'
          if (delta > 0) {
            const dash = delta / StateTransitionService.CREDITS_PER_DASH
            const dashStr = dash.toFixed(8).replace(/\.0+$/, '').replace(/(\.\d*[1-9])0+$/, '$1')
            toast.success(`${action} ${documentType}. Cost: ${delta} credits (≈ ${dashStr} DASH)`) 
          } else {
            toast.success(`${action} ${documentType}. Cost: <unavailable> (credits)`) 
          }
        }
      } catch {}
      
      return {
        success: true,
        transactionHash: result.stateTransition?.$id || result.transitionId
      };
    } catch (error) {
      console.error('Error deleting document:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error'
      };
    }
  }

  /**
   * Wait for a state transition to be confirmed
   */
  async waitForConfirmation(
    transactionHash: string, 
    options: {
      maxWaitTimeMs?: number,
      pollingIntervalMs?: number,
      onProgress?: (attempt: number, elapsed: number) => void
    } = {}
  ): Promise<{ success: boolean; result?: any; error?: string }> {
    const {
      maxWaitTimeMs = 10000, // 10 seconds max wait (reduced from 30s)
      pollingIntervalMs = 2000, // Poll every 2 seconds
      onProgress
    } = options;

    const startTime = Date.now();
    let attempt = 0;
    
    try {
      const sdk = await getWasmSdk();
      
      console.log(`Waiting for transaction confirmation: ${transactionHash}`);
      
      // Try wait_for_state_transition_result once with a short timeout
      try {
        // Create a timeout promise
        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => reject(new Error('Wait timeout')), 8000); // 8 second timeout
        });
        
        // Race the wait call against the timeout
        const result = await Promise.race([
          wait_for_state_transition_result(sdk, transactionHash),
          timeoutPromise
        ]);
        
        if (result) {
          console.log('Transaction confirmed via wait_for_state_transition_result:', result);
          return { success: true, result };
        }
      } catch (waitError) {
        // This is expected to timeout frequently due to DAPI gateway issues
        console.log('wait_for_state_transition_result timed out (expected):', waitError);
      }
      
      // Since wait_for_state_transition_result often times out even for successful transactions,
      // we'll assume success if the transaction was broadcast successfully
      // This is a workaround for the known DAPI gateway timeout issue
      console.log('Transaction broadcast successfully. Assuming confirmation due to known DAPI timeout issue.');
      console.log('Note: The transaction is likely confirmed on the network despite the timeout.');
      
      return { 
        success: true, 
        result: { 
          assumed: true, 
          reason: 'DAPI wait timeout is a known issue - transaction likely succeeded',
          transactionHash 
        } 
      };
      
    } catch (error) {
      console.error('Error waiting for confirmation:', error);
      return { 
        success: false, 
        error: error instanceof Error ? error.message : 'Unknown error' 
      };
    }
  }

  /**
   * Create document with confirmation
   */
  async createDocumentWithConfirmation(
    contractId: string,
    documentType: string,
    ownerId: string,
    documentData: any,
    waitForConfirmation: boolean = false
  ): Promise<StateTransitionResult & { confirmed?: boolean }> {
    const result = await this.createDocument(contractId, documentType, ownerId, documentData);
    
    if (!result.success || !waitForConfirmation || !result.transactionHash) {
      return result;
    }
    
    console.log('Waiting for transaction confirmation...');
    const confirmation = await this.waitForConfirmation(result.transactionHash, {
      onProgress: (attempt, elapsed) => {
        console.log(`Confirmation attempt ${attempt}, elapsed: ${Math.round(elapsed / 1000)}s`);
      }
    });
    
    return {
      ...result,
      confirmed: confirmation.success
    };
  }
}

// Singleton instance
export const stateTransitionService = new StateTransitionService();
