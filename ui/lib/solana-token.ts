import { Connection, PublicKey } from '@solana/web3.js';

const RPC_URL = process.env.NEXT_PUBLIC_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';

interface TokenMintInfo {
  supply: number;
  decimals: number;
}

/**
 * Get token mint information from the blockchain
 */
export async function getTokenMintInfo(mintAddress: string): Promise<TokenMintInfo> {
  const connection = new Connection(RPC_URL, 'confirmed');
  const mintPublicKey = new PublicKey(mintAddress);

  const mintInfo = await connection.getParsedAccountInfo(mintPublicKey);

  if (!mintInfo.value || !('parsed' in mintInfo.value.data)) {
    throw new Error('Failed to fetch mint info');
  }

  const parsedData = mintInfo.value.data.parsed;
  const info = parsedData.info;

  return {
    supply: parseFloat(info.supply) / Math.pow(10, info.decimals),
    decimals: info.decimals,
  };
}
