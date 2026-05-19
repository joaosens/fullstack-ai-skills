# Production Engineering Reference
## GitHub Analytics Platform — Senior Architecture Patterns

---

# TABLE OF CONTENTS

1. Project Structure & App Factory
2. Middleware Architecture
3. Logging Middleware
4. Redis Rate Limiting
5. JWT Auth System
6. Service Layer Patterns
7. DTO / Pydantic Validation
8. PostgreSQL Integration (Async)
9. Docker Infrastructure
10. External API Integration (GitHub)
11. Retry & Resilience Patterns
12. Error Handling Architecture
13. Frontend Service Abstraction
14. React Scalable Folder Structure
15. TailwindCSS System
16. React Three Fiber Scene Architecture
17. API Client Abstraction
18. Observability & Logging Patterns

---

# 1. FASTAPI MODULAR ARCHITECTURE

## Why This Structure

The application is split by responsibility, not by file type. Each domain (auth, github, users) is self-contained. The app factory pattern (`create_app`) keeps the entry point clean and testable — you can instantiate the app with different configs for testing without touching global state.

## Project Layout

```
backend/
├── app/
│   ├── __init__.py
│   ├── main.py                    # App factory — entry point
│   ├── config.py                  # Typed settings via Pydantic BaseSettings
│   ├── dependencies.py            # Shared FastAPI dependencies
│   │
│   ├── core/
│   │   ├── database.py            # Async SQLAlchemy engine + session factory
│   │   ├── redis.py               # Redis connection pool
│   │   ├── security.py            # JWT encode/decode, password hashing
│   │   └── exceptions.py          # Domain exception hierarchy
│   │
│   ├── middleware/
│   │   ├── logging.py             # Structured request/response logging
│   │   ├── rate_limit.py          # Redis-backed rate limiting
│   │   └── auth.py                # JWT validation middleware (if global)
│   │
│   ├── modules/
│   │   ├── auth/
│   │   │   ├── router.py          # Route definitions only
│   │   │   ├── service.py         # Auth business logic
│   │   │   ├── schemas.py         # Request/response DTOs
│   │   │   └── dependencies.py    # Auth-specific FastAPI deps
│   │   │
│   │   ├── github/
│   │   │   ├── router.py
│   │   │   ├── service.py         # GitHub orchestration logic
│   │   │   ├── client.py          # GitHub HTTP client (external API)
│   │   │   ├── schemas.py
│   │   │   └── cache.py           # GitHub-specific Redis caching
│   │   │
│   │   └── users/
│   │       ├── router.py
│   │       ├── service.py
│   │       ├── schemas.py
│   │       └── repository.py      # DB access layer for users
│   │
│   └── models/
│       ├── user.py                # SQLAlchemy ORM models
│       └── github_stat.py
│
├── tests/
│   ├── conftest.py
│   ├── test_auth/
│   └── test_github/
│
├── Dockerfile
├── docker-compose.yml
└── pyproject.toml
```

## App Factory — `main.py`

```python
# app/main.py
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import get_settings
from app.core.database import init_db
from app.core.redis import init_redis, close_redis
from app.middleware.logging import LoggingMiddleware
from app.middleware.rate_limit import RateLimitMiddleware
from app.modules.auth.router import router as auth_router
from app.modules.github.router import router as github_router
from app.modules.users.router import router as users_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Lifespan replaces on_event startup/shutdown (deprecated in FastAPI 0.93+).
    Runs before requests are accepted, tears down cleanly on shutdown.
    Critical for connection pool management.
    """
    settings = get_settings()

    await init_db()
    await init_redis(settings.REDIS_URL)

    yield  # Application runs here

    await close_redis()


def create_app() -> FastAPI:
    settings = get_settings()

    app = FastAPI(
        title="GitHub Analytics API",
        version="1.0.0",
        docs_url="/docs" if settings.ENVIRONMENT != "production" else None,
        redoc_url=None,
        lifespan=lifespan,
    )

    # Order matters: CORS before application middleware
    app.add_middleware(
        CORSMiddleware,
        allow_origins=settings.ALLOWED_ORIGINS,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    # Custom middleware — outermost executes first on request, last on response
    app.add_middleware(LoggingMiddleware)
    app.add_middleware(RateLimitMiddleware)

    # Routers — prefix and tag grouping for OpenAPI clarity
    app.include_router(auth_router, prefix="/auth", tags=["auth"])
    app.include_router(github_router, prefix="/github", tags=["github"])
    app.include_router(users_router, prefix="/users", tags=["users"])

    return app


app = create_app()
```

## Typed Settings — `config.py`

```python
# app/config.py
from functools import lru_cache
from typing import List

from pydantic import PostgresDsn, RedisDsn, field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    ENVIRONMENT: str = "development"
    SECRET_KEY: str
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 30
    REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    DATABASE_URL: PostgresDsn
    REDIS_URL: RedisDsn

    GITHUB_API_TOKEN: str
    GITHUB_API_BASE_URL: str = "https://api.github.com"

    ALLOWED_ORIGINS: List[str] = ["http://localhost:5173"]

    RATE_LIMIT_REQUESTS: int = 100
    RATE_LIMIT_WINDOW_SECONDS: int = 60

    class Config:
        env_file = ".env"
        case_sensitive = True


@lru_cache
def get_settings() -> Settings:
    """
    Cached singleton. Safe to call from anywhere without re-parsing env.
    lru_cache ensures single instantiation across the application lifecycle.
    """
    return Settings()
```

---

# 2. MIDDLEWARE ARCHITECTURE

## Design Principle

Each middleware handles exactly one concern. Middleware runs outside the route lifecycle — it cannot access route dependencies, so it must be self-contained. Think of middleware as infrastructure infrastructure, not business logic.

## Middleware Execution Order

```
Request IN:
  CORS → RateLimit → Logging → Router → Service → DB

Response OUT:
  DB → Service → Router → Logging → RateLimit → CORS
```

The outermost middleware (added last via `add_middleware`) wraps everything. FastAPI's `add_middleware` uses a stack — last added = outermost wrapper.

---

# 3. LOGGING MIDDLEWARE

## Why Structured Logging

Raw print statements are noise. Structured logs are queryable. When production incidents happen, you need to filter by `request_id`, `user_id`, `route`, or `duration_ms` — not grep through unstructured strings.

```python
# app/middleware/logging.py
import time
import uuid
import logging
from typing import Callable

from fastapi import Request, Response
from starlette.middleware.base import BaseHTTPMiddleware
from starlette.types import ASGIApp

logger = logging.getLogger("api.requests")


class LoggingMiddleware(BaseHTTPMiddleware):
    """
    Captures the full request/response lifecycle.
    Attaches a request_id for distributed tracing correlation.
    Never logs request bodies by default — PII risk.
    """

    def __init__(self, app: ASGIApp):
        super().__init__(app)

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        request_id = str(uuid.uuid4())
        start_time = time.perf_counter()

        # Attach request_id to request state for downstream access
        request.state.request_id = request_id

        logger.info(
            "request_started",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "client_ip": self._get_client_ip(request),
                "user_agent": request.headers.get("user-agent", "unknown"),
            },
        )

        try:
            response = await call_next(request)
            duration_ms = (time.perf_counter() - start_time) * 1000

            logger.info(
                "request_completed",
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "status_code": response.status_code,
                    "duration_ms": round(duration_ms, 2),
                },
            )

            # Propagate request_id to client for support correlation
            response.headers["X-Request-ID"] = request_id
            return response

        except Exception as exc:
            duration_ms = (time.perf_counter() - start_time) * 1000
            logger.error(
                "request_failed",
                extra={
                    "request_id": request_id,
                    "method": request.method,
                    "path": request.url.path,
                    "duration_ms": round(duration_ms, 2),
                    "error": str(exc),
                },
                exc_info=True,
            )
            raise

    @staticmethod
    def _get_client_ip(request: Request) -> str:
        """
        Respect X-Forwarded-For when behind NGINX/load balancer.
        Falls back to direct connection IP.
        """
        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            return forwarded_for.split(",")[0].strip()
        return request.client.host if request.client else "unknown"


def configure_logging(environment: str) -> None:
    """
    Called once at startup. JSON formatting in production,
    human-readable in development.
    """
    import logging.config

    log_level = "DEBUG" if environment == "development" else "INFO"

    config = {
        "version": 1,
        "disable_existing_loggers": False,
        "formatters": {
            "json": {
                "()": "pythonjsonlogger.jsonlogger.JsonFormatter",
                "format": "%(asctime)s %(name)s %(levelname)s %(message)s",
            },
            "console": {
                "format": "%(asctime)s | %(levelname)-8s | %(name)s | %(message)s",
                "datefmt": "%H:%M:%S",
            },
        },
        "handlers": {
            "console": {
                "class": "logging.StreamHandler",
                "formatter": "console" if environment == "development" else "json",
            },
        },
        "root": {
            "level": log_level,
            "handlers": ["console"],
        },
    }

    logging.config.dictConfig(config)
```

---

# 4. REDIS RATE LIMITING

## Architecture Decision

Rate limiting at the middleware layer means it fires before any route logic — no DB queries, no service calls, no wasted compute. The sliding window algorithm via Redis atomic operations (`INCR` + `EXPIRE`) prevents thundering herd on burst traffic.

Per-IP is the baseline. For authenticated routes, swap the key to `user_id` for per-user limits — this prevents a single user from burning shared IP capacity.

```python
# app/middleware/rate_limit.py
import logging
from typing import Callable

from fastapi import Request, Response
from fastapi.responses import JSONResponse
from starlette.middleware.base import BaseHTTPMiddleware

from app.config import get_settings
from app.core.redis import get_redis

logger = logging.getLogger("api.rate_limit")


class RateLimitMiddleware(BaseHTTPMiddleware):
    """
    Sliding-window rate limiter backed by Redis.

    Key design choices:
    - INCR + EXPIRE is atomic enough for our use case (minor race on first request is acceptable)
    - For strict accuracy use Redis Lua scripts or MULTI/EXEC
    - Health endpoints are excluded from limiting
    """

    EXCLUDED_PATHS = {"/health", "/metrics", "/docs", "/openapi.json"}

    async def dispatch(self, request: Request, call_next: Callable) -> Response:
        if request.url.path in self.EXCLUDED_PATHS:
            return await call_next(request)

        settings = get_settings()
        redis = await get_redis()

        identifier = self._get_identifier(request)
        key = f"rate_limit:{identifier}"

        try:
            current = await redis.incr(key)

            if current == 1:
                # First request in window — set expiry
                await redis.expire(key, settings.RATE_LIMIT_WINDOW_SECONDS)

            remaining = max(0, settings.RATE_LIMIT_REQUESTS - current)

            if current > settings.RATE_LIMIT_REQUESTS:
                logger.warning(
                    "rate_limit_exceeded",
                    extra={
                        "identifier": identifier,
                        "count": current,
                        "limit": settings.RATE_LIMIT_REQUESTS,
                        "path": request.url.path,
                    },
                )
                return JSONResponse(
                    status_code=429,
                    content={
                        "error": "rate_limit_exceeded",
                        "message": "Too many requests. Please slow down.",
                        "retry_after": settings.RATE_LIMIT_WINDOW_SECONDS,
                    },
                    headers={
                        "X-RateLimit-Limit": str(settings.RATE_LIMIT_REQUESTS),
                        "X-RateLimit-Remaining": "0",
                        "Retry-After": str(settings.RATE_LIMIT_WINDOW_SECONDS),
                    },
                )

            response = await call_next(request)

            # Attach rate limit headers for client awareness
            response.headers["X-RateLimit-Limit"] = str(settings.RATE_LIMIT_REQUESTS)
            response.headers["X-RateLimit-Remaining"] = str(remaining)

            return response

        except Exception as exc:
            # Redis failure must not block requests — fail open
            logger.error(
                "rate_limit_redis_failure",
                extra={"error": str(exc)},
                exc_info=True,
            )
            return await call_next(request)

    def _get_identifier(self, request: Request) -> str:
        """
        Prefer user_id from JWT state if already resolved.
        Falls back to IP for unauthenticated routes.
        """
        user_id = getattr(request.state, "user_id", None)
        if user_id:
            return f"user:{user_id}"

        forwarded_for = request.headers.get("X-Forwarded-For")
        if forwarded_for:
            return f"ip:{forwarded_for.split(',')[0].strip()}"

        client_host = request.client.host if request.client else "unknown"
        return f"ip:{client_host}"
```

## Redis Connection Pool — `core/redis.py`

```python
# app/core/redis.py
import logging
from typing import Optional

import redis.asyncio as aioredis
from redis.asyncio import Redis

logger = logging.getLogger("app.redis")

_redis_client: Optional[Redis] = None


async def init_redis(url: str) -> None:
    global _redis_client
    _redis_client = aioredis.from_url(
        str(url),
        encoding="utf-8",
        decode_responses=True,
        max_connections=20,
    )
    # Validate connection on startup
    await _redis_client.ping()
    logger.info("redis_connected", extra={"url": str(url).split("@")[-1]})


async def get_redis() -> Redis:
    if _redis_client is None:
        raise RuntimeError("Redis not initialized. Call init_redis() first.")
    return _redis_client


async def close_redis() -> None:
    global _redis_client
    if _redis_client:
        await _redis_client.aclose()
        logger.info("redis_disconnected")
```

---

# 5. JWT AUTH SYSTEM

## Token Architecture

Access tokens are short-lived (30m). Refresh tokens are long-lived (7d) and stored in the DB, which allows revocation. This is a deliberate tradeoff — pure stateless JWT can't be revoked, so the refresh token anchors the session.

Never store tokens in localStorage. HttpOnly cookies prevent XSS exfiltration.

```python
# app/core/security.py
from datetime import datetime, timedelta, timezone
from typing import Any

import bcrypt
from jose import JWTError, jwt

from app.config import get_settings


def hash_password(plain: str) -> str:
    return bcrypt.hashpw(plain.encode(), bcrypt.gensalt()).decode()


def verify_password(plain: str, hashed: str) -> bool:
    return bcrypt.checkpw(plain.encode(), hashed.encode())


def create_access_token(subject: str | int, extra_claims: dict[str, Any] = {}) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)

    payload = {
        "sub": str(subject),
        "iat": now,
        "exp": now + timedelta(minutes=settings.ACCESS_TOKEN_EXPIRE_MINUTES),
        "type": "access",
        **extra_claims,
    }

    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def create_refresh_token(subject: str | int) -> str:
    settings = get_settings()
    now = datetime.now(timezone.utc)

    payload = {
        "sub": str(subject),
        "iat": now,
        "exp": now + timedelta(days=settings.REFRESH_TOKEN_EXPIRE_DAYS),
        "type": "refresh",
    }

    return jwt.encode(payload, settings.SECRET_KEY, algorithm=settings.ALGORITHM)


def decode_token(token: str) -> dict[str, Any]:
    """
    Raises JWTError on invalid/expired tokens.
    Callers must handle this exception.
    """
    settings = get_settings()
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[settings.ALGORITHM])
```

## Auth Dependencies — `modules/auth/dependencies.py`

```python
# app/modules/auth/dependencies.py
import logging
from typing import Annotated

from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.core.security import decode_token
from app.modules.users.repository import UserRepository
from app.models.user import User

logger = logging.getLogger("api.auth")

bearer_scheme = HTTPBearer(auto_error=False)


async def get_current_user(
    credentials: Annotated[
        HTTPAuthorizationCredentials | None, Depends(bearer_scheme)
    ],
    user_repo: Annotated[UserRepository, Depends()],
) -> User:
    """
    FastAPI dependency for protected routes.
    Validates JWT, loads user from DB, injects into route handlers.

    Deliberately does NOT log the token — PII/security risk.
    """
    if not credentials:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Missing authentication token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    try:
        payload = decode_token(credentials.credentials)
    except Exception:
        logger.warning("invalid_token_attempt")
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired token",
            headers={"WWW-Authenticate": "Bearer"},
        )

    if payload.get("type") != "access":
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid token type",
        )

    user_id = payload.get("sub")
    user = await user_repo.get_by_id(int(user_id))

    if not user or not user.is_active:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="User not found or inactive",
        )

    return user


# Type alias for injection clarity
CurrentUser = Annotated[User, Depends(get_current_user)]
```

## Auth Service — `modules/auth/service.py`

```python
# app/modules/auth/service.py
import logging
from datetime import datetime, timezone

from app.core.security import (
    create_access_token,
    create_refresh_token,
    hash_password,
    verify_password,
)
from app.core.exceptions import AuthenticationError, ConflictError
from app.modules.users.repository import UserRepository
from app.modules.auth.schemas import TokenPair, RegisterRequest, LoginRequest

logger = logging.getLogger("api.auth.service")


class AuthService:
    """
    Owns all authentication business logic.
    Repository handles DB. Service handles rules.
    """

    def __init__(self, user_repo: UserRepository):
        self.user_repo = user_repo

    async def register(self, payload: RegisterRequest) -> TokenPair:
        existing = await self.user_repo.get_by_email(payload.email)
        if existing:
            raise ConflictError(f"Email already registered: {payload.email}")

        hashed = hash_password(payload.password)
        user = await self.user_repo.create(
            email=payload.email,
            username=payload.username,
            password_hash=hashed,
        )

        logger.info("user_registered", extra={"user_id": user.id})

        return self._generate_token_pair(user.id)

    async def login(self, payload: LoginRequest) -> TokenPair:
        user = await self.user_repo.get_by_email(payload.email)

        # Constant-time-safe: always verify even if user not found
        # to prevent email enumeration via timing attack
        password_valid = verify_password(
            payload.password,
            user.password_hash if user else "$2b$12$placeholder_hash_for_timing",
        )

        if not user or not password_valid:
            logger.warning(
                "failed_login_attempt",
                extra={"email": payload.email},
            )
            raise AuthenticationError("Invalid credentials")

        logger.info("user_logged_in", extra={"user_id": user.id})
        return self._generate_token_pair(user.id)

    def _generate_token_pair(self, user_id: int) -> TokenPair:
        return TokenPair(
            access_token=create_access_token(subject=user_id),
            refresh_token=create_refresh_token(subject=user_id),
            token_type="bearer",
        )
```

---

# 6. SERVICE LAYER PATTERNS

## Why a Service Layer Exists

Routes answer the question "what HTTP contract do we expose?" Services answer "what does this application actually do?" Keeping them separate means you can call services from other services, background workers, CLI scripts, or tests — without needing an HTTP context.

```python
# app/modules/github/service.py
import logging
from typing import Optional

from app.modules.github.client import GitHubClient
from app.modules.github.cache import GitHubCache
from app.modules.github.schemas import (
    GitHubUserStats,
    GitHubRepoSummary,
    GitHubAnalytics,
)
from app.core.exceptions import NotFoundError, ExternalAPIError

logger = logging.getLogger("api.github.service")


class GitHubService:
    """
    Orchestrates GitHub data retrieval.

    Responsibilities:
    - Check cache before hitting GitHub API
    - Transform raw API data into domain-relevant schemas
    - Handle business rules (e.g. analytics computation)
    - Delegate caching to GitHubCache
    - Delegate HTTP to GitHubClient

    Does NOT:
    - Know about HTTP request/response
    - Know about JWT or auth
    - Manage DB connections
    """

    def __init__(self, client: GitHubClient, cache: GitHubCache):
        self.client = client
        self.cache = cache

    async def get_user_analytics(self, github_username: str) -> GitHubAnalytics:
        cache_key = f"analytics:{github_username}"
        cached = await self.cache.get(cache_key)
        if cached:
            logger.debug("cache_hit", extra={"key": cache_key})
            return GitHubAnalytics.model_validate(cached)

        logger.info(
            "fetching_github_analytics",
            extra={"username": github_username},
        )

        user_data = await self.client.get_user(github_username)
        if not user_data:
            raise NotFoundError(f"GitHub user not found: {github_username}")

        repos = await self.client.get_user_repos(github_username)
        languages = self._aggregate_languages(repos)
        analytics = GitHubAnalytics(
            username=github_username,
            public_repos=user_data["public_repos"],
            followers=user_data["followers"],
            following=user_data["following"],
            total_stars=sum(r.get("stargazers_count", 0) for r in repos),
            top_languages=languages,
            repos=[
                GitHubRepoSummary(
                    name=r["name"],
                    stars=r.get("stargazers_count", 0),
                    forks=r.get("forks_count", 0),
                    language=r.get("language"),
                    description=r.get("description"),
                )
                for r in repos[:10]  # Top 10 by default
            ],
        )

        await self.cache.set(cache_key, analytics.model_dump(), ttl=300)

        return analytics

    def _aggregate_languages(self, repos: list[dict]) -> dict[str, int]:
        languages: dict[str, int] = {}
        for repo in repos:
            lang = repo.get("language")
            if lang:
                languages[lang] = languages.get(lang, 0) + 1
        return dict(sorted(languages.items(), key=lambda x: x[1], reverse=True)[:8])
```

## Router — Thin by Design

```python
# app/modules/github/router.py
from typing import Annotated

from fastapi import APIRouter, Depends

from app.modules.auth.dependencies import CurrentUser
from app.modules.github.service import GitHubService
from app.modules.github.schemas import GitHubAnalytics
from app.dependencies import get_github_service

router = APIRouter()


@router.get("/stats/{username}", response_model=GitHubAnalytics)
async def get_github_stats(
    username: str,
    current_user: CurrentUser,
    service: Annotated[GitHubService, Depends(get_github_service)],
) -> GitHubAnalytics:
    """
    Route does exactly three things:
    1. Accepts the request and validates path param
    2. Calls the service
    3. Returns the response

    No business logic here. Ever.
    """
    return await service.get_user_analytics(username)
```

---

# 7. DTO / PYDANTIC VALIDATION

## Design Philosophy

DTOs (Data Transfer Objects) are the contract between your API and the outside world. They validate input before it ever touches a service, and they control exactly what gets serialized into responses. Never return raw ORM models directly to clients.

```python
# app/modules/auth/schemas.py
from pydantic import BaseModel, EmailStr, Field, field_validator
import re


class RegisterRequest(BaseModel):
    email: EmailStr
    username: str = Field(min_length=3, max_length=32, pattern=r"^[a-zA-Z0-9_-]+$")
    password: str = Field(min_length=8, max_length=128)

    @field_validator("password")
    @classmethod
    def password_strength(cls, v: str) -> str:
        if not re.search(r"[A-Z]", v):
            raise ValueError("Password must contain at least one uppercase letter")
        if not re.search(r"[0-9]", v):
            raise ValueError("Password must contain at least one digit")
        return v


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class TokenPair(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    refresh_token: str


# app/modules/github/schemas.py
from typing import Optional
from pydantic import BaseModel, Field


class GitHubRepoSummary(BaseModel):
    name: str
    stars: int = Field(ge=0)
    forks: int = Field(ge=0)
    language: Optional[str] = None
    description: Optional[str] = None


class GitHubAnalytics(BaseModel):
    username: str
    public_repos: int
    followers: int
    following: int
    total_stars: int
    top_languages: dict[str, int]
    repos: list[GitHubRepoSummary]

    model_config = {"from_attributes": True}


# Shared error response schema — consistent across all endpoints
class ErrorResponse(BaseModel):
    error: str
    message: str
    request_id: Optional[str] = None
```

---

# 8. POSTGRESQL INTEGRATION (ASYNC)

## Why Async SQLAlchemy

Blocking DB calls in an async framework nullify async benefits. With `asyncpg` + `async_sessionmaker`, DB I/O yields the event loop, allowing concurrent request handling on a single process.

```python
# app/core/database.py
import logging
from typing import AsyncGenerator

from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)
from sqlalchemy.orm import DeclarativeBase

from app.config import get_settings

logger = logging.getLogger("app.database")

_engine = None
_session_factory = None


class Base(DeclarativeBase):
    pass


async def init_db() -> None:
    global _engine, _session_factory

    settings = get_settings()

    _engine = create_async_engine(
        str(settings.DATABASE_URL).replace("postgresql://", "postgresql+asyncpg://"),
        pool_size=10,
        max_overflow=20,
        pool_pre_ping=True,   # Validates connections before checkout
        echo=settings.ENVIRONMENT == "development",
    )

    _session_factory = async_sessionmaker(
        bind=_engine,
        expire_on_commit=False,  # Prevent lazy-load failures after commit
        class_=AsyncSession,
    )

    logger.info("database_initialized")


async def get_session() -> AsyncGenerator[AsyncSession, None]:
    """
    FastAPI dependency. Yields a session per request, commits on success,
    rolls back on exception. Never leaks connections.
    """
    if _session_factory is None:
        raise RuntimeError("Database not initialized")

    async with _session_factory() as session:
        try:
            yield session
            await session.commit()
        except Exception:
            await session.rollback()
            raise
        finally:
            await session.close()
```

## ORM Model

```python
# app/models/user.py
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import Boolean, DateTime, Integer, String, func
from sqlalchemy.orm import Mapped, mapped_column

from app.core.database import Base


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    username: Mapped[str] = mapped_column(String(64), unique=True, index=True, nullable=False)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )
    updated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        onupdate=func.now(),
        nullable=True,
    )
```

## Repository Pattern

```python
# app/modules/users/repository.py
import logging
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from fastapi import Depends

from app.core.database import get_session
from app.models.user import User

logger = logging.getLogger("api.users.repository")


class UserRepository:
    """
    Isolates all DB access for the User domain.

    Why a repository and not direct session usage in services?
    - Services should not know about SQLAlchemy internals
    - Repositories are mockable in tests
    - Query logic stays in one place
    """

    def __init__(self, session: AsyncSession = Depends(get_session)):
        self.session = session

    async def get_by_id(self, user_id: int) -> Optional[User]:
        result = await self.session.execute(
            select(User).where(User.id == user_id)
        )
        return result.scalar_one_or_none()

    async def get_by_email(self, email: str) -> Optional[User]:
        result = await self.session.execute(
            select(User).where(User.email == email)
        )
        return result.scalar_one_or_none()

    async def create(self, email: str, username: str, password_hash: str) -> User:
        user = User(email=email, username=username, password_hash=password_hash)
        self.session.add(user)
        await self.session.flush()  # Gets ID without committing — session manages tx
        await self.session.refresh(user)
        logger.info("user_created", extra={"user_id": user.id})
        return user
```

---

# 9. DOCKER INFRASTRUCTURE

## Philosophy

Dev and prod containers differ intentionally. Dev mounts source code as volumes for hot reload. Prod builds a minimal image with no dev dependencies, non-root user, and a single process.

## `Dockerfile` (Production)

```dockerfile
# Dockerfile
FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

# Install system deps separately — layer caches unless deps change
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpq-dev gcc \
    && rm -rf /var/lib/apt/lists/*

# ------- Dependency layer (cached unless pyproject.toml changes) -------
FROM base AS deps
COPY pyproject.toml ./
RUN pip install --upgrade pip && pip install .

# ------- Production image -------
FROM base AS production

# Non-root user — security baseline
RUN addgroup --system appgroup && adduser --system --group appuser

COPY --from=deps /usr/local/lib/python3.12 /usr/local/lib/python3.12
COPY --from=deps /usr/local/bin /usr/local/bin

COPY --chown=appuser:appgroup ./app ./app

USER appuser

EXPOSE 8000

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000", "--workers", "2"]
```

## `docker-compose.yml` (Development)

```yaml
# docker-compose.yml
version: "3.9"

services:
  api:
    build:
      context: .
      target: base          # Dev target — no prod optimizations
    command: uvicorn app.main:app --host 0.0.0.0 --port 8000 --reload
    volumes:
      - ./app:/app/app      # Hot reload via volume mount
    env_file: .env
    ports:
      - "8000:8000"
    depends_on:
      postgres:
        condition: service_healthy
      redis:
        condition: service_healthy
    networks:
      - backend

  postgres:
    image: postgres:16-alpine
    environment:
      POSTGRES_USER: ${POSTGRES_USER}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD}
      POSTGRES_DB: ${POSTGRES_DB}
    volumes:
      - postgres_data:/var/lib/postgresql/data
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${POSTGRES_USER}"]
      interval: 5s
      timeout: 5s
      retries: 5
    networks:
      - backend

  redis:
    image: redis:7-alpine
    command: redis-server --maxmemory 256mb --maxmemory-policy allkeys-lru
    volumes:
      - redis_data:/data
    healthcheck:
      test: ["CMD", "redis-cli", "ping"]
      interval: 5s
      timeout: 3s
      retries: 5
    networks:
      - backend

  nginx:
    image: nginx:alpine
    ports:
      - "80:80"
    volumes:
      - ./nginx/dev.conf:/etc/nginx/nginx.conf:ro
    depends_on:
      - api
    networks:
      - backend

volumes:
  postgres_data:
  redis_data:

networks:
  backend:
    driver: bridge
```

---

# 10. EXTERNAL API INTEGRATION — GITHUB CLIENT

## Design Principles

The GitHub client is infrastructure, not business logic. It speaks HTTP. It knows nothing about your domain. The service knows what data to request; the client knows how to transport it.

Retry is built in at the client level — transient failures (502, 503, rate limit) are transparently retried before the error surfaces to the service.

```python
# app/modules/github/client.py
import logging
from typing import Any, Optional

import httpx
from tenacity import (
    retry,
    retry_if_exception_type,
    stop_after_attempt,
    wait_exponential,
    before_sleep_log,
)

from app.config import get_settings
from app.core.exceptions import ExternalAPIError, RateLimitError

logger = logging.getLogger("api.github.client")

RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


class GitHubClient:
    """
    GitHub REST API client.

    Responsibilities:
    - Authenticate requests with token
    - Serialize/deserialize HTTP
    - Retry on transient failures
    - Surface clean domain exceptions (not httpx errors)

    Does NOT:
    - Cache responses (GitHubCache's job)
    - Transform data into domain models (service's job)
    - Know about users or analytics logic
    """

    def __init__(self):
        settings = get_settings()
        self._base_url = settings.GITHUB_API_BASE_URL
        self._token = settings.GITHUB_API_TOKEN
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(
                base_url=self._base_url,
                headers={
                    "Authorization": f"Bearer {self._token}",
                    "Accept": "application/vnd.github.v3+json",
                    "X-GitHub-Api-Version": "2022-11-28",
                },
                timeout=httpx.Timeout(connect=5.0, read=15.0, write=5.0, pool=5.0),
            )
        return self._client

    @retry(
        retry=retry_if_exception_type(ExternalAPIError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,
    )
    async def get_user(self, username: str) -> dict[str, Any]:
        return await self._get("/users/{username}", username=username)

    @retry(
        retry=retry_if_exception_type(ExternalAPIError),
        stop=stop_after_attempt(3),
        wait=wait_exponential(multiplier=1, min=1, max=8),
        before_sleep=before_sleep_log(logger, logging.WARNING),
        reraise=True,
    )
    async def get_user_repos(
        self,
        username: str,
        per_page: int = 100,
    ) -> list[dict[str, Any]]:
        return await self._get(
            f"/users/{username}/repos",
            params={"per_page": per_page, "sort": "stars", "direction": "desc"},
        )

    async def _get(self, path: str, params: dict = {}, **kwargs) -> Any:
        url = path.format(**kwargs) if kwargs else path
        client = await self._get_client()

        try:
            response = await client.get(url, params=params)
        except httpx.TimeoutException as exc:
            logger.error("github_timeout", extra={"path": url})
            raise ExternalAPIError(f"GitHub API timeout: {url}") from exc
        except httpx.RequestError as exc:
            logger.error("github_request_error", extra={"path": url, "error": str(exc)})
            raise ExternalAPIError(f"GitHub API request failed: {url}") from exc

        if response.status_code == 404:
            return None

        if response.status_code == 429:
            reset = response.headers.get("X-RateLimit-Reset", "unknown")
            logger.warning("github_rate_limited", extra={"reset": reset})
            raise RateLimitError(f"GitHub rate limit exceeded. Reset: {reset}")

        if response.status_code in RETRYABLE_STATUS_CODES:
            logger.warning(
                "github_retryable_error",
                extra={"status": response.status_code, "path": url},
            )
            raise ExternalAPIError(
                f"GitHub API error {response.status_code}: {url}"
            )

        if not response.is_success:
            logger.error(
                "github_api_error",
                extra={"status": response.status_code, "path": url},
            )
            raise ExternalAPIError(
                f"GitHub API unexpected error {response.status_code}"
            )

        return response.json()

    async def close(self) -> None:
        if self._client and not self._client.is_closed:
            await self._client.aclose()
```

---

# 11. ERROR HANDLING ARCHITECTURE

## Domain Exception Hierarchy

```python
# app/core/exceptions.py


class AppError(Exception):
    """Base for all application errors."""
    status_code: int = 500
    error_code: str = "internal_error"


class AuthenticationError(AppError):
    status_code = 401
    error_code = "authentication_error"


class AuthorizationError(AppError):
    status_code = 403
    error_code = "authorization_error"


class NotFoundError(AppError):
    status_code = 404
    error_code = "not_found"


class ConflictError(AppError):
    status_code = 409
    error_code = "conflict"


class ValidationError(AppError):
    status_code = 422
    error_code = "validation_error"


class ExternalAPIError(AppError):
    status_code = 502
    error_code = "external_api_error"


class RateLimitError(AppError):
    status_code = 429
    error_code = "rate_limit_error"
```

## Global Exception Handler

```python
# app/core/error_handlers.py
import logging
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from pydantic import ValidationError as PydanticValidationError

from app.core.exceptions import AppError

logger = logging.getLogger("api.errors")


def register_exception_handlers(app: FastAPI) -> None:
    """
    Centralized exception handling.
    All exceptions normalize to the same response shape.
    Internal details are logged, never leaked to clients.
    """

    @app.exception_handler(AppError)
    async def app_error_handler(request: Request, exc: AppError) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)

        log_level = logging.ERROR if exc.status_code >= 500 else logging.WARNING
        logger.log(
            log_level,
            "app_error",
            extra={
                "request_id": request_id,
                "error_code": exc.error_code,
                "status_code": exc.status_code,
                "message": str(exc),
                "path": request.url.path,
            },
            exc_info=exc.status_code >= 500,
        )

        return JSONResponse(
            status_code=exc.status_code,
            content={
                "error": exc.error_code,
                "message": str(exc),
                "request_id": request_id,
            },
        )

    @app.exception_handler(PydanticValidationError)
    async def pydantic_error_handler(
        request: Request, exc: PydanticValidationError
    ) -> JSONResponse:
        return JSONResponse(
            status_code=422,
            content={
                "error": "validation_error",
                "message": "Request validation failed",
                "details": exc.errors(),
            },
        )

    @app.exception_handler(Exception)
    async def unhandled_exception_handler(
        request: Request, exc: Exception
    ) -> JSONResponse:
        request_id = getattr(request.state, "request_id", None)
        logger.error(
            "unhandled_exception",
            extra={"request_id": request_id, "path": request.url.path},
            exc_info=True,
        )
        return JSONResponse(
            status_code=500,
            content={
                "error": "internal_error",
                "message": "An unexpected error occurred",
                "request_id": request_id,
            },
        )
```

---

# 12. FRONTEND SERVICE ABSTRACTION

## Why a Service Layer on the Frontend

Components should not contain `fetch` calls. API communication belongs in a service layer that handles auth headers, error normalization, and response typing. Components just consume hooks; hooks consume services.

## API Client — The Transport Layer

```typescript
// src/services/api-client.ts
import { TokenStorage } from "@/lib/token-storage";

interface RequestOptions extends RequestInit {
  skipAuth?: boolean;
}

class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId?: string
  ) {
    super(message);
    this.name = "ApiError";
  }
}

async function apiClient<T>(
  path: string,
  options: RequestOptions = {}
): Promise<T> {
  const { skipAuth = false, ...fetchOptions } = options;

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...(fetchOptions.headers as Record<string, string>),
  };

  if (!skipAuth) {
    const token = TokenStorage.getAccessToken();
    if (token) headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${import.meta.env.VITE_API_BASE_URL}${path}`, {
    ...fetchOptions,
    headers,
  });

  const requestId = response.headers.get("X-Request-ID") ?? undefined;

  if (!response.ok) {
    let errorBody: { error?: string; message?: string } = {};
    try {
      errorBody = await response.json();
    } catch {
      // Non-JSON error body — use defaults
    }

    // Silently attempt token refresh on 401
    if (response.status === 401 && !skipAuth) {
      const refreshed = await attemptTokenRefresh();
      if (refreshed) {
        return apiClient<T>(path, options); // Retry original request
      }
    }

    throw new ApiError(
      response.status,
      errorBody.error ?? "unknown_error",
      errorBody.message ?? "An unexpected error occurred",
      requestId
    );
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

async function attemptTokenRefresh(): Promise<boolean> {
  const refreshToken = TokenStorage.getRefreshToken();
  if (!refreshToken) return false;

  try {
    const result = await apiClient<{ access_token: string }>(
      "/auth/refresh",
      {
        method: "POST",
        body: JSON.stringify({ refresh_token: refreshToken }),
        skipAuth: true,
      }
    );
    TokenStorage.setAccessToken(result.access_token);
    return true;
  } catch {
    TokenStorage.clear();
    return false;
  }
}

export { apiClient, ApiError };
```

## GitHub Service

```typescript
// src/services/github.service.ts
import { apiClient } from "./api-client";

export interface RepoSummary {
  name: string;
  stars: number;
  forks: number;
  language: string | null;
  description: string | null;
}

export interface GitHubAnalytics {
  username: string;
  public_repos: number;
  followers: number;
  following: number;
  total_stars: number;
  top_languages: Record<string, number>;
  repos: RepoSummary[];
}

export const githubService = {
  async getAnalytics(username: string): Promise<GitHubAnalytics> {
    return apiClient<GitHubAnalytics>(`/github/stats/${username}`);
  },
};
```

## React Hook — Consumes the Service

```typescript
// src/hooks/useGithubAnalytics.ts
import { useState, useEffect, useCallback } from "react";
import { githubService, GitHubAnalytics } from "@/services/github.service";
import { ApiError } from "@/services/api-client";

interface State {
  data: GitHubAnalytics | null;
  isLoading: boolean;
  error: string | null;
}

export function useGithubAnalytics(username: string | null) {
  const [state, setState] = useState<State>({
    data: null,
    isLoading: false,
    error: null,
  });

  const fetch = useCallback(async () => {
    if (!username) return;

    setState({ data: null, isLoading: true, error: null });

    try {
      const data = await githubService.getAnalytics(username);
      setState({ data, isLoading: false, error: null });
    } catch (err) {
      const message =
        err instanceof ApiError
          ? err.message
          : "Failed to load GitHub analytics";
      setState({ data: null, isLoading: false, error: message });
    }
  }, [username]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { ...state, refetch: fetch };
}
```

---

# 13. REACT SCALABLE FOLDER STRUCTURE

## Principle: Feature-Based, Not Type-Based

Grouping by feature keeps related code co-located. When you work on GitHub analytics, everything you need is in `/features/github` — not scattered across `/components`, `/services`, `/hooks`.

```
frontend/
├── src/
│   ├── app/
│   │   ├── App.tsx                  # Root with providers
│   │   ├── router.tsx               # Route definitions
│   │   └── providers.tsx            # Auth, Query, Theme providers
│   │
│   ├── features/
│   │   ├── auth/
│   │   │   ├── components/
│   │   │   │   ├── LoginForm.tsx
│   │   │   │   └── RegisterForm.tsx
│   │   │   ├── hooks/
│   │   │   │   └── useAuth.ts
│   │   │   ├── services/
│   │   │   │   └── auth.service.ts
│   │   │   └── index.ts             # Public API for the feature
│   │   │
│   │   └── github/
│   │       ├── components/
│   │       │   ├── AnalyticsDashboard.tsx
│   │       │   ├── RepoList.tsx
│   │       │   ├── LanguageChart.tsx
│   │       │   └── StatsGrid.tsx
│   │       ├── hooks/
│   │       │   └── useGithubAnalytics.ts
│   │       ├── services/
│   │       │   └── github.service.ts
│   │       ├── three/               # R3F scene for this feature
│   │       │   ├── GlobeScene.tsx
│   │       │   └── ActivityMesh.tsx
│   │       └── index.ts
│   │
│   ├── components/                  # Truly shared UI primitives
│   │   ├── ui/
│   │   │   ├── Button.tsx
│   │   │   ├── Card.tsx
│   │   │   ├── Spinner.tsx
│   │   │   └── ErrorBoundary.tsx
│   │   └── layout/
│   │       ├── Navbar.tsx
│   │       └── PageShell.tsx
│   │
│   ├── lib/
│   │   ├── token-storage.ts         # Auth token management
│   │   └── cn.ts                    # Tailwind class merge utility
│   │
│   ├── services/
│   │   └── api-client.ts            # Base HTTP client (shared)
│   │
│   ├── styles/
│   │   ├── globals.css
│   │   └── tailwind.config.ts
│   │
│   └── types/
│       └── api.ts                   # Shared API type definitions
│
├── public/
├── index.html
├── vite.config.ts
└── package.json
```

---

# 14. TAILWINDCSS SYSTEM

## Design Tokens via Config

```typescript
// tailwind.config.ts
import type { Config } from "tailwindcss";

export default {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        // Semantic color system — not raw hex values in components
        brand: {
          50: "#f0f9ff",
          500: "#0ea5e9",
          600: "#0284c7",
          900: "#0c4a6e",
        },
        surface: {
          DEFAULT: "#0f172a",
          elevated: "#1e293b",
          border: "#334155",
        },
        text: {
          primary: "#f1f5f9",
          secondary: "#94a3b8",
          muted: "#475569",
        },
      },
      fontFamily: {
        sans: ["Inter", "system-ui", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      animation: {
        "fade-in": "fadeIn 0.2s ease-out",
        "slide-up": "slideUp 0.3s ease-out",
      },
      keyframes: {
        fadeIn: {
          "0%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        slideUp: {
          "0%": { opacity: "0", transform: "translateY(8px)" },
          "100%": { opacity: "1", transform: "translateY(0)" },
        },
      },
    },
  },
  plugins: [],
} satisfies Config;
```

## Component Composition Pattern

```tsx
// src/lib/cn.ts
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

// Merges Tailwind classes and resolves conflicts deterministically
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// src/components/ui/Button.tsx
import { cn } from "@/lib/cn";
import { type ButtonHTMLAttributes, forwardRef } from "react";

type Variant = "primary" | "secondary" | "ghost" | "danger";
type Size = "sm" | "md" | "lg";

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  size?: Size;
  isLoading?: boolean;
}

const variantClasses: Record<Variant, string> = {
  primary:
    "bg-brand-500 text-white hover:bg-brand-600 focus:ring-brand-500",
  secondary:
    "bg-surface-elevated text-text-primary border border-surface-border hover:bg-surface-border",
  ghost:
    "text-text-secondary hover:text-text-primary hover:bg-surface-elevated",
  danger: "bg-red-600 text-white hover:bg-red-700 focus:ring-red-500",
};

const sizeClasses: Record<Size, string> = {
  sm: "h-8 px-3 text-sm",
  md: "h-10 px-4 text-sm",
  lg: "h-12 px-6 text-base",
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  (
    {
      variant = "primary",
      size = "md",
      isLoading = false,
      disabled,
      className,
      children,
      ...props
    },
    ref
  ) => (
    <button
      ref={ref}
      disabled={disabled || isLoading}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium",
        "transition-colors duration-150 focus:outline-none focus:ring-2 focus:ring-offset-2",
        "disabled:opacity-50 disabled:cursor-not-allowed",
        variantClasses[variant],
        sizeClasses[size],
        className
      )}
      {...props}
    >
      {isLoading && (
        <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent" />
      )}
      {children}
    </button>
  )
);

Button.displayName = "Button";
```

---

# 15. REACT THREE FIBER SCENE ARCHITECTURE

## Performance Principles

R3F renders inside a WebGL context on a continuous loop. Every unnecessary re-render is a frame budget hit. Keep scene logic inside R3F-specific components; never let scene state leak into React's reconciler unnecessarily.

```tsx
// src/features/github/three/GlobeScene.tsx
import { Canvas } from "@react-three/fiber";
import { OrbitControls, Environment, Stars } from "@react-three/drei";
import { Suspense, memo } from "react";
import { ActivityGlobe } from "./ActivityGlobe";
import { CommitParticles } from "./CommitParticles";
import type { GitHubAnalytics } from "../services/github.service";

interface GlobeSceneProps {
  analytics: GitHubAnalytics;
}

/**
 * Scene entry point. Canvas is isolated here.
 * memo prevents re-render when parent re-renders with same analytics ref.
 *
 * Performance decisions:
 * - dpr capped at [1, 2] — prevents GPU overload on high-DPI displays
 * - gl.antialias: true — acceptable cost at this scene complexity
 * - frameloop "demand" skips renders when nothing moves
 */
export const GlobeScene = memo(({ analytics }: GlobeSceneProps) => (
  <div className="h-[500px] w-full rounded-xl overflow-hidden">
    <Canvas
      camera={{ position: [0, 0, 4], fov: 60 }}
      dpr={[1, 2]}
      gl={{ antialias: true, alpha: true }}
      frameloop="demand"  // Only re-renders when scene state changes
    >
      <Suspense fallback={null}>
        <SceneContent analytics={analytics} />
      </Suspense>
    </Canvas>
  </div>
));

GlobeScene.displayName = "GlobeScene";

// Separate inner component: keeps Canvas config clean
function SceneContent({ analytics }: GlobeSceneProps) {
  return (
    <>
      <ambientLight intensity={0.4} />
      <directionalLight position={[5, 5, 5]} intensity={1.2} />

      <Stars radius={80} depth={50} count={3000} factor={4} fade />
      <Environment preset="night" />

      <ActivityGlobe analytics={analytics} />
      <CommitParticles count={analytics.total_stars} />

      <OrbitControls
        enablePan={false}
        minDistance={2.5}
        maxDistance={8}
        autoRotate
        autoRotateSpeed={0.4}
      />
    </>
  );
}
```

```tsx
// src/features/github/three/ActivityGlobe.tsx
import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import { Sphere, MeshDistortMaterial } from "@react-three/drei";
import * as THREE from "three";
import type { GitHubAnalytics } from "../services/github.service";

interface ActivityGlobeProps {
  analytics: GitHubAnalytics;
}

export function ActivityGlobe({ analytics }: ActivityGlobeProps) {
  const meshRef = useRef<THREE.Mesh>(null);

  // Derive visual properties from real data — only recomputed when analytics changes
  const distortionFactor = useMemo(() => {
    const normalized = Math.min(analytics.total_stars / 10000, 1);
    return 0.1 + normalized * 0.4;
  }, [analytics.total_stars]);

  // useFrame runs every tick — keep it minimal, no allocations
  useFrame((state) => {
    if (!meshRef.current) return;
    const t = state.clock.elapsedTime;
    meshRef.current.rotation.y = t * 0.08;
    meshRef.current.rotation.x = Math.sin(t * 0.05) * 0.05;
  });

  return (
    <Sphere ref={meshRef} args={[1.4, 64, 64]}>
      <MeshDistortMaterial
        color="#0ea5e9"
        distort={distortionFactor}
        speed={1.5}
        roughness={0.2}
        metalness={0.8}
        transparent
        opacity={0.85}
      />
    </Sphere>
  );
}
```

---

# 16. OBSERVABILITY PATTERNS

## Structured Log Configuration

```python
# app/core/logging.py
import logging
import sys
from typing import Any


class RequestContextFilter(logging.Filter):
    """
    Injects request_id into all log records when available.
    Enables filtering all logs for a specific request in production log systems.
    """

    def filter(self, record: logging.LogRecord) -> bool:
        if not hasattr(record, "request_id"):
            record.request_id = "no-request-context"
        return True


def setup_logging(environment: str) -> None:
    """
    JSON in prod (ingested by Datadog, Loki, CloudWatch).
    Console in dev.
    """
    root_logger = logging.getLogger()
    root_logger.setLevel(logging.DEBUG if environment == "development" else logging.INFO)

    handler = logging.StreamHandler(sys.stdout)
    handler.addFilter(RequestContextFilter())

    if environment == "production":
        try:
            from pythonjsonlogger import jsonlogger
            formatter = jsonlogger.JsonFormatter(
                fmt="%(asctime)s %(name)s %(levelname)s %(message)s %(request_id)s"
            )
        except ImportError:
            formatter = logging.Formatter(
                "%(asctime)s | %(levelname)s | %(name)s | %(message)s"
            )
    else:
        formatter = logging.Formatter(
            "%(asctime)s | %(levelname)-8s | %(name)-30s | %(message)s",
            datefmt="%H:%M:%S",
        )

    handler.setFormatter(formatter)
    root_logger.addHandler(handler)

    # Suppress noisy third-party loggers
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(
        logging.INFO if environment == "development" else logging.WARNING
    )
```

## Health Check Endpoint

```python
# app/modules/health/router.py
import logging
from fastapi import APIRouter
from fastapi.responses import JSONResponse

from app.core.database import get_engine
from app.core.redis import get_redis

logger = logging.getLogger("api.health")
router = APIRouter()


@router.get("/health")
async def health_check() -> JSONResponse:
    """
    Infrastructure health endpoint.
    Used by Docker HEALTHCHECK, NGINX upstream checks, k8s readiness probes.
    Returns 503 if any critical dependency is down.
    """
    checks = {}
    healthy = True

    # Database check
    try:
        engine = get_engine()
        async with engine.connect() as conn:
            await conn.execute("SELECT 1")
        checks["database"] = "ok"
    except Exception as exc:
        logger.error("health_check_db_failed", extra={"error": str(exc)})
        checks["database"] = "failed"
        healthy = False

    # Redis check
    try:
        redis = await get_redis()
        await redis.ping()
        checks["redis"] = "ok"
    except Exception as exc:
        logger.error("health_check_redis_failed", extra={"error": str(exc)})
        checks["redis"] = "failed"
        healthy = False

    status_code = 200 if healthy else 503
    return JSONResponse(
        status_code=status_code,
        content={"status": "healthy" if healthy else "degraded", "checks": checks},
    )
```

---

# 17. SHARED DEPENDENCIES — `dependencies.py`

```python
# app/dependencies.py
from typing import Annotated

from fastapi import Depends

from app.modules.github.client import GitHubClient
from app.modules.github.cache import GitHubCache
from app.modules.github.service import GitHubService
from app.modules.users.repository import UserRepository
from app.core.database import get_session
from sqlalchemy.ext.asyncio import AsyncSession


def get_github_client() -> GitHubClient:
    return GitHubClient()


def get_github_cache() -> GitHubCache:
    return GitHubCache()


def get_github_service(
    client: Annotated[GitHubClient, Depends(get_github_client)],
    cache: Annotated[GitHubCache, Depends(get_github_cache)],
) -> GitHubService:
    return GitHubService(client=client, cache=cache)


def get_user_repository(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> UserRepository:
    return UserRepository(session=session)
```

---

# PRODUCTION TRADEOFFS — ENGINEERING NOTES

## What This Architecture Optimizes For

- **Debuggability**: Every request has a `request_id`. Every failure is logged with context. On-call engineers can trace any incident end-to-end.
- **Testability**: Services are injectable. Repositories are mockable. Routes are thin. You can test the entire business logic layer without HTTP.
- **Resilience**: Redis failures don't block requests. GitHub API failures are retried transparently. External errors are translated into domain errors before surfacing.
- **Maintainability**: New engineers find feature logic in `features/github/` or `modules/github/` — not spread across 12 files in different directories.

## What This Architecture Trades Off

- **Initial velocity**: More files, more boilerplate than a single-file FastAPI script. The payoff comes at scale, not day one.
- **Flexibility**: DTOs enforcing strict response shapes mean API changes require schema updates. This is the right tradeoff for a contract-driven API.
- **Async complexity**: Async SQLAlchemy has subtleties (session lifecycle, lazy loading). The patterns above handle these correctly, but they require understanding the async execution model.

## Next Layer: Worker Systems

When GitHub data fetching becomes too slow for synchronous request/response, move it to a background worker:

```
Request → API → Publish job to RabbitMQ → Return 202 Accepted
Worker → Consume job → Fetch GitHub → Store in DB → Publish event
WebSocket / SSE → Push completion to client
```

The current service layer is already structured to support this transition — the `GitHubService` methods can be called from a worker with zero modification.