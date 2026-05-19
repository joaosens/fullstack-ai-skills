# ⚖️ Rules Config

## Purpose
This directory contains the foundational guardrails, system prompts, and architectural restrictions for the AI agent. These files are injected directly into the system prompt configuration to maintain absolute positioning over the AI's behavior.

## Core Directives
- **Zero Hallucination**: Strict enforcement of architectural patterns.
- **System-Level Control**: Holds the global `GUIDE` file to define the agent's persona.
- **Architectural Guardrails**: Enforces thin controllers, isolated services, and decoupled infrastructure boundaries.

## Configuration Mappings
Files inside this directory must use `systemPrompt: true` and `invokable: false` within their frontmatter blocks.
