# kna-test-bed — Development Roadmap

> This roadmap outlines planned features, components, and milestones for the kna-test-bed project from v0.4.5 through v0.7.0, leading toward v1.0.0 final release.

---

## Version Matrix

| Version    | Focus Area       | Components                                              | Status  | Target  |
| ---------- | ---------------- | ------------------------------------------------------- | ------- | ------- |
| **v0.4.5** | Performance      | Parallelism (schema tests, scenarios)                   | Planned | Q4 2025 |
| **v0.5.0** | Server Lifecycle | `env-merge.ts`, `server-assert.ts`                      | Planned | Q4 2025 |
| **v0.6.0** | HTTP & Auth      | `http-assert.ts`, `auth-assert.ts`, `session-assert.ts` | Planned | Q4 2025 |
| **v0.7.0** | Database         | `pg-assert.ts`                                          | Planned | Q4 2025 |
| **v1.0.0** | Stable Release   | All features complete, documentation polished           | Planned | Q1 2026 |

---

## Detailed Component Breakdown

### v0.4.5 — Parallelism & Performance

**Goal:** Reduce test execution time while maintaining CI output integrity

**Changes:**

- Enable parallel execution within schema tests (low risk, no output ordering concerns)
- Evaluate parallel scenario execution:
  - ✅ If CI output can maintain Suite → Schema → Scenarios order
  - ❌ If not, defer scenario parallelism to post-v1.0.0

**Dependencies:** None (infrastructure-only change)

**Success Criteria:**

- Schema tests run concurrently without reporter output degradation
- Suite → Schema → Scenarios ordering preserved in CI logs
- Test execution time reduced by 30-50%

---

### v0.5.0 — Server Lifecycle Management

**Goal:** Start, probe, and manage scaffolded app lifecycle during tests

**New Components:**

#### `test/components/env-merge.ts`

**Purpose:** Merge scenario-specific `.real-env/real.env` into app `.env` after manifest assertion

**Key Features:**

- Selective merge strategy (preserve app defaults unless overwrite requested)
- OAuth secrets injection from scenario real-env
- Dynamic PG environment variables (`SUITE_PG_*`, `PG_DB`)
- Idempotent operations with comment preservation

**API:**

```typescript
export async function writeMergedEnv(
  appDir: string,
  realEnvPath: string,
  inject: Record<string, string | number | boolean>,
  opts?: EnvMergeOptions,
): Promise<string>;
```

**Integration Point:** Called by scenario runner between env-assert and server-assert

---

#### `test/components/server-assert.ts`

**Purpose:** Start scaffolded app, wait for readiness, and provide lifecycle control

**Key Features:**

- Spawn `npm run dev` or `node server.js`
- Configurable readiness probe (default: `GET /` → 200)
- Parse port from `.env` or dev server logs
- Graceful shutdown with cleanup

**API:**

```typescript
export async function startServer(
  opts: ServerAssertOptions,
): Promise<{ stop: () => Promise<void>; url: string }>;

export async function assertRoutes(baseUrl: string, routes: Array<RouteSpec>): Promise<void>;
```

**Integration Point:** Called by scenario runner after env-merge; stopped in test cleanup

---

**Dependencies:**

- `env-merge.ts` has no dependencies (pure fs/env operations)
- `server-assert.ts` depends on `env-merge.ts` (reads merged `.env` for PORT)

**Success Criteria:**

- All scenarios can start scaffolded app successfully
- Server readiness detected within 30s timeout
- Graceful shutdown without orphaned processes
- Clear error messages for startup failures

---

### v0.6.0 — HTTP & Authentication

**Goal:** Validate public routes, static assets, and auth flows (local + OAuth providers)

**New Components:**

#### `test/components/http-assert.ts`

**Purpose:** Lightweight HTTP assertions for status, content, and headers

**Key Features:**

- Public route validation (status codes, content matching)
- Static asset checks (CSS, JS, images)
- Header validation (content-type, cache-control)
- Retry logic with exponential backoff for flaky starts

**API:**

```typescript
export async function assertHttp(
  baseUrl: string,
  specs: Array<HttpSpec>,
  log?: Logger,
): Promise<void>;
```

**Integration Point:** Called by scenario runner after server starts for public routes

---

#### `test/components/auth-assert.ts`

**Purpose:** Provider-aware authentication flow validation (local/google/microsoft/bearer)

**Key Features:**

- **Local auth:** signup → login → protected route access
- **OAuth providers:** redirect → callback → protected route access
- **Bearer token:** token generation → API access with Authorization header
- Shared post-auth logic (session validation, protected route access)
- Provider-specific error handling

**API:**

```typescript
export async function assertLocalAuthFlow(baseUrl: string, opts?: AuthFlowOptions): Promise<void>;

export async function assertOAuthFlow(
  baseUrl: string,
  provider: 'google' | 'microsoft',
  opts?: OAuthFlowOptions,
): Promise<void>;

export async function assertBearerFlow(baseUrl: string, opts?: BearerFlowOptions): Promise<void>;
```

**Unified routes.json design:**

```json
{
  "routes": [
    {
      "path": "/",
      "method": "GET",
      "expectStatus": 200,
      "requiresAuth": false
    },
    {
      "path": "/dashboard",
      "method": "GET",
      "expectStatus": 200,
      "requiresAuth": true
    }
  ]
}
```

**Integration Point:** Called by scenario runner after http-assert for protected routes

---

#### `test/components/session-assert.ts`

**Purpose:** Session persistence, expiry, and store validation (independent of auth flows)

**Key Features:**

- Session creation and persistence across requests
- Session expiry validation (time-based, idle timeout)
- Session store validation (PostgreSQL connect-pg-simple)
- Cookie attributes (httpOnly, secure, sameSite)

**API:**

```typescript
export async function assertSessionPersistence(
  baseUrl: string,
  opts?: SessionOptions,
): Promise<void>;

export async function assertSessionExpiry(baseUrl: string, opts?: ExpiryOptions): Promise<void>;

export async function assertSessionStore(pg: PgEnv, dbName: string): Promise<void>;
```

**Integration Point:** Called by scenario runner after auth flows to validate session behavior

---

**Dependencies:**

- `http-assert.ts` has no dependencies (uses built-in http/https)
- `auth-assert.ts` depends on `http-assert.ts` (uses httpGet under the hood)
- `session-assert.ts` depends on `http-assert.ts` and `pg-env.ts` (store validation)

**Execution Order:**

1. `http-assert.ts` validates public routes
2. `auth-assert.ts` validates authentication flows (creates sessions)
3. `session-assert.ts` validates session behavior

**Success Criteria:**

- All public routes return expected status/content
- Local auth signup/login flows work end-to-end
- OAuth provider flows complete successfully (google, microsoft)
- Bearer token flows validate API access
- Sessions persist across requests
- Session expiry works as configured
- PostgreSQL session store validated

---

### v0.7.0 — Database Validation

**Goal:** Validate database structure, constraints, and data integrity

**New Component:**

#### `test/components/pg-assert.ts`

**Purpose:** Database structure validation with nested manifest

**Key Features:**

- Table existence and structure validation
- Column types, constraints, and nullability
- Index validation (unique, composite, partial)
- Foreign key relationships with cascade rules
- Sample data validation (row counts, specific values)

**Nested Manifest Design:**

```json
{
  "tables": {
    "users": {
      "columns": {
        "id": { "type": "uuid", "nullable": false, "primaryKey": true },
        "email": { "type": "varchar", "nullable": false, "unique": true }
      },
      "indexes": {
        "users_email_key": { "columns": ["email"], "unique": true }
      },
      "values": {
        "minRows": 0,
        "samples": []
      }
    },
    "sessions": {
      "columns": {
        "sid": { "type": "varchar", "nullable": false, "primaryKey": true },
        "user_id": { "type": "uuid", "nullable": true }
      },
      "foreignKeys": {
        "sessions_user_id_fkey": {
          "column": "user_id",
          "references": "users(id)",
          "onDelete": "CASCADE"
        }
      }
    }
  }
}
```

**API:**

```typescript
export async function assertPgStructure(
  pg: PgEnv,
  dbName: string,
  manifest: PgManifest,
  log?: Logger,
): Promise<void>;
```

**Integration Point:** Called by scenario runner after server tests to validate database state

---

**Dependencies:**

- `pg-assert.ts` depends on `pg-env.ts` (connection management)

**Success Criteria:**

- All expected tables exist with correct structure
- Column types and constraints match manifest
- Indexes validated (type, columns, uniqueness)
- Foreign keys validated with cascade rules
- Sample data validation passes
- Clear error messages with SQL query results

---

## Dependency Graph

```
Legend: A → B means "A depends on B" or "A runs after B"

Test Execution Order:
┌─────────────────────────────────────────────────────────────────┐
│ Suite Setup (global-setup.ts)                                   │
│   - Docker + PostgreSQL initialization                          │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Schema Tests (schema-validation.test.ts)                        │
│   - Validate all JSON manifests against schemas                 │
│   - Run in parallel (v0.4.5+)                                    │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ Per-Scenario Tests (scenario-runner.ts orchestrates)            │
└─────────────────────────────────────────────────────────────────┘
                            ↓
          ┌─────────────────────────────────────┐
          │ 1. scaffold-command-assert.ts       │
          │    (v0.4.0+)                        │
          └─────────────────────────────────────┘
                            ↓
          ┌─────────────────────────────────────┐
          │ 2. env-assert.ts                    │
          │    (v0.4.0+)                        │
          └─────────────────────────────────────┘
                            ↓
          ┌─────────────────────────────────────┐
          │ 3. fs-assert.ts                     │
          │    (v0.4.0+)                        │
          └─────────────────────────────────────┘
                            ↓
          ┌─────────────────────────────────────┐
          │ 4. env-merge.ts                     │
          │    (v0.5.0) — NEW                   │
          │    Merges real.env → .env           │
          └─────────────────────────────────────┘
                            ↓
          ┌─────────────────────────────────────┐
          │ 5. server-assert.ts                 │
          │    (v0.5.0) — NEW                   │
          │    Starts app, waits for readiness  │
          └─────────────────────────────────────┘
                            ↓
          ┌─────────────────────────────────────┐
          │ 6. http-assert.ts                   │
          │    (v0.6.0) — NEW                   │
          │    Validates public routes          │
          └─────────────────────────────────────┘
                            ↓
          ┌─────────────────────────────────────┐
          │ 7. auth-assert.ts                   │
          │    (v0.6.0) — NEW                   │
          │    Validates auth flows             │
          └─────────────────────────────────────┘
                            ↓
          ┌─────────────────────────────────────┐
          │ 8. session-assert.ts                │
          │    (v0.6.0) — NEW                   │
          │    Validates session behavior       │
          └─────────────────────────────────────┘
                            ↓
          ┌─────────────────────────────────────┐
          │ 9. pg-assert.ts                     │
          │    (v0.7.0) — NEW                   │
          │    Validates database structure     │
          └─────────────────────────────────────┘
                            ↓
          ┌─────────────────────────────────────┐
          │ Cleanup: server.stop()              │
          │    (v0.5.0+)                        │
          └─────────────────────────────────────┘

Component Dependencies:
┌─────────────────────────────────────────────────────────────────┐
│ Infrastructure (no dependencies)                                │
│   - suite/components/* (logger, proc, pg-env, etc.)             │
│   - test/components/scaffold-command-assert.ts                  │
│   - test/components/env-assert.ts                               │
│   - test/components/fs-assert.ts                                │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ v0.5.0 Components                                               │
│   - env-merge.ts (no deps)                                      │
│   - server-assert.ts → env-merge.ts                             │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ v0.6.0 Components                                               │
│   - http-assert.ts (no deps)                                    │
│   - auth-assert.ts → http-assert.ts                             │
│   - session-assert.ts → http-assert.ts, pg-env.ts               │
└─────────────────────────────────────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────────┐
│ v0.7.0 Components                                               │
│   - pg-assert.ts → pg-env.ts                                    │
└─────────────────────────────────────────────────────────────────┘
```

---

## Parallelism Strategy

### Schema Tests (v0.4.5)

- **Status:** Safe to parallelize
- **Reason:** Independent validation of JSON files against schemas
- **Risk:** Low (no shared state, no output ordering concerns)
- **Implementation:** Enable Vitest `pool: 'threads'` for schema tests

### Scenario Tests (v0.4.5)

- **Status:** Evaluate before enabling
- **Condition:** CI output must maintain Suite → Schema → Scenarios ordering
- **Risk:** Medium (reporter complexity, log interleaving)
- **Approach:**
  1. Test parallelism locally with `--reporter=verbose`
  2. Verify CI output maintains section ordering
  3. If successful, enable; if not, defer to post-v1.0.0
- **Fallback:** Sequential execution (current behavior)

### Within-Scenario Steps

- **Status:** Always sequential
- **Reason:** Steps have strict dependencies (can't run server before scaffold)
- **Risk:** High if parallelized (would break test logic)
- **Decision:** Never parallelize

---

## Key Design Decisions

### Unified routes.json (v0.6.0)

- **Decision:** Single manifest for all route validations
- **Rationale:** Reduces duplication, clearer intent with `requiresAuth` flag
- **Structure:** Each route specifies `path`, `method`, `expectStatus`, `requiresAuth`, `headers`
- **Benefit:** http-assert and auth-assert share the same manifest

### Provider-Aware auth-assert.ts (v0.6.0)

- **Decision:** Single module handles all auth providers
- **Rationale:** Shared post-auth logic, consistent error handling
- **Providers:** local, google, microsoft, bearer
- **Alternative Rejected:** Separate module per provider (too much duplication)

### Nested pg-assert Manifest (v0.7.0)

- **Decision:** Tables contain nested columns/indexes/foreignKeys/values
- **Rationale:** Natural hierarchy, easier to read/maintain
- **Alternative Rejected:** Flat structure with table prefixes (verbose, harder to navigate)

### Separate session-assert.ts (v0.6.0)

- **Decision:** Dedicated module for session testing
- **Rationale:** Session behavior is orthogonal to auth flows
- **Benefit:** Can test session expiry, persistence independently

### Error Handling (All versions)

- **Decision:** Built into each assert module
- **Rationale:** Context-specific errors with helpful diagnostics
- **Pattern:** Throw with descriptive messages, include relevant data (SQL results, HTTP responses)
- **Alternative Rejected:** Separate error-handling component (adds indirection)

---

## Release Checklist (Template for Future Releases)

### Pre-Release

- [ ] All tests green (unit + e2e)
- [ ] Typecheck clean (`npm run typecheck`)
- [ ] Lint clean (`npm run lint`)
- [ ] Documentation audit:
  - [ ] `README.md` updated with version highlights
  - [ ] `CHANGELOG.md` dated section added
  - [ ] `docs/components.md` reflects new/changed components
  - [ ] `docs/design.md` includes design decisions
  - [ ] `docs/scenarios.md` updated if runner changes
  - [ ] `docs/planning/roadmap.md` updated with progress
- [ ] Version bumped in `package.json`
- [ ] Commit: `"Release vX.Y.Z"`
- [ ] Fix any pre-commit hook failures (unused imports, lint errors)
- [ ] Tag created: `git tag vX.Y.Z`
- [ ] Tag pushed: `git push origin vX.Y.Z`

### GitHub Pre-Release

```bash
gh release create vX.Y.Z \
  --prerelease \
  --title "vX.Y.Z" \
  --notes "$(cat CHANGELOG.md | sed -n '/^## vX.Y.Z/,/^## v/p' | head -n -1)"
```

### Verification

- [ ] Release shows as "Pre-release" on GitHub
- [ ] Changelog excerpt visible in release notes
- [ ] All assets attached (if any)

### Announcement

- [ ] Update project README with latest version badge
- [ ] Notify team/contributors

---

## Migration Path to v1.0.0

### v0.4.5 → v0.5.0

- No breaking changes
- Add `env-merge.ts` and `server-assert.ts`
- Update scenario runner to call new components
- Update manifests to include server lifecycle config

### v0.5.0 → v0.6.0

- Add `routes.json` manifest to all scenarios
- Migrate from separate public/protected route checks to unified `routes.json`
- Add `http-assert.ts`, `auth-assert.ts`, `session-assert.ts`
- Update scenario runner to call new components

### v0.6.0 → v0.7.0

- Add `pg-manifest.json` to all scenarios with database
- Add `pg-assert.ts`
- Update scenario runner to call pg-assert after session tests

### v0.7.0 → v1.0.0

- Stabilize APIs (no breaking changes after this point)
- Performance optimizations
- Documentation polish
- Example scenario updates
- Release notes refinement

---

## Success Metrics

### v0.5.0

- All scenarios start servers successfully
- 100% server readiness detection rate
- Zero orphaned processes after test runs

### v0.6.0

- All public routes validated successfully
- All auth flows (local + 2 OAuth providers) working
- Session persistence validated across all scenarios

### v0.7.0

- All database schemas validated successfully
- Foreign key relationships verified
- Index uniqueness constraints validated

### v1.0.0

- Full test suite completion time < 5 minutes
- Zero flaky tests (100 consecutive runs)
- Documentation completeness score: 100%
- Community adoption: 10+ external users

---

## Future Considerations (Post v1.0.0)

### Migration Testing

- Schema evolution validation
- Backward compatibility checks
- Data migration validation

### Performance Testing

- Load testing scaffolded apps
- Database query performance validation
- Memory leak detection

### Security Testing

- CSRF protection validation
- XSS prevention checks
- SQL injection prevention
- OAuth token security

### Internationalization

- Multi-locale testing
- Timezone handling validation
- Currency formatting checks

---

## Contributing

See the main [README.md](../../README.md) for contribution guidelines. When working on roadmap items:

1. Check this roadmap for context and design decisions
2. Review [components.md](../components.md) for API specifications
3. Review [design.md](../design.md) for architectural patterns
4. Create feature branch: `feature/vX.Y.Z-component-name`
5. Update documentation alongside code changes
6. Ensure all quality gates pass before PR

---

**Last Updated:** October 27, 2025 (v0.4.4)  
**Next Review:** Upon v0.4.5 release planning
