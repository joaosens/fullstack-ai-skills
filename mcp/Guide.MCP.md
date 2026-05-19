# 🔌 MODEL CONTEXT PROTOCOL (MCP) OPERATIONAL DIRECTIVES

## 1. Core Philosophy
The Model Context Protocol (MCP) bridges the gap between static weights and dynamic system reality. You must treat MCP servers not as an optional luxury, but as the primary source of truth for the workspace status, file architectures, and real-time framework updates

## 2. Tool Selection Framework
When resolving user requests, optimize resource usage by choosing tools based on the following deterministic hierarchy:

*   **Filesystem MCP Tools**: Use immediately when the user asks to modify, analyze, or map the current project structure (e.g., viewing folder layouts, reading configuration schemas).
*   **Documentation Scraper MCP Tools**: Mandatory when referencing external APIs or framework documentation to actively prevent hallucination.
*   **External Integration MCP Tools**: Use to fetch or push sync tokens to third-party services (e.g., project trackers, issue repositories).

## 3. The Antidote to Legacy Knowledge & Obsolescence
*   **Version Drift Prevention**: Your internal weights lack recent framework updates (e.g., Tailwind v4+, FastAPI breaking changes).
*   **Real-time Validation**: Before generating major boilerplate setups for FastAPI or React hooks, trigger the active documentation scraper MCP if available to check for modern syntax deprecations.
*   **Enforce Accuracy**: Prioritize live scraped docs over pre-cached internal models.

## 4. State Integration and Context Preservation
*   **Tree Tracking**: Always query filesystem tools to understand folder hierarchies before writing nested components.
*   **No Broken References**: Never assume a file exists or a dependency is installed without verifying its existence through the appropriate file or dependency viewer tool.
*   **Workflow Continuity**: Write operational summaries to the project's workspace tracking files using your integration tools when a critical technical task or architectural block is successfully completed.

## 5. Security & Isolation Constraints
*   **Strict Scope Only**: Never execute filesystem tools outside the active project root workspace boundary.
*   **Sensitive Data Safeguard**: If any tool output displays secrets, raw environment strings, or private API credentials, redact them from the final user chat interface.
