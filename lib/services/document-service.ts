import { getWasmSdk } from './wasm-sdk-service';
import { safeGetDocuments, safeGetDocument } from './dapi-helpers';
import { stateTransitionService } from './state-transition-service';
import { YAPPR_CONTRACT_ID } from '../constants';
import { cacheManager } from '../cache-manager';

export type WhereClause = Array<[string, string, unknown]>;
export type OrderByClause = Array<[string, 'asc' | 'desc']>;

export interface QueryOptions {
  where?: WhereClause;
  orderBy?: OrderByClause;
  limit?: number;
  startAfter?: string;
  startAt?: string;
}

export interface DocumentResult<T> {
  documents: T[];
  nextCursor?: string;
  prevCursor?: string;
}

export abstract class BaseDocumentService<T> {
  protected readonly contractId: string;
  protected readonly documentType: string;
  protected readonly CACHE_TTL = 30000; // 30 seconds cache

  constructor(documentType: string) {
    this.contractId = YAPPR_CONTRACT_ID;
    this.documentType = documentType;
  }

  /**
   * Query documents
   */
  async query(options: QueryOptions = {}): Promise<DocumentResult<T>> {
    try {
      // Build typed query
      const query: {
        contractId: string;
        documentType: string;
        where?: WhereClause;
        orderBy?: OrderByClause;
        limit?: number;
        startAfter?: string;
        startAt?: string;
      } = {
        contractId: this.contractId,
        documentType: this.documentType,
        where: options.where,
        orderBy: options.orderBy,
        limit: options.limit,
        startAfter: options.startAfter,
        startAt: options.startAt,
      };

      console.log(`Querying ${this.documentType} documents:`, query);
      
      const cacheKeyObject = {
        where: query.where || null,
        orderBy: query.orderBy || null,
        limit: query.limit || 25,
        startAfter: query.startAfter || null,
        startAt: query.startAt || null
      }

      const cacheName = `documents:${this.documentType}`

      const response = await cacheManager.getOrFetchByObject<unknown>(
        cacheName,
        cacheKeyObject,
        async () => {
          return await safeGetDocuments(
            this.contractId,
            this.documentType,
            query.where || null,
            query.orderBy || null,
            query.limit || 25,
            query.startAfter || null,
            query.startAt || null
          )
        },
        { ttl: this.CACHE_TTL, tags: [
          `doctype:${this.documentType}`
        ] }
      )

      // get_documents returns an object directly, not JSON string
      let result: unknown = response;
      
      console.log(`${this.documentType} result type:`, typeof result);
      
      // Check if result is an array (direct documents response)
      if (Array.isArray(result)) {
        const rawDocs = result as unknown[];
        const documents = rawDocs.map((doc) => this.transformDocument(doc));
        
        return {
          documents,
          nextCursor: undefined,
          prevCursor: undefined
        };
      }
      
      // Otherwise expect object with documents property
      let documents: T[] = [];
      if (result && typeof result === 'object' && 'documents' in result) {
        const maybeDocs = (result as { documents?: unknown }).documents;
        if (Array.isArray(maybeDocs)) {
          documents = (maybeDocs as unknown[]).map((doc) => this.transformDocument(doc));
        }
      }
      
      let nextCursor: string | undefined
      let prevCursor: string | undefined
      if (result && typeof result === 'object') {
        if ('nextCursor' in result) nextCursor = (result as { nextCursor?: string }).nextCursor
        if ('prevCursor' in result) prevCursor = (result as { prevCursor?: string }).prevCursor
      }
      return {
        documents,
        nextCursor,
        prevCursor
      };
    } catch (error) {
      console.error(`Error querying ${this.documentType} documents:`, error);
      throw error;
    }
  }

  /**
   * Get a single document by ID
   */
  async get(documentId: string): Promise<T | null> {
    try {
      const cacheName = `document:${this.documentType}`
      return await cacheManager.getOrFetch<T | null>(
        cacheName,
        documentId,
        async () => {
          const response = await safeGetDocument(
            this.contractId,
            this.documentType,
            documentId
          )
          if (!response) return null as any
          const doc = response
          const transformed = this.transformDocument(doc)
          return transformed
        },
        { ttl: this.CACHE_TTL, tags: [`doctype:${this.documentType}`, `docid:${this.documentType}:${documentId}`] }
      )
    } catch (error) {
      console.error(`Error getting ${this.documentType} document:`, error);
      return null;
    }
  }

  /**
   * Create a new document
   */
  async create(ownerId: string, data: Record<string, unknown>): Promise<T> {
    try {
      const sdk = await getWasmSdk();
      
      console.log(`Creating ${this.documentType} document:`, data);
      
      // Use state transition service for document creation
      const result = await stateTransitionService.createDocument(
        this.contractId,
        this.documentType,
        ownerId,
        data
      );
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to create document');
      }
      
      // Invalidate caches for this document type
      cacheManager.invalidateByTag(`doctype:${this.documentType}`)
      
      return this.transformDocument(result.document as unknown);
    } catch (error) {
      console.error(`Error creating ${this.documentType} document:`, error);
      throw error;
    }
  }

  /**
   * Update a document
   */
  async update(documentId: string, ownerId: string, data: Record<string, unknown>): Promise<T> {
    try {
      const sdk = await getWasmSdk();
      
      console.log(`Updating ${this.documentType} document ${documentId}:`, data);
      
      // Get current document to find revision
      const currentDoc = await this.get(documentId);
      if (!currentDoc) {
        throw new Error('Document not found');
      }
      const revision = (currentDoc as unknown as { $revision?: number }).$revision || 0;
      
      // Use state transition service for document update
      const result = await stateTransitionService.updateDocument(
        this.contractId,
        this.documentType,
        documentId,
        ownerId,
        data,
        revision
      );
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to update document');
      }
      
      // Invalidate caches for this document and type
      cacheManager.invalidateByTag(`doctype:${this.documentType}`)
      cacheManager.invalidateByTag(`docid:${this.documentType}:${documentId}`)
      
      return this.transformDocument(result.document as unknown);
    } catch (error) {
      console.error(`Error updating ${this.documentType} document:`, error);
      throw error;
    }
  }

  /**
   * Delete a document
   */
  async delete(documentId: string, ownerId: string): Promise<boolean> {
    try {
      const sdk = await getWasmSdk();
      
      console.log(`Deleting ${this.documentType} document ${documentId}`);
      
      // Use state transition service for document deletion
      const result = await stateTransitionService.deleteDocument(
        this.contractId,
        this.documentType,
        documentId,
        ownerId
      );
      
      if (!result.success) {
        throw new Error(result.error || 'Failed to delete document');
      }
      
      // Invalidate caches
      cacheManager.invalidateByTag(`doctype:${this.documentType}`)
      cacheManager.invalidateByTag(`docid:${this.documentType}:${documentId}`)
      
      return true;
    } catch (error) {
      console.error(`Error deleting ${this.documentType} document:`, error);
      return false;
    }
  }

  /**
   * Transform raw document to typed object
   * Override in subclasses for custom transformation
   */
  protected abstract transformDocument(doc: unknown): T;

  /**
   * Clear cache
   */
  clearCache(documentId?: string): void {
    if (documentId) {
      cacheManager.invalidateByTag(`docid:${this.documentType}:${documentId}`)
    } else {
      cacheManager.invalidateByTag(`doctype:${this.documentType}`)
    }
  }

  /**
   * Clean up expired cache entries
   */
  cleanupCache(): void {
    // No-op: centralized cleanup handled by cacheManager
  }
}
