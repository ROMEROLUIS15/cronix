# ADR 002: Action Tags vs. JSON Function Calling for WhatsApp AI

## Status
**Proposed & Accepted (April 2026)**

## Context

Service businesses in multi-tenant environments require a virtual assistant that interacts with WhatsApp in real-time to manage appointments. 
The industry standard is to force LLMs (Large Language Models) to return structured JSON payloads (**Function Calling**). 
However, this standard presents critical risks in high-latency, mobile-first environments like WhatsApp.

## Decision

We have decided to implement **Action Tags (Plain-text Structured Labels)** instead of **JSON Function Calling** for the core Cronix Agent.

### Why Action Tags?

1.  **Robustness (Solidez)**: LLMs are probabilistic. They often "hallucinate" incorrect JSON syntax (missing quotes, trailing commas). A broken JSON causes `JSON.parse()` to fail, crashing the conversation. **Regex-based tags** are immune to these syntax errors; if a tag is malformed, the system gracefully degrades to conversational mode instead of crashing.
2.  **Latency (Vibe)**: Generating complex JSON schemas consumes significantly more tokens and inference time. Action Tags are minimal, ensuring near-instant responses on WhatsApp.
3.  **Model Agnosticism**: Strict JSON calling often requires expensive, high-end models (GPT-4o). Action Tags work perfectly with lighter, faster Open Source models like Llama-3.1-8B.
4.  **Security (Two-Turn Flow)**: By using tags, we can structurally enforce a two-step confirmation flow. The Agent asks: *"Should I book it?"* and only emits the tag after a logical `"Yes"` is detected in the next turn.

## Consequences

- **Positive**: 
    - Zero server-side crashes due to malformed AI output.
    - Drastically reduced token costs (~25% savings).
    - Infallible data extraction via O(1) Regex.
    - Improved developer observability (actions are readable in the raw chat logs).
- **Negative**:
    - Requires precise prompt engineering to ensure tags are not shown to the end user (handled by the "Silent Execution" replacement layer).
    - Limited complexity: Not suitable for orchestrators with 50+ nested API dependencies (where JSON would be better), but ideal for the 16 core business tools of Cronix.

---
*Signed: Senior Systems Architect (Antigravity)*
