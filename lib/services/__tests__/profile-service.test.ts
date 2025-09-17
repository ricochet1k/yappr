import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../wasm-sdk/wasm_sdk', () => ({
  get_documents: vi.fn(async (_sdk, _contractId, docType: string, where: any) => {
    if (docType === 'profile') {
      // Return one profile matching the in-batch owner id
      const ids = typeof where === 'string' && where.includes('in') ? JSON.parse(where).find((w: any[]) => w[0] === '$ownerId')[2] : []
      const docs = (ids || []).map((id: string) => ({
        $id: `prof-${id}`,
        $ownerId: id,
        $createdAt: 1234,
        displayName: `Display ${id.slice(0,4)}`,
        bio: 'Bio',
      }))
      return { documents: docs }
    }
    return { documents: [] }
  }),
  get_document: vi.fn(async () => null),
}))

vi.mock('../dpns-service', () => ({
  dpnsService: { resolveUsername: vi.fn(async (id: string) => `name-${id.slice(0,4)}`) }
}))

vi.mock('../wasm-sdk-service', () => ({ getWasmSdk: vi.fn(async () => ({})) }))

import { profileService } from '../profile-service'

function sleep(ms: number) { return new Promise(res => setTimeout(res, ms)) }

describe('profileService getProfile', () => {
  beforeEach(() => vi.clearAllMocks())

  it('returns transformed user with resolved username and displayName', async () => {
    const id = 'user-abcdef012345'
    const user = await profileService.getProfile(id)
    expect(user).toBeTruthy()
    expect(user!.id).toBe(id)
    expect(user!.displayName).toMatch(/Display/)
    // Username from dpns resolution
    await sleep(10)
    expect(user!.username).toMatch(/^name-/)
  })

  it('getProfilesByIdentityIds batches requests and returns mapped docs', async () => {
    const ids = ['user-a', 'user-b']
    const docs = await profileService.getProfilesByIdentityIds(ids)
    expect(docs.length).toBe(2)
    expect(docs.map(d => d.$ownerId)).toEqual(ids)
  })
})
