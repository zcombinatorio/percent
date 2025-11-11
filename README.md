# Percent Protocol

A governance and prediction market protocol on Solana built with TypeScript. The system enables users to create proposals with integrated prediction markets for pass/fail outcomes, providing price discovery for governance decisions.

## Features

- **Conditional Token Model**: 1:1 split/merge mechanism for binary outcome markets
- **Dual AMM Structure**: Separate AMMs for pass/fail markets using Meteora CP-AMM
- **TWAP Oracle**: Time-weighted average price tracking for outcome determination
- **Vault System**: Token escrow and conditional token lifecycle management
- **Real-time Updates**: WebSocket-based price feeds and trade notifications
- **Trading Interface**: Modern UI built with Next.js 15 and React with Turbopack
- **Interactive Charts**: TradingView Advanced Charts integration for market visualization
- **Advanced UI Components**:
  - ChartBox - Real-time market charting
  - CountdownBox - Proposal deadline tracking
  - DepositCard - Token deposit interface
  - DescriptionBox - Proposal details display
  - FlipCard - Animated card transitions
  - ModeToggle - Interface mode switching
  - PFGBox - Pass/Fail/Guarantee indicators
  - PageHeaderBox - Consistent page headers
- **Mobile Support**: Responsive design with mobile optimizations
- **Wallet Integration**: Privy-powered Web3 authentication

## Architecture

The protocol consists of three main components:

1. **Backend API** (`/src`, `/app`) - REST API and core protocol logic
2. **WebSocket Server** (`/server`) - Real-time price feeds and notifications
3. **Frontend UI** (`/ui`) - Trading interface and analytics dashboard

See [CLAUDE.md](./CLAUDE.md) for detailed architecture documentation.

## Prerequisites

- Node.js 18+ and pnpm
- PostgreSQL 14+
- Solana CLI tools
- A Solana RPC provider (Helius, QuickNode, or public RPC)

## Quick Start

### 1. Clone the Repository

```bash
git clone https://github.com/percent-markets/percent-core.git
cd percent-core
```

### 2. Install Dependencies

```bash
pnpm install
cd ui && pnpm install
```

### 3. TradingView Charts Setup

This project uses TradingView's Advanced Charts library. **You'll need to obtain your own license:**

1. **Request free access** from TradingView: https://www.tradingview.com/advanced-charts/
2. **Follow setup instructions** in [ui/SETUP_TRADINGVIEW.md](./ui/SETUP_TRADINGVIEW.md)

**Note:** The application will work without charts, but chart functionality will be unavailable until you complete this step. The library is free for public-facing web projects.

### 4. Environment Configuration

Create `.env` file in the root directory:

```bash
cp .env.example .env
```

Edit `.env` and configure:

```env
# Server Configuration
PORT=3001
API_KEY=your-secret-api-key-here  # Set to any secret value you choose
WS_PORT=9091                        # WebSocket server port

# Database
DB_URL=postgresql://username:password@localhost:5432/percent_db
DB_LISTEN_URL=postgresql://username:password@localhost:5432/percent_db  # Usually same as DB_URL

# For AWS RDS with SSL:
# DB_URL=postgresql://user:pass@host.rds.amazonaws.com:5432/dbname?sslmode=verify-full&sslrootcert=/path/to/us-east-1-bundle.pem

# Solana
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_KEYPAIR_PATH=./wallet.json

# Encryption (generate with: node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
ENCRYPTION_KEY=your-encryption-key-here
```

Create `ui/.env.local` file:

```bash
cp ui/.env.example ui/.env.local
```

Edit `ui/.env.local`:

```env
NEXT_PUBLIC_RPC_URL=https://api.mainnet-beta.solana.com
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WS_PRICE_URL=ws://localhost:9091
NEXT_PUBLIC_PRIVY_APP_ID=your-privy-app-id
```

### 5. Database Setup

Create the database and run migrations:

```bash
createdb percent_db
psql percent_db < schema/schema.sql
```

### 6. Generate Solana Keypair

```bash
solana-keygen new --outfile wallet.json
```

⚠️ **NEVER commit wallet.json to version control!**

### 7. Start the Services

**Terminal 1 - Backend API:**
```bash
pnpm dev
```

**Terminal 2 - WebSocket Server:**
```bash
pnpm start:ws
```

**Terminal 3 - Frontend UI:**
```bash
cd ui
pnpm dev
```

Access the application at http://localhost:3000

## Development

### Project Structure

```
percent/
├── app/              # Core protocol logic (Moderator, Proposal, AMM, Vault, TWAP)
├── src/              # REST API routes and middleware
├── server/           # WebSocket server for real-time updates
├── ui/               # Next.js frontend application
│   ├── components/   # React components (ChartBox, CountdownBox, DepositCard, etc.)
│   ├── hooks/        # Custom React hooks
│   ├── lib/          # Utility functions and trading logic
│   ├── providers/    # Context providers (Privy, etc.)
│   └── services/     # API and WebSocket clients
├── scripts/          # Utility scripts
└── CLAUDE.md         # Detailed architecture documentation
```

### Key Commands

```bash
# Backend
pnpm dev              # Start development server with hot reload
pnpm build            # Compile TypeScript
pnpm test             # Run tests

# Frontend
cd ui
pnpm dev              # Start Next.js dev server with Turbopack
pnpm build            # Build for production
pnpm start            # Start production server
```

## Configuration

### Environment Variables

See `.env.example` for all available configuration options.

**Critical variables:**
- `SOLANA_RPC_URL` - Your Solana RPC endpoint
- `DB_URL` - PostgreSQL connection string
- `ENCRYPTION_KEY` - For encrypting sensitive database data
- `API_KEY` - For protecting admin endpoints

### Network Selection

The application automatically detects mainnet vs devnet based on the RPC URL:
- Mainnet: Uses Jupiter aggregator for swaps
- Devnet: Uses simulated 1:1 exchange rates

## Testing

```bash
# Run all tests
pnpm test

# Run specific test file
pnpm test path/to/test.ts
```

## Deployment

### Production Build

```bash
# Build backend
pnpm build

# Build frontend
cd ui
pnpm build
```

### Environment Setup

1. Set all production environment variables
2. Use a production-grade PostgreSQL instance
3. Configure a reliable RPC provider (not public RPC)
4. Set up SSL certificates for HTTPS
5. Configure CORS appropriately
6. Obtain and configure TradingView Advanced Charts license

## Security

⚠️ **Security Notice**: This software has not been formally audited. Use at your own risk. We recommend thorough testing before production use.

**Best Practices:**
- Never commit `.env` files or `wallet.json`
- Rotate API keys and encryption keys regularly
- Use a hardware wallet or secure key management for production
- Enable rate limiting on public endpoints
- Monitor for suspicious activity

### Known Vulnerabilities

⚠️ **bigint-buffer (Solana Ecosystem Issue)**
- **Status**: Known high-severity vulnerability, no patch available
- **Impact**: Production dependency via `@solana/spl-token`
- **Context**: This affects the entire Solana ecosystem and is present in most projects using SPL tokens
- **Mitigation**: We monitor for updates from Solana Foundation and implement additional validation layers

See [SECURITY.md](./SECURITY.md) for detailed vulnerability information and reporting guidelines.

## Contributing

Contributions are welcome! Please read [CONTRIBUTING.md](./CONTRIBUTING.md) before submitting pull requests.

## License

This project is licensed under the GNU Affero General Public License v3.0 (AGPL-3.0). See [LICENSE](./LICENSE) for details.

**Key Points:**
- Open source and free to use
- Modifications must be open sourced
- Network use triggers license obligations
- Commercial use allowed

## Third-Party Licenses

This project uses:
- **TradingView Charting Library** - Proprietary (users must obtain their own license)
- See `package.json` files for other dependencies and their licenses

## Documentation

- [CLAUDE.md](./CLAUDE.md) - Detailed architecture and implementation guide
- [ui/SETUP_TRADINGVIEW.md](./ui/SETUP_TRADINGVIEW.md) - TradingView library setup
- [CONTRIBUTING.md](./CONTRIBUTING.md) - Contribution guidelines
- [SECURITY.md](./SECURITY.md) - Security policy and vulnerability reporting

## Support

- **Issues**: https://github.com/percent-markets/percent-core/issues
- **Documentation**: See CLAUDE.md for comprehensive architecture docs
- **Discussions**: https://github.com/percent-markets/percent-core/discussions

## Acknowledgments

- Built with [Meteora CP-AMM SDK](https://github.com/meteora-ag/cp-amm-sdk)
- Charts powered by [TradingView Advanced Charts](https://www.tradingview.com/advanced-charts/)
- Wallet integration via [Privy](https://www.privy.io/)
- Built with [Next.js 15](https://nextjs.org/) and [Turbopack](https://turbo.build/pack)
