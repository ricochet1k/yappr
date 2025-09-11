import { BaseDocumentService, QueryOptions } from './document-service';
import { stateTransitionService } from './state-transition-service';
import { getWasmSdk } from './wasm-sdk-service';

export interface LikeDocument {
  $id: string;
  $ownerId: string;
  $createdAt: number;
  postId: string;
}

class LikeService extends BaseDocumentService<LikeDocument> {
  constructor() {
    super('like');
  }

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

    // Use state transition service for creation
    const result = await stateTransitionService.createDocument(
      this.contractId,
      this.documentType,
      ownerId,
      { postId: postIdBytes }
    );

    return result.success;
  }

  /**
   * Unlike a post
   */
  async unlikePost(postId: string, ownerId: string): Promise<boolean> {
    const like = await this.getLike(postId, ownerId);
    if (!like) return true;

    // Use state transition service for deletion
    const result = await stateTransitionService.deleteDocument(
      this.contractId,
      this.documentType,
      like.$id,
      ownerId
    );

    return result.success;
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
    const bs58Module = await import('bs58');
    const bs58 = bs58Module.default;
    const postIdBytes = Array.from(bs58.decode(postId));

    const result = await this.query({
      where: [
        ['postId', '==', postIdBytes],
        ['$ownerId', '==', ownerId]
      ],
      limit: 1
    });
    return result.documents.length > 0 ? result.documents[0] : null;
  }

  /**
   * Get likes for a post
   */
  async getPostLikes(postId: string, options: QueryOptions = {}): Promise<LikeDocument[]> {
    const bs58Module = await import('bs58');
    const bs58 = bs58Module.default;
    const postIdBytes = Array.from(bs58.decode(postId));

    const result = await this.query({
      where: [['postId', '==', postIdBytes]],
      orderBy: [['$createdAt', 'desc']],
      limit: options.limit || 50
    })
    return result.documents
  }

  /**
   * Get user's likes
   */
  async getUserLikes(userId: string, options: QueryOptions = {}): Promise<LikeDocument[]> {
    try {
      const result = await this.query({
        where: [['$ownerId', '==', userId]],
        orderBy: [['$createdAt', 'desc']],
        limit: 50,
        ...options
      });

      return result.documents;
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
