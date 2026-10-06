# React Router 8 on Cloudflare Workers with D1 and hand-written SQL

Superseded in part by [ADR 0007](0007-workers-paid-in-the-developers-account.md): the account and the free-plan requirement below no longer hold.

The app runs on React Router 8 in framework mode on Cloudflare Workers with D1, in a Cloudflare account that belongs to Gamo. It leaves no server to look after and is a setup the developer has already shipped. It must stay on Workers Free and D1 Free: that is a requirement of the owner, not an optimization, and it outranks every other technical preference here.

We first chose Remix 3 for the smooth feel of its sites on phones and dropped it before writing any code, because the developer did not want this app to be an experiment. The same feel is expected from React Router's client-side navigation and optimistic updates.

SQL is written by hand against the D1 binding, and migrations are plain `.sql` files created and applied with Wrangler. In a codebase written largely with coding agents a query builder's ergonomics add little, and fewer layers leave more of the 10 ms CPU allowance for rendering.

## Considered Options

- **Remix 3 on Workers with D1**: as of remix@3.0.0 its asset server is Node-only and its SQLite data layer needs a synchronous client, which D1 is not, so this path was undocumented and needed a spike first. Worth revisiting once Remix documents a Workers deployment.
- **Drizzle on D1**: what the developer's other project uses. It gives row types inferred from a schema and generated migrations, at the cost of another layer; here rows are decoded and typed at the query instead.
- **A separate API project and client project**: two deploys, an API contract and sign-in plumbed across both, without adding any smoothness that a full-stack framework's client navigation doesn't already give.
- **Remix 3 on a small Node host with a SQLite file**: the setup Remix documents, but it adds a server and backups to look after, and a monthly cost.
