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

/**
 * SSE client for monitor server real-time updates
 * Used for futarchy proposal data (isFutarchy=true)
 */

import { getMonitorUrl } from '@/lib/monitor-api';

// ============================================================================
// Types
// ============================================================================

export interface MonitorPriceUpdate {
  proposalPda: string;
  market: number;
  price: number;
  marketCapUsd: number;
  timestamp: number;
}

export interface MonitorTradeUpdate {
  proposalPda: string;
  pool: string;
  market: number;
  trader: string;
  swapAToB: boolean;
  amountIn: string;
  amountOut: string;
  txSignature: string;
  timestamp: number;
}

export interface MonitorTWAPUpdate {
  proposalPda: string;
  pools: Array<{
    pool: string;
    twap: number;
  }>;
  timestamp: number;
}

type PriceCallback = (update: MonitorPriceUpdate) => void;
type TradeCallback = (trade: MonitorTradeUpdate) => void;
type TWAPCallback = (twap: MonitorTWAPUpdate) => void;

// ============================================================================
// MonitorStreamService
// ============================================================================

class MonitorStreamService {
  private eventSource: EventSource | null = null;
  private connected = false;
  private reconnectTimeout: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private readonly maxReconnectAttempts = 5;
  private readonly reconnectDelay = 3000;

  // Subscription maps: proposalPda -> Set of callbacks
  private priceSubscribers = new Map<string, Set<PriceCallback>>();
  private tradeSubscribers = new Map<string, Set<TradeCallback>>();
  private twapSubscribers = new Map<string, Set<TWAPCallback>>();

  /**
   * Connect to the monitor SSE endpoint
   */
  connect(): void {
    if (this.eventSource) {
      console.log('[MonitorStream] Already connected, skipping');
      return; // Already connected
    }

    const url = `${getMonitorUrl()}/events`;
    console.log('[MonitorStream] Connecting to', url, '(NEXT_PUBLIC_MONITOR_URL:', process.env.NEXT_PUBLIC_MONITOR_URL, ')');

    try {
      this.eventSource = new EventSource(url);

      this.eventSource.onopen = () => {
        console.log('[MonitorStream] Connected');
        this.connected = true;
        this.reconnectAttempts = 0;
      };

      this.eventSource.onerror = (error) => {
        console.error('[MonitorStream] Connection error:', error);
        this.connected = false;
        this.handleDisconnect();
      };

      // Handle SSE messages
      this.eventSource.onmessage = (event) => {
        try {
          // SSE format: "event: EVENT_TYPE\ndata: {json}\n\n"
          // But EventSource parses this for us, event.data is the JSON
          const message = JSON.parse(event.data);
          this.handleMessage(event.type || 'message', message);
        } catch (error) {
          console.error('[MonitorStream] Failed to parse message:', error);
        }
      };

      // Handle specific event types
      this.eventSource.addEventListener('PRICE_UPDATE', (event: MessageEvent) => {
        try {
          console.log('[MonitorStream] Received PRICE_UPDATE event:', event.data);
          const data = JSON.parse(event.data);
          this.handlePriceUpdate(data);
        } catch (error) {
          console.error('[MonitorStream] Failed to parse PRICE_UPDATE:', error);
        }
      });

      this.eventSource.addEventListener('COND_SWAP', (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          this.handleTradeUpdate(data);
        } catch (error) {
          console.error('[MonitorStream] Failed to parse COND_SWAP:', error);
        }
      });

      this.eventSource.addEventListener('TWAP_UPDATE', (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          this.handleTWAPUpdate(data);
        } catch (error) {
          console.error('[MonitorStream] Failed to parse TWAP_UPDATE:', error);
        }
      });

      this.eventSource.addEventListener('CONNECTED', (event: MessageEvent) => {
        try {
          const data = JSON.parse(event.data);
          console.log('[MonitorStream] Received CONNECTED with clientId:', data.clientId);
        } catch (error) {
          // Ignore parse errors for CONNECTED event
        }
      });
    } catch (error) {
      console.error('[MonitorStream] Failed to create EventSource:', error);
      this.handleDisconnect();
    }
  }

  /**
   * Disconnect from the monitor SSE endpoint
   */
  disconnect(): void {
    if (this.reconnectTimeout) {
      clearTimeout(this.reconnectTimeout);
      this.reconnectTimeout = null;
    }

    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.connected = false;
    this.reconnectAttempts = 0;
    console.log('[MonitorStream] Disconnected');
  }

  /**
   * Check if connected
   */
  isConnected(): boolean {
    return this.connected;
  }

  /**
   * Handle disconnect and attempt reconnection
   */
  private handleDisconnect(): void {
    if (this.eventSource) {
      this.eventSource.close();
      this.eventSource = null;
    }

    this.connected = false;

    // Only reconnect if we have active subscribers
    const hasSubscribers =
      this.priceSubscribers.size > 0 ||
      this.tradeSubscribers.size > 0 ||
      this.twapSubscribers.size > 0;

    if (hasSubscribers && this.reconnectAttempts < this.maxReconnectAttempts) {
      this.reconnectAttempts++;
      const delay = this.reconnectDelay * Math.min(this.reconnectAttempts, 3);
      console.log(`[MonitorStream] Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts})`);

      this.reconnectTimeout = setTimeout(() => {
        this.connect();
      }, delay);
    }
  }

  /**
   * Handle generic messages (fallback)
   */
  private handleMessage(type: string, data: unknown): void {
    // Most messages are handled by specific event listeners
    // This is a fallback for debugging
    if (type === 'message') {
      console.log('[MonitorStream] Generic message:', data);
    }
  }

  /**
   * Handle PRICE_UPDATE events
   */
  private handlePriceUpdate(data: MonitorPriceUpdate): void {
    const subscribers = this.priceSubscribers.get(data.proposalPda);
    if (subscribers) {
      subscribers.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error('[MonitorStream] Price callback error:', error);
        }
      });
    }
  }

  /**
   * Handle COND_SWAP (trade) events
   */
  private handleTradeUpdate(data: MonitorTradeUpdate): void {
    const subscribers = this.tradeSubscribers.get(data.proposalPda);
    if (subscribers) {
      subscribers.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error('[MonitorStream] Trade callback error:', error);
        }
      });
    }
  }

  /**
   * Handle TWAP_UPDATE events
   */
  private handleTWAPUpdate(data: MonitorTWAPUpdate): void {
    const subscribers = this.twapSubscribers.get(data.proposalPda);
    if (subscribers) {
      subscribers.forEach(callback => {
        try {
          callback(data);
        } catch (error) {
          console.error('[MonitorStream] TWAP callback error:', error);
        }
      });
    }
  }

  // ============================================================================
  // Subscription Methods
  // ============================================================================

  /**
   * Subscribe to price updates for a proposal
   */
  subscribeToPrices(proposalPda: string, callback: PriceCallback): void {
    console.log('[MonitorStream] subscribeToPrices called for', proposalPda);
    if (!this.priceSubscribers.has(proposalPda)) {
      this.priceSubscribers.set(proposalPda, new Set());
    }
    this.priceSubscribers.get(proposalPda)!.add(callback);
    console.log('[MonitorStream] Price subscribers count:', this.priceSubscribers.get(proposalPda)!.size);

    // Auto-connect if not connected
    if (!this.connected && !this.eventSource) {
      console.log('[MonitorStream] Auto-connecting...');
      this.connect();
    }
  }

  /**
   * Unsubscribe from price updates
   */
  unsubscribeFromPrices(proposalPda: string, callback: PriceCallback): void {
    const subscribers = this.priceSubscribers.get(proposalPda);
    if (subscribers) {
      subscribers.delete(callback);
      if (subscribers.size === 0) {
        this.priceSubscribers.delete(proposalPda);
      }
    }
    this.maybeDisconnect();
  }

  /**
   * Subscribe to trade updates for a proposal
   */
  subscribeToTrades(proposalPda: string, callback: TradeCallback): void {
    if (!this.tradeSubscribers.has(proposalPda)) {
      this.tradeSubscribers.set(proposalPda, new Set());
    }
    this.tradeSubscribers.get(proposalPda)!.add(callback);

    // Auto-connect if not connected
    if (!this.connected && !this.eventSource) {
      this.connect();
    }
  }

  /**
   * Unsubscribe from trade updates
   */
  unsubscribeFromTrades(proposalPda: string, callback: TradeCallback): void {
    const subscribers = this.tradeSubscribers.get(proposalPda);
    if (subscribers) {
      subscribers.delete(callback);
      if (subscribers.size === 0) {
        this.tradeSubscribers.delete(proposalPda);
      }
    }
    this.maybeDisconnect();
  }

  /**
   * Subscribe to TWAP updates for a proposal
   */
  subscribeToTWAP(proposalPda: string, callback: TWAPCallback): void {
    if (!this.twapSubscribers.has(proposalPda)) {
      this.twapSubscribers.set(proposalPda, new Set());
    }
    this.twapSubscribers.get(proposalPda)!.add(callback);

    // Auto-connect if not connected
    if (!this.connected && !this.eventSource) {
      this.connect();
    }
  }

  /**
   * Unsubscribe from TWAP updates
   */
  unsubscribeFromTWAP(proposalPda: string, callback: TWAPCallback): void {
    const subscribers = this.twapSubscribers.get(proposalPda);
    if (subscribers) {
      subscribers.delete(callback);
      if (subscribers.size === 0) {
        this.twapSubscribers.delete(proposalPda);
      }
    }
    this.maybeDisconnect();
  }

  /**
   * Disconnect if no more subscribers
   */
  private maybeDisconnect(): void {
    const hasSubscribers =
      this.priceSubscribers.size > 0 ||
      this.tradeSubscribers.size > 0 ||
      this.twapSubscribers.size > 0;

    if (!hasSubscribers) {
      console.log('[MonitorStream] No more subscribers, disconnecting');
      this.disconnect();
    }
  }
}

// ============================================================================
// Singleton Instance
// ============================================================================

let instance: MonitorStreamService | null = null;

export function getMonitorStreamService(): MonitorStreamService {
  if (!instance) {
    instance = new MonitorStreamService();
  }
  return instance;
}

export { MonitorStreamService };
