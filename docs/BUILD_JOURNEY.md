# Build Journey — Shared Bill Splitter

This document chronicles the real engineering decisions, learning moments, and iterative progress made throughout building the Shared Bill Splitter application.

---

### Step 0: Repository Orientation and Test Inspection (commit: docs: add agent guidance and project plan)

- **What I did**:
  - Inspected the repository tree, root `package.json`, `biome.json`, `wrangler.jsonc`, and all test suites in `api/test/`.
  - Examined the exact test assertions in `homes.test.ts`, `bills.test.ts`, and `payments.test.ts`.
  - Confirmed ID formats (UUID strings), exact HTTP status codes (400 for missing header, 404 for missing resources, 422 for invalid amounts or 0-member homes, 409 for payment key conflict), and that `paidAt` must be an ISO timestamp string.
  - Confirmed that `GET /api/homes/:homeId/balances` strictly requires `{ memberId, name, outstandingCents }` with no extra fields.
  - Added `AGENTS.md` and `AGENT_TASK.md` to define technical specifications and working agreements.

- **What I learned / what confused me**:
  - TODO(Shantanu): Note what was new to you regarding Cloudflare Workers runtime and Hono setup, or what initially stood out when reading the tests.

- **Decision (and the alternative I rejected)**:
  - **Decision**: Read all test files before writing any architecture docs or code, treating tests as the single source of truth for behavior.
  - **Alternative rejected**: Implementing the API directly from the high-level `README.md` description, which would have risked subtle status code or response shape mismatches (such as returning 400 instead of 422 for bill creation validation).

---

### Step 1: Software Requirements Specification (commit: docs: add software requirements specification)

- **What I did**:
  - Authored `docs/SRS.md` detailing functional and non-functional requirements, explicit out-of-scope boundaries, business rules, a comprehensive error catalogue, and a traceability matrix for the 7 mandatory cases.
  - Mapped each mandatory test case directly to functional requirements and proof tests in `api/test/`.
  - Documented strict business rules for integer currency calculations, deterministic remainder distribution, and idempotency guarantees.

- **What I learned / what confused me**:
  - TODO(Shantanu): Note what stood out when establishing the formal business rules and error catalogue.

- **Decision (and the alternative I rejected)**:
  - **Decision**: Formally map the 7 mandatory cases into an explicit traceability matrix with exact status codes before writing architecture or schemas.
  - **Alternative rejected**: Starting directly with database coding without a written requirements baseline, which often leads to missed edge cases (such as homes with 0 members returning 200 instead of 422).

---

### Step 2: System Architecture & Sequence Diagrams (commit: docs: add architecture overview and sequence diagrams)

- **What I did**:
  - Authored `docs/ARCHITECTURE.md` establishing system components, request lifecycle, sequence diagrams for bill creation and payment, concurrency strategy, error handling, frontend architecture, and trade-offs.
  - Diagrammed the concurrent payment race showing how atomic conditional `UPDATE ... WHERE paid_at IS NULL` cleanly guarantees exactly one winner and one 409 conflict without application locks.
  - Documented explicit trade-offs (e.g. point-in-time member capture during bill creation; no optimistic UI) to directly support the 3-minute video presentation.

- **What I learned / what confused me**:
  - TODO(Shantanu): Note how your mental model of D1 concurrency and edge statelessness evolved during this step.

- **Decision (and the alternative I rejected)**:
  - **Decision**: Rely on database-level atomic conditional updates and `DB.batch()` rather than application-level in-memory locking or external key-value stores.
  - **Alternative rejected**: In-memory mutexes (which fail across distributed Cloudflare Workers) or separate external lock services (which add latency and failure points).

---

### Step 3: Database Design & Named Constraints (commit: docs: design database schema and constraints)

- **What I did**:
  - Authored `docs/DATABASE.md` detailing the schema design flow, an ER diagram, table descriptions, a 10-item named constraint catalogue, rationales for column choices, and the three core SQL queries.
  - Formulated the atomic pay query (`UPDATE ... WHERE paid_at IS NULL`), the atomic bill+shares `DB.batch` query, and the `LEFT JOIN` balance aggregation query.
  - Designed the payment consistency constraint (`chk_shares_payment_state`) ensuring `paid_at` and `idempotency_key` cannot diverge.

- **What I learned / what confused me**:
  - TODO(Shantanu): Note what you learned regarding SQLite constraints in D1 or using an autoincrement `seq` integer instead of timestamps for ordering.

- **Decision (and the alternative I rejected)**:
  - **Decision**: Use an explicit integer `seq` column for member ordering and strict named constraints at the DB level.
  - **Alternative rejected**: Relying purely on `created_at` timestamp strings (which can collide or vary under clock skew) or trusting API validation alone without DB-level constraint enforcement.

---

### Step 4: Initial SQL Migration with Named Constraints (commit: feat(db): add initial schema with named constraints)

- **What I did**:
  - Implemented `api/migrations/0001_init.sql` creating the `homes`, `members`, `bills`, and `shares` tables.
  - Incorporated 10 named integrity constraints including foreign key cascades, positive cents checks, non-empty text validations, and payment consistency checks.
  - Added targeted indexes on foreign keys and lookup paths (`(home_id, seq)` on `members`, `bill_id` on `shares`, and a partial index on unpaid shares).

- **What I learned / what confused me**:
  - TODO(Shantanu): Note what stood out about how migrations are loaded and applied automatically in the Vitest Workers runtime via `readD1Migrations`.

- **Decision (and the alternative I rejected)**:
  - **Decision**: Place all initial tables in `0001_init.sql` with explicit named constraints directly embedded in table declarations.
  - **Alternative rejected**: Creating tables without constraints and adding checks later, or creating tables on-the-fly inside application code.

---

### Step 5: JSON Error Handling and Validation Helpers (commit: feat(api): add JSON error handling and input validation helpers)

- **What I did**:
  - Implemented `HttpError` class in `api/src/errors.ts` to represent HTTP status codes and error messages uniformly.
  - Configured global `app.onError` and `app.notFound` in `api/src/index.ts`, guaranteeing all errors return `{ "error": "..." }` and never leak stack traces.
  - Created validation utilities in `api/src/validation.ts` for safe JSON body reading, non-empty string validation, positive integer cents validation, and required header validation.

- **What I learned / what confused me**:
  - TODO(Shantanu): Note what you learned about Hono's middleware lifecycle (`onError` vs per-route try-catches).

- **Decision (and the alternative I rejected)**:
  - **Decision**: Centralize error formatting in Hono's `app.onError` hook via a custom `HttpError` class.
  - **Alternative rejected**: Writing boilerplate `try/catch` and manual `c.json({ error }, status)` blocks inside every individual route handler.

---

### Step 6: Create Homes Endpoint (commit: feat(api): create homes)

- **What I did**:
  - Implemented `POST /api/homes` in `api/src/routes/homes.ts` and mounted it in `api/src/index.ts`.
  - Used `readJsonBody` and `requireNonEmptyString` to ensure the home name is present and non-blank.
  - Executed a parameterized D1 insert with UUID generation (`crypto.randomUUID()`) and ISO creation timestamp, returning `201 Created` with `{ id, name }`.

- **What I learned / what confused me**:
  - TODO(Shantanu): Note what stood out about using `c.env.DB.prepare(...).bind(...).run()`.

- **Decision (and the alternative I rejected)**:
  - **Decision**: Split endpoints into modular route files under `api/src/routes/` and mount them onto the main Hono app.
  - **Alternative rejected**: Defining all endpoints inside a monolithic `api/src/index.ts` file.

---

### Step 7: Add Members to Home Endpoint (commit: feat(api): add members to a home)

- **What I did**:
  - Implemented `POST /api/homes/:homeId/members` in `api/src/routes/homes.ts`.
  - Added home existence check throwing `404 Not Found` if `homeId` does not exist.
  - Computed the next sequential insertion integer `seq` per home (`SELECT COALESCE(MAX(seq), 0) + 1`), preserving FIFO member ordering.
  - Inserted the member row and returned `201 Created` with `{ id, homeId, name }`.
  - With this step complete, all tests in `api/test/homes.test.ts` pass!

- **What I learned / what confused me**:
  - TODO(Shantanu): Note what you learned about handling route parameters in Hono (`c.req.param('homeId')`) and computing sequential ranks in SQLite.

- **Decision (and the alternative I rejected)**:
  - **Decision**: Compute `seq` via `COALESCE(MAX(seq), 0) + 1` scoped to `home_id` so member sequences start at 1 for each home.
  - **Alternative rejected**: A global autoincrement ID across all homes, which would expose global member volume and have gaps between homes.

---

### Step 8: Fair Integer Cents Split Engine (commit: feat(api): split cents evenly with remainder to earliest members)

- **What I did**:
  - Implemented `splitCents(totalCents, members)` in `api/src/split.ts` as a pure function with zero database or framework dependencies.
  - Calculated base cents via integer division (`Math.floor(totalCents / n)`) and allocated the remainder (`totalCents % n`) one cent each to the earliest members in insertion order.
  - Created unit tests in `api/test/split.test.ts` covering even splits, uneven splits, single member homes, sub-member totals, and 100 randomized property-based tests proving `sum(shares) === totalCents` and `max - min <= 1`.

- **What I learned / what confused me**:
  - TODO(Shantanu): Note what you found neat about isolating domain algorithms as pure functions before integrating with database writes.

- **Decision (and the alternative I rejected)**:
  - **Decision**: Keep `splitCents` strictly pure (accepting an array and returning calculated share amounts) separate from SQL queries or HTTP contexts.
  - **Alternative rejected**: Computing split amounts inline inside database insertion loops, which makes unit testing and edge case verification much harder.

---

### Step 9: Create Bills Endpoint with DB.batch (commit: feat(api): create bills with atomic share creation)

- **What I did**:
  - Implemented `POST /api/homes/:homeId/bills` in `api/src/routes/homes.ts`.
  - Added validation returning `422 Unprocessable Entity` for non-positive or non-integer `totalCents`, and for homes with 0 members.
  - Added home existence check returning `404 Not Found`.
  - Loaded members in order of `seq ASC`, applied `splitCents` to distribute amounts, and committed the bill and all shares atomically via `c.env.DB.batch(...)`.
  - With this step complete, all tests in `api/test/bills.test.ts` pass!

- **What I learned / what confused me**:
  - TODO(Shantanu): Note what stood out about `DB.batch()` atomicity in D1.

- **Decision (and the alternative I rejected)**:
  - **Decision**: Execute bill insertion and all share insertions in a single `c.env.DB.batch([...])` transaction.
  - **Alternative rejected**: Inserting the bill first and then looping over shares with individual `run()` queries, which risks leaving orphaned bill headers if the Worker is interrupted or a subsequent share fails.









