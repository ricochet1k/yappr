import { DocumentResult } from './document-service';
import { Post, User } from '../types';
import { identityService } from './identity-service';
import { profileService } from './profile-service';
import { cacheManager } from '../cache-manager';
import { posts } from '../contract-docs'
import type { PostDocument as ContractPostDoc, PostIndex } from '../contract-types.generated'
import type { QueryOptions as TypedQueryOptions } from '../contract-api'
import { keyManager } from '../key-manager'

export interface PostDocument {
  $id: string;
  $ownerId: string;
  $createdAt: number;
  $updatedAt?: number;
  content: string;
  mediaUrl?: string;
  replyToPostId?: string;
  quotedPostId?: string;
  firstMentionId?: string;
  primaryHashtag?: string;
  language?: string;
  sensitive?: boolean;
}

export interface PostStats {
  postId: string;
  likes: number;
  reposts: number;
  replies: number;
  views: number;
}

type PostQueryOptions = TypedQueryOptions<ContractPostDoc, PostIndex>

class PostService {
  private readonly CACHE_TTL = 30000

  /**
   * Transform document to Post type
   */
  protected transformDocument(doc: PostDocument): Post {
    // Be resilient to different document shapes ($-prefixed vs plain vs data wrapper)
    const anyDoc: any = doc as any
    const data = anyDoc.data || anyDoc
    const id: string = anyDoc.$id || anyDoc.id || Math.random().toString(36).slice(2)
    const ownerId: string | undefined = anyDoc.$ownerId || anyDoc.ownerId
    const createdAtMs: number = anyDoc.$createdAt || anyDoc.createdAt || Date.now()
    const content: string = data.content || ''

    // Return a basic Post object - additional data will be loaded separately
    const post: Post = {
      id,
      author: this.getDefaultUser(ownerId),
      content,
      createdAt: new Date(createdAtMs),
      likes: 0,
      reposts: 0,
      replies: 0,
      views: 0,
      liked: false,
      reposted: false,
      bookmarked: false,
      media: data.mediaUrl ? [{
        id: id + '-media',
        type: 'image',
        url: data.mediaUrl
      }] : undefined
    };

    // Queue async operations to enrich the post
    this.enrichPost(post, doc);

    return post;
  }

  private async runQuery(options: PostQueryOptions): Promise<DocumentResult<Post>> {
    // Call typed document query
    const res: any = await posts.query(options)

    // Normalize shapes: some SDKs return array, some return {documents}
    const rawDocs: any[] = Array.isArray(res)
      ? res
      : (res && typeof res === 'object' && Array.isArray(res.documents))
        ? res.documents
        : []

    const documents = rawDocs.map((d) => this.transformDocument(d as any))
    const nextCursor = res && typeof res === 'object' && 'nextCursor' in res ? (res as any).nextCursor : undefined
    const prevCursor = res && typeof res === 'object' && 'prevCursor' in res ? (res as any).prevCursor : undefined

    return { documents, nextCursor, prevCursor }
  }

  async get(id: string): Promise<Post | null> {
    const doc = await posts.get(id)
    if (!doc) return null
    return this.transformDocument(doc as any)
  }

  /**
   * Enrich post with async data
   */
  private async enrichPost(post: Post, doc: PostDocument): Promise<void> {
    try {
      const anyDoc: any = doc as any
      const data = anyDoc.data || anyDoc
      const ownerId: string | undefined = anyDoc.$ownerId || anyDoc.ownerId
      const docId: string = anyDoc.$id || anyDoc.id || post.id
      // Get author information
      const author = ownerId ? await profileService.getProfile(ownerId) : null;
      if (author) {
        post.author = author;
      }
      
      // Get post stats
      const stats = await this.getPostStats(docId);
      post.likes = stats.likes;
      post.reposts = stats.reposts;
      post.replies = stats.replies;
      post.views = stats.views;
      
      // Get interaction status for current user
      const interactions = await this.getUserInteractions(docId);
      post.liked = interactions.liked;
      post.reposted = interactions.reposted;
      post.bookmarked = interactions.bookmarked;

      // Load reply-to post if exists
      const replyToId: string | undefined = data.replyToId || anyDoc.replyToId
      if (replyToId) {
        const replyTo = await this.get(replyToId);
        if (replyTo) {
          post.replyTo = replyTo;
        }
      }

      // Load quoted post if exists
      const quotedPostId: string | undefined = data.quotedPostId || anyDoc.quotedPostId
      if (quotedPostId) {
        const quotedPost = await this.get(quotedPostId);
        if (quotedPost) {
          post.quotedPost = quotedPost;
        }
      }
    } catch (error) {
      console.error('Error enriching post:', error);
    }
  }

  /**
   * Create a new post
   */
  async createPost(
    ownerId: string,
    content: string,
    options: {
      mediaUrl?: string;
      replyToId?: string;
      quotedPostId?: string;
      firstMentionId?: string;
      primaryHashtag?: string;
      language?: string;
      sensitive?: boolean;
    } = {}
  ): Promise<Post> {
    const data: any = {
      content
    };

    // Add optional fields
    if (options.mediaUrl) data.mediaUrl = options.mediaUrl;
    if (options.replyToId) data.replyToId = options.replyToId;
    if (options.quotedPostId) data.quotedPostId = options.quotedPostId;
    if (options.firstMentionId) data.firstMentionId = options.firstMentionId;
    if (options.primaryHashtag) data.primaryHashtag = options.primaryHashtag;
    if (options.language) data.language = options.language || 'en';
    if (options.sensitive !== undefined) data.sensitive = options.sensitive;

    // Use typed DocumentType#create (requires signer + entropy)
    const pk = await keyManager.getPrivateKey(ownerId)
    if (!pk) throw new Error('No private key found. Please log in again.')
    const entropy = (() => {
      const bytes = new Uint8Array(32)
      if (typeof window !== 'undefined' && window.crypto) window.crypto.getRandomValues(bytes)
      else for (let i = 0; i < 32; i++) bytes[i] = Math.floor(Math.random() * 256)
      return Array.from(bytes, b => b.toString(16).padStart(2, '0')).join('')
    })()

    const result = await posts.create({ ownerId, data: data as any, entropy, privateKeyWif: pk })
    return this.transformDocument((result && (result as any).document) ? (result as any).document : (result as any))
  }

  /**
   * Get timeline posts
   */
  async getTimeline(options: PostQueryOptions = {}): Promise<DocumentResult<Post>> {
    const defaultOptions: PostQueryOptions = {
      orderBy: [['$createdAt', 'desc']],
      limit: 20,
      ...options
    };
    return this.runQuery(defaultOptions)
  }

  /**
   * Get posts by user
   */
  async getUserPosts(userId: string, options: PostQueryOptions = {}): Promise<DocumentResult<Post>> {
    const queryOptions: PostQueryOptions = {
      where: [['$ownerId', '==', userId]],
      orderBy: [['$createdAt', 'desc']],
      limit: 20,
      ...options
    };
    return this.runQuery(queryOptions)
  }

  /**
   * Get replies to a post
   */
  async getReplies(postId: string, options: PostQueryOptions = {}): Promise<DocumentResult<Post>> {
    const queryOptions: PostQueryOptions = {
      where: [['replyToPostId', '==', postId]],
      orderBy: [['$createdAt', 'asc']],
      limit: 20,
      ...options
    };
    return this.runQuery(queryOptions)
  }

  // Note: No index exists for primaryHashtag; cannot support hashtag queries without Drive index.

  /**
   * Get post statistics (likes, reposts, replies)
   */
  private async getPostStats(postId: string): Promise<PostStats> {
    try {
      return await cacheManager.getOrFetch<PostStats>(
        'post:stats',
        postId,
        async () => {
          // In a real implementation, these would be parallel queries
          const stats: PostStats = {
            postId,
            likes: await this.countLikes(postId),
            reposts: await this.countReposts(postId),
            replies: await this.countReplies(postId),
            views: 0
          };
          return stats
        },
        { ttl: 10000, tags: ['post:stats'] }
      )
    } catch (error) {
      console.error('Error getting post stats:', error);
      return { postId, likes: 0, reposts: 0, replies: 0, views: 0 };
    }
  }

  /**
   * Count likes for a post
   */
  private async countLikes(postId: string): Promise<number> {
    const { likeService } = await import('./like-service');
    return likeService.countLikes(postId);
  }

  /**
   * Count reposts for a post
   */
  private async countReposts(postId: string): Promise<number> {
    const { repostService } = await import('./repost-service');
    return repostService.countReposts(postId);
  }

  /**
   * Count replies to a post
   */
  private async countReplies(postId: string): Promise<number> {
    try {
      const result = await this.runQuery({
        where: [['replyToPostId', '==', postId]],
        // For demo purposes, fetch up to 100 replies and count them (Drive limit)
        // Note: backend should provide a total count in production
        limit: 100
      });
      return result.documents.length
    } catch (error) {
      return 0;
    }
  }

  /**
   * Get user interactions with a post
   */
  private async getUserInteractions(postId: string): Promise<{
    liked: boolean;
    reposted: boolean;
    bookmarked: boolean;
  }> {
    // This would check if the current user has liked/reposted/bookmarked
    // For now, return false for all
    return {
      liked: false,
      reposted: false,
      bookmarked: false
    };
  }

  /**
   * Get default user object when profile not found
   */
  private getDefaultUser(userId?: string): User {
    return {
      id: userId || 'unknown',
      username: userId ? userId.substring(0, 8) + '...' : 'unknown',
      displayName: 'Unknown User',
      avatar: '',
      bio: '',
      followers: 0,
      following: 0,
      verified: false,
      joinedAt: new Date()
    };
  }
}

// Singleton instance
export const postService = new PostService();
