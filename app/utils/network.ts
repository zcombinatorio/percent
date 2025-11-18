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

import { Connection } from '@solana/web3.js';

/**
 * Network enum to specify which Solana network to use
 */
export enum Network {
  MAINNET = 'mainnet',
  DEVNET = 'devnet'
}

/**
 * Determine the Solana network from a Connection object
 * @param connection - Solana Connection instance
 * @returns Network enum value (MAINNET or DEVNET)
 */
export function getNetworkFromConnection(connection: Connection): Network {
  return connection.rpcEndpoint.includes('devnet') ? Network.DEVNET : Network.MAINNET;
}