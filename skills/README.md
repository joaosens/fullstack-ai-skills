# 🛠️ Skills Catalog

## Purpose
This directory acts as a modular, on-demand technical repository. It holds dense technical specifications, syntax standards, boilerplate patterns, and large codebase examples (such as `System.Example`) that should only be parsed when explicitly invoked.

## Covered Frameworks & Tech
- **Backend**: FastAPI, Python, PostgreSQL, Redis, RabbitMQ.
- **Frontend**: React, TailwindCSS, React Three Fiber (R3F), Vite.
- **Infrastructure**: Docker, NGINX Reverse Proxy configs.

## Context Optimization
To prevent contextual drift and token starvation, these files must be declared as `invokable: true` so they are strictly called via slash commands (e.g., `/fastapi`, `/react`).
