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

import { AnchorProvider, BN, Program, Wallet, Idl } from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair } from "@solana/web3.js";
import * as fs from "fs";
import * as path from "path";

const STAKING_PROGRAM_ID = new PublicKey("47rZ1jgK7zU6XAgffAfXkDX1JkiiRi4HRPBytossWR12");

// UserStake account layout offsets (from IDL)
// owner: pubkey (32), shares: u64 (8), unbonding_shares: u64 (8), ...
const USER_STAKE_SHARES_OFFSET = 8 + 32; // discriminator (8) + owner (32)
const USER_STAKE_UNBONDING_SHARES_OFFSET = USER_STAKE_SHARES_OFFSET + 8;

// Load IDL at module level
const idlPath = path.join(__dirname, "../../src/idl/staking_vault.json");
const stakingVaultIdl = JSON.parse(fs.readFileSync(idlPath, "utf-8")) as Idl;

/**
 * Service for interacting with the staking vault program
 * Used for querying user stakes and executing slash operations
 */
export class StakingVaultService {
  private program: Program;
  private connection: Connection;
  private vaultState: PublicKey;
  private adminPubkey: PublicKey;

  constructor(connection: Connection, adminKeypair: Keypair) {
    const wallet = new Wallet(adminKeypair);
    const provider = new AnchorProvider(connection, wallet, { commitment: "confirmed" });
    this.program = new Program(stakingVaultIdl, provider);
    this.connection = connection;
    this.adminPubkey = adminKeypair.publicKey;

    // Derive vault_state PDA
    [this.vaultState] = PublicKey.findProgramAddressSync(
      [Buffer.from("vault_state")],
      STAKING_PROGRAM_ID
    );
  }

  /**
   * Get user's total shares (active + unbonding)
   * @param userAddress - Solana wallet address of the user
   * @returns Total shares as bigint, or 0n if account doesn't exist
   */
  async getUserShares(userAddress: string): Promise<bigint> {
    try {
      const userPubkey = new PublicKey(userAddress);

      // Derive user_stake PDA
      const [userStakePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_stake"), this.vaultState.toBuffer(), userPubkey.toBuffer()],
        STAKING_PROGRAM_ID
      );

      // Fetch raw account data
      const accountInfo = await this.connection.getAccountInfo(userStakePda);
      if (!accountInfo || !accountInfo.data) {
        return 0n;
      }

      // Parse shares directly from account data
      const data = accountInfo.data;
      const shares = data.readBigUInt64LE(USER_STAKE_SHARES_OFFSET);
      const unbondingShares = data.readBigUInt64LE(USER_STAKE_UNBONDING_SHARES_OFFSET);

      return shares + unbondingShares;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      console.error(`Failed to fetch user shares for ${userAddress}:`, errorMessage);
      return 0n;
    }
  }

  /**
   * Execute slash instruction against a user
   * @param userAddress - Solana wallet address of the user to slash
   * @param sharesToSlash - Number of shares to slash
   * @returns Transaction signature
   */
  async slash(userAddress: string, sharesToSlash: bigint): Promise<string> {
    const userPubkey = new PublicKey(userAddress);

    // Execute slash instruction using type assertion for accounts
    const tx = await (this.program.methods as any)
      .slash(new BN(sharesToSlash.toString()))
      .accounts({
        user: userPubkey,
        signer: this.adminPubkey,
      })
      .rpc();

    return tx;
  }

  /**
   * Get the program ID
   */
  get programId(): PublicKey {
    return STAKING_PROGRAM_ID;
  }
}

// Singleton instance
let stakingVaultServiceInstance: StakingVaultService | null = null;

/**
 * Get or create the singleton StakingVaultService instance
 * @param connection - Solana connection (required on first call)
 * @param adminKeypair - Admin keypair for signing (required on first call)
 */
export function getStakingVaultService(connection?: Connection, adminKeypair?: Keypair): StakingVaultService {
  if (!stakingVaultServiceInstance) {
    if (!connection || !adminKeypair) {
      throw new Error("Connection and adminKeypair required for first initialization");
    }
    stakingVaultServiceInstance = new StakingVaultService(connection, adminKeypair);
  }
  return stakingVaultServiceInstance;
}

/**
 * Initialize the staking vault service from environment variable
 * @param connection - Solana connection
 */
export function initStakingVaultService(connection: Connection): StakingVaultService | null {
  const adminKeyPath = process.env.STAKING_VAULT_ADMIN_PATH;
  if (!adminKeyPath) {
    console.warn("STAKING_VAULT_ADMIN_PATH not set - slash execution will be disabled");
    return null;
  }

  try {
    // Load keypair from JSON file
    const resolvedPath = path.resolve(adminKeyPath);
    if (!fs.existsSync(resolvedPath)) {
      console.error(`Staking vault admin keypair file not found: ${resolvedPath}`);
      return null;
    }
    const secretKey = JSON.parse(fs.readFileSync(resolvedPath, "utf-8"));
    const adminKeypair = Keypair.fromSecretKey(Uint8Array.from(secretKey));
    return getStakingVaultService(connection, adminKeypair);
  } catch (error) {
    console.error("Failed to initialize StakingVaultService:", error);
    return null;
  }
}
