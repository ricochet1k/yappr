import { get_documents, get_document, WasmSdk } from '../wasm-sdk/wasm_sdk'
import { getWasmSdk, wasmSdkService } from './wasm-sdk-service'

function isDapiAddressExhausted(err: any): boolean {
  const msg = (err && (err.message || String(err))) || ''
  return msg.includes('no available addresses')
}

let runningPromises = 0
let waitingFunctions: Array<() => Promise<void>> = []
const RUNNING_LIMIT = 10
function rateLimit<R>(fn: () => Promise<R>): Promise<R> {
  return new Promise((resolve, reject) => {
    if (runningPromises < RUNNING_LIMIT) {
      runningPromises += 1;
      fn().then(resolve, reject).finally(rateLimitedFinished)
    } else {
        waitingFunctions.push(() => fn().then(resolve, reject).finally(rateLimitedFinished))
    }
  })
}
function rateLimitedFinished() {
  const fn = waitingFunctions.pop();
  if (fn) {
    fn();
  } else {
    runningPromises -= 1
  }
}

async function retryLoop<R>(fn: () => Promise<R>, shouldRetry: (err: any) => boolean | PromiseLike<boolean>, failed?: (err: any) => void): Promise<R> {
  let retry = true;
  while (true) {
    try {
      return await fn()
    } catch (e) {
      if (retry && await shouldRetry(e)) {
        retry = false;
        continue;
      }
      failed?.(e);
      throw e
    }
  }
}

async function reinitializeAndRetryIfIsDapiAddressExhausted(err: any): Promise<boolean> {
  if (isDapiAddressExhausted(err)) {
    const cfg = wasmSdkService.getConfig()
    if (cfg) {
      console.warn('safeGetDocuments: DAPI address pool empty; reinitializing SDK and retrying once...')
      await wasmSdkService.reinitialize(cfg)
      return true;
    }
  }
  return false;
}

export async function safeGetDocuments(
  contractId: string,
  documentType: string,
  where: Array<[string, string, unknown]> | null,
  orderBy: Array<[string, 'desc' | 'asc']> | null,
  limit: number,
  startAfter: string | null,
  startAt: string | null,
): Promise<any> {
  return retryLoop(async () => {
    return rateLimit(async () => { 
      const sdk = await getWasmSdk()
      return await get_documents(
        sdk,
        contractId,
        documentType,
        where && JSON.stringify(where),
        orderBy && JSON.stringify(orderBy),
        limit,
        startAfter,
        startAt
      )
    })
  },
  reinitializeAndRetryIfIsDapiAddressExhausted,
  () => {
    console.warn('safeGetDocuments failed', {
      contractId,
      documentType,
      where,
      orderBy,
      limit,
      startAfter,
      startAt
    })
  })
}

export async function safeGetDocument(
  contractId: string,
  documentType: string,
  documentId: string
): Promise<any> {
  return retryLoop(async () => {
    return rateLimit(async () => { 
      const sdk = await getWasmSdk()
      return await get_document(
        sdk,
        contractId,
        documentType,
        documentId
      )
    })
  },
  reinitializeAndRetryIfIsDapiAddressExhausted,
  () => {
    console.warn('safeGetDocument failed', {
      contractId,
      documentType,
      documentId
    })
  })
}

export async function safeDocumentCreate(
  contractId: string,
  documentType: string,
  ownerId: string,
  jsonData: string,
  entropy: string,
  privateKeyWif: string
): Promise<any> {
  return retryLoop(async () => {
    return rateLimit(async () => { 
      const sdk = await getWasmSdk()
      return await sdk.documentCreate(
        contractId,
        documentType,
        ownerId,
        jsonData,
        entropy,
        privateKeyWif
      )
    })
  },
  reinitializeAndRetryIfIsDapiAddressExhausted,
  () => {
    console.warn('safeDocumentCreate failed', {
      contractId,
      documentType,
      ownerId,
      jsonData,
      entropy,
      privateKeyWif
    })
  })
}

export async function safeDocumentReplace(
  contractId: string,
  documentType: string,
  documentId: string,
  ownerId: string,
  jsonData: string,
  revision: bigint,
  privateKeyWif: string,
): Promise<any> {
  return retryLoop(async () => {
    return rateLimit(async () => { 
      const sdk = await getWasmSdk()
      return await sdk.documentReplace(
        contractId,
        documentType,
        documentId,
        ownerId,
        jsonData,
        revision,
        privateKeyWif,
      )
    })
  },
  reinitializeAndRetryIfIsDapiAddressExhausted,
  () => {
    console.warn('safeDocumentReplace failed', {
      contractId,
      documentType,
      documentId,
      ownerId,
      jsonData,
      revision,
      privateKeyWif,
    })
  })
}

export async function safeDocumentDelete(
  contractId: string,
  documentType: string,
  documentId: string,
  ownerId: string,
  privateKeyWif: string,
): Promise<any> {
  return retryLoop(async () => {
    return rateLimit(async () => { 
      const sdk = await getWasmSdk()
      return await sdk.documentDelete(
        contractId,
        documentType,
        documentId,
        ownerId,
        privateKeyWif,
      )
    })
  },
  reinitializeAndRetryIfIsDapiAddressExhausted,
  () => {
    console.warn('safeDocumentDelete failed', {
      contractId,
      documentType,
      documentId,
      ownerId,
      privateKeyWif,
    })
  })
}
