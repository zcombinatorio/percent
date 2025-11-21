# Whitelisting New Tokens - Complete Setup Guide

This guide covers everything needed to add a new token to the decision market system with proper security isolation.

## Overview

Adding a new token requires:
1. Creating a dedicated manager wallet (authority keypair)
2. Configuring the wallet in both percent and zcombinator
3. Updating whitelists with authorized users
4. Adding pool metadata for routing

---

## Step 1: Create Manager Wallet

Each token needs its own **manager/authority wallet** for security isolation. If one token's wallet is compromised, other tokens remain safe.

### Generate Wallet Keypair

```bash
# Generate new Solana wallet
solana-keygen new --outfile wallet-newtoken.json

# Get the public key
solana-keygen pubkey wallet-newtoken.json
# Copy this public key - you'll need it for Step 3
```

**Save this wallet file securely!** This wallet will:
- Sign withdrawal transactions from the DAMM pool
- Hold tokens during active decision markets
- Automatically deposit back to the pool after DM finalization

---

## Step 2: Configure Manager Wallet in Backend

### 2a. percent Configuration

Add environment variable pointing to the wallet file:

**File:** `percent/.env`

```bash
# Existing wallets
POOL_AUTHORITY_ZC_PATH=./wallet-zc.json
POOL_AUTHORITY_OOGWAY_PATH=./wallet-oogway.json

# NEW: Add your token's wallet
POOL_AUTHORITY_NEWTOKEN_PATH=./wallet-newtoken.json
```

**File:** `percent/app/services/router.service.ts`

Update the `poolMapping` object (lines 44-47):

```typescript
const poolMapping: Record<string, string> = {
  'ZC': 'CCZdbVvDqPN8DmMLVELfnt9G1Q9pQNt3bTGifSpUY9Ad',
  'OOGWAY': '2FCqTyvFcE4uXgRL1yh56riZ9vdjVgoP6yknZW3f8afX',
  'NEWTOKEN': 'YOUR_NEW_POOL_ADDRESS_HERE',  // ADD THIS LINE
};
```

### 2b. zcombinator Configuration

Add manager wallet public key as environment variable:

**File:** `zcombinator/.env`

```bash
# Existing manager wallets
MANAGER_WALLET_ZC=9x7FvP...  # Public key
MANAGER_WALLET_OOGWAY=3h8Kq...  # Public key

# NEW: Add your token's manager wallet public key
MANAGER_WALLET_NEWTOKEN=YOUR_PUBLIC_KEY_FROM_STEP1
```

**File:** `zcombinator/ui/routes/damm-liquidity.ts`

Update the `getManagerWalletForPool()` function (lines 133-160):

```typescript
function getManagerWalletForPool(poolAddress: string): string {
  const poolToEnvVar: Record<string, string> = {
    'CCZdbVvDqPN8DmMLVELfnt9G1Q9pQNt3bTGifSpUY9Ad': 'MANAGER_WALLET_ZC',
    '2FCqTyvFcE4uXgRL1yh56riZ9vdjVgoP6yknZW3f8afX': 'MANAGER_WALLET_OOGWAY',
    'YOUR_NEW_POOL_ADDRESS_HERE': 'MANAGER_WALLET_NEWTOKEN',  // ADD THIS LINE
  };

  // ... rest of function
}
```

---

## Step 3: Update Whitelists

### 3a. percent Whitelist (User Authorization)

**File:** `percent/src/config/whitelist.ts`

Add pool whitelist entry with **manager wallet public key + authorized users**:

```typescript
export const POOL_WHITELIST: Record<string, string[]> = {
  // Existing pools...
  'CCZdbVvDqPN8DmMLVELfnt9G1Q9pQNt3bTGifSpUY9Ad': [...],
  '2FCqTyvFcE4uXgRL1yh56riZ9vdjVgoP6yknZW3f8afX': [...],

  // NEW: Your token's pool
  'YOUR_NEW_POOL_ADDRESS_HERE': [
    'YOUR_PUBLIC_KEY_FROM_STEP1',      // ⚠️ REQUIRED: Manager wallet must be whitelisted
    '79TLv4oneDA1tDUSNXBxNCnemzNmLToBHYXnfZWDQNeP',  // User wallet 1
    'BXc9g3zxbQhhfkLjxXbtSHrfd6MSFRdJo8pDQhW95QUw',  // User wallet 2
    // Add more authorized user wallets as needed
  ],
};
```

**⚠️ CRITICAL:** The manager wallet public key MUST be in this list!

### 3b. zcombinator Whitelist (Defense-in-Depth)

**File:** `zcombinator/ui/lib/whitelist.ts`

Add the **exact same whitelist entry**:

```typescript
export const POOL_WHITELIST: Record<string, string[]> = {
  // Existing pools...
  'CCZdbVvDqPN8DmMLVELfnt9G1Q9pQNt3bTGifSpUY9Ad': [...],
  '2FCqTyvFcE4uXgRL1yh56riZ9vdjVgoP6yknZW3f8afX': [...],

  // NEW: Your token's pool (MUST match percent whitelist)
  'YOUR_NEW_POOL_ADDRESS_HERE': [
    'YOUR_PUBLIC_KEY_FROM_STEP1',      // ⚠️ REQUIRED: Manager wallet
    '79TLv4oneDA1tDUSNXBxNCnemzNmLToBHYXnfZWDQNeP',  // User 1
    'BXc9g3zxbQhhfkLjxXbtSHrfd6MSFRdJo8pDQhW95QUw',  // User 2
  ],
};
```

**Why duplicate?** Defense-in-depth security. Both APIs validate independently.

---

## Step 4: Add Pool Metadata

**File:** `percent/src/config/whitelist.ts`

Add pool metadata for routing and display:

```typescript
export const POOL_METADATA: Record<string, PoolMetadata> = {
  // Existing pools...

  // NEW: Your token
  'YOUR_NEW_POOL_ADDRESS_HERE': {
    poolAddress: 'YOUR_NEW_POOL_ADDRESS_HERE',
    ticker: 'newtoken',  // ⚠️ MUST BE UNIQUE! Used for routing (/newtoken)
    baseMint: 'YOUR_TOKEN_MINT_ADDRESS',
    quoteMint: 'So11111111111111111111111111111111111111112',  // SOL
    baseDecimals: 6,  // Check your token's decimals
    quoteDecimals: 9,  // SOL always 9
    moderatorId: 4,  // Next available ID (ZC=2, oogway=3, so use 4)
    icon: 'https://your-token-icon-url.png',  // Optional
  },
};
```

**⚠️ CRITICAL:** The `ticker` field MUST be UNIQUE! It's used for routing:
- Frontend routes: `/newtoken`, `/newtoken/create`, `/newtoken/history`
- Check existing tickers before choosing one

---

## Step 5: Moderator ID

Each token needs a unique `moderatorId` to isolate proposals:

- **ZC**: `moderatorId: 2`
- **oogway**: `moderatorId: 3`
- **Your new token**: Choose next available (e.g., `4`)

The moderator:
- Auto-initializes in database on first proposal creation
- Tracks independent `proposal_counter` per token
- Cannot be changed after creation

---

## Step 6: Verify Configuration

### Checklist Before Deploying

- [ ] Manager wallet keypair created (`wallet-newtoken.json`)
- [ ] Manager wallet public key copied
- [ ] `POOL_AUTHORITY_NEWTOKEN_PATH` in percent `.env`
- [ ] `MANAGER_WALLET_NEWTOKEN` in zcombinator `.env`
- [ ] `poolMapping` updated in `router.service.ts`
- [ ] `getManagerWalletForPool()` updated in `damm-liquidity.ts`
- [ ] Manager wallet public key in **both** whitelists
- [ ] User wallets added to **both** whitelists
- [ ] `POOL_METADATA` entry added with unique ticker
- [ ] Unique `moderatorId` assigned
- [ ] Manager wallet funded with SOL for transaction fees

---

## Example: Adding "SHIRTLESS" Token

```typescript
// 1. Generate wallet
// solana-keygen new --outfile wallet-shirtless.json
// Public key: ShRt1essABC123... (example)

// 2. percent/.env
POOL_AUTHORITY_SHIRTLESS_PATH=./wallet-shirtless.json

// 3. zcombinator/.env
MANAGER_WALLET_SHIRTLESS=ShRt1essABC123...

// 4. router.service.ts
const poolMapping = {
  'SHIRTLESS': '8qWx3PQrZKm9VNYu4ThJ6Kp5XmD2Hf7Lb1Rj3Cw6Sv9T',
};

// 5. damm-liquidity.ts
const poolToEnvVar = {
  '8qWx3PQrZKm9VNYu4ThJ6Kp5XmD2Hf7Lb1Rj3Cw6Sv9T': 'MANAGER_WALLET_SHIRTLESS',
};

// 6. Both whitelists
'8qWx3PQrZKm9VNYu4ThJ6Kp5XmD2Hf7Lb1Rj3Cw6Sv9T': [
  'ShRt1essABC123...',  // Manager wallet
  '79TLv4oneDA1tDUSNXBxNCnemzNmLToBHYXnfZWDQNeP',
],

// 7. POOL_METADATA
'8qWx3PQrZKm9VNYu4ThJ6Kp5XmD2Hf7Lb1Rj3Cw6Sv9T': {
  poolAddress: '8qWx3PQrZKm9VNYu4ThJ6Kp5XmD2Hf7Lb1Rj3Cw6Sv9T',
  ticker: 'shirtless',
  baseMint: 'SHRT1ess...',
  quoteMint: 'So11111111111111111111111111111111111111112',
  baseDecimals: 6,
  quoteDecimals: 9,
  moderatorId: 4,
  icon: 'https://shirtless.com/icon.png',
},
```

Routes automatically available:
- `/shirtless` - Trading interface
- `/shirtless/create` - Create DM
- `/shirtless/history` - Price history
- `/shirtless/rank` - Leaderboard

---

## Team Communication Template

When asking the team to add a new token, provide:

**Subject:** Add [TOKEN_NAME] to Decision Markets

**Request:**
```
Please add support for [TOKEN_NAME] with the following setup:

1. Generate manager wallet:
   - Create new Solana keypair: wallet-[token].json
   - Send me the PUBLIC KEY (not the private key!)

2. Fund the wallet:
   - Transfer 0.5 SOL for transaction fees
   - Wallet address: [WILL_PROVIDE_AFTER_GENERATION]

3. Configuration needed:
   - Pool address: [YOUR_POOL_ADDRESS]
   - Token mint: [TOKEN_MINT_ADDRESS]
   - Decimals: [TOKEN_DECIMALS]
   - Ticker: [UNIQUE_TICKER] (for routing: /[ticker])
   - Icon URL: [OPTIONAL_ICON_URL]
   - Authorized wallets: [LIST_OF_USER_PUBLIC_KEYS]

4. Deploy to:
   - percent backend
   - zcombinator API

Once deployed, I'll test by creating a test DM.
```

---

## Summary

To whitelist a new token:
1. ✅ Generate dedicated manager wallet
2. ✅ Configure wallet in both backends (percent + zcombinator)
3. ✅ Add manager wallet public key to BOTH whitelists
4. ✅ Add authorized user wallets to BOTH whitelists
5. ✅ Add pool metadata with unique ticker and moderatorId
6. ✅ Fund manager wallet with SOL
