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



