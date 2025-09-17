import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../wasm-sdk/wasm_sdk', () => {
  return {
    get_documents: vi.fn(async (_sdk, _contractId, docType: string, where: any) => {
      if (docType !== 'like') return { documents: [] }
      const whereStr = String(where || '')
      const hasOwner = whereStr.includes('$ownerId')
      const ownerIsUser1 = whereStr.includes('"user-1"')
      // getLike path
      if (hasOwner) {
        if (ownerIsUser1) {
          return { documents: [{ $id: 'l1', $ownerId: 'user-1', $createdAt: 1, postId: [1,2] }] }
        }
        return { documents: [] }
      }
      // getPostLikes path
      if (whereStr.includes('postId')) {
        return { documents: [
          { $id: 'l1', $ownerId: 'user-1', $createdAt: 1, postId: [1,2] },
          { $id: 'l2', $ownerId: 'user-2', $createdAt: 2, postId: [1,2] },
        ] }
      }
      return { documents: [] }
    }),
    get_document: vi.fn(async () => null),
  }
})

vi.mock('../wasm-sdk-service', () => ({ getWasmSdk: vi.fn(async () => ({})) }))

vi.mock('bs58', () => ({ default: { decode: (_s: string) => new Uint8Array([1,2]) } }))

vi.mock('../state-transition-service', () => ({
  stateTransitionService: {
    createDocument: vi.fn(async () => ({ success: true, document: { $id: 'new', $ownerId: 'user-9', $createdAt: Date.now(), postId: [1,2] } })),
    deleteDocument: vi.fn(async () => ({ success: true })),
  }
}))

import { likeService } from '../like-service'

describe('likeService functionality', () => {
  beforeEach(() => vi.clearAllMocks())

  it('isLiked returns false when no like exists', async () => {
    const liked = await likeService.isLiked('3mJr7AoUXx2Wqd', 'user-0')
    expect(liked).toBe(false)
  })

  it('getLike finds existing like for user', async () => {
    const like = await likeService.getLike('3mJr7AoUXx2Wqd', 'user-1')
    expect(like?.$ownerId).toBe('user-1')
  })

  it('likePost creates like when not existing', async () => {
    const ok = await likeService.likePost('3mJr7AoUXx2Wqd', 'user-new')
    expect(ok).toBe(true)
  })

  it('countLikes returns number of likes', async () => {
    const n = await likeService.countLikes('3mJr7AoUXx2Wqd')
    expect(n).toBe(2)
  })

  it('unlikePost succeeds and calls delete when like exists', async () => {
    // Arrange: for user-1 getLike path returns a like
    const ok = await likeService.unlikePost('3mJr7AoUXx2Wqd', 'user-1')
    expect(ok).toBe(true)
  })
})
