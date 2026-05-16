# BACKEND ENGINEERING RULES

## Core Backend Philosophy

- Always prioritize maintainability and production readability.
- Think like a senior engineer responsible for long-term system stability.
- Prefer explicit architecture over hidden magic.
- Backend code must be modular, predictable, and easy to debug.
- Avoid unnecessary abstractions and premature complexity.
- Build scalable systems progressively instead of overengineering from day one.

---

## Layer Responsibilities

### Routes / Controllers

Responsibilities:

- Receive HTTP requests.
- Validate request boundaries.
- Call services.
- Return HTTP responses.

Rules:

- Keep controllers thin.
- Never place business logic inside routes.
- Never place database logic directly inside controllers.
- Controllers should mainly orchestrate request lifecycle.

---

### Services

Responsibilities:

- Business rules.
- System orchestration.
- External API integrations.
- Domain logic.
- Internal processing.

Rules:

- Services contain the real backend logic.
- Services should remain reusable and modular.
- Avoid tightly coupling services to FastAPI internals.
- Separate external integrations from pure business logic when possible.

---

### DTO / Schema Layer

Responsibilities:

- Input validation.
- Output serialization.
- API contracts.
- Type safety.

Rules:

- Always validate external input.
- Use Pydantic models for request/response consistency.
- Keep DTOs explicit and readable.
- Avoid leaking internal structures directly to clients.

---

### Middleware

Responsibilities:

- Cross-cutting concerns.
- Request lifecycle interception.
- Logging.
- Rate limiting.
- Authentication.
- Observability.

Rules:

- Each middleware should have a single responsibility.
- Avoid giant “god middlewares”.
- Middleware should remain infrastructure-oriented.
- Prefer composable middleware architecture.

Examples:

- Logging middleware
- CORS middleware
- Rate limit middleware
- Auth middleware
- Metrics middleware

---

### API Design Rules

- APIs should remain predictable and consistent.
- Use meaningful endpoint naming.
- Avoid deeply nested routes.
- Maintain response consistency.
- Prefer explicit HTTP status codes.
- Return useful error messages without leaking sensitive internals.

Examples:

- Good: "/github/stats"
- Bad: "/fetchGithubDataAndAnalyzeEverything"

---

### Error Handling

- Never expose raw internal exceptions to clients.
- Log exceptions internally.
- Return clean API-safe errors externally.
- Distinguish:
  - validation errors,
  - business errors,
  - infrastructure failures.

Production mindset:

- Fail gracefully.
- Predict failure scenarios early.

---

### Logging & Observability

- Logging is mandatory in production systems.
- Every important request flow should be observable.
- Log:
  - request lifecycle,
  - failures,
  - retries,
  - external API failures,
  - infrastructure issues.

Rules:

- Logs should help debugging production incidents.
- Avoid useless noisy logs.
- Prefer structured logs when possible.

---

### Redis Rules

Use Redis for:

- rate limiting,
- caching,
- temporary state,
- cooldown systems,
- lightweight shared state.

Avoid:

- storing permanent business data,
- abusing Redis as primary database.

Rules:

- Keys should be predictable and structured.
- Always define expiration policies when appropriate.

Example:

- "rate_limit:user_ip"
- "cooldown:user_id"

---

### PostgreSQL / Database Rules

- Database access should remain isolated from controllers.
- Use ORM carefully and explicitly.
- Prevent SQL injection through ORM/query parameterization.
- Prefer clear schemas over clever abstractions.
- Think about indexing early for scalable queries.

Avoid:

- giant unstructured tables,
- hidden query behavior,
- excessive joins without necessity.

---

### Security Rules

Always think about:

- JWT validation,
- token expiration,
- refresh token lifecycle,
- CORS configuration,
- input sanitization,
- SQL injection prevention,
- XSS prevention,
- secrets management.

Rules:

- Never hardcode secrets.
- Always use environment variables.
- Never trust external input.

---

### Docker & Infrastructure

- Docker is part of the backend lifecycle.
- Backend systems should be reproducible.
- Environment parity matters.

Rules:

- Separate dev and production concerns.
- Keep containers simple and predictable.
- Avoid bloated images.
- Use environment variables correctly.

---

### System Design Philosophy

- Design for moderate scalability first.
- Predict bottlenecks early.
- Think about:
  - request volume,
  - API failures,
  - retries,
  - queue systems,
  - caching,
  - latency,
  - observability.

Avoid:

- building distributed systems complexity too early,
- premature microservices,
- infrastructure overengineering.

---

### Testing Philosophy

- Tests protect production systems.
- Focus on:
  - service behavior,
  - critical flows,
  - integration points.

Tools:

- Pytest
- Postman
- Playwright
- Mock external APIs when appropriate.

---

### Architecture Principles

Prefer:

- modular systems,
- explicit boundaries,
- reusable services,
- simple abstractions,
- composability.

Avoid:

- tightly coupled systems,
- giant files,
- hidden side effects,
- magical architecture.

---

### Anti-Patterns

Avoid:

- fat controllers,
- business logic in routes,
- global mutable state,
- copy-paste architecture,
- unnecessary abstractions,
- overengineering for imaginary scale,
- deeply coupled services,
- massive god classes,
- silent failures,
- hidden infrastructure behavior.

---

### Senior Engineering Mindset

Always ask:

- What breaks in production?
- What happens under scale?
- How will debugging happen?
- Can another engineer understand this quickly?
- Is this abstraction justified?
- Is this maintainable in 6 months?
- What are the infrastructure consequences?
- What happens if external services fail?

The goal is not only making the system work.

The goal is:

- stability,
- maintainability,
- scalability,
- observability,
- engineering clarity.