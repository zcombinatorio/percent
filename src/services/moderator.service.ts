import { Moderator } from '../../app/moderator';
import { IModeratorConfig } from '../../app/types/moderator.interface';
import { PublicKey, Keypair, Connection } from '@solana/web3.js';
import fs from 'fs';
import path from 'path';

class ModeratorService {
  private static instance: Moderator | null = null;

  private constructor() {}

  public static getInstance(): Moderator {
    if (!ModeratorService.instance) {
      const keypairPath = process.env.SOLANA_KEYPAIR_PATH || './wallet.json';
      const rpcUrl = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
      
      if (!fs.existsSync(keypairPath)) {
        throw new Error(`Keypair file not found at ${keypairPath}`);
      }
      
      const keypairData = JSON.parse(fs.readFileSync(keypairPath, 'utf-8'));
      const authority = Keypair.fromSecretKey(new Uint8Array(keypairData));
      
      const config: IModeratorConfig = {
        baseMint: new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'), // USDC
        quoteMint: new PublicKey('So11111111111111111111111111111111111111112'), // Wrapped SOL
        baseDecimals: 6,
        quoteDecimals: 9,
        authority,
        connection: new Connection(rpcUrl, 'confirmed'),
      };
      
      ModeratorService.instance = new Moderator(config);
    }
    
    return ModeratorService.instance;
  }

  public static reset(): void {
    ModeratorService.instance = null;
  }
}

export default ModeratorService;