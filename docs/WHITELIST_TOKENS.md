# Whitelisting Tokens

To whitelist tokens and dev wallet addresses (people who can launch decision markets for that token), modify `src/config/whitelist.ts`:

## 1. POOL_WHITELIST (who can create DMs)
```typescript
'NEW_POOL_ADDRESS': ['wallet1', 'wallet2'],
```

## 2. POOL_METADATA (pool details)
```typescript
'NEW_POOL_ADDRESS': {
  poolAddress: 'NEW_POOL_ADDRESS',
  name: 'shirtless',
  baseMint: 'SHIRTLESS_TOKEN_MINT',
  quoteMint: 'So11111111111111111111111111111111111111112',
  baseDecimals: 6,
  quoteDecimals: 9,
  moderatorId: 4, // Unique ID for this token's moderator instance
  icon: 'https://...', // Optional: Token icon URL
},
```

## 3. Moderator ID

Each token requires a **unique `moderatorId`** to manage its own set of proposals:

- **ZC (default)**: `moderatorId: 2`
- **oogway**: `moderatorId: 3`
- **Your new token**: Choose the next available ID (e.g., `4`)

The moderator ID:
- Isolates proposals by token (each token has its own proposal counter)
- Stored in database: `moderator_state` table with `moderator_id` column
- Must be unique across all tokens
- Cannot be changed after proposals are created

### How to set up a new token's moderator:

1. Choose an unused moderator ID (check existing entries in `POOL_METADATA`)
2. Add the ID to your pool metadata config
3. The moderator will auto-initialize in the database on first proposal creation
4. Each moderator tracks its own `proposal_counter` independently

After adding these entries, the routes `/shirtless`, `/shirtless/create`, `/shirtless/history`, and `/shirtless/rank` will automatically work.
