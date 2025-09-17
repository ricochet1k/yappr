import { describe, it, expect, vi, beforeEach } from 'vitest'

// Mocks
vi.mock('../../wasm-sdk/wasm_sdk', () => ({
  get_documents: vi.fn(async (_sdk, _cid, docType: string, where: any) => {
    if (docType === 'profile') {
      const parsed = typeof where === 'string' ? JSON.parse(where) : where
      const inClause = (parsed || []).find((w: any[]) => w[0] === '$ownerId' && w[1] === 'in')
      const eqClause = (parsed || []).find((w: any[]) => w[0] === '$ownerId' && w[1] === '==')
      if (inClause) {
        const owners: string[] = Array.isArray(inClause?.[2]) ? inClause[2] : []
        return { documents: owners.map((id) => ({ $id: `prof-${id}`, $ownerId: id, $createdAt: 1, displayName: `User ${id}`, avatarId: (id === 'o3' || id === 'o4') ? 'av-1' : undefined })) }
      }
      if (eqClause) {
        const id = eqClause[2]
        return { documents: [{ $id: `prof-${id}`, $ownerId: id, $createdAt: 1, displayName: `User ${id}`, avatarId: (id === 'o3' || id === 'o4') ? 'av-1' : undefined }] }
      }
    }
    return { documents: [] }
  }),
  get_document: vi.fn(async (_sdk, _cid, docType: string, id: string) => {
    if (docType === 'avatar') {
      // Return a stub avatar with revision
      return { $id: id, $ownerId: 'o1', $createdAt: 1, $revision: 2, data: 'x' }
    }
    if (docType === 'profile') {
      return { $id: `prof-${id}`, $ownerId: id, $createdAt: 1, displayName: `User ${id}` }
    }
    return null
  }),
}))

vi.mock('../wasm-sdk-service', () => ({ getWasmSdk: vi.fn(async () => ({})) }))

vi.mock('../state-transition-service', () => {
  const create = vi.fn(async (_cid: string, docType: string, ownerId: string, data: any) => ({
    success: true,
    document: docType === 'avatar'
      ? { $id: 'av-1', $ownerId: ownerId, $createdAt: 2, data: data?.data }
      : { $id: `prof-${ownerId}`, $ownerId: ownerId, $createdAt: 1, displayName: data?.displayName, bio: data?.bio, avatarId: data?.avatarId }
  }))
  const update = vi.fn(async () => ({ success: true, document: { $id: 'av-1', $ownerId: 'o1', $createdAt: 3 } }))
  const del = vi.fn(async () => ({ success: true }))
  return {
    stateTransitionService: {
      createDocument: create,
      updateDocument: update,
      deleteDocument: del,
    },
    _mocks: { create, update, del },
  }
})

import { profileService } from '../profile-service'
import * as sts from '../state-transition-service'
import { cacheManager } from '../../cache-manager'

describe('profileService avatar flows', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('createProfile with avatar creates avatar then profile and invalidates user tag', async () => {
    const inv = vi.spyOn(cacheManager, 'invalidateByTag')
    const user = await profileService.createProfile('o1', 'Name', 'Bio', 'AVATAR-DATA')
    expect(sts._mocks.create).toHaveBeenCalledWith(expect.anything(), 'avatar', 'o1', { data: 'AVATAR-DATA' })
    expect(user.displayName).toBe('Name')
    expect(inv).toHaveBeenCalledWith('user:o1')
  })

  it('updateProfile creates new avatar when none exists', async () => {
    const inv = vi.spyOn(cacheManager, 'invalidateByTag')
    const user = await profileService.updateProfile('o2', { avatarData: 'NEW' })
    expect(user).not.toBeNull()
    expect(sts._mocks.create).toHaveBeenCalled()
    expect(inv).toHaveBeenCalledWith('user:o2')
  })

  it('updateProfile updates existing avatar and clears avatar cache', async () => {
    // Return profile with existing avatar by making getProfile see avatarId via get_document('profile') path
    const delSpy = vi.spyOn(cacheManager, 'delete')
    // First ensure profile exists by calling getProfile (enqueueProfileDoc mocks)
    const p = await profileService.getProfile('o3')
    expect(p).not.toBeNull()
    // Now call updateProfile with existing avatarId on transform (simulate by passing avatar via updates requires internal fetch)
    // We simulate existing by calling updateProfile which will call createOrUpdateAvatar with profile.avatarId (undefined here),
    // so instead we call private method by updating getProfile to include avatarId via get_document mock would require transform input.
    // Easiest path: first create avatar through createProfile then update it.
    await profileService.createProfile('o3', 'Name', 'Bio', 'INIT')
    const updated = await profileService.updateProfile('o3', { avatarData: 'UPD' })
    expect(updated).not.toBeNull()
    expect(sts._mocks.update).toHaveBeenCalled()
    expect(delSpy).toHaveBeenCalledWith('avatars', expect.any(String))
  })

  it('updateProfile removes avatar when avatarData is empty', async () => {
    const delSpy = vi.spyOn(cacheManager, 'delete')
    await profileService.createProfile('o4', 'Name', 'Bio', 'HAS')
    const res = await profileService.updateProfile('o4', { avatarData: '' as any })
    expect(res).not.toBeNull()
    expect(sts._mocks.del).toHaveBeenCalled()
    expect(delSpy).toHaveBeenCalledWith('avatars', expect.any(String))
  })
})
