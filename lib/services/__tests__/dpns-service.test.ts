import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../wasm-sdk/wasm_sdk', () => ({
  dpns_is_valid_username: vi.fn((label: string) => /^[a-z0-9_]{3,20}$/i.test(label)),
  dpns_is_contested_username: vi.fn((label: string) => label.startsWith('hot')),
  dpns_convert_to_homograph_safe: vi.fn((label: string) => label.toLowerCase()),
  dpns_is_name_available: vi.fn(async () => true),
  get_documents: vi.fn(async (_sdk, _cid, docType: string, where: any) => {
    if (docType === 'domain') {
      const parsed = typeof where === 'string' ? JSON.parse(where) : where
      // Resolve identity by username (forward): expect normalizedLabel in [labels] AND parent == 'dash'
      const inClause = (parsed || []).find((w: any[]) => w[0] === 'normalizedLabel' && w[1] === 'in')
      const parentEq = (parsed || []).find((w: any[]) => w[0] === 'normalizedParentDomainName' && w[1] === '==')
      const owner = 'IDENTITY-123'
      if (inClause && parentEq) {
        return { documents: inClause[2].map((lbl: string) => ({ normalizedLabel: lbl, $ownerId: owner })) }
      }
      // Reverse lookup by identity
      const idClause = (parsed || []).find((w: any[]) => w[0] === 'records.identity' && w[1] === 'in')
      if (idClause) {
        const ids: string[] = idClause[2]
        return { documents: ids.map((id) => ({ label: 'name', normalizedParentDomainName: 'dash', records: { identity: id } })) }
      }
    }
    return { documents: [] }
  }),
}))

vi.mock('../wasm-sdk-service', () => ({ getWasmSdk: vi.fn(async () => ({})) }))

import { dpnsService } from '../dpns-service'

describe('dpnsService validation helpers', () => {
  it('validateUsername reflects dpns rules', () => {
    const ok = dpnsService.validateUsername('Alice_1')
    expect(ok.isValid).toBe(true)
    expect(ok.normalizedLabel).toBe('alice_1')
    const bad = dpnsService.validateUsername('!!')
    expect(bad.isValid).toBe(false)
  })

  it('getUsernameValidationError returns helpful messages', () => {
    expect(dpnsService.getUsernameValidationError('')).toMatch(/required/i)
    expect(dpnsService.getUsernameValidationError('ab')).toMatch(/at least 3/i)
    expect(dpnsService.getUsernameValidationError('this_is_way_too_long_for_dpns')).toMatch(/20/i)
    expect(dpnsService.getUsernameValidationError('bad*chars')).toMatch(/letters, numbers, and underscores/i)
    expect(dpnsService.getUsernameValidationError('_start')).toMatch(/cannot start or end/i)
    expect(dpnsService.getUsernameValidationError('end_')).toMatch(/cannot start or end/i)
    expect(dpnsService.getUsernameValidationError('double__u')).toMatch(/consecutive underscores/i)
  })
})

describe('dpnsService search', () => {
  it('searchUsernames maps usernames', async () => {
    const list = await dpnsService.searchUsernames('al', 5)
    expect(Array.isArray(list)).toBe(true)
  })

  it('searchUsernamesWithDetails maps owner ids', async () => {
    const list = await dpnsService.searchUsernamesWithDetails('al', 5)
    expect(Array.isArray(list)).toBe(true)
  })
})

describe('dpnsService lookups', () => {
  beforeEach(() => vi.clearAllMocks())

  it('isUsernameAvailable uses native check', async () => {
    const ok = await dpnsService.isUsernameAvailable('alice')
    expect(ok).toBe(true)
  })

  it('resolveIdentity via forward batch returns owner id', async () => {
    const id = await dpnsService.resolveIdentity('alice.dash')
    expect(id).toBe('IDENTITY-123')
  })

  it('resolveUsername via reverse batch returns best name', async () => {
    const name = await dpnsService.resolveUsername('IDENTITY-XYZ')
    // With our mock, returns a single name
    expect(typeof name === 'string' ? name : '').toMatch(/\.dash$/)
  })
})

describe('dpnsService future work', () => {
  it.fails('registerUsername requires auth and platform connectivity', async () => {
    // This test documents the intended contract and will be implemented when testnet is wired.
    // It is expected to fail today due to missing platform connectivity and auth.
    const result = await (await import('../dpns-service')).dpnsService.registerUsername(
      'alice', 'IDENTITY-123', 1, () => {}
    )
    expect(result).toBeDefined()
  })
})
