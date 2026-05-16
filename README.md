# Full Stack Architect Prompts 🚀

A curated collection of production-oriented engineering context modules for AI-assisted Full Stack and Backend development workflows.

This repository helps provide structured architectural guidance, engineering conventions, and scalable software design principles for tools like Cursor, Continue, Gemini, Claude, and other AI-assisted development environments.

Optimized for:
- scalable microSaaS,
- modern backend systems,
- production-oriented APIs,
- modular frontend architecture,
- and AI-augmented engineering workflows.

---

## 🏗️ Core Stack

The context modules are designed around a modern Full Stack ecosystem:

- Frontend: React, TailwindCSS, React Three Fiber (R3F), Vite
- Backend: FastAPI, Python, PostgreSQL, Redis, RabbitMQ
- Infrastructure: Docker, NGINX / Reverse Proxy, JWT Authentication, REST APIs

---

## 🧩 Included Context Modules

1. `About.Me.md`
   - User learning profile, engineering direction, and systems-building context.

2. `Backend.Rules.md`
   - Backend architecture conventions, service layers, DTO validation, middleware separation, observability, Redis usage, and production-oriented backend practices.

3. `Frontend.Rules.md`
   - Frontend architecture patterns, scalable React systems, Tailwind organization, rendering lifecycle awareness, R3F performance considerations, and maintainable UI structure.

4. `Main.Context.md`
   - Global engineering behavior, architectural philosophy, systems-thinking guidance, and senior-level development direction.

---

## 🚀 Usage

### Continue / Cursor

Register the package inside your Continue configuration:

```json 
{ 
  "models": [ ... ],
  "prompts": [
    "@joaosens/fullstack-prompts"
  ]
}
```

Then invoke contextual modules directly in chat:

@Backend.Rules
@Frontend.Rules
@Main.Context

## 📜 Engineering Philosophy

- Prefer production-oriented architecture over tutorial-style examples.
- Prioritize maintainability, modularity, observability, and scalability.
- Encourage systems thinking and pragmatic engineering tradeoffs.
- Avoid unnecessary abstractions and premature overengineering.
- Focus on real-world software architecture and maintainable systems design.

## 📄 License

Distributed under the MIT License.