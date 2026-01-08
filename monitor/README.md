# Monitor
A TypeScript Express server that manages the lifecycle of decision markets running on Combinator's `Futarchy` program.

## Scope
This server handles automated tasks that must run periodically within a proposal's lifetime:

1. **Listen** for `ProposalLaunched` / `ProposalFinalized` events on-chain (only for tracked moderators)
2. **Crank** TWAP oracles every ~65 seconds for managed proposals
3. **Finalize**, **Redeem Liquidity**, & **Deposit Back** when proposals expire
4. **Broadcast** lifecycle events, trade events & price updates via SSE
5. **Record** prices, trades, and TWAP snapshots to database
6. **Log** failures for analysis / manual resolution

## Usage
For development:
```bash
npm run monitor:dev
```
Uses `tsx` with `--dev --no-auth` flags.

For production:
```bash
npm run monitor
```

**CLI Args**
| Arg         | Description                                                     |
|-------------|-----------------------------------------------------------------|
| `--port`    | Custom port (default: 4000)                                     |
| `--no-auth` | Disable API key authentication                                  |
| `--dev`     | Writes to dev tables                                            |
| `--listen`  | Listen-only mode (no DB writes, no cranking, no finalization)   |

## Endpoints

### Public

| Endpoint | Description |
|----------|-------------|
| `GET /events` | SSE stream for real-time updates |
| `GET /api/history/:pda/twap` | TWAP history |
| `GET /api/history/:pda/trades` | Trade history |
| `GET /api/history/:pda/volume` | Volume data |
| `GET /api/history/:pda/chart` | Chart data |

### Protected (API Key Required)

#### `GET /status`
Returns monitor status and tracked proposals.

```json
{
  "monitored": 2,
  "proposals": [
    {
      "pda": "ABC123...",
      "id": 1,
      "endsAt": "2025-01-15T12:00:00.000Z",
      "timeRemaining": 3600000
    }
  ]
}
```

#### `GET /logs?file={lifecycle|server|twap|price}&limit=50`
Fetch error logs (newest first, default limit 50, max 500).

#### `POST /clean?file={lifecycle|server|twap|price}`
Clear error logs. Omit `file` param to clear all.

## Architecture

```
                        On-chain Events
                              │
                              ▼
┌─────────────────────────────────────────────────────────────────┐
│                            MONITOR                              │
│                                                                 │
│   ┌─────────────┐                                               │
│   │   Monitor   │ emits: proposal:added, proposal:removed, swap │
│   └──────┬──────┘                                               │
│          │                                                      │
│          ▼                                                      │
│   ┌─────────────────────────────────────────────────────────┐   │
│   │  ┌─────────────┐   ┌──────────────┐  ┌─────────────┐    │   │
│   │  │  Lifecycle  │   │    TWAP      │  │    Price    │    │   │
│   │  │ API + SSE   │   │API + SSE + DB│  │  SSE + DB   │    │   │
│   │  └─────────────┘   └──────────────┘  └─────────────┘    │   │
│   └─────────────────────────────────────────────────────────┘   │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Services**

| Service   | Trigger              | Action                                                           |
|-----------|----------------------|------------------------------------------------------------------|
| Lifecycle | Proposal added/removed | Broadcasts SSE events, schedules finalization flow             |
| TWAP      | Every 65s (live)     | Cranks TWAP oracle, broadcasts updates, records to DB            |
| Price     | Swap events          | Broadcasts prices & trades via SSE, records to DB                |

## SSE Events

The `/events` endpoint broadcasts the following events:

| Event | Payload |
|-------|---------|
| `CONNECTED` | `{ clientId }` |
| `PROPOSAL_TRACKED` | `{ proposalPda, proposalId, name, numOptions, pools, endTime, createdAt, moderatorPda, baseMint, quoteMint, daoPda?, spotPool?, timestamp }` |
| `PROPOSAL_REMOVED` | `{ proposalPda, proposalId, name, timestamp }` |
| `PRICE_UPDATE` | `{ proposalPda, market, price, marketCapUsd, timestamp }` |
| `COND_SWAP` | `{ proposalPda, pool, market, trader, swapAToB, amountIn, amountOut, txSignature, timestamp }` |
| `TWAP_UPDATE` | `{ proposalPda, pools: [{ pool, twap }], timestamp }` |

- `market = -1` indicates spot pool price, `market >= 0` indicates conditional pool index

### Testing SSE

```bash
npm run monitor:listen
```
