/**
 * Service for managing local data contracts
 */

import yapprContractJson from '../../contracts/yappr-social-contract.json'

export interface DataContract {
  $id?: string
  $format_version: string
  $schema: string
  version: number
  ownerId: string
  documents: Record<string, any>
}

class ContractService {
  private yapprContract: DataContract | null = null
  private contractId: string | null = null

  /**
   * Get the yappr contract with the specified owner ID and contract ID
   */
  getYapprContract(ownerId: string, contractId: string): DataContract {
    if (!this.yapprContract || this.contractId !== contractId) {
      // Normalize contract shape and set owner/contract IDs
      const base: any = yapprContractJson as any
      const documents = base.documents ?? base
      this.yapprContract = ({
        ...base,
        documents,
        ownerId,
        $id: contractId
      } as unknown) as DataContract
      this.contractId = contractId
    }
    
    return this.yapprContract
  }

  /**
   * Get the yappr contract JSON as a string
   */
  getYapprContractJson(ownerId: string, contractId: string): string {
    const contract = this.getYapprContract(ownerId, contractId)
    return JSON.stringify(contract)
  }

  /**
   * Validate if a contract ID matches our yappr contract
   */
  isYapprContract(contractId: string): boolean {
    return this.contractId === contractId
  }
}

// Singleton instance
export const contractService = new ContractService()
