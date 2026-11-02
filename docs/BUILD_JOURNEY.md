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

