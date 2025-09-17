import type { DocumentResult } from './document-service';
import { likes } from '../contract-docs'
import type { LikeDocument as ContractLikeDoc, LikeIndex } from '../contract-types.generated'
import type { QueryOptions as TypedQueryOptions } from '../contract-api'
import { keyManager } from '../key-manager'

export interface LikeDocument {
  $id: string;
  $ownerId: string;
  $createdAt: number;
  postId: string;
}

type LikeQueryOptions = TypedQueryOptions<ContractLikeDoc, LikeIndex>

class LikeService {
  private readonly CACHE_TTL = 30000

  /**
   * Transform document
   */
  protected transformDocument(doc: any): LikeDocument {
    return {
      $id: doc.$id,
      $ownerId: doc.$ownerId,
      $createdAt: doc.$createdAt,
      postId: doc.postId
    };
  }

  /**
   * Like a post
   */
  async likePost(postId: string, ownerId: string): Promise<boolean> {
    // Check if already liked
    const existing = await this.getLike(postId, ownerId);
    if (existing) return true;

    // Convert postId to byte array
    const bs58Module = await import('bs58');
    const bs58 = bs58Module.default;
    const postIdBytes = Array.from(bs58.decode(postId));

    const pk = await keyManager.getPrivateKey(ownerId)
    if (!pk) return false
    const entropy = (() => {
      const bytes = new Uint8Array(32)
      if (typeof window !== 'undefined' && window.crypto) window.crypto.getRandomValues(bytes)
      else for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256)
      return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
    })()

    const res = await likes.create({ ownerId, data: { postId: postIdBytes } as any, entropy, privateKeyWif: pk })
    // If create returns the document directly or wrapped, treat as success
    return !!res
  }

  /**
   * Unlike a post
   */
  async unlikePost(postId: string, ownerId: string): Promise<boolean> {
    const like = await this.getLike(postId, ownerId);
    if (!like) return true;
    const pk = await keyManager.getPrivateKey(ownerId)
    if (!pk) return false
    const ok = await likes.delete({ documentId: like.$id, ownerId, privateKeyWif: pk })
    return !!ok
  }

  /**
   * Check if post is liked by user
   */
  async isLiked(postId: string, ownerId: string): Promise<boolean> {
    const like = await this.getLike(postId, ownerId);
    return like !== null;
  }

  /**
   * Get like by post and owner
   */
  async getLike(postId: string, ownerId: string): Promise<LikeDocument | null> {
    const res: any = await likes.query({ where: [['postId', '==', postId], ['$ownerId', '==', ownerId]], limit: 1 })
    const docs: any[] = Array.isArray(res) ? res : (res?.documents || [])
    return docs.length > 0 ? this.transformDocument(docs[0]) : null;
  }

  /**
   * Get likes for a post
   */
  async getPostLikes(postId: string, options: LikeQueryOptions = {}): Promise<LikeDocument[]> {
    const res: any = await likes.query({ where: [['postId', '==', postId]], orderBy: [['$createdAt', 'desc']], limit: options.limit || 50 })
    const docs: any[] = Array.isArray(res) ? res : (res?.documents || [])
    return docs.map((d) => this.transformDocument(d))
  }

  /**
   * Get user's likes
   */
  async getUserLikes(userId: string, options: LikeQueryOptions = {}): Promise<LikeDocument[]> {
    try {
      const res: any = await likes.query({ where: [['$ownerId', '==', userId]], orderBy: [['$createdAt', 'desc']], limit: options.limit || 50 })
      const docs: any[] = Array.isArray(res) ? res : (res?.documents || [])
      return docs.map((d) => this.transformDocument(d))
    } catch (error) {
      console.error('Error getting user likes:', error);
      return [];
    }
  }

  /**
   * Count likes for a post
   */
  async countLikes(postId: string): Promise<number> {
    // In a real implementation, this would be more efficient
    const likes = await this.getPostLikes(postId);
    return likes.length;
  }
}

// Singleton instance
export const likeService = new LikeService();
