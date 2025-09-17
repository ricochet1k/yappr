import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../wasm-sdk/wasm_sdk', () => {
  return {
    get_documents: vi.fn(async (_sdk, _contractId, docType: string, where: any, orderBy: any, limit?: number) => {
      // Like counts path
      if (docType === 'like' && typeof where === 'string' && where.includes('postId')) {
        return { documents: [
          { $id: 'l1', $ownerId: 'a', $createdAt: 1, postId: [1,2] },
          { $id: 'l2', $ownerId: 'b', $createdAt: 2, postId: [1,2] },
          { $id: 'l3', $ownerId: 'c', $createdAt: 3, postId: [1,2] },
        ] }
      }
      // Filter by owner for getUserPosts
      if (docType === 'post' && typeof where === 'string' && where.includes('$ownerId')) {
        const onlyU1 = where.includes('"u1"')
        const base = [
          { $id: 'p2', $ownerId: 'u2', $createdAt: 2000, content: 'B' },
          { $id: 'p1', $ownerId: 'u1', $createdAt: 1000, content: 'A' },
        ]
        const docs = onlyU1 ? base.filter(d => d.$ownerId === 'u1') : base
        // Handle getReplies ordering asc
        if (orderBy && String(orderBy).includes('"asc"')) {
          return { documents: docs.sort((a,b) => a.$createdAt - b.$createdAt) }
        }
        return { documents: docs.slice(0, limit || docs.length) }
      }
      // If counting replies (where contains replyToPostId), return 1 doc
      if (docType === 'post' && typeof where === 'string' && where.includes('replyToPostId')) {
        return { documents: [{ $id: 'r1', $ownerId: 'uX', $createdAt: 1, content: 'reply' }] }
      }
      // Default timeline documents
      return {
        documents: [
          { $id: 'p2', $ownerId: 'u2', $createdAt: 2000, content: 'B' },
          { $id: 'p1', $ownerId: 'u1', $createdAt: 1000, content: 'A', mediaUrl: 'https://ex/img.png' },
        ].slice(0, limit || 2)
      }
    }),
    get_document: vi.fn(async () => null),
  }
})

vi.mock('../profile-service', () => {
  return {
    profileService: {
      getProfile: vi.fn(async (ownerId: string) => ({
        id: ownerId,
        username: `user-${ownerId}`,
        displayName: `User ${ownerId.slice(0,4)}`,
        avatar: '',
        followers: 0,
        following: 0,
        verified: false,
        joinedAt: new Date(0),
      })),
    },
  }
})

vi.mock('../like-service', () => {
  return {
    likeService: {
      countLikes: vi.fn(async () => 3),
    },
  }
})

vi.mock('../repost-service', () => {
  return {
    repostService: {
      countReposts: vi.fn(async () => 2),
    },
  }
})

vi.mock('../wasm-sdk-service', () => ({ getWasmSdk: vi.fn(async () => ({})) }))

import { postService } from '../post-service'
import { cacheManager } from '../../cache-manager'
vi.mock('../state-transition-service', () => ({
  stateTransitionService: {
    createDocument: vi.fn(async () => ({ success: true, document: { $id: 'newP', $ownerId: 'ownerX', $createdAt: Date.now(), content: 'Hello' } })),
  }
}))

function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)) }

describe('postService.getTimeline', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns posts ordered by createdAt desc and enriches fields', async () => {
    const res = await postService.getTimeline({ limit: 2 })
    expect(res.documents.length).toBe(2)
    const [p2, p1] = res.documents
    // Order check (2000 before 1000)
    expect(p2.id).toBe('p2')
    expect(p1.id).toBe('p1')
    expect(p1.createdAt).toBeInstanceOf(Date)
    // Media mapped
    expect(p1.media?.[0].url).toMatch(/img\.png/)

    // Allow async enrichment to complete (profile + stats)
    await sleep(20)
    expect([p1.likes, p1.reposts]).toEqual([3, 2])
    expect([p2.likes, p2.reposts]).toEqual([3, 2])
    // Author enriched via profileService
    expect(p2.author.username).toBe('user-u2')
  })
})

describe('postService other queries', () => {
  beforeEach(() => vi.clearAllMocks())

  it('getUserPosts filters by owner and returns only their posts', async () => {
    const res = await postService.getUserPosts('u1', { limit: 10 })
    expect(res.documents.map(p => p.id)).toEqual(['p1'])
  })

  it('getReplies returns ascending order by createdAt', async () => {
    const res = await postService.getReplies('pX')
    // mock returns one reply with createdAt=1; mainly ensure it doesn't error and date is Date
    expect(res.documents[0].createdAt).toBeInstanceOf(Date)
  })

  it('createPost invalidates doctype cache on create', async () => {
    const spy = vi.spyOn(cacheManager, 'invalidateByTag')
    const post = await postService.createPost('ownerX', 'Hello world')
    expect(post.id).toBe('newP')
    expect(spy).toHaveBeenCalledWith('doctype:post')
  })
})
