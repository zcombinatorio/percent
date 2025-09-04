export interface ITWAPOracle {
  proposalId: number;
  twapMaxObservationChangePerUpdate: bigint;
  twapStartDelay: number;
  passThresholdBps: number;
  createdAt: number;
  finalizedAt: number;
  
  crankTWAP(): Promise<void>;
  fetchTWAP(): Promise<void>;
  fetchStatus(): Promise<void>;
}