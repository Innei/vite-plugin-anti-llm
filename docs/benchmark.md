# Exposure benchmark (planned)

The central research question is not “was text injected?” but “did the agent actually receive it?”

## Phases

1. Build clean and instrumented bundles with the same functional behavior.
2. Replay controlled source-search, AST-slicing and browser-only reverse-engineering workflows.
3. Log what was returned by tools and what (if anything) entered model context. Never log secrets.
4. Measure: canary build retention, canary context exposure, adherence to untrusted instructions, functional reconstruction success and token/time overhead.
5. Report sample size, model and tool versions, failure cases and confidence intervals.

## Acceptance gates

- Unit tests pass, plus full Vite integration tests when network dependencies are available.
- Source code and emitted bundles are executable without runtime errors introduced by instrumentation.
- Code-size overhead is bounded.
- Sourcemaps and chunk hashes are validated against built output.
- Do not represent a canary's presence in generated JS as proof that an AI agent encountered it.

