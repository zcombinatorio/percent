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

import { EventEmitter } from 'events';
import { Connection, PublicKey, Keypair, Logs } from '@solana/web3.js';
import { AnchorProvider, Wallet, BorshCoder, EventParser } from '@coral-xyz/anchor';
import {
  FutarchyClient,
  FUTARCHY_PROGRAM_ID,
  ProposalLaunchedEvent,
  ProposalFinalizedEvent,
} from '@zcomb/programs-sdk';
import { FutarchyIDL } from '@zcomb/programs-sdk/dist/generated/idls';
import { getPool } from '@app/utils/database';
import { logError } from './logger';

export interface MonitoredProposal {
  proposalPda: string;
  moderatorPda: string;
  proposalId: number;
  numOptions: number;
  pools: string[];
  endTime: number;
  createdAt: number;
}

export interface MonitorEvents {
  'proposal:added': (proposal: MonitoredProposal) => void;
  'proposal:removed': (proposal: MonitoredProposal) => void;
}

/**
 * Listens for ProposalLaunched/ProposalFinalized events on-chain and tracks
 * proposals from moderators registered in our database (cmb_daos table).
 * Emits 'proposal:added' and 'proposal:removed' events for other services.
 */
export class Monitor extends EventEmitter {
  readonly monitored = new Map<string, MonitoredProposal>();
  readonly client: FutarchyClient;

  private connection: Connection;
  private eventParser: EventParser;
  private subscriptionId: number | null = null;

  constructor(rpcUrl: string) {
    super();
    this.connection = new Connection(rpcUrl, 'confirmed');
    const wallet = new Wallet(Keypair.generate());
    const provider = new AnchorProvider(this.connection, wallet, { commitment: 'confirmed' });

    this.client = new FutarchyClient(provider);
    this.eventParser = new EventParser(FUTARCHY_PROGRAM_ID, new BorshCoder(FutarchyIDL as any));
  }

  async start() {
    this.subscriptionId = this.connection.onLogs(
      FUTARCHY_PROGRAM_ID,
      (logs) => this.handleLogs(logs),
      'confirmed'
    );
    console.log(`Listening for events on ${FUTARCHY_PROGRAM_ID.toBase58()}`);
  }

  async stop() {
    if (this.subscriptionId !== null) {
      await this.connection.removeOnLogsListener(this.subscriptionId);
      this.subscriptionId = null;
      console.log('Stopped event listener');
    }
  }

  private handleLogs(logs: Logs) {
    if (logs.err) return;

    try {
      const events = this.eventParser.parseLogs(logs.logs);
      for (const event of events) {
        if (event.name === 'ProposalLaunched') {
          this.handleProposalLaunched(event.data as ProposalLaunchedEvent);
        } else if (event.name === 'ProposalFinalized') {
          this.handleProposalFinalized(event.data as ProposalFinalizedEvent);
        }
      }
    } catch {
      // Parsing can fail for non-event logs
    }
  }

  private async isTrackedModerator(moderatorPda: string): Promise<boolean> {
    const result = await getPool().query(
      'SELECT 1 FROM cmb_daos WHERE moderator_pda = $1 LIMIT 1',
      [moderatorPda]
    );
    return (result.rowCount ?? 0) > 0;
  }

  private async handleProposalLaunched(data: ProposalLaunchedEvent) {
    const proposalPdaStr = data.proposal.toBase58();

    try {
      const proposal = await this.client.fetchProposal(data.proposal);
      const moderatorPda = proposal.moderator.toBase58();

      if (!(await this.isTrackedModerator(moderatorPda))) {
        console.log(`Ignoring proposal ${proposalPdaStr} - moderator not tracked`);
        return;
      }

      const createdAtMs = Number(data.createdAt) * 1000;
      const timeRemaining = this.client.getTimeRemaining(proposal);
      const endTime = Date.now() + timeRemaining * 1000;

      const pools = proposal.pools
        .map((p: PublicKey) => p.toBase58())
        .filter((p: string) => p !== '11111111111111111111111111111111'); // remove uninitialized pools

      const info: MonitoredProposal = {
        proposalPda: proposalPdaStr,
        moderatorPda,
        proposalId: data.proposalId,
        numOptions: data.numOptions,
        pools,
        endTime,
        createdAt: createdAtMs,
      };

      this.monitored.set(proposalPdaStr, info);
      this.emit('proposal:added', info);
      console.log(`Monitoring proposal ${proposalPdaStr} (ends: ${new Date(endTime).toISOString()})`);
    } catch (e) {
      console.error(`Failed to handle ProposalLaunched: ${proposalPdaStr}`, e);
      logError('server', {
        type: 'proposal_launched_handler',
        proposalPda: proposalPdaStr,
        error: String(e),
      });
    }
  }

  private handleProposalFinalized(data: ProposalFinalizedEvent) {
    const proposalPdaStr = data.proposal.toBase58();
    const info = this.monitored.get(proposalPdaStr);

    if (info) {
      this.monitored.delete(proposalPdaStr);
      this.emit('proposal:removed', info);
      console.log(`Proposal finalized: ${proposalPdaStr} (winner: ${data.winningIdx})`);
    }
  }

  getMonitored() {
    return Array.from(this.monitored.values());
  }

  removeMonitored(pda: string) {
    const info = this.monitored.get(pda);
    if (info && this.monitored.delete(pda)) {
      this.emit('proposal:removed', info);
      return true;
    }
    return false;
  }
}
