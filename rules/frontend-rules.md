# FRONTEND ENGINEERING RULES

## Core Frontend Philosophy

- Frontend is not only visual design.
- Frontend is system architecture, rendering flow, user interaction, state orchestration, and developer experience.
- Build interfaces that remain maintainable as the application grows.
- Prioritize scalability, readability, UX consistency, and rendering performance.
- Avoid chaotic component structures and uncontrolled state management.

---

## Frontend Architecture Philosophy

The frontend should behave like a structured system, not a collection of random components.

Always think about:

- rendering lifecycle,
- state flow,
- component boundaries,
- scalability,
- performance,
- API integration consistency,
- maintainability.

---

## Component Design Rules

Components must have:

- clear responsibilities,
- predictable behavior,
- reusable structure,
- minimal side effects.

Prefer:

- small reusable components,
- composable UI systems,
- isolated logic,
- explicit props.

Avoid:

- giant god components,
- duplicated UI logic,
- deeply nested prop chains,
- hidden side effects.

---

## Folder Organization

Frontend structure should scale naturally.

Prefer:

- feature-based organization,
- separation between:
  - components,
  - pages,
  - hooks,
  - services,
  - styles,
  - assets.

Example:

- "/components"
- "/pages"
- "/hooks"
- "/services"
- "/styles"
- "/assets"

---

## React Philosophy

React is a rendering and state orchestration system.

Always think about:

- re-renders,
- state ownership,
- lifecycle,
- side effects,
- component isolation.

Rules:

- Keep state as local as possible.
- Lift state only when necessary.
- Avoid unnecessary global state.
- Prefer explicit data flow.
- Minimize unnecessary re-renders.

---

## State Management Rules

Before creating global state:

- ask if local component state is sufficient.

Use:

- local state for UI concerns,
- shared state only when truly necessary.

Avoid:

- overengineering state management,
- turning everything into global context,
- unnecessary complexity.

---

## Hooks Rules

Hooks should:

- isolate reusable logic,
- improve readability,
- reduce duplication.

Avoid:

- hooks that become giant service layers,
- hidden side effects,
- unclear naming.

Prefer:

- explicit hook responsibilities.

Examples:

- "useGithubStats"
- "useAuth"
- "useTheme"

---

## API Integration Rules

Frontend should never:

- directly contain backend business logic.

Responsibilities:

- fetch data,
- handle loading state,
- handle errors,
- present information clearly.

Rules:

- Keep API calls isolated inside services/hooks.
- Avoid scattered fetch logic across components.
- Handle:
  - loading,
  - error,
  - empty states properly.

---

## TailwindCSS Philosophy

Tailwind should create:

- consistency,
- reusable patterns,
- scalable styling systems.

Rules:

- Prefer composable utility patterns.
- Keep spacing and sizing consistent.
- Create visual rhythm.
- Avoid random utility chaos.

Avoid:

- unreadable utility explosions,
- inconsistent spacing systems,
- duplicated style patterns everywhere.

---

## UI / UX Philosophy

Frontend is product experience.

Always think about:

- responsiveness,
- interaction feedback,
- readability,
- navigation clarity,
- perceived performance,
- visual hierarchy.

Rules:

- Every animation should have purpose.
- Every interaction should feel responsive.
- Avoid visual overload.
- Prioritize clarity over flashy effects.

---

## React Three Fiber (R3F) Rules

R3F introduces rendering complexity and GPU considerations.

Always think about:

- render loops,
- GPU cost,
- unnecessary updates,
- object lifecycle,
- performance bottlenecks.

Rules:

- Keep scenes optimized.
- Avoid unnecessary re-renders.
- Dispose resources correctly.
- Use effects intentionally.
- Think about performance before adding complexity.

Avoid:

- excessive scene complexity,
- unnecessary particles/effects,
- uncontrolled animation loops.

---

## Performance Philosophy

Frontend performance matters.

Always think about:

- bundle size,
- render frequency,
- expensive computations,
- lazy loading,
- caching,
- animation cost.

Prefer:

- optimized rendering,
- code splitting,
- memoization only when justified,
- scalable rendering strategies.

Avoid:

- premature optimization,
- unnecessary complexity,
- rendering everything globally.

---

## Error Handling

Frontend should fail gracefully.

Always handle:

- API failures,
- loading states,
- invalid data,
- empty states,
- fallback rendering.

Never:

- leave broken UI silently,
- expose raw backend errors to users.

---

## Frontend Security

Frontend must respect security boundaries.

Rules:

- Never expose secrets.
- Never trust client-side validation alone.
- Sanitize user-generated content when necessary.
- Understand JWT/token lifecycle.
- Respect authentication boundaries.

---

## Frontend Observability

Frontend systems should remain debuggable.

Think about:

- request failures,
- rendering issues,
- UX bottlenecks,
- client-side errors.

Prefer:

- clear logs,
- isolated debugging,
- observable flows.

---

## Anti-Patterns

Avoid:

- giant pages with all logic inside,
- duplicated API calls,
- random state mutations,
- overusing global state,
- chaotic styling,
- prop drilling everywhere,
- tightly coupled UI logic,
- magic hidden behavior,
- unnecessary abstractions,
- premature architecture complexity.

---

## Senior Frontend Mindset

Always ask:

- Can this scale cleanly?
- Is the rendering flow predictable?
- Who owns this state?
- Will this component become hard to maintain?
- Is this abstraction justified?
- Will another engineer understand this quickly?
- Is the UX consistent?
- What breaks under scale or latency?
- Is performance being respected?

The goal is not only:

- making the UI work.

The goal is:

- maintainability,
- UX quality,
- rendering performance,
- scalability,
- developer experience,
- architectural clarity.