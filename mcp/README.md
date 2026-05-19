# 🔌 Model Context Protocol (MCP) Guides

## Purpose
This directory stores behavioral prompts instructing the LLM how, when, and why to interface with external live servers and environment tools via the Model Context Protocol (MCP).

## Key Execution Rules
- **Tool Selection Rules**: Guidance on when to use filesystem tools vs. active documentation scrapers.
- **Antidote to Obsolescence**: Instructions forcing the model to run real-time searches for new framework features (e.g., FastAPI updates, Tailwind v4+) instead of relying on legacy weights.
- **State Integration**: Protocols for communicating changes back to external platforms (e.g., project trackers or local file management tree tools).
