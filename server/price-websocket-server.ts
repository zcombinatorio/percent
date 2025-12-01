/*
 * Copyright (C) 2025 Spice Finance Inc.
 *
 * This file is part of Z Combinator.
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Affero General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU Affero General Public License for more details.
 *
 * You should have received a copy of the GNU Affero General Public License
 * along with this program. If not, see <https://www.gnu.org/licenses/>.
 */

import { WebSocketServer } from 'ws';
import type { WebSocket } from 'ws';
import { getMainnetPriceService } from './mainnet-price-service';
import { Client } from 'pg';
import * as dotenv from 'dotenv';

dotenv.config();

interface PriceData {
  tokenAddress: string;
  price: number;
  timestamp: number;
  source?: 'dexscreener' | 'mainnet-amm';
}

interface ClientSubscription {
  tokens: Set<string>;
  poolAddresses?: Map<string, string>; // token -> pool mapping
  proposals: Set<number>; // subscribed proposal IDs for trades
}

interface TradeEvent {
  type: 'TRADE';
  proposalId: number;
  market: number;  // Market index: 0=fail, 1=pass (or higher for multi-market)
  userAddress: string;
  isBaseToQuote: boolean;
  amountIn: string;
  amountOut: string;
  price: string;
  txSignature: string | null;
  timestamp: string;
}

interface ProposalCacheEntry {
  actualSupply: number; // Total supply adjusted for decimals
  fetched: number;
}

class PriceWebSocketServer {
  private wss: WebSocketServer;
  private clients: Map<WebSocket, ClientSubscription> = new Map();
  private prices: Map<string, PriceData> = new Map();
  private priceUpdateInterval: NodeJS.Timeout | null = null;
  private subscribedTokens: Set<string> = new Set();
  private mainnetService = getMainnetPriceService();
  private mainnetPools: Set<string> = new Set(); // Track which pools are on mainnet
  private pgClient: Client | null = null;
  private subscribedProposals: Set<number> = new Set();
  private solPrice: number = 150; // Default SOL price in USD
  private SOL_ADDRESS = 'So11111111111111111111111111111111111111112';

  // Proposal cache for market cap calculations
  private proposalCache: Map<number, ProposalCacheEntry> = new Map();
  private readonly PROPOSAL_CACHE_TTL = 60000; // 1 minute

  constructor(port: number = 9091) {
    this.wss = new WebSocketServer({ port });
    console.log(`Price & Trade WebSocket server started on port ${port}`);
    this.setupServer();
    this.startPriceUpdates();
    this.setupDatabaseListener();
  }

  private setupServer() {
    // Start fetching SOL price
    this.fetchSolPrice();
    setInterval(() => this.fetchSolPrice(), 30000); // Update every 30 seconds

    this.wss.on('connection', (ws: WebSocket) => {
      console.log('New client connected');
      
      // Initialize client subscription
      this.clients.set(ws, { tokens: new Set(), proposals: new Set() });

      ws.on('message', (message: string) => {
        try {
          const data = JSON.parse(message.toString());
          this.handleClientMessage(ws, data);
        } catch (error) {
          console.error('Error parsing client message:', error);
        }
      });

      ws.on('close', () => {
        console.log('Client disconnected');
        this.clients.delete(ws);
        this.updateSubscribedTokens();
      });

      ws.on('error', (error) => {
        console.error('Client WebSocket error:', error);
      });

      // Send initial prices for any cached data
      this.sendCachedPrices(ws);
    });
  }

  private handleClientMessage(ws: WebSocket, data: any) {
    const client = this.clients.get(ws);
    if (!client) return;

    switch (data.type) {
      case 'SUBSCRIBE':
        if (data.tokens && Array.isArray(data.tokens)) {
          console.log('Client subscribing to tokens:', data.tokens.length);
          // Handle simple token array or token objects with pool info
          data.tokens.forEach((tokenOrConfig: string | { address: string, poolAddress?: string }) => {
            let token: string;
            let pool: string | undefined;
            
            if (typeof tokenOrConfig === 'string') {
              token = tokenOrConfig;
            } else {
              token = tokenOrConfig.address;
              pool = tokenOrConfig.poolAddress;
              
              // Store pool address for this token
              if (pool) {
                if (!client.poolAddresses) {
                  client.poolAddresses = new Map();
                }
                client.poolAddresses.set(token, pool);
              }
            }

            client.tokens.add(token);
            this.subscribedTokens.add(token);

            // Fetch price immediately for new subscription
            this.fetchTokenPrice(token, pool);
            
            // Send current price if available
            const priceData = this.prices.get(token);
            if (priceData) {
              ws.send(JSON.stringify({
                type: 'PRICE_UPDATE',
                data: priceData
              }));
            }
          });
        }
        break;

      case 'UNSUBSCRIBE':
        if (data.tokens && Array.isArray(data.tokens)) {
          data.tokens.forEach((token: string) => {
            client.tokens.delete(token);
            // Client unsubscribed
          });
          this.updateSubscribedTokens();
        }
        break;

      case 'PING':
        ws.send(JSON.stringify({ type: 'PONG' }));
        break;

      case 'SUBSCRIBE_TRADES':
        if (data.proposalId && typeof data.proposalId === 'number') {
          console.log('Client subscribing to trades for proposal:', data.proposalId);
          client.proposals.add(data.proposalId);
          this.subscribedProposals.add(data.proposalId);

          // Send acknowledgment
          ws.send(JSON.stringify({
            type: 'TRADES_SUBSCRIBED',
            proposalId: data.proposalId
          }));
        }
        break;

      case 'UNSUBSCRIBE_TRADES':
        if (data.proposalId && typeof data.proposalId === 'number') {
          client.proposals.delete(data.proposalId);
          this.updateSubscribedProposals();
        }
        break;
    }
  }

  private updateSubscribedTokens() {
    // Update the set of all subscribed tokens across all clients
    this.subscribedTokens.clear();
    this.clients.forEach(client => {
      client.tokens.forEach(token => {
        this.subscribedTokens.add(token);
      });
    });
  }

  private startPriceUpdates() {
    // Initial fetch for ZC
    const ZC_ADDRESS = 'GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC';
    this.fetchTokenPrice(ZC_ADDRESS);

    // For mainnet tokens (like ZC), poll DexScreener every 10 seconds
    // This is acceptable since DexScreener itself aggregates data
    this.priceUpdateInterval = setInterval(() => {
      // Only poll for mainnet tokens (ZC)
      if (this.subscribedTokens.has(ZC_ADDRESS)) {
        this.fetchTokenPrice(ZC_ADDRESS);
      }
    }, 10000); // 10 seconds for mainnet tokens

    // For devnet tokens, we'll set up real-time monitoring when they subscribe
  }

  private async fetchTokenPrice(tokenAddress: string, poolAddress?: string) {
    try {
      // If we already know the pool is on mainnet, fetch from mainnet directly
      if (poolAddress && this.mainnetPools.has(poolAddress)) {
        const mainnetPrice = await this.mainnetService.getTokenPrice(tokenAddress, poolAddress);
        if (mainnetPrice && !isNaN(mainnetPrice.price) && isFinite(mainnetPrice.price)) {
          this.updatePrice({
            tokenAddress,
            price: mainnetPrice.price,
            timestamp: Date.now(),
            source: 'mainnet-amm'
          });
          return;
        }
      }

      // If we have a pool address but don't know if it's cached, try mainnet
      if (poolAddress && !this.mainnetPools.has(poolAddress)) {
        const mainnetPrice = await this.mainnetService.getTokenPrice(tokenAddress, poolAddress);
        if (mainnetPrice && !isNaN(mainnetPrice.price) && isFinite(mainnetPrice.price)) {
          this.mainnetPools.add(poolAddress);
          this.updatePrice({
            tokenAddress,
            price: mainnetPrice.price,
            timestamp: Date.now(),
            source: 'mainnet-amm'
          });
          return;
        }
      }

      // Try DexScreener for mainnet tokens
      const response = await fetch(
        `https://api.dexscreener.com/latest/dex/tokens/${tokenAddress}`
      );

      if (response.ok) {
        const data = await response.json();
        const pairs = data.pairs || [];
        
        // Find the pair with highest liquidity
        const sortedPairs = pairs.sort((a: any, b: any) => 
          (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
        );
        
        if (sortedPairs.length > 0) {
          const price = parseFloat(sortedPairs[0].priceUsd || '0');
          
          // Only update if price changed significantly (> 0.01%)
          const existingPrice = this.prices.get(tokenAddress);
          const priceChanged = !existingPrice || 
            Math.abs(existingPrice.price - price) / existingPrice.price > 0.0001;
          
          if (priceChanged) {
            this.updatePrice({
              tokenAddress,
              price,
              timestamp: Date.now(),
              source: 'dexscreener'
            });
          }
        }
      } else if (response.status === 404) {
        // Token not found on DexScreener, try AMM pools on mainnet
        if (poolAddress) {
          const mainnetPrice = await this.mainnetService.getTokenPrice(tokenAddress, poolAddress);
          if (mainnetPrice && !isNaN(mainnetPrice.price) && isFinite(mainnetPrice.price)) {
            this.mainnetPools.add(poolAddress);
            this.updatePrice({
              tokenAddress,
              price: mainnetPrice.price,
              timestamp: Date.now(),
              source: 'mainnet-amm'
            });
          }
        }
      }
    } catch (error) {
      // Silently handle errors for non-existent tokens
      if (error instanceof Error && !error.message?.includes('404')) {
        console.error(`Error fetching price for ${tokenAddress}:`, error.message);
      }
    }
  }

  private updatePrice(priceData: PriceData) {
    // Calculate USD price based on source
    let priceUsd: number;

    if (priceData.source === 'dexscreener') {
      // DexScreener already provides USD price
      priceUsd = priceData.price;
    } else {
      // AMM prices are in SOL, need to convert to USD
      priceUsd = priceData.price * this.solPrice;
    }

    // Create extended price data with USD value
    const extendedPriceData = {
      ...priceData,
      priceUsd
    };

    // Update stored price
    this.prices.set(priceData.tokenAddress, extendedPriceData);

    // Broadcast to all subscribed clients
    this.broadcast(priceData.tokenAddress, priceData);
  }

  private broadcast(tokenAddress: string, priceData: PriceData) {
    // Get the stored price data which already has the correct priceUsd
    const storedData = this.prices.get(tokenAddress);
    const broadcastData = storedData || priceData;

    this.clients.forEach((subscription, ws) => {
      if (subscription.tokens.has(tokenAddress) && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'PRICE_UPDATE',
          data: broadcastData
        }));
      }
    });
  }

  private sendCachedPrices(ws: WebSocket) {
    const client = this.clients.get(ws);
    if (!client) return;

    client.tokens.forEach(token => {
      const priceData = this.prices.get(token);
      if (priceData && ws.readyState === 1) {
        ws.send(JSON.stringify({
          type: 'PRICE_UPDATE',
          data: priceData
        }));
      }
    });
  }

  private updateSubscribedProposals() {
    // Update the set of all subscribed proposals across all clients
    const allProposals = new Set<number>();
    this.clients.forEach(subscription => {
      subscription.proposals.forEach(proposalId => allProposals.add(proposalId));
    });
    this.subscribedProposals = allProposals;
  }

  private async setupDatabaseListener() {
    try {
      // Get database connection info from environment
      const dbUrl = process.env.DB_LISTEN_URL;
      if (!dbUrl) {
        console.log('No database URL found, trade notifications disabled');
        return;
      }

      this.pgClient = new Client({ connectionString: dbUrl });
      await this.pgClient.connect();
      console.log('Connected to PostgreSQL for trade and price notifications');

      // Listen for both trade and price notifications
      // Channel names must match schema_vqm.sql triggers
      await this.pgClient.query('LISTEN new_trade');
      await this.pgClient.query('LISTEN qm_new_price');

      this.pgClient.on('notification', (msg) => {
        console.log('PostgreSQL notification received:', msg.channel, msg.payload);
        if (msg.channel === 'new_trade' && msg.payload) {
          try {
            const tradeData = JSON.parse(msg.payload);
            console.log('Parsed trade data:', tradeData);
            this.handleNewTrade(tradeData);
          } catch (error) {
            console.error('Error parsing trade notification:', error);
          }
        } else if (msg.channel === 'qm_new_price' && msg.payload) {
          try {
            const priceData = JSON.parse(msg.payload);
            console.log('Parsed price data:', priceData);
            this.handleNewPrice(priceData);
          } catch (error) {
            console.error('Error parsing price notification:', error);
          }
        }
      });

      // Also poll for recent trades on connection (in case we missed any)
      this.pollRecentTrades();

    } catch (error) {
      console.error('Failed to setup database listener:', error);
      // Continue without database notifications
    }
  }

  private async pollRecentTrades() {
    if (!this.pgClient) return;

    try {
      // Get trades from last 5 seconds for all subscribed proposals
      // Table name must match schema_vqm.sql: qm_trade_history
      if (this.subscribedProposals.size > 0) {
        const proposalIds = Array.from(this.subscribedProposals).join(',');
        const query = `
          SELECT * FROM qm_trade_history
          WHERE proposal_id IN (${proposalIds})
          AND timestamp > NOW() - INTERVAL '5 seconds'
          ORDER BY timestamp DESC
        `;

        const result = await this.pgClient.query(query);
        result.rows.forEach(trade => {
          this.broadcastTrade({
            type: 'TRADE',
            proposalId: trade.proposal_id,
            market: trade.market,
            userAddress: trade.user_address,
            isBaseToQuote: trade.is_base_to_quote,
            amountIn: trade.amount_in,
            amountOut: trade.amount_out,
            price: trade.price,
            txSignature: trade.tx_signature,
            timestamp: trade.timestamp.toISOString()
          });
        });
      }
    } catch (error) {
      console.error('Error polling recent trades:', error);
    }
  }

  private async handleNewTrade(tradeData: any) {
    const proposalId = tradeData.proposalId || tradeData.proposal_id;
    const priceInSol = parseFloat(tradeData.price);

    // Calculate market cap USD: price (SOL) × actual supply × SOL/USD
    const actualSupply = await this.getProposalTotalSupply(proposalId);
    const marketCapUsd = priceInSol * actualSupply * this.solPrice;

    // Broadcast to all clients subscribed to this proposal with BOTH formats
    const trade: TradeEvent & { marketCapUsd: number } = {
      type: 'TRADE',
      proposalId: proposalId,
      market: tradeData.market,
      userAddress: tradeData.userAddress || tradeData.user_address,
      isBaseToQuote: tradeData.isBaseToQuote || tradeData.is_base_to_quote,
      amountIn: tradeData.amountIn || tradeData.amount_in,
      amountOut: tradeData.amountOut || tradeData.amount_out,
      price: priceInSol.toString(),   // OLD: for legacy clients (SOL)
      marketCapUsd: marketCapUsd,     // NEW: for updated clients (USD)
      txSignature: tradeData.txSignature || tradeData.tx_signature,
      timestamp: tradeData.timestamp || new Date().toISOString()
    };

    console.log('Trade timestamp from DB:', tradeData.timestamp, '→ sending:', trade.timestamp);
    console.log(`Trade price: ${priceInSol} SOL → marketCap $${marketCapUsd.toFixed(2)}`);
    this.broadcastTrade(trade);
  }

  private async handleNewPrice(priceData: any) {
    // Log raw payload from database for debugging
    console.log('[WebSocket Server] Raw price notification from database:', JSON.stringify(priceData));

    const proposalId = priceData.proposalId || priceData.proposal_id;
    const market = priceData.market;
    const priceValue = parseFloat(priceData.price);

    let marketCapUsd: number;

    // Check if this is a spot market price (market=-1, already in USD) or conditional market (in SOL)
    if (market === -1) {
      // Spot prices are already stored as market cap USD - no conversion needed
      marketCapUsd = priceValue;
      console.log(`[WebSocket Server] Spot market - price already in USD: $${marketCapUsd.toFixed(2)}`);
    } else {
      // Conditional market prices are in SOL - calculate market cap USD: price (SOL) × actual supply × SOL/USD
      const actualSupply = await this.getProposalTotalSupply(proposalId);
      marketCapUsd = priceValue * actualSupply * this.solPrice;
      console.log(`[WebSocket Server] Market ${market} - converting: ${priceValue} SOL × ${actualSupply} supply × $${this.solPrice} = $${marketCapUsd.toFixed(2)}`);
    }

    // Broadcast price update with BOTH formats for backwards compatibility
    const priceUpdate = {
      type: 'PRICE_UPDATE',
      proposalId: proposalId,
      market: market,
      price: priceValue,              // OLD: for legacy clients (SOL for pass/fail, USD for spot)
      marketCapUsd: marketCapUsd,     // NEW: for updated clients (always USD)
      timestamp: priceData.timestamp || new Date().toISOString()
    };

    console.log(`[WebSocket Server] Broadcasting price update: proposal ${priceUpdate.proposalId}, market ${priceUpdate.market}, marketCap $${marketCapUsd.toFixed(2)}`);
    console.log(`[WebSocket Server] Subscribed proposals:`, Array.from(this.subscribedProposals));
    this.broadcastPrice(priceUpdate);
  }

  private broadcastTrade(trade: TradeEvent) {
    this.clients.forEach((subscription, ws) => {
      if (subscription.proposals.has(trade.proposalId) && ws.readyState === 1) {
        ws.send(JSON.stringify(trade));
      }
    });
    console.log(`Trade broadcast for proposal ${trade.proposalId}: market ${trade.market} ${trade.isBaseToQuote ? 'sell' : 'buy'}`);
  }

  private broadcastPrice(priceUpdate: any) {
    console.log('[WebSocket Server] Broadcasting priceUpdate object:', JSON.stringify(priceUpdate, null, 2));

    let clientCount = 0;
    this.clients.forEach((subscription, ws) => {
      if (subscription.proposals.has(priceUpdate.proposalId) && ws.readyState === 1) {
        const message = JSON.stringify(priceUpdate);
        console.log('[WebSocket Server] Sending message to client:', message);
        ws.send(message);
        clientCount++;
      }
    });
    console.log(`[WebSocket Server] Price broadcast sent to ${clientCount} client(s) for proposal ${priceUpdate.proposalId}`);
    console.log(`Price broadcast for proposal ${priceUpdate.proposalId}: ${priceUpdate.market} @ ${priceUpdate.price}`);
  }

  private async fetchSolPrice() {
    try {
      const response = await fetch(`https://api.dexscreener.com/latest/dex/tokens/${this.SOL_ADDRESS}`);

      if (!response.ok) {
        throw new Error('Failed to fetch SOL price');
      }

      const data = await response.json();
      const solPairs = data.pairs || [];

      if (solPairs.length > 0) {
        // Sort by liquidity and take the highest
        const sortedSolPairs = solPairs.sort((a: any, b: any) =>
          (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
        );
        this.solPrice = parseFloat(sortedSolPairs[0]?.priceUsd || '0') || 150;
      } else {
        this.solPrice = 150; // Fallback price
      }

      console.log(`SOL price updated: $${this.solPrice}`);
    } catch (error) {
      console.error('Error fetching SOL price:', error);
      this.solPrice = 150; // Fallback price
    }
  }

  private async getProposalTotalSupply(proposalId: number): Promise<number> {
    const cached = this.proposalCache.get(proposalId);
    const now = Date.now();

    // Return cached value if fresh
    if (cached && (now - cached.fetched) < this.PROPOSAL_CACHE_TTL) {
      return cached.actualSupply;
    }

    // Fetch from database
    try {
      if (!this.pgClient) {
        console.warn('No database connection, using default actual supply');
        return 1_000_000_000; // Default fallback (1 billion tokens)
      }

      const result = await this.pgClient.query(
        'SELECT total_supply, base_decimals FROM qm_proposals WHERE proposal_id = $1 LIMIT 1',
        [proposalId]
      );

      if (result.rows.length === 0) {
        console.warn(`Proposal ${proposalId} not found, using default actual supply`);
        return 1_000_000_000; // Default fallback (1 billion tokens)
      }

      const totalSupply = parseInt(result.rows[0].total_supply);
      const baseDecimals = parseInt(result.rows[0].base_decimals) || 6;

      // Total supply is already the actual token count, no decimal adjustment needed
      const actualSupply = totalSupply;

      // Cache the result
      this.proposalCache.set(proposalId, {
        actualSupply,
        fetched: now
      });

      console.log(`Cached actual supply for proposal ${proposalId}: ${actualSupply} tokens (raw: ${totalSupply}, decimals: ${baseDecimals})`);
      return actualSupply;
    } catch (error) {
      console.error(`Error fetching proposal ${proposalId} total supply:`, error);
      return 1_000_000_000; // Default fallback (1 billion tokens)
    }
  }

  public async shutdown() {
    if (this.priceUpdateInterval) {
      clearInterval(this.priceUpdateInterval);
    }
    if (this.pgClient) {
      await this.pgClient.end();
    }
    this.wss.close();
  }
}

const ws_port = process.env.WS_PORT;
if (ws_port === undefined) throw Error("WS_PORT not set");
// Start the server
const server = new PriceWebSocketServer(Number(ws_port));

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('\nShutting down price WebSocket server...');
  server.shutdown();
  process.exit(0);
});

export default server;