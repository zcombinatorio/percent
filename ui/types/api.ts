export type ProposalStatus = 'Pending' | 'Passed' | 'Failed' | 'Executed';

export interface ProposalListItem {
  id: number;
  title: string;
  description: string;
  status: ProposalStatus;
  createdAt: number;
  finalizedAt: number;
  passThresholdBps: number;
  totalSupply?: number;
}

export interface ProposalListResponse {
  proposals: ProposalListItem[];
}

export interface ProposalDetailResponse {
  moderatorId: number;
  id: number;
  title: string;
  description: string;
  status: ProposalStatus;
  createdAt: number;
  finalizedAt: number;
  proposalStatus: ProposalStatus;
  proposalLength: number;
  baseMint: string;
  quoteMint: string;
  authority: string;
  spotPoolAddress?: string;
  totalSupply?: number;
  ammConfig: {
    initialBaseAmount: string;
    initialQuoteAmount: string;
  } | null;
  passAmmState: any | null;
  failAmmState: any | null;
  baseVaultState: any | null;
  quoteVaultState: any | null;
  twapOracleState: any | null;
}

export interface UserBalancesResponse {
  proposalId: number;
  user: string;
  base: {
    regular: string;
    passConditional: string;
    failConditional: string;
  };
  quote: {
    regular: string;
    passConditional: string;
    failConditional: string;
  };
}