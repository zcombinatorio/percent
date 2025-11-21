# Per-Pool Authority Architecture Design

## Overview
Enable separate authority wallets per DAMM pool address with cryptographic attestation validation, allowing isolated wallet management for different token pools (e.g., separate wallets for ZC vs oogway).

## Original Architecture (Before Changes)

### Moderator Configuration
```typescript
interface IModeratorConfig {
  authority: Keypair;  // Single authority for ALL pools
  // ... other config
}
```

### Proposal Creation Flow
1. User creates proposal with optional `spotPoolAddress`
2. System validates wallet against whitelist for that pool
3. Proposal is created using moderator's single `config.authority`
4. Same authority signs all transactions regardless of pool

### Security Gaps (Resolved)
- ✅ Backend didn't validate `creatorWallet` with signature verification (FIXED: Added attestation signing)
- ✅ Single authority wallet used across all pools (FIXED: Per-pool authorities)
- ✅ No defense-in-depth validation (FIXED: Two-layer validation at percent + zcombinator)

## Target Architecture

### 1. Moderator Configuration Changes

**Update IModeratorConfig**
```typescript
interface IModeratorConfig {
  // BEFORE: authority: Keypair
  // AFTER: Map of poolAddress → authority keypair
  authorities: Map<string, Keypair>;

  // Alternative: Default + overrides pattern
  defaultAuthority: Keypair;
  poolAuthorities?: Map<string, Keypair>;

  // ... other config unchanged
}
```

**Selected Approach: Default + Overrides**
- Simpler migration path
- Backward compatible with single-pool moderators
- Explicit default fallback for unmapped pools

```typescript
interface IModeratorConfig {
  baseMint: PublicKey;
  quoteMint: PublicKey;
  baseDecimals: number;
  quoteDecimals: number;

  // Default authority (used if pool not in poolAuthorities map)
  defaultAuthority: Keypair;

  // Optional: Per-pool authority overrides
  poolAuthorities?: Map<string, Keypair>;

  rpcEndpoint: string;
  commitment?: Commitment;
  jitoUuid?: string;
}
```

### 2. Moderator Class Changes

**Add Authority Selection Method**
```typescript
class Moderator {
  /**
   * Get the appropriate authority keypair for a given pool
   * @param poolAddress - DAMM pool address (optional)
   * @returns Authority keypair for the pool, or default if not mapped
   */
  getAuthorityForPool(poolAddress?: string): Keypair {
    // If no pool-specific authorities configured, use default
    if (!this.config.poolAuthorities) {
      return this.config.defaultAuthority;
    }

    // If poolAddress not provided or not mapped, use default
    if (!poolAddress || !this.config.poolAuthorities.has(poolAddress)) {
      return this.config.defaultAuthority;
    }

    // Return pool-specific authority
    return this.config.poolAuthorities.get(poolAddress)!;
  }
}
```

**Update createProposal Method**
```typescript
// BEFORE
async createProposal(params: ICreateProposalParams): Promise<IProposal> {
  const proposalConfig: IProposalConfig = {
    // ...
    authority: this.config.authority,  // Single authority
    // ...
  };
}

// AFTER
async createProposal(params: ICreateProposalParams): Promise<IProposal> {
  // Select appropriate authority based on pool
  const authority = this.getAuthorityForPool(params.spotPoolAddress);

  const proposalConfig: IProposalConfig = {
    // ...
    authority: authority,  // Pool-specific authority
    // ...
  };
}
```

**Update depositBackToDamm Method**
```typescript
// Line 298+ in moderator.ts
async depositBackToDamm(poolAddress: string): Promise<IExecutionResult> {
  // Select authority for this specific pool
  const authority = this.getAuthorityForPool(poolAddress);

  // Use pool-specific authority for deposit transaction
  // ...
}
```

### 3. Router Changes (Moderator Creation)

**Update router.ts**
```typescript
// BEFORE: Single authority passed to moderator
const config: IModeratorConfig = {
  baseMint: new PublicKey(baseMint),
  quoteMint: new PublicKey(quoteMint),
  authority: authorityKeypair,  // Single keypair
  // ...
};

// AFTER: Default + optional pool overrides
const config: IModeratorConfig = {
  baseMint: new PublicKey(baseMint),
  quoteMint: new PublicKey(quoteMint),

  // Primary authority (backward compatible)
  defaultAuthority: authorityKeypair,

  // Optional: Pool-specific authorities from environment variables
  poolAuthorities: loadPoolAuthorities(),  // New helper function

  // ...
};
```

**New Environment Variable Pattern**
```bash
# Default authority (required)
AUTHORITY_KEYPAIR_PATH=./authority-default.json

# Pool-specific overrides (optional)
POOL_AUTHORITY_ZC=./authority-zc.json
POOL_AUTHORITY_OOGWAY=./authority-oogway.json

# Or as JSON strings
POOL_AUTHORITIES='{"CCZdbVvDqPN8DmMLVELfnt9G1Q9pQNt3bTGifSpUY9Ad": "./authority-zc.json", "2FCqTyvFcE4uXgRL1yh56riZ9vdjVgoP6yknZW3f8afX": "./authority-oogway.json"}'
```

### 4. Proposal Creation Route Changes

**Update proposals.ts**
```typescript
// Line 166 in createProposal: Already passes spotPoolAddress in params
const proposal = await moderatorService.createProposal(moderatorId, {
  title,
  description,
  transaction,
  proposalLength,
  spotPoolAddress: poolAddress,  // Already passed, will be used for authority selection
  totalSupply,
  twap: twapConfig,
  amm: ammConfig,
});
```

**No changes needed** - spotPoolAddress already passed to createProposal

### 5. Persistence Changes

**Database Schema**
No changes needed - authority is not stored in database, only derived from config

**Recovery After Restart**
- Load pool authorities from environment variables
- Reconstruct Map<string, Keypair> during moderator initialization
- Proposals will automatically use correct authority based on their spotPoolAddress

### 6. ICreateProposalParams Changes

**Already has spotPoolAddress** (line 63 in moderator.interface.ts)
```typescript
export interface ICreateProposalParams {
  // ...
  spotPoolAddress?: string;  // Already exists, will be used for authority selection
  // ...
}
```

## Migration Path

### Phase 1: Add Default + Overrides Support
1. Update `IModeratorConfig` interface
2. Add `getAuthorityForPool()` method to Moderator
3. Update `createProposal()` to use `getAuthorityForPool(params.spotPoolAddress)`
4. Update `depositBackToDamm()` to accept poolAddress parameter
5. Maintain backward compatibility: if poolAuthorities is undefined, use defaultAuthority

### Phase 2: Environment Variable Loading
1. Create `loadPoolAuthorities()` helper function
2. Support both individual env vars and JSON mapping
3. Update router.ts to load pool authorities

### Phase 3: Testing
1. Test with single authority (backward compat)
2. Test with multiple pool authorities
3. Verify correct authority used per pool

### Phase 4: Deployment
1. Deploy code changes
2. Update environment variables with pool-specific authorities
3. Restart servers to load new authorities

## Backward Compatibility

### Single-Pool Moderators
```typescript
const config: IModeratorConfig = {
  defaultAuthority: myKeypair,
  // poolAuthorities undefined - uses default for all pools
};
```

### Multi-Pool Moderators
```typescript
const config: IModeratorConfig = {
  defaultAuthority: fallbackKeypair,
  poolAuthorities: new Map([
    ['CCZdbVvDqPN8DmMLVELfnt9G1Q9pQNt3bTGifSpUY9Ad', zcKeypair],
    ['2FCqTyvFcE4uXgRL1yh56riZ9vdjVgoP6yknZW3f8afX', oogwayKeypair],
  ]),
};
```

## Files to Modify

1. **app/types/moderator.interface.ts**
   - Update `IModeratorConfig` interface (line 75-84)
   - Change `authority: Keypair` to `defaultAuthority: Keypair` + `poolAuthorities?: Map<string, Keypair>`

2. **app/moderator.ts**
   - Add `getAuthorityForPool(poolAddress?: string): Keypair` method
   - Update `createProposal()` to use `getAuthorityForPool(params.spotPoolAddress)` (line 166)
   - Update `depositBackToDamm()` to accept poolAddress and use `getAuthorityForPool(poolAddress)` (line 298+)
   - Update `info()` to show authority per pool or default (line 113)

3. **src/routes/router.ts**
   - Add `loadPoolAuthorities()` helper function
   - Update moderator initialization to use defaultAuthority + poolAuthorities
   - Load authorities from environment variables

4. **src/routes/proposals.ts**
   - Update `/damm/withdraw/build` to pass creatorWallet (already added via whitelist validation)
   - No other changes needed - spotPoolAddress already passed

5. **.env.example / .env**
   - Document new environment variable pattern

## Security Improvements

1. **Wallet Isolation**: Each pool has its own authority wallet
2. **Backend Whitelist**: Already implemented via damm-liquidity.ts changes
3. **Authority Separation**: Compromised authority for one pool doesn't affect others

## Testing Checklist

- [ ] Single authority (backward compat) works
- [ ] Multiple pool authorities work
- [ ] Default authority used for unmapped pools
- [ ] Correct authority selected per pool
- [ ] Database persistence/recovery works
- [ ] Withdrawal/deposit uses correct authority
- [ ] Environment variable loading works
