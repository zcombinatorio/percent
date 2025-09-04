import { ITWAPOracle } from './types/twap-oracle.interface';

export class TWAPOracle implements ITWAPOracle {
  public proposalId: number;
  public twapMaxObservationChangePerUpdate: bigint;
  public twapStartDelay: number;
  public passThresholdBps: number;
  public createdAt: number;
  public finalizedAt: number;

  constructor(
    proposalId: number,
    twapMaxObservationChangePerUpdate: bigint,
    twapStartDelay: number,
    passThresholdBps: number,
    createdAt: number,
    finalizedAt: number
  ) {
    this.proposalId = proposalId;
    this.twapMaxObservationChangePerUpdate = twapMaxObservationChangePerUpdate;
    this.twapStartDelay = twapStartDelay;
    this.passThresholdBps = passThresholdBps;
    this.createdAt = createdAt;
    this.finalizedAt = finalizedAt;
  }

  async crankTWAP(): Promise<void> {
    throw new Error('Method not implemented.');
  }

  async fetchTWAP(): Promise<void> {
    throw new Error('Method not implemented.');
  }

  async fetchStatus(): Promise<void> {
    throw new Error('Method not implemented.');
  }
}