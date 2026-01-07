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

import { Response, Request } from 'express';

/**
 * Wrapper around Express Response for SSE connections.
 * Handles protocol details so consumers just call send().
 */
export class SSEClient {
  private keepaliveTimer: NodeJS.Timeout | null = null;

  constructor(
    private res: Response,
    private id: string
  ) {
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
  }

  /** Send an event to the client */
  send(event: string, data: any) {
    this.res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  }

  /** Send a keepalive comment (prevents connection timeout) */
  keepalive() {
    this.res.write(':keepalive\n\n');
  }

  /** Start automatic keepalive pings */
  startKeepalive(intervalMs = 30_000) {
    this.keepaliveTimer = setInterval(() => this.keepalive(), intervalMs);
  }

  /** Close the connection and cleanup */
  close() {
    if (this.keepaliveTimer) {
      clearInterval(this.keepaliveTimer);
      this.keepaliveTimer = null;
    }
    this.res.end();
  }

  get clientId() {
    return this.id;
  }
}

/**
 * Manages multiple SSE client connections.
 * Handles connection lifecycle and broadcasting.
 */
export class SSEManager {
  private clients = new Set<SSEClient>();
  private idCounter = 0;

  /** Create a new SSE client from an Express request */
  connect(req: Request, res: Response): SSEClient {
    const client = new SSEClient(res, `sse-${++this.idCounter}`);
    client.startKeepalive();
    this.clients.add(client);

    console.log(`[SSE] Client ${client.clientId} connected (${this.clients.size} total)`);

    // Cleanup on disconnect
    req.on('close', () => {
      client.close();
      this.clients.delete(client);
      console.log(`[SSE] Client ${client.clientId} disconnected (${this.clients.size} total)`);
    });

    return client;
  }

  /** Broadcast an event to all connected clients */
  broadcast(event: string, data: any) {
    this.clients.forEach((client) => client.send(event, data));
  }

  /** Close all connections */
  closeAll() {
    this.clients.forEach((client) => client.close());
    this.clients.clear();
    console.log('[SSE] All clients disconnected');
  }

  get clientCount() {
    return this.clients.size;
  }
}
