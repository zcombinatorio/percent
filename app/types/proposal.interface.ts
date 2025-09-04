import { Transaction } from '@solana/web3.js';
import { IAMM } from './amm.interface';
import { IVault } from './vault.interface';
import { ITWAPOracle } from './twap-oracle.interface';
import { ProposalStatus } from './moderator.interface';

export interface IProposal {
  id: number;
  description: string;
  transaction: Transaction;
  pAMM: IAMM | null;
  fAMM: IAMM | null;
  pVault: IVault | null;
  fVault: IVault | null;
  twapOracle: ITWAPOracle;
  createdAt: number;
  finalizedAt: number;
  baseMint: string;
  quoteMint: string;
  readonly status: ProposalStatus;
  
  fetchTTL(): number;
  getAMMs(): Promise<void>;
  getVaults(): Promise<void>;
  finalize(): ProposalStatus;
  execute(): Promise<void>;
}