---
name: Orval hook options
description: How to pass react-query options to generated API hooks without type errors
---

The Orval-generated hooks in lib/api-client-react type their `query` options as full `UseQueryOptions`, so TanStack Query v5 requires `queryKey` at the type level even though the runtime falls back to the generated key.

**Rule:** when passing `{ query: { enabled, refetchInterval, ... } }` to a generated hook, also pass `queryKey: getXQueryKey(args)` using the helper the generated module exports next to each hook.

**Why:** `{ query: { enabled: false } }` alone fails typecheck with "Property 'queryKey' is missing"; casting hides real errors.

**How to apply:** import the matching `get<Endpoint>QueryKey` from `@workspace/api-client-react` and include it in the options object.

## Mutations never invalidate

Orval-generated mutation hooks perform NO cache invalidation on success. For an
in-place UI refresh after a mutation, prop-drill the owning component's
refetch() down as a callback (bound to the exact query observer) instead of
queryClient.invalidateQueries: a correctly-keyed invalidation (verified against
the generated getXQueryKey output) still failed to refresh a long-lived HMR
session in practice, while the prop-drilled refetch worked first try.
