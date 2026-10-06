---
status: accepted
---

# Effect 4's stable core on the backend, and none of its unstable modules

The developer wants the backend written with Effect, to learn it and for what it gives this app: the signed-in User and the clock become required dependencies of every operation, and rule violations become typed errors. We use Effect 4.0.x, which went stable on 2026-10-01, and only modules and exports that are not tagged `@stability unstable`. In 4.0.1 that rules out `effect/sql`, `effect/http` and `effect/http-api`, and therefore `@effect/sql-d1`, so D1 sits behind a small service of our own with hand-written SQL, and React Router's loaders and actions remain the only HTTP boundary.

Effect is slower than plain functions; it is chosen for those guarantees, not for speed, and staying on Workers Free outranks it. A local measurement on 2026-10-05 put what Effect adds to a 50-row request at about a hundredth of a millisecond warm and about one millisecond on a cold first call. Rendering the same rows with React, which the app pays for with or without Effect, took roughly 0.3 ms and 5.5 ms. We therefore expect Effect to fit, but the release proof on Workers Free decides: if Effect is what makes a screen fail, it is removed.

## Considered Options

- **Effect SQL on D1** (`@effect/sql-d1`): first-party, and it supports D1 batches, but it is built on `effect/sql`, which is tagged unstable and may change in minor or patch releases.
- **Effect's HTTP API beside React Router**: with a single client it would define every operation twice, and it is tagged unstable too.
- **Effect 3.22**: mature, but the outgoing line, so starting on it means a migration later.
- **No Effect**: plain async functions with the same rules. Kept as the fallback.
