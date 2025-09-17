Yappr — Agent Notes and Codegen

Overview
- We generate strongly typed contract bindings from `contracts/yappr-social-contract.json`.
- Use the generated helpers instead of ad‑hoc strings for contract/document access.

Key modules
- `contracts/contract-to-ts.mjs`: Codegen script. Reads the JSON contract and writes `lib/contract-types.generated.ts`.
- `lib/contract-api.ts`: Generic helpers
  - `DataContract`: wraps a contract id.
  - `DocumentType<D, I>`: typed access to a document type with methods `query`, `get`, `create`, `replace`, `delete`.
  - `DocIndexSymbol` and `IndicesOf<T>`: tie index maps to document interfaces so TypeScript can enforce index usage.
  - Strict where typing: where clauses must be a prefix of a defined index, in order. The final field may use a range op; preceding fields must use `==`.
- `lib/contract-types.generated.ts`: Generated types
  - Per‑document `XDocument`, `XIndex`, and a convenience class `X extends DocumentType<XDocument, XIndex>`.
- `lib/contract-docs.ts`: Instantiates typed document classes for the active contract id.

Regenerating types
- Run: `node contracts/contract-to-ts.mjs`
- Output: `lib/contract-types.generated.ts`

Using typed docs
- Import instances from `lib/contract-docs.ts`, e.g. `posts`, `likes`.
- Query examples (index‑safe):
  - `posts.query({ orderBy: [['$createdAt','desc']], limit: 20 })`
  - `posts.query({ where: [['$ownerId','==', userId]], orderBy: [['$createdAt','desc']], limit: 20 })`
  - `posts.query({ where: [['replyToPostId','==', postId], ['$createdAt','>=', t]] })`
- Create example:
  - Get `privateKeyWif` via `keyManager.getPrivateKey(identityId)` and pass a 32‑byte hex `entropy`.
  - `await posts.create({ ownerId, data: { content: 'Hello' }, entropy, privateKeyWif })`

Conventions
- Prefer `DocumentType` methods in app/services. Avoid calling low‑level `safeDocument*` or `stateTransitionService` directly unless needed.
- Only query on indexed fields. If a field is not indexed (e.g., `primaryHashtag`), the types will block invalid queries.

Migration status
- Post service now uses `posts` for typed queries and `posts.create` for creation.
- Like service uses `likes` for typed queries and creation; delete uses the safe wrapper.
- Next candidates: migrate `repost-service`, `bookmark-service`, and others to typed instances.

Typechecking
- Use `npm run build` (Next.js build) to lint and run TypeScript checks.

