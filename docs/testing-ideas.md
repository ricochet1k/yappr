Testing ideas and next steps

- Services: add unit/integration-style tests by mocking the Dash client in `lib/dash-platform-client.ts`.
  - post-service: timeline ordering, user posts, pagination, empty states, error handling.
  - profile-service: profile fetch/update, DPNS resolution, caching tags and invalidation.
  - like-service: optimistic toggle, idempotency, error rollback.
- CacheManager: already covered basics; add property-based tests for `safeStringify` and stress tests for inflight dedup.
- UI component tests (Vitest + React Testing Library): critical components render and handle basic interactions without platform.
- E2E: expand Playwright flows once feed route is stable without network (e.g., smoke tests for `/explore`, `/login`).

Notes

- Prefer deterministic seeds and local mocks to avoid network dependencies.
- Keep e2e smoke tests fast; deeper flows can be added behind a separate tag.

