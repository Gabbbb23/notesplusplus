# MCP benchmark

Run the benchmark with:

```text
npm run benchmark:mcp
```

The harness connects the MCP server to an in-memory MCP client and a deterministic 120-note fixture. Each sampled tool runs five times. `estimatedTokens` is `ceil(text characters / 4)`, so it is a directional comparison rather than a tokenizer-specific bill. REST, disk, and embedding latency are outside this measurement.

## Before AXI changes

Captured on 2026-09-21 from the pre-change server:

| Measure | Result |
| --- | ---: |
| Tools | 15 |
| Tool catalog | 12,046 chars |
| Sampled text output | 8,558 chars |
| Estimated text tokens | 2,144 |
| Structured result coverage in the sampled fixture | 0/10 |

The last row was a harness limitation: the original synthetic search and pin fixtures did not satisfy their strict output schemas, so the MCP client discarded those structured results. The source code exposed structured output only on search and pins before this change.

## After AXI changes

Captured with the same command and fixture after the change:

| Measure | Result |
| --- | ---: |
| Tools | 15 |
| Tool catalog | 12,046 chars |
| Sampled text output | 6,825 chars |
| Estimated text tokens | 1,710 |
| Structured result coverage | 7/10 |

The sampled text payload fell by 20.2%: 8,558 to 6,825 chars, and 2,144 to 1,710 estimated tokens. Search fell from 547 to 393 estimated tokens. The 50-note list fell from 1,140 to 1,101. Pins fell from 286 to 45 because the default text now contains only slug, type, and title while the full note summaries remain in `structuredContent`.

The changed tools return structured data for search, list notes, tags, pins, inbox list, link checks, stats, and pin mutations. The default text uses TOON where the result is tabular and keeps the existing compact empty/error wording where that is shorter. Full REST-shaped data remains available to protocol clients through `structuredContent`.

## Verification

```text
npm run typecheck
npx vitest run test/mcp.test.ts --pool=forks --maxWorkers=1
```

Both passed after the change: TypeScript typecheck passed and all 30 MCP tests passed.
