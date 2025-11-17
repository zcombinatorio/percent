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
},
```

After adding these entries, the routes `/shirtless`, `/shirtless/create`, `/shirtless/history`, and `/shirtless/rank` will automatically work.
