# System Architecture & Technical Design

## 1. System Overview

The Shared Bill Splitter is built as a lightweight, edge-native monorepo consisting of a React single-page frontend and a Hono API hosted on Cloudflare Workers, backed by Cloudflare D1 (serverless SQLite).

```mermaid
flowchart TD
    subgraph Browser["Client Browser"]
        UI["React 19 + TanStack Router"]
        ApiClient["Resilient API Client<br/>(AbortController + ErrorBoundary)"]
        UI --> ApiClient
    end

    subgraph Edge["Cloudflare Workers Runtime"]
        HonoApp["Hono HTTP Router"]
        Middleware["JSON Error Handling<br/>(onError and notFound)"]
        Routes["API Endpoints<br/>(Homes, Bills, Pay, Balances)"]
        SplitDomain["Pure Split Engine<br/>(splitCents)"]

        HonoApp --> Middleware
        Middleware --> Routes
        Routes --> SplitDomain
    end

    subgraph Storage["Cloudflare D1 (SQLite)"]
        D1["D1 Database Binding: DB"]
        Tables[("SQLite Tables:<br/>homes, members, bills, shares")]
        D1 --- Tables
    end

    ApiClient -->|HTTPS JSON| HonoApp
    Routes -->|Prepared Statements and DB.batch| D1
```

---

## 2. Components and Responsibilities

| Component | Location | Responsibility |
|---|---|---|
| **Entry & Middleware** | `api/src/index.ts` | Mounts routes, defines `c.notFound()` and `app.onError()` ensuring standard `{ "error": string }` format. |
| **Error Domain** | `api/src/errors.ts` | Provides typed `HttpError(status, message)` class for intentional HTTP error responses. |
| **Validation Layer** | `api/src/validation.ts` | Parses request bodies, asserts types, validates positive whole cents, and enforces non-empty strings. |
| **Split Domain** | `api/src/split.ts` | Pure function `splitCents(totalCents, members)`. Calculates floor base and allocates remainder cents in `seq` order. |
| **Route Handlers** | `api/src/routes/*.ts` | Implements endpoint business logic, executes D1 prepared statements, and coordinates atomic writes. |
| **Web API Client** | `web/src/api/client.ts` | Typed `fetch` wrapper supporting `AbortController` timeouts, typed `ApiError`, and JSON error decoding. |
| **Web UI** | `web/src/routes/index.tsx` | Single-page bill management view with loading skeletons, empty states, error banners, and share payment actions. |

---

## 3. Request Lifecycle

```mermaid
flowchart LR
    Req(["HTTP Request"]) --> Router["Hono Router"]
    Router --> Val["Input Validation"]
    Val -->|Invalid| Err["Throw HttpError"]
    Val -->|Valid| Handler["Route Controller"]
    Handler --> DB[("D1 Prepared Statement / Batch")]
    DB --> Res(["200 / 201 JSON Response"])
    Err --> OnError["app.onError Handler"]
    OnError --> ErrRes(["JSON Error Response<br/>status + error message"])
```

1. **Incoming Request**: Arrives at Cloudflare Worker via `exports.default.fetch`.
2. **Routing & Dispatch**: Hono matches the HTTP method and pathname.
3. **Validation**: Body/header parser validates types and business rules; invalid inputs throw typed `HttpError` (e.g. 400 or 422).
4. **Data Access**: Handler executes pre-compiled SQL queries with parameterized bindings via `env.DB.prepare()`.
5. **Atomic Mutation**: Multi-row operations use `env.DB.batch()`; state changes use atomic conditional `UPDATE`.
6. **Response / Error Interception**: Successful handlers return `c.json(data, status)`. Any thrown exception is caught by `app.onError()`, ensuring internal stack traces are never exposed.

---

## 4. Sequence Diagrams

### 4.1 Create Bill Flow
Creating a bill requires atomicity: the bill and all member shares must be committed together.

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant API as Hono API
    participant Engine as Split Engine
    participant D1 as Cloudflare D1

    Client->>API: POST /api/homes/:homeId/bills (title, totalCents)
    API->>API: Validate input (totalCents > 0, integer)
    alt Invalid totalCents
        API-->>Client: 422 Unprocessable Entity
    end

    API->>D1: SELECT id FROM homes WHERE id = ?
    alt Home does not exist
        API-->>Client: 404 Not Found
    end

    API->>D1: SELECT id, name, seq FROM members WHERE home_id = ? ORDER BY seq ASC
    alt Member count is 0
        API-->>Client: 422 Unprocessable Entity (no members)
    end

    API->>Engine: splitCents(totalCents, members)
    Engine-->>API: Calculated shares list

    Note over API,D1: Atomic DB.batch execution
    API->>D1: DB.batch: INSERT bill and N shares
    D1-->>API: Batch success confirmation

    API-->>Client: 201 Created (bill and shares)
```

---

### 4.2 Pay Share Flow (Idempotent & Race-Safe)
Payment must handle fresh payments, identical retries (replay), conflicts, and non-existent entities.

```mermaid
sequenceDiagram
    autonumber
    actor Client
    participant API as Hono API
    participant D1 as Cloudflare D1

    Client->>API: POST /api/bills/:billId/shares/:shareId/pay (Idempotency-Key header)
    alt Missing Idempotency-Key
        API-->>Client: 400 Bad Request
    end

    API->>D1: SELECT * FROM shares WHERE id = ? AND bill_id = ?
    alt Share or Bill not found
        API-->>Client: 404 Not Found
    end

    alt Share already paid with same key
        API-->>Client: 200 OK (Idempotent replay: original paidAt)
    else Share already paid with different key
        API-->>Client: 409 Conflict (Already paid)
    end

    Note over API,D1: Atomic conditional update
    API->>D1: UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND paid_at IS NULL
    alt Update successful (changes == 1)
        API-->>Client: 200 OK (Share marked as paid)
    else Lost concurrent race (changes == 0)
        API->>D1: Re-fetch share to inspect key
        API-->>Client: 200 OK (if same key) or 409 Conflict (if different key)
    end
```

---

### 4.3 Concurrent Payment Race ("Two requests at once")

```mermaid
sequenceDiagram
    autonumber
    actor Alice as "Client A (Key: K1)"
    actor Bob as "Client B (Key: K2)"
    participant D1 as "Cloudflare D1 (SQLite)"

    Alice->>D1: UPDATE shares SET paid_at=now, key=K1 WHERE id=S1 AND paid_at IS NULL
    Bob->>D1: UPDATE shares SET paid_at=now, key=K2 WHERE id=S1 AND paid_at IS NULL

    Note over D1: SQLite serializes write statements
    D1-->>Alice: changes = 1 (Alice succeeds)
    D1-->>Bob: changes = 0 (Where predicate false: already paid)

    Alice-->>Alice: 200 OK (Payment successful)
    Bob->>D1: SELECT idempotency_key FROM shares WHERE id=S1
    D1-->>Bob: Returns key K1 (differs from K2)
    Bob-->>Bob: 409 Conflict
```

---

## 5. Concurrency and Idempotency Strategy

1. **Why Conditional `UPDATE` and Not Read-Then-Write**:
   - A naive implementation (`SELECT` -> check if unpaid -> `UPDATE`) is susceptible to Time-Of-Check to Time-Of-Use (TOCTOU) race conditions. Two concurrent requests can both read `paid_at = NULL` before either writes, resulting in double charges or overwrites.
   - An atomic single-statement `UPDATE shares SET paid_at = ?, idempotency_key = ? WHERE id = ? AND paid_at IS NULL` guarantees that the SQLite engine evaluates the predicate and executes the write atomically.
2. **Where Idempotency State Is Stored**:
   - The idempotency state is stored directly on the `shares` row (`idempotency_key` column).
   - This eliminates the need for external caches (like Redis) and guarantees zero distributed state divergence: if the share is paid, its key is permanently recorded alongside `paid_at`.
3. **Why No Application-Level Locks**:
   - Cloudflare Workers are stateless and distributed across hundreds of edge locations; in-memory locks do not work across workers.
   - Cloudflare D1 coordinates writes through primary SQLite instances. Relying on SQLite's ACID guarantees and atomic row-level predicates is both simpler and race-proof.

---

## 6. Error-Handling Strategy

- **Typed `HttpError`**: Errors thrown from business logic or validation carry an explicit HTTP status code:
  ```ts
  throw new HttpError(422, 'totalCents must be a positive integer')
  ```
- **Centralized `onError` Middleware**:
  ```ts
  app.onError((err, c) => {
    if (err instanceof HttpError) {
      return c.json({ error: err.message }, err.status)
    }
    console.error('Unhandled error:', err)
    return c.json({ error: 'Internal server error' }, 500)
  })
  ```
- **Centralized `notFound` Middleware**:
  ```ts
  app.notFound((c) => c.json({ error: 'Not found' }, 404))
  ```
- **Zero Leakage**: Internal database error details and stack traces are suppressed in HTTP responses and sent solely to Worker observability logs.

---

## 7. Frontend Architecture

```mermaid
flowchart TD
    subgraph View["Page: web/src/routes/index.tsx"]
        EB["React ErrorBoundary"]
        State["Component State:<br/>bills, status, error"]
        LoadingState["Loading Skeleton<br/>(status: loading)"]
        EmptyState["Empty View: No Bills<br/>(bills is empty)"]
        ErrorBanner["Error Banner / Retry<br/>(error is not null)"]
        BillList["Bills & Shares Table<br/>(status: success)"]

        EB --> State
        State --> LoadingState
        State --> EmptyState
        State --> ErrorBanner
        State --> BillList
    end

    subgraph Client["API Client Layer: web/src/api/client.ts"]
        FetchWrapper["fetchWithTimeout<br/>(AbortController: 8s)"]
        IdempGen["UUID Generator<br/>(crypto.randomUUID)"]
        FetchWrapper --- IdempGen
    end

    BillList -->|Pay Share Click| FetchWrapper
    FetchWrapper -->|HTTP POST| WorkerAPI["Cloudflare Worker API"]
```

- **Resilient Request Execution**: All network calls pass through a wrapper creating an `AbortController` with an 8-second timeout.
- **Stable Idempotency Key**: When a user clicks "Pay", an idempotency key is generated and held in component state for that specific action. Retrying a timed-out or interrupted network request safely reuses the key.
- **Fail-Safe Share State**: If a payment call returns 409, 500, or times out, the share remains unpaid in the UI and an explicit banner alerts the user.

---

## 8. Testing Architecture

- **Runtime Simulation**: Vitest operates inside the actual Miniflare / Cloudflare Workers environment using `@cloudflare/vitest-plugin`.
- **Database Isolation**: The test harness runs `applyD1Migrations` before each test suite runs, ensuring clean SQLite tables.
- **Dual Test Layers**:
  1. *Visible Test Suite*: `homes.test.ts`, `bills.test.ts`, `payments.test.ts` (kept unmodified).
  2. *Custom Hardening Suite* (`edge-cases.test.ts`): Tests true concurrent `Promise.all` payment races, constraint enforcement, and error responses.

---

## 9. Trade-offs and Known Limitations

1. **Member Addition During Bill Creation**:
   - *Behavior*: Bill creation reads members, computes splits, and inserts shares in a batch. If a new member is added between the read and the batch insert, the bill is split among the members existing at read time.
   - *Rationale*: Avoids complex distributed locking on the home entity; bills represent a point-in-time expense for existing occupants.
2. **No Optimistic UI Updates**:
   - *Behavior*: The web UI disables the pay button and shows a loading state until the server confirms payment.
   - *Rationale*: Optimistic updates for financial transactions risk displaying false success if the server rejects the payment with 409 Conflict.
3. **SQLite Single-Writer Concurrency**:
   - *Behavior*: Under extremely high write concurrency, SQLite serializes write transactions.
   - *Rationale*: Perfectly suited for home-scale bill splitting with zero operational overhead and rock-solid ACID guarantees.
