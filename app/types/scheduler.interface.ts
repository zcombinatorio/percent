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
 * Types of tasks that can be scheduled
 */
export enum ScheduledTaskType {
  /** Periodic TWAP oracle cranking */
  TWAPCrank = 'twap-crank',
  /** One-time proposal finalization */
  ProposalFinalize = 'proposal-finalize',
  /** Periodic AMM price recording */
  PriceRecord = 'price-record',
  /** Periodic spot market price recording */
  SpotPriceRecord = 'spot-price-record'
}

export interface IScheduledTask {
  id: string;
  type: ScheduledTaskType;
  moderatorId: number;
  proposalId: number;
  interval?: number;
  nextRunTime: number;
  timer?: NodeJS.Timeout;
}

export interface ISchedulerService {
  /**
   * Schedules automatic TWAP cranking for a proposal
   * @param moderatorId - The moderator ID that owns the proposal
   * @param proposalId - The proposal ID to crank TWAP for
   * @param intervalMs - Interval between cranks in milliseconds (default: 60000 = 1 minute)
   */
  scheduleTWAPCranking(moderatorId: number, proposalId: number, intervalMs?: number): void;

  /**
   * Schedules automatic finalization for a proposal
   * @param moderatorId - The moderator ID that owns the proposal
   * @param proposalId - The proposal ID to finalize
   * @param finalizeAt - Timestamp when to finalize the proposal
   */
  scheduleProposalFinalization(moderatorId: number, proposalId: number, finalizeAt: number): void;

  /**
   * Schedules automatic price recording for a proposal
   * @param moderatorId - The moderator ID that owns the proposal
   * @param proposalId - The proposal ID to record prices for
   * @param intervalMs - Interval between recordings in milliseconds (default: 60000 = 1 minute)
   */
  schedulePriceRecording(moderatorId: number, proposalId: number, intervalMs?: number): void;

  /**
   * Schedules automatic spot price recording for a proposal
   * @param moderatorId - The moderator ID that owns the proposal
   * @param proposalId - The proposal ID to record spot prices for
   * @param spotPoolAddress - The Meteora pool address for the spot market
   * @param intervalMs - Interval between recordings in milliseconds (default: 60000 = 1 minute)
   */
  scheduleSpotPriceRecording(moderatorId: number, proposalId: number, spotPoolAddress: string, intervalMs?: number): void;

  /**
   * Cancels a scheduled task
   * @param taskId - The task ID to cancel
   */
  cancelTask(taskId: string): void;

  /**
   * Cancels all tasks for a specific proposal
   * @param moderatorId - The moderator ID that owns the proposal
   * @param proposalId - The proposal ID
   */
  cancelProposalTasks(moderatorId: number, proposalId: number): void;

  /**
   * Stops all scheduled tasks
   */
  stopAll(): void;

  /**
   * Gets information about all active tasks
   */
  getActiveTasks(): Array<{
    id: string;
    type: string;
    moderatorId: number;
    proposalId: number;
    nextRunTime: number;
  }>;
}