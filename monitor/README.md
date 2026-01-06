# Proposal Cranker
A TS Express Server that manages the lifecycle of decision markets running on Combinator's `Futarchy` program.

## Scope
This should be a replacement for most of `./app/*`,  `./server/*`, & `router` within `./src/`. 
This server should offer support to our on-chain programs. It should handle any tasks that must run periodically and automatically within a proposals lifetime.

This is opposed to another server, currently in `./src/*` and yet to be revamped, that should handle standard HTTP client & ui traffic. 

1. *Listen* for new proposal creation "ProposalLaunched" on-chain. Only monitor proposals created via Combinator's API. 
2. *Crank* TWAP ~ every minute for managed proposals.
3. *Finalize* & *Redeem Liquidity* for managed proposals.
4. *Broadcast* trade-events & price-updates for spot & cond. markets using SSE. ! Replacing the current WS `./server/*`
5. *Persist* on restart
6. *Log* failures for future analysis / manual resolution.

## Endpoints (Key-gated)
`/status`: Prints basic stats, i.e., what proposals are currently being managed & failures
`/logs`: Fetch JSON logs
`/clean`: Clears logs & persistance. 

## Usage
For development, run
```
npm run monitor:dev
```
which uses `tsx` with `--no-auth` to disable API key auth & `--dev` to write to dev db tables.

For production, run
```
npm run build && npm run monitor
```

**CLI Args**
| Arg         | Description                      |
|-------------|----------------------------------|
| `--port`    | Custom port (default: 4000)      |
| `--no-auth` | Disable API key authentication   |
| `--dev`     | Use dev database tables          |

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         MONITOR                                 │
│                                                                 │
│   ┌─────────────┐                                               │
│   │   Monitor   │◄──── On-chain Events                          │
│   │             │      (ProposalLaunched / ProposalFinalized)   │
│   └──────┬──────┘                                               │
│          │                                                      │
│          │ subscribes                                           │
│          ▼                                                      │
│   ┌──────────────────────────────────────────────────────┐      │
│   │                     SERVER                           │      │
│   │                                                      │      │
│   │  ┌────────────────┐  ┌────────────┐  ┌────────────┐  │      │
│   │  │   Lifecycle    │  │    TWAP    │  │   Price    │  │      │
│   │  │    Service     │  │   Service  │  │  Service   │  │      │
│   │  └───────┬────────┘  └─────┬──────┘  └─────┬──────┘  │      │
│   │          │                 │               │         │      │
│   └──────────┼─────────────────┼───────────────┼─────────┘      │
│              │                 │               │                │
└──────────────┼─────────────────┼───────────────┼────────────────┘
               │                 │               │
               ▼                 ▼               ▼
        ┌────────────┐    ┌────────────┐   ┌────────────┐
        │ Combinator │    │  On-chain  │   │    SSE     │
        │    API     │    │   TWAP     │   │  Clients   │
        └────────────┘    └────────────┘   └────────────┘
```

**Services**

| Service   | Trigger              | Action                                        |
|-----------|----------------------|-----------------------------------------------|
| Lifecycle | Proposal launched    | Queues `finalize` & `redeem-liquidity` calls  |
| TWAP      | Every minute (live)  | Cranks TWAP oracle                            |
| Price     | Market price changes | Broadcasts spot & conditional prices via SSE  |

