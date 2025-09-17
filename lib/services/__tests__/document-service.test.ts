import { describe, it, expect, vi } from 'vitest'

vi.mock('../../wasm-sdk/wasm_sdk', () => ({
  get_documents: vi.fn(async () => ({ documents: [] })),
  get_document: vi.fn(async () => ({ $id: 'd1', $ownerId: 'o1', $createdAt: 1 })),
}))

vi.mock('../wasm-sdk-service', () => ({ getWasmSdk: vi.fn(async () => ({})) }))

vi.mock('../state-transition-service', () => ({
  stateTransitionService: {
    createDocument: vi.fn(async () => ({ success: true, document: { $id: 'new', $ownerId: 'o1', $createdAt: 2 } })),
    updateDocument: vi.fn(async () => ({ success: true, document: { $id: 'd1', $ownerId: 'o1', $createdAt: 3 } })),
    deleteDocument: vi.fn(async () => ({ success: true })),
  }
}))

import { cacheManager } from '../../cache-manager'
import { BaseDocumentService } from '../document-service'

class TestService extends BaseDocumentService<any> {
  constructor() { super('testdoc') }
  protected transformDocument(doc: any) { return doc }
}

describe('BaseDocumentService cache invalidation', () => {
  it('invalidates tags on create/update/delete', async () => {
    const svc = new TestService()
    const inv = vi.spyOn(cacheManager, 'invalidateByTag')
    const created = await svc.create('o1', { foo: 'bar' })
    expect(created.$id).toBe('new')
    expect(inv).toHaveBeenCalledWith('doctype:testdoc')

    const updated = await svc.update('d1', 'o1', { baz: 1 })
    expect(updated.$id).toBe('d1')
    expect(inv).toHaveBeenCalledWith('doctype:testdoc')
    expect(inv).toHaveBeenCalledWith('docid:testdoc:d1')

    const ok = await svc.delete('d1', 'o1')
    expect(ok).toBe(true)
    expect(inv).toHaveBeenCalledWith('doctype:testdoc')
    expect(inv).toHaveBeenCalledWith('docid:testdoc:d1')
  })
})

