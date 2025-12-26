'use client';

import { useState, useEffect, useCallback, useMemo } from "react";
import { PublicKey, Connection, Transaction } from "@solana/web3.js";
import { getAssociatedTokenAddress, getAccount, createAssociatedTokenAccountInstruction, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import { Program, AnchorProvider, BN } from "@coral-xyz/anchor";
import { usePrivyWallet } from '@/hooks/usePrivyWallet';
import { useWalletBalances } from '@/hooks/useWalletBalances';
import { useTokenContext } from '@/providers/TokenContext';
import { useSolanaWallets } from '@privy-io/react-auth/solana';
import toast from 'react-hot-toast';
import Header from '@/components/Header';
import StakingVaultIDL from '@/lib/staking-vault-idl.json';

const ZC_TOKEN_MINT = new PublicKey("GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC");
const PROGRAM_ID = new PublicKey("47rZ1jgK7zU6XAgffAfXkDX1JkiiRi4HRPBytossWR12");

// Hardcoded exit mode target date - January 15, 2026
const EXIT_MODE_TARGET_DATE = new Date('2026-01-15T00:00:00Z').getTime() / 1000;

interface SolanaWalletProvider {
  signAndSendTransaction: (transaction: Transaction) => Promise<{ signature: string }>;
}

interface WindowWithWallets extends Window {
  solana?: SolanaWalletProvider;
  solflare?: SolanaWalletProvider;
}

interface StakerTrade {
  id: number;
  timestamp: string;
  moderatorId: number;
  ticker: string;
  proposalId: number;
  market: number;
  marketLabel: string;
  userAddress: string;
  isBaseToQuote: boolean;
  amountIn: string;
  amountOut: string;
  price: string;
  txSignature: string | null;
}

interface Staker {
  address: string;
  balance: string;
  percentage: string;
  volumeUsd: string;
}

export function StakeContent() {
  const { ready, authenticated, walletAddress, login } = usePrivyWallet();
  const { wallets } = useSolanaWallets();
  const { tokenSlug, poolAddress, baseMint, baseDecimals, tokenSymbol, icon } = useTokenContext();
  const { sol: solBalance, baseToken: baseTokenBalance } = useWalletBalances({
    walletAddress,
    baseMint,
    baseDecimals,
  });

  const [loading, setLoading] = useState(false);
  const [modalMode, setModalMode] = useState<"deposit" | "redeem">("deposit");
  const [amount, setAmount] = useState<string>("");
  
  const [zcBalance, setZcBalance] = useState<number>(0);
  const [vaultBalance, setVaultBalance] = useState<number>(0);
  const [userShareBalance, setUserShareBalance] = useState<number>(0);
  const [userShareValue, setUserShareValue] = useState<number>(0);
  const [exchangeRate, setExchangeRate] = useState<number>(0);
  const [zcTotalSupply, setZcTotalSupply] = useState<number>(0);
  const [stakerCount, setStakerCount] = useState<number>(0);
  const [qmVolumeUsd, setQmVolumeUsd] = useState<number>(0);
  const [refreshing, setRefreshing] = useState(false);
  const [postTransactionRefreshing, setPostTransactionRefreshing] = useState(false);
  const [withdrawalsEnabled, setWithdrawalsEnabled] = useState<boolean>(true);
  const [vaultTab, setVaultTab] = useState<"stats" | "stakers" | "trades">("stats");
  const [timeFilter, setTimeFilter] = useState<"1D" | "1W" | "ALL">("ALL");
  const [stakerTrades, setStakerTrades] = useState<StakerTrade[]>([]);
  const [tradesLoading, setTradesLoading] = useState(false);
  const [stakersList, setStakersList] = useState<Staker[]>([]);
  const [stakersLoading, setStakersLoading] = useState(false);
  const [stakersSort, setStakersSort] = useState<{ column: 'balance' | 'volume'; direction: 'asc' | 'desc' }>({ column: 'balance', direction: 'desc' });
  const [isHoveringStaked, setIsHoveringStaked] = useState(false);

  // New staking vault state
  const [isFrozen, setIsFrozen] = useState<boolean>(false);
  const [userShares, setUserShares] = useState<number>(0);
  const [unbondingShares, setUnbondingShares] = useState<number>(0);
  const [unbondingAssets, setUnbondingAssets] = useState<number>(0);
  const [expectedUnlockTime, setExpectedUnlockTime] = useState<number>(0);
  const [isHoveringRedeem, setIsHoveringRedeem] = useState<boolean>(false);
  const [exitModeCountdown, setExitModeCountdown] = useState<string>("");
  const [unbondingCountdown, setUnbondingCountdown] = useState<string>("");
  const [rewardRate, setRewardRate] = useState<number>(0);
  const [totalAssets, setTotalAssets] = useState<number>(0);
  const [totalShares, setTotalShares] = useState<number>(0);
  const [slashedAmount, setSlashedAmount] = useState<number>(0);

  const connection = useMemo(() => new Connection(process.env.NEXT_PUBLIC_RPC_URL || "https://api.mainnet-beta.solana.com"), []);

  const wallet = useMemo(() => {
    if (!walletAddress) return null;
    return new PublicKey(walletAddress);
  }, [walletAddress]);

  const getProvider = useCallback(() => {
    if (typeof window === 'undefined') return null;

    const walletProvider = (window as WindowWithWallets).solana || (window as WindowWithWallets).solflare;
    if (!wallet || !walletProvider) return null;

    try {
      const provider = new AnchorProvider(
        connection,
        walletProvider as unknown as AnchorProvider['wallet'],
        { commitment: "confirmed" }
      );
      return provider;
    } catch (error) {
      console.error("Failed to create provider:", error);
      return null;
    }
  }, [wallet, connection]);

  const getProgram = useCallback((): Program | null => {
    const provider = getProvider();
    if (!provider) return null;
    return new Program(StakingVaultIDL as unknown as Program['idl'], provider);
  }, [getProvider]);

  const program = useMemo(() => getProgram(), [getProgram]);

  const calculateAPY = useCallback((): number => {
    if (totalAssets === 0 || rewardRate === 0) return 0;
    // reward_rate is tokens per second (in raw units)
    // Annual rewards = reward_rate * seconds_per_year
    const SECONDS_PER_YEAR = 31536000;
    const annualRewards = rewardRate * SECONDS_PER_YEAR;
    // APY = (annual_rewards / total_assets) * 100
    return (annualRewards / totalAssets) * 100;
  }, [totalAssets, rewardRate]);

  // Fetch public vault data (TVL, exchange rate, is_frozen) - doesn't require wallet
  const fetchPublicVaultData = useCallback(async () => {
    try {
      const [vaultState] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_state")],
        PROGRAM_ID
      );
      const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_vault"), ZC_TOKEN_MINT.toBuffer()],
        PROGRAM_ID
      );

      // Fetch VaultState to get is_frozen, total_assets, total_shares, reward_rate
      try {
        const vaultStateAccountInfo = await connection.getAccountInfo(vaultState);
        if (vaultStateAccountInfo && vaultStateAccountInfo.data && program) {
          const vaultStateAccount = program.coder.accounts.decode("vaultState", vaultStateAccountInfo.data);
          setIsFrozen(vaultStateAccount.isFrozen);
          setWithdrawalsEnabled(vaultStateAccount.operationsEnabled);

          // Store raw values for APY calculation
          const totalAssetsRaw = Number(vaultStateAccount.totalAssets);
          const totalSharesRaw = Number(vaultStateAccount.totalShares);
          const rewardRateRaw = Number(vaultStateAccount.rewardRate);

          setTotalAssets(totalAssetsRaw);
          setTotalShares(totalSharesRaw);
          setRewardRate(rewardRateRaw);

          // Calculate exchange rate from total_assets / total_shares
          if (totalSharesRaw > 0) {
            setExchangeRate(totalAssetsRaw / totalSharesRaw);
          } else {
            setExchangeRate(1);
          }

          // Set vault balance from total_assets (converted to human readable)
          setVaultBalance(totalAssetsRaw / 1_000_000);
        }
      } catch (error) {
        console.error("Failed to fetch vault state:", error);
        setIsFrozen(false);
        setExchangeRate(1);
        setRewardRate(0);
        setTotalAssets(0);
        setTotalShares(0);
      }

      // Fallback: Fetch TVL directly from vault token account if VaultState decode fails
      try {
        const vaultTokenAccountInfo = await getAccount(connection, vaultTokenAccount);
        // Only set if not already set from VaultState
        if (vaultBalance === 0) {
          setVaultBalance(Number(vaultTokenAccountInfo.amount) / 1_000_000);
        }
      } catch (error) {
        console.error("Failed to fetch vault token account:", error);
      }

      // Fetch ZC total supply
      try {
        const mintInfo = await connection.getParsedAccountInfo(ZC_TOKEN_MINT);
        if (mintInfo.value?.data && 'parsed' in mintInfo.value.data) {
          const supply = Number(mintInfo.value.data.parsed.info.supply) / 1_000_000;
          setZcTotalSupply(supply);
        }
      } catch (error) {
        console.error("Failed to fetch ZC total supply:", error);
      }

      // Fetch staker count and QM Volume from backend API
      // Backend uses getProgramAccounts which gets ALL stakers (not limited to ~20)
      try {
        const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/stakers/volume`);
        const data = await response.json();
        setStakerCount(data.stakerCount || 0);
        setQmVolumeUsd(data.volumeUsd || 0);
      } catch (error) {
        console.error("Failed to fetch staker data:", error);
        setStakerCount(0);
        setQmVolumeUsd(0);
      }
    } catch (error) {
      console.error("Failed to fetch public vault data:", error);
    }
  }, [connection, program, vaultBalance]);

  // Fetch user-specific data (requires wallet)
  const fetchUserData = useCallback(async (retryCount = 0, maxRetries = 3) => {
    if (!program || !wallet) {
      setUserShareBalance(0);
      setUserShareValue(0);
      setZcBalance(0);
      setUserShares(0);
      setUnbondingShares(0);
      setUnbondingAssets(0);
      setExpectedUnlockTime(0);
      return;
    }

    try {
      setRefreshing(true);

      const [vaultState] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_state")],
        PROGRAM_ID
      );

      // Derive UserStake PDA
      const [userStakePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_stake"), vaultState.toBuffer(), wallet.toBuffer()],
        PROGRAM_ID
      );

      // Fetch vault state for withdrawals enabled and is_frozen
      try {
        const vaultStateAccountInfo = await connection.getAccountInfo(vaultState);
        if (vaultStateAccountInfo && vaultStateAccountInfo.data) {
          const vaultStateAccount = program.coder.accounts.decode("vaultState", vaultStateAccountInfo.data);
          setWithdrawalsEnabled(vaultStateAccount.operationsEnabled);
          setIsFrozen(vaultStateAccount.isFrozen);
        } else {
          setWithdrawalsEnabled(false);
          setIsFrozen(false);
        }
      } catch (error) {
        console.error("Failed to fetch vault state:", error);
        setWithdrawalsEnabled(false);
        setIsFrozen(false);
      }

      // Fetch user ZC balance
      try {
        const userTokenAccount = await getAssociatedTokenAddress(ZC_TOKEN_MINT, wallet);
        const userTokenAccountInfo = await getAccount(connection, userTokenAccount);
        setZcBalance(Number(userTokenAccountInfo.amount) / 1_000_000);
      } catch {
        setZcBalance(0);
      }

      // Fetch user stake data from UserStake PDA
      try {
        const userStakeAccountInfo = await connection.getAccountInfo(userStakePda);
        if (userStakeAccountInfo && userStakeAccountInfo.data) {
          const userStakeAccount = program.coder.accounts.decode("userStake", userStakeAccountInfo.data);

          const shares = Number(userStakeAccount.shares) / 1_000_000;
          const unbondingSharesVal = Number(userStakeAccount.unbondingShares) / 1_000_000;
          const unbondingAssetsVal = Number(userStakeAccount.unbondingAssets) / 1_000_000;
          const unlockTime = Number(userStakeAccount.expectedUnlockTime);

          setUserShares(shares);
          setUserShareBalance(shares); // For backwards compatibility with UI
          setUnbondingShares(unbondingSharesVal);
          setUnbondingAssets(unbondingAssetsVal);
          setExpectedUnlockTime(unlockTime);

          // Calculate user share value using preview_unstake
          if (shares > 0) {
            try {
              const assets = await program.methods
                .previewUnstake(new BN(userStakeAccount.shares.toString()))
                .accounts({
                  vaultState,
                })
                .view();
              setUserShareValue(Number(assets) / 1_000_000);
            } catch {
              // Fallback: estimate value from exchange rate
              setUserShareValue(shares * exchangeRate);
            }
          } else {
            setUserShareValue(unbondingAssetsVal); // Show unbonding assets if no active shares
          }
        } else {
          // User has no stake account yet
          setUserShares(0);
          setUserShareBalance(0);
          setUnbondingShares(0);
          setUnbondingAssets(0);
          setExpectedUnlockTime(0);
          setUserShareValue(0);
        }
      } catch (error) {
        console.log("User stake account not found:", error);
        if (retryCount < maxRetries) {
          const delay = Math.pow(2, retryCount) * 1000;
          setTimeout(() => {
            fetchUserData(retryCount + 1, maxRetries);
          }, delay);
          return;
        }
        setUserShares(0);
        setUserShareBalance(0);
        setUnbondingShares(0);
        setUnbondingAssets(0);
        setExpectedUnlockTime(0);
        setUserShareValue(0);
      }
    } catch (error) {
      console.error("Failed to fetch user data:", error);
    } finally {
      setRefreshing(false);
    }
  }, [wallet, connection, program, exchangeRate]);

  // Countdown timer for exit mode and unbonding
  useEffect(() => {
    const interval = setInterval(() => {
      const now = Date.now() / 1000;

      // Exit mode countdown (before is_frozen)
      if (!isFrozen) {
        const diff = EXIT_MODE_TARGET_DATE - now;
        if (diff > 0) {
          const days = Math.floor(diff / 86400);
          const hours = Math.floor((diff % 86400) / 3600);
          const mins = Math.floor((diff % 3600) / 60);
          const secs = Math.floor(diff % 60);
          setExitModeCountdown(`${days}D ${hours}H ${mins}M ${secs}S`);
        } else {
          setExitModeCountdown("AWAITING EXIT MODE");
        }
      }

      // Unbonding countdown
      if (unbondingShares > 0 && expectedUnlockTime > 0) {
        const diff = expectedUnlockTime - now;
        if (diff > 0) {
          const hours = Math.floor(diff / 3600);
          const mins = Math.floor((diff % 3600) / 60);
          const secs = Math.floor(diff % 60);
          setUnbondingCountdown(`${hours}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`);
        } else {
          setUnbondingCountdown("");
        }
      } else {
        setUnbondingCountdown("");
      }
    }, 1000);

    return () => clearInterval(interval);
  }, [isFrozen, unbondingShares, expectedUnlockTime]);

  // Fetch public data on mount (no wallet required)
  useEffect(() => {
    fetchPublicVaultData();
  }, [fetchPublicVaultData]);

  // Fetch user data when wallet connects
  useEffect(() => {
    if (wallet) {
      fetchUserData();
    }
  }, [wallet, fetchUserData]);

  // Fetch staker trades
  const fetchStakerTrades = useCallback(async () => {
    setTradesLoading(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/stakers/trades?limit=100&period=${timeFilter}`);
      const data = await response.json();
      setStakerTrades(data.trades || []);
    } catch (error) {
      console.error("Failed to fetch staker trades:", error);
      setStakerTrades([]);
    } finally {
      setTradesLoading(false);
    }
  }, [timeFilter]);

  const fetchStakersList = useCallback(async () => {
    setStakersLoading(true);
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/stakers/list?period=${timeFilter}`);
      const data = await response.json();
      setStakersList(data.stakers || []);
    } catch (error) {
      console.error("Failed to fetch stakers list:", error);
      setStakersList([]);
    } finally {
      setStakersLoading(false);
    }
  }, [timeFilter]);

  // Fetch slashed amount for current user
  const fetchSlashedAmount = useCallback(async () => {
    if (!walletAddress) {
      setSlashedAmount(0);
      return;
    }
    try {
      const response = await fetch(`${process.env.NEXT_PUBLIC_API_URL}/api/stakers/slashed/${walletAddress}`);
      const data = await response.json();
      setSlashedAmount(data.totalSlashed || 0);
    } catch (error) {
      console.error("Failed to fetch slashed amount:", error);
      setSlashedAmount(0);
    }
  }, [walletAddress]);

  // Fetch slashed amount when wallet connects
  useEffect(() => {
    if (walletAddress) {
      fetchSlashedAmount();
    }
  }, [walletAddress, fetchSlashedAmount]);

  // Fetch data when tab is selected
  useEffect(() => {
    if (vaultTab === 'trades') {
      fetchStakerTrades();
    } else if (vaultTab === 'stakers') {
      fetchStakersList();
    }
  }, [vaultTab, fetchStakerTrades, fetchStakersList]);

  // Helper functions for trades table
  const getTimeAgo = useCallback((timestamp: string) => {
    const now = Date.now();
    const then = new Date(timestamp).getTime();
    const diff = now - then;

    const seconds = Math.floor(diff / 1000);
    const minutes = Math.floor(diff / (1000 * 60));
    const hours = Math.floor(diff / (1000 * 60 * 60));
    const days = Math.floor(diff / (1000 * 60 * 60 * 24));

    if (days > 0) return `${days}d`;
    if (hours > 0) return `${hours}h`;
    if (minutes > 0) return `${minutes}m`;
    if (seconds > 0) return `${seconds}s`;
    return 'now';
  }, []);

  const formatTradeAddress = useCallback((address: string) => {
    if (!address || address.length <= 13) return address || '';
    return `${address.slice(0, 6)}...${address.slice(-6)}`;
  }, []);

  // Sort stakers list
  const sortedStakersList = useMemo(() => {
    return [...stakersList].sort((a, b) => {
      const aVal = stakersSort.column === 'balance' ? parseFloat(a.balance) : parseFloat(a.volumeUsd);
      const bVal = stakersSort.column === 'balance' ? parseFloat(b.balance) : parseFloat(b.volumeUsd);
      return stakersSort.direction === 'desc' ? bVal - aVal : aVal - bVal;
    });
  }, [stakersList, stakersSort]);

  const toggleStakersSort = useCallback((column: 'balance' | 'volume') => {
    setStakersSort(prev => ({
      column,
      direction: prev.column === column && prev.direction === 'desc' ? 'asc' : 'desc'
    }));
  }, []);

  const handleDeposit = async () => {
    const depositAmount = parseFloat(amount);
    if (!depositAmount || depositAmount <= 0) {
      toast.error('Please enter a valid deposit amount');
      return;
    }

    const walletProvider = (window as WindowWithWallets).solana || (window as WindowWithWallets).solflare;
    if (!wallet || !walletProvider) {
      toast.error('Please connect your wallet first');
      return;
    }

    const toastId = toast.loading(`Staking ${depositAmount} ZC...`);

    try {
      setLoading(true);
      if (!program) throw new Error("Program not available");

      const depositAmountBN = new BN(depositAmount * 1_000_000);

      const [vaultState] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_state")],
        PROGRAM_ID
      );
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_pda")],
        PROGRAM_ID
      );
      const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_vault"), ZC_TOKEN_MINT.toBuffer()],
        PROGRAM_ID
      );
      const [userStakePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_stake"), vaultState.toBuffer(), wallet.toBuffer()],
        PROGRAM_ID
      );

      const userTokenAccount = await getAssociatedTokenAddress(ZC_TOKEN_MINT, wallet);

      const stakeIx = await program.methods
        .stake(depositAmountBN)
        .accounts({
          vaultState,
          userStake: userStakePda,
          vaultPda,
          vaultTokenAccount,
          userTokenAccount,
          signer: wallet,
          systemProgram: new PublicKey("11111111111111111111111111111111"),
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();

      const transaction = new Transaction();
      transaction.add(stakeIx);

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = wallet;

      const { signature } = await walletProvider.signAndSendTransaction(transaction);
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      });

      toast.success(`Staked ${depositAmount} ZC to the vault`, { id: toastId });
      setAmount("");

      setPostTransactionRefreshing(true);
      setTimeout(async () => {
        await Promise.all([fetchPublicVaultData(), fetchUserData()]);
        setPostTransactionRefreshing(false);
      }, 8000);
    } catch (error) {
      console.error("Deposit failed:", error);
      toast.error(error instanceof Error ? error.message : "Failed to deposit tokens", { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  // Request unstake - starts 24h unbonding period (always 100% of shares)
  const handleRequestUnstake = async () => {
    const walletProvider = (window as WindowWithWallets).solana || (window as WindowWithWallets).solflare;
    if (!wallet || !walletProvider) {
      toast.error('Please connect your wallet first');
      return;
    }

    const toastId = toast.loading('Requesting unstake for 100% of staked ZC...');

    try {
      setLoading(true);
      if (!program) throw new Error("Program not available");

      const [vaultState] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_state")],
        PROGRAM_ID
      );
      const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_vault"), ZC_TOKEN_MINT.toBuffer()],
        PROGRAM_ID
      );
      const [userStakePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_stake"), vaultState.toBuffer(), wallet.toBuffer()],
        PROGRAM_ID
      );

      // Unstake all shares (100%)
      const sharesToUnstake = new BN(Math.floor(userShares * 1_000_000));

      const requestUnstakeIx = await program.methods
        .requestUnstake(sharesToUnstake)
        .accounts({
          vaultState,
          userStake: userStakePda,
          vaultTokenAccount,
          signer: wallet,
        })
        .instruction();

      const transaction = new Transaction();
      transaction.add(requestUnstakeIx);

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = wallet;

      const { signature } = await walletProvider.signAndSendTransaction(transaction);
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      });

      toast.success(`Unstake requested! 24h countdown started.`, { id: toastId });

      setPostTransactionRefreshing(true);
      setTimeout(async () => {
        await Promise.all([fetchPublicVaultData(), fetchUserData()]);
        setPostTransactionRefreshing(false);
      }, 8000);
    } catch (error) {
      console.error("Request unstake failed:", error);
      toast.error(error instanceof Error ? error.message : "Failed to request unstake", { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  // Cancel unstake - re-stakes unbonding shares (only when vault not frozen)
  const handleCancelUnstake = async () => {
    const walletProvider = (window as WindowWithWallets).solana || (window as WindowWithWallets).solflare;
    if (!wallet || !walletProvider) {
      toast.error('Please connect your wallet first');
      return;
    }

    const toastId = toast.loading(`Cancelling unstake request...`);

    try {
      setLoading(true);
      if (!program) throw new Error("Program not available");

      const [vaultState] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_state")],
        PROGRAM_ID
      );
      const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_vault"), ZC_TOKEN_MINT.toBuffer()],
        PROGRAM_ID
      );
      const [userStakePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_stake"), vaultState.toBuffer(), wallet.toBuffer()],
        PROGRAM_ID
      );

      const cancelUnstakeIx = await program.methods
        .cancelUnstake()
        .accounts({
          vaultState,
          userStake: userStakePda,
          vaultTokenAccount,
          signer: wallet,
        })
        .instruction();

      const transaction = new Transaction();
      transaction.add(cancelUnstakeIx);

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = wallet;

      const { signature } = await walletProvider.signAndSendTransaction(transaction);
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      });

      toast.success(`Unstake cancelled! Shares re-staked.`, { id: toastId });

      setPostTransactionRefreshing(true);
      setTimeout(async () => {
        await Promise.all([fetchPublicVaultData(), fetchUserData()]);
        setPostTransactionRefreshing(false);
      }, 8000);
    } catch (error) {
      console.error("Cancel unstake failed:", error);
      toast.error(error instanceof Error ? error.message : "Failed to cancel unstake", { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  // Complete unstake - withdraw tokens after 24h unbonding period
  const handleCompleteUnstake = async () => {
    const walletProvider = (window as WindowWithWallets).solana || (window as WindowWithWallets).solflare;
    if (!wallet || !walletProvider) {
      toast.error('Please connect your wallet first');
      return;
    }

    const toastId = toast.loading(`Completing unstake...`);

    try {
      setLoading(true);
      if (!program) throw new Error("Program not available");

      const [vaultState] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_state")],
        PROGRAM_ID
      );
      const [vaultPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_pda")],
        PROGRAM_ID
      );
      const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_vault"), ZC_TOKEN_MINT.toBuffer()],
        PROGRAM_ID
      );
      const [userStakePda] = PublicKey.findProgramAddressSync(
        [Buffer.from("user_stake"), vaultState.toBuffer(), wallet.toBuffer()],
        PROGRAM_ID
      );

      const userTokenAccount = await getAssociatedTokenAddress(ZC_TOKEN_MINT, wallet);

      const transaction = new Transaction();

      // Ensure user has ZC token account
      try {
        await getAccount(connection, userTokenAccount);
      } catch {
        const createATAIx = createAssociatedTokenAccountInstruction(
          wallet,
          userTokenAccount,
          wallet,
          ZC_TOKEN_MINT,
          TOKEN_PROGRAM_ID
        );
        transaction.add(createATAIx);
      }

      const completeUnstakeIx = await program.methods
        .completeUnstake()
        .accounts({
          vaultState,
          userStake: userStakePda,
          vaultPda,
          vaultTokenAccount,
          userTokenAccount,
          signer: wallet,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();

      transaction.add(completeUnstakeIx);

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = wallet;

      const { signature } = await walletProvider.signAndSendTransaction(transaction);
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      });

      toast.success(`Unstake complete! ZC transferred to your wallet.`, { id: toastId });

      setPostTransactionRefreshing(true);
      setTimeout(async () => {
        await Promise.all([fetchPublicVaultData(), fetchUserData()]);
        setPostTransactionRefreshing(false);
      }, 8000);
    } catch (error) {
      console.error("Complete unstake failed:", error);
      toast.error(error instanceof Error ? error.message : "Failed to complete unstake", { id: toastId });
    } finally {
      setLoading(false);
    }
  };

  const formatCompactNumber = (num: number): string => {
    if (num >= 1_000_000_000) {
      return `${(num / 1_000_000_000).toFixed(1)}B`;
    } else if (num >= 1_000_000) {
      return `${(num / 1_000_000).toFixed(1)}M`;
    } else if (num >= 1_000) {
      return `${(num / 1_000).toFixed(1)}K`;
    }
    return num.toLocaleString();
  };

  const hasWalletBalance = solBalance > 0 || baseTokenBalance > 0;

  return (
    <div className="flex h-screen" style={{ backgroundColor: '#0a0a0a' }}>
      <div className="flex-1 flex flex-col">
        <Header
          walletAddress={walletAddress}
          authenticated={authenticated}
          solBalance={solBalance}
          baseTokenBalance={baseTokenBalance}
          hasWalletBalance={hasWalletBalance}
          login={login}
          isPassMode={true}
          tokenSlug={tokenSlug}
          tokenSymbol={tokenSymbol}
          tokenIcon={icon}
          poolAddress={poolAddress}
        />

        {/* Content Area */}
        <div className="flex-1 flex overflow-hidden">
          <div className="flex-1 flex justify-center overflow-y-auto">
            <div className="w-full max-w-[1332px] 2xl:max-w-[1512px] pt-8 pb-8 px-4 md:px-0">
              {/* Page Title */}
              <div className="mb-6">
                <h2 className="text-2xl font-medium" style={{ color: '#E9E9E3' }}>
                  Stake
                </h2>
              </div>

              {/* Cards Layout - 2/3 + 1/3 columns */}
              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                {/* Left Column: Vault Stats (2/3 width) */}
                <div className="contents md:flex md:col-span-2 md:flex-col md:gap-4 md:pb-12">
                  <div className={`bg-[#121212] border border-[#191919] rounded-[9px] flex flex-col md:flex-1 ${vaultTab === 'trades' || vaultTab === 'stakers' ? '' : 'py-4 px-5'}`}>
                  {/* Header with title left, toggle right */}
                  <div className={`flex items-center justify-between ${vaultTab === 'trades' || vaultTab === 'stakers' ? 'py-4 px-5' : 'mb-4'}`}>
                    <span className={`text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] uppercase ${vaultTab !== 'stats' ? 'hidden md:inline' : ''}`} style={{ color: '#DDDDD7' }}>
                      <span className="md:hidden">Vault</span>
                      <span className="hidden md:inline">{vaultTab === 'stats' ? 'ZC Stakers Vault' : vaultTab === 'stakers' ? 'ZC Stakers' : 'ZC Stakers QM Trades'}</span>
                    </span>

                    <div className="flex items-center gap-2">
                      {/* Time Filter Toggle - only shows on stakers/trades tabs */}
                      {(vaultTab === 'stakers' || vaultTab === 'trades') && (
                        <div className="flex items-center gap-[2px] p-[3px] border border-[#191919] rounded-full">
                          <button
                            onClick={() => setTimeFilter("1D")}
                            className={`px-3 py-1 rounded-full text-xs font-medium transition cursor-pointer font-ibm-plex-mono ${
                              timeFilter === '1D'
                                ? 'bg-[#DDDDD7]'
                                : 'bg-transparent'
                            }`}
                            style={timeFilter === '1D' ? { color: '#161616', fontFamily: 'IBM Plex Mono, monospace' } : { color: '#6B6E71', fontFamily: 'IBM Plex Mono, monospace' }}
                          >
                            1D
                          </button>
                          <button
                            onClick={() => setTimeFilter("1W")}
                            className={`px-3 py-1 rounded-full text-xs font-medium transition cursor-pointer font-ibm-plex-mono ${
                              timeFilter === '1W'
                                ? 'bg-[#DDDDD7]'
                                : 'bg-transparent'
                            }`}
                            style={timeFilter === '1W' ? { color: '#161616', fontFamily: 'IBM Plex Mono, monospace' } : { color: '#6B6E71', fontFamily: 'IBM Plex Mono, monospace' }}
                          >
                            1W
                          </button>
                          <button
                            onClick={() => setTimeFilter("ALL")}
                            className={`px-3 py-1 rounded-full text-xs font-medium transition cursor-pointer font-ibm-plex-mono ${
                              timeFilter === 'ALL'
                                ? 'bg-[#DDDDD7]'
                                : 'bg-transparent'
                            }`}
                            style={timeFilter === 'ALL' ? { color: '#161616', fontFamily: 'IBM Plex Mono, monospace' } : { color: '#6B6E71', fontFamily: 'IBM Plex Mono, monospace' }}
                          >
                            ALL
                          </button>
                        </div>
                      )}

                      {/* Triple Toggle */}
                      <div className="flex items-center gap-[2px] p-[3px] border border-[#191919] rounded-full">
                        <button
                          onClick={() => setVaultTab("stats")}
                          className={`px-3 py-1 rounded-full text-xs font-medium transition cursor-pointer font-ibm-plex-mono ${
                            vaultTab === 'stats'
                              ? 'bg-[#DDDDD7]'
                              : 'bg-transparent'
                          }`}
                          style={vaultTab === 'stats' ? { color: '#161616', fontFamily: 'IBM Plex Mono, monospace' } : { color: '#6B6E71', fontFamily: 'IBM Plex Mono, monospace' }}
                        >
                          Stats
                        </button>
                        <button
                          onClick={() => setVaultTab("stakers")}
                          className={`px-3 py-1 rounded-full text-xs font-medium transition cursor-pointer font-ibm-plex-mono ${
                            vaultTab === 'stakers'
                              ? 'bg-[#DDDDD7]'
                              : 'bg-transparent'
                          }`}
                          style={vaultTab === 'stakers' ? { color: '#161616', fontFamily: 'IBM Plex Mono, monospace' } : { color: '#6B6E71', fontFamily: 'IBM Plex Mono, monospace' }}
                        >
                          Stakers
                        </button>
                        <button
                          onClick={() => setVaultTab("trades")}
                          className={`px-3 py-1 rounded-full text-xs font-medium transition cursor-pointer font-ibm-plex-mono ${
                            vaultTab === 'trades'
                              ? 'bg-[#DDDDD7]'
                              : 'bg-transparent'
                          }`}
                          style={vaultTab === 'trades' ? { color: '#161616', fontFamily: 'IBM Plex Mono, monospace' } : { color: '#6B6E71', fontFamily: 'IBM Plex Mono, monospace' }}
                        >
                          Trades
                        </button>
                      </div>
                    </div>
                  </div>

                  {/* Bordered Container - Content changes based on tab */}
                  <div className={`flex-1 flex flex-col px-5 ${vaultTab === 'trades' || vaultTab === 'stakers' ? 'pb-4' : 'border border-[#191919] rounded-[6px] py-6'}`}>
                    {vaultTab === 'stats' ? (
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-x-3 gap-y-5 flex-1">
                        {/* TVL Box */}
                        <div className="flex flex-col">
                          <div className="flex-1 border border-[#191919] rounded-[30px] px-4 py-6 md:py-0 flex flex-col items-center justify-center">
                            <p className="text-[60px] leading-none font-semibold font-ibm-plex-mono" style={{ color: '#DDDDD7', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0em' }}>
                              {formatCompactNumber(vaultBalance)}
                            </p>
                          </div>
                          <p className="text-sm text-center mt-2" style={{ color: '#6B6E71', fontFamily: 'IBM Plex Mono, monospace' }}>
                            Total Value Locked (ZC)
                          </p>
                        </div>
                        {/* Exchange Rate Box */}
                        <div className="flex flex-col">
                          <div className="flex-1 border border-[#191919] rounded-[30px] px-4 py-6 md:py-0 flex flex-col items-center justify-center">
                            <p className="text-[60px] leading-none font-semibold font-ibm-plex-mono" style={{ color: '#DDDDD7', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0em' }}>
                              1:{exchangeRate > 0 ? exchangeRate.toFixed(3) : '1.000'}
                            </p>
                          </div>
                          <p className="text-sm text-center mt-2" style={{ color: '#6B6E71', fontFamily: 'IBM Plex Mono, monospace' }}>
                            sZC:ZC
                          </p>
                        </div>
                        {/* Stakers Box */}
                        <div className="flex flex-col">
                          <div className="flex-1 border border-[#191919] rounded-[30px] px-4 py-6 md:py-0 flex flex-col items-center justify-center">
                            <p className="text-[60px] leading-none font-semibold font-ibm-plex-mono" style={{ color: '#DDDDD7', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0em' }}>
                              {stakerCount}
                            </p>
                          </div>
                          <p className="text-sm text-center mt-2" style={{ color: '#6B6E71', fontFamily: 'IBM Plex Mono, monospace' }}>
                            Stakers
                          </p>
                        </div>
                        {/* QM Volume Box */}
                        <div className="flex flex-col">
                          <div className="flex-1 border border-[#191919] rounded-[30px] px-4 py-6 md:py-0 flex flex-col items-center justify-center">
                            <p className="text-[60px] leading-none font-semibold font-ibm-plex-mono" style={{ color: '#DDDDD7', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0em' }}>
                              {qmVolumeUsd >= 1000000
                                ? `$${(qmVolumeUsd / 1000000).toFixed(1)}M`
                                : qmVolumeUsd >= 1000
                                  ? `$${(qmVolumeUsd / 1000).toFixed(0)}K`
                                  : `$${qmVolumeUsd.toFixed(0)}`
                              }
                            </p>
                          </div>
                          <p className="text-sm text-center mt-2" style={{ color: '#6B6E71', fontFamily: 'IBM Plex Mono, monospace' }}>
                            Total QM Volume
                          </p>
                        </div>
                      </div>
                    ) : vaultTab === 'trades' ? (
                      <div className="flex-1 min-h-[400px] md:min-h-0 relative border border-[#191919] rounded-[6px]">
                        <div className="absolute inset-0 overflow-y-auto scrollbar-hide">
                        <table className="w-full text-sm">
                          <thead className="text-[#6B6E71] font-medium uppercase">
                            <tr>
                              <th className="py-3 pl-3 text-left font-medium w-[120px] md:w-auto">Staker</th>
                              <th className="py-3 text-left font-medium w-[100px]">QM</th>
                              <th className="py-3 text-left font-medium w-[100px]">Coin</th>
                              <th className="py-3 text-left font-medium w-[100px] hidden md:table-cell">Trade</th>
                              <th className="py-3 text-left font-medium w-[100px] hidden md:table-cell">Amount</th>
                              <th className="py-3 text-left font-medium">Tx</th>
                              <th className="py-3 pr-3 text-right font-medium">Age</th>
                            </tr>
                          </thead>
                          <tbody>
                          {tradesLoading ? (
                            <tr>
                              <td colSpan={7} className="py-8 text-center text-[#6B6E71]">
                                Loading trades...
                              </td>
                            </tr>
                          ) : stakerTrades.length === 0 ? (
                            <tr>
                              <td colSpan={7} className="py-8 text-center text-[#6B6E71]">
                                No trades yet
                              </td>
                            </tr>
                          ) : (
                            stakerTrades.map((trade) => {
                              const isBuy = !trade.isBaseToQuote;
                              const amount = parseFloat(trade.amountIn);
                              const tokenUsed = trade.isBaseToQuote ? 'ZC' : 'SOL';

                              const removeTrailingZeros = (num: string): string => {
                                return num.replace(/\.?0+$/, '');
                              };

                              let formattedAmount;
                              if (tokenUsed === 'SOL') {
                                formattedAmount = removeTrailingZeros(amount.toFixed(3));
                              } else {
                                if (amount >= 1000000000) {
                                  formattedAmount = removeTrailingZeros((amount / 1000000000).toFixed(3)) + 'B';
                                } else if (amount >= 1000000) {
                                  formattedAmount = removeTrailingZeros((amount / 1000000).toFixed(3)) + 'M';
                                } else if (amount >= 1000) {
                                  formattedAmount = removeTrailingZeros((amount / 1000).toFixed(3)) + 'K';
                                } else {
                                  formattedAmount = removeTrailingZeros(amount.toFixed(3));
                                }
                              }

                              return (
                                <tr
                                  key={trade.id}
                                  className="border-t border-[#191919] hover:bg-[#1a1a1a] transition-colors"
                                  style={{ color: '#E9E9E3' }}
                                >
                                  <td className="py-3 pl-3 whitespace-nowrap" style={{ color: '#DDDDD7' }}>
                                    <span className="md:hidden">{trade.userAddress.slice(0, 6)}</span>
                                    <span className="hidden md:inline">{formatTradeAddress(trade.userAddress)}</span>
                                    <button
                                      onClick={() => navigator.clipboard.writeText(trade.userAddress)}
                                      className="text-[#6B6E71] hover:text-theme-text transition-colors ml-1 inline"
                                      title="Copy address"
                                    >
                                      <svg
                                        width="12"
                                        height="12"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        className="inline"
                                      >
                                        <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                        <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                      </svg>
                                    </button>
                                    <a
                                      href={`https://solscan.io/account/${trade.userAddress}`}
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="text-[#6B6E71] hover:text-theme-text transition-colors ml-1 inline"
                                      title="View on Solscan"
                                    >
                                      <svg
                                        width="12"
                                        height="12"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                        strokeLinecap="round"
                                        strokeLinejoin="round"
                                        className="inline"
                                      >
                                        <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                                        <polyline points="15 3 21 3 21 9"></polyline>
                                        <line x1="10" y1="14" x2="21" y2="3"></line>
                                      </svg>
                                    </a>
                                  </td>
                                  <td className="py-3 w-[100px]" style={{ color: '#DDDDD7' }}>
                                    {trade.ticker}-{trade.proposalId}
                                  </td>
                                  <td className="py-3 w-[100px]" style={{ color: '#DDDDD7' }}>
                                    {trade.marketLabel}
                                  </td>
                                  <td className="py-3 w-[100px] hidden md:table-cell" style={{ color: isBuy ? '#6ECC94' : '#FF6F94' }}>
                                    {isBuy ? 'Buy' : 'Sell'}
                                  </td>
                                  <td className="py-3 w-[100px] hidden md:table-cell" style={{ color: '#DDDDD7' }}>
                                    {formattedAmount} {tokenUsed}
                                  </td>
                                  <td className="py-3 whitespace-nowrap" style={{ color: '#DDDDD7' }}>
                                    {trade.txSignature ? (
                                      <>
                                        <span className="md:hidden">{trade.txSignature.slice(0, 6)}</span>
                                        <span className="hidden md:inline">{trade.txSignature.slice(0, 12)}...</span>
                                      </>
                                    ) : '—'}
                                    {trade.txSignature && (
                                      <a
                                        href={`https://solscan.io/tx/${trade.txSignature}`}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        className="text-[#6B6E71] hover:text-theme-text transition-colors ml-1 inline"
                                      >
                                        <svg
                                          width="12"
                                          height="12"
                                          viewBox="0 0 24 24"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                          strokeLinecap="round"
                                          strokeLinejoin="round"
                                          className="inline"
                                        >
                                          <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                                          <polyline points="15 3 21 3 21 9"></polyline>
                                          <line x1="10" y1="14" x2="21" y2="3"></line>
                                        </svg>
                                      </a>
                                    )}
                                  </td>
                                  <td className="py-3 pr-3 text-right text-[#6B6E71]">{getTimeAgo(trade.timestamp)}</td>
                                </tr>
                              );
                            })
                          )}
                          </tbody>
                        </table>
                        </div>
                      </div>
                    ) : (
                      <div className="flex-1 min-h-[400px] md:min-h-0 relative border border-[#191919] rounded-[6px]">
                        <div className="absolute inset-0 overflow-y-auto scrollbar-hide">
                        <table className="w-full text-sm">
                          <thead className="text-[#6B6E71] font-medium uppercase">
                            <tr>
                              <th className="py-3 pl-3 text-left font-medium">Staker</th>
                              <th
                                className="py-3 text-right font-medium cursor-pointer hover:text-[#DDDDD7] transition-colors select-none"
                                onClick={() => toggleStakersSort('volume')}
                              >
                                QM Vol
                              </th>
                              <th
                                className="py-3 pr-3 text-right font-medium cursor-pointer hover:text-[#DDDDD7] transition-colors select-none"
                                onClick={() => toggleStakersSort('balance')}
                              >
                                Staked ZC Bal
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                          {stakersLoading ? (
                            <tr>
                              <td colSpan={3} className="py-8 text-center text-[#6B6E71]">
                                Loading stakers...
                              </td>
                            </tr>
                          ) : stakersList.length === 0 ? (
                            <tr>
                              <td colSpan={3} className="py-8 text-center text-[#6B6E71]">
                                No stakers yet
                              </td>
                            </tr>
                          ) : (
                            sortedStakersList.map((staker) => (
                              <tr
                                key={staker.address}
                                className="border-t border-[#191919] hover:bg-[#1a1a1a] transition-colors"
                                style={{ color: '#E9E9E3' }}
                              >
                                <td className="py-3 pl-3 whitespace-nowrap" style={{ color: '#DDDDD7' }}>
                                  <span className="md:hidden">{staker.address.slice(0, 6)}</span>
                                  <span className="hidden md:inline">{formatTradeAddress(staker.address)}</span>
                                  <button
                                    onClick={() => navigator.clipboard.writeText(staker.address)}
                                    className="text-[#6B6E71] hover:text-theme-text transition-colors ml-1 inline"
                                    title="Copy address"
                                  >
                                    <svg
                                      width="12"
                                      height="12"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      className="inline"
                                    >
                                      <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                                      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
                                    </svg>
                                  </button>
                                  <a
                                    href={`https://solscan.io/account/${staker.address}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="text-[#6B6E71] hover:text-theme-text transition-colors ml-1 inline"
                                    title="View on Solscan"
                                  >
                                    <svg
                                      width="12"
                                      height="12"
                                      viewBox="0 0 24 24"
                                      fill="none"
                                      stroke="currentColor"
                                      strokeWidth="2"
                                      strokeLinecap="round"
                                      strokeLinejoin="round"
                                      className="inline"
                                    >
                                      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"></path>
                                      <polyline points="15 3 21 3 21 9"></polyline>
                                      <line x1="10" y1="14" x2="21" y2="3"></line>
                                    </svg>
                                  </a>
                                </td>
                                <td className="py-3 text-right" style={{ color: '#DDDDD7' }}>
                                  {(() => {
                                    const vol = parseFloat(staker.volumeUsd);
                                    if (vol >= 1000000) return `$${(vol / 1000000).toFixed(2)}M`;
                                    if (vol >= 1000) return `$${(vol / 1000).toFixed(2)}K`;
                                    return `$${vol.toFixed(2)}`;
                                  })()}
                                </td>
                                <td className="py-3 pr-3 text-right" style={{ color: '#DDDDD7' }}>
                                  <span className="md:hidden">
                                    {(() => {
                                      const bal = parseFloat(staker.balance);
                                      if (bal >= 1000000000) return `${(bal / 1000000000).toFixed(1)}B`;
                                      if (bal >= 1000000) return `${(bal / 1000000).toFixed(1)}M`;
                                      if (bal >= 1000) return `${(bal / 1000).toFixed(1)}K`;
                                      return bal.toFixed(0);
                                    })()} ({staker.percentage}%)
                                  </span>
                                  <span className="hidden md:inline">
                                    {parseFloat(staker.balance).toLocaleString()} ({staker.percentage}%)
                                  </span>
                                </td>
                              </tr>
                            ))
                          )}
                          </tbody>
                        </table>
                        </div>
                      </div>
                    )}
                  </div>
                  </div>
                </div>

                {/* Right Column: How It Works + Your Position + Stake/Redeem stacked (1/3 width) */}
                <div className="contents md:flex md:col-span-1 md:flex-col md:gap-4 md:pb-12">
                  {/* How It Works Card */}
                  <a
                    href="https://docs.combinator.trade/staking"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="order-first md:order-none"
                  >
                    <div className="bg-[#121212] border border-[#191919] rounded-[9px] pt-4 pb-5 px-5 hover:border-[#2A2A2A] transition-all duration-300 cursor-pointer h-full">
                      <h1 className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] mb-4 uppercase flex items-center justify-between" style={{ color: '#DDDDD7' }}>
                        How It Works
                        <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth="1">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
                        </svg>
                      </h1>
                      <div className="text-sm" style={{ color: '#DDDDD7' }}>
                        Staked $ZC acts as a license to earn protocol fees, conditional on you trading and proposing QMs. The community polices this obligation. If you passively collect rewards without contributing, a{' '}
                        <span
                          className="underline"
                          style={{ color: '#BEE8FC' }}
                          onClick={(e) => {
                            e.preventDefault();
                            e.stopPropagation();
                            window.location.href = '/zc/create?reportStaker=true';
                          }}
                        >
                          QM is initiated to slash
                        </span>
                        {' '}and redistribute your stake.
                      </div>
                    </div>
                  </a>

                  {/* Your Position Card */}
                  <div className="bg-[#121212] border border-[#191919] rounded-[9px] py-4 px-5 flex flex-col min-h-[280px]">
                    <span className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] uppercase mb-4 block text-center" style={{ color: '#DDDDD7' }}>
                      Your Position
                    </span>

                    {/* Bordered Container for Position Stats */}
                    <div className="border border-[#191919] rounded-[6px] py-6 px-4 flex-1 flex flex-col">
                      <div className="flex gap-3 flex-1">
                        {/* APY Box */}
                        <div className="flex-1 flex flex-col">
                          <div className="flex-1 border border-[#191919] rounded-[30px] px-4 flex flex-col items-center justify-center">
                            <p className="text-4xl font-semibold font-ibm-plex-mono" style={{ color: userShareValue > 0 ? '#DDDDD7' : '#6B6E71', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0em' }}>
                              {calculateAPY().toFixed(0)}%
                            </p>
                          </div>
                          <p className="text-sm text-center mt-2" style={{ color: '#6B6E71', fontFamily: 'IBM Plex Mono, monospace' }}>
                            APY
                          </p>
                        </div>
                        {/* Staked Box */}
                        <div className="flex-1 flex flex-col">
                          <div
                            className="flex-1 border border-[#191919] rounded-[30px] px-4 flex flex-col items-center justify-center cursor-pointer"
                            onMouseEnter={() => setIsHoveringStaked(true)}
                            onMouseLeave={() => setIsHoveringStaked(false)}
                          >
                            <p className="text-4xl font-semibold font-ibm-plex-mono" style={{ color: isHoveringStaked ? '#FF6F94' : '#DDDDD7', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0em' }}>
                              {wallet ? formatCompactNumber(isHoveringStaked ? slashedAmount : userShareValue) : '0'}
                            </p>
                          </div>
                          <p className="text-sm text-center mt-2" style={{ color: '#6B6E71', fontFamily: 'IBM Plex Mono, monospace' }}>
                            {isHoveringStaked ? 'Slashed (ZC)' : 'Staked (ZC)'}
                          </p>
                        </div>
                      </div>
                    </div>
                  </div>

                  {/* Stake/Redeem Form Card */}
                  <div className="pb-10 md:pb-0">
                  <div className="bg-[#121212] border border-[#191919] rounded-[9px] py-4 px-5">
                    <div className="flex flex-col gap-4">
                      {/* Title + Toggle Row */}
                      <div className="flex items-center justify-between">
                        {/* Title */}
                        <span className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] uppercase" style={{ color: '#DDDDD7' }}>
                          {modalMode === 'deposit' ? 'Stake ZC' : 'Redeem ZC'}
                        </span>

                        {/* Pill Toggle */}
                        <div className="flex items-center gap-[2px] p-[3px] border border-[#191919] rounded-full">
                          <button
                            onClick={() => setModalMode("deposit")}
                            className={`px-3 py-1 rounded-full text-xs font-medium transition cursor-pointer font-ibm-plex-mono ${
                              modalMode === 'deposit'
                                ? 'bg-[#DDDDD7]'
                                : 'bg-transparent'
                            }`}
                            style={modalMode === 'deposit' ? { color: '#161616', fontFamily: 'IBM Plex Mono, monospace' } : { color: '#6B6E71', fontFamily: 'IBM Plex Mono, monospace' }}
                          >
                            Stake
                          </button>
                          <button
                            onClick={() => setModalMode("redeem")}
                            className={`px-3 py-1 rounded-full text-xs font-medium transition cursor-pointer font-ibm-plex-mono ${
                              modalMode === 'redeem'
                                ? 'bg-[#DDDDD7]'
                                : 'bg-transparent'
                            }`}
                            style={modalMode === 'redeem' ? { color: '#161616', fontFamily: 'IBM Plex Mono, monospace' } : { color: '#6B6E71', fontFamily: 'IBM Plex Mono, monospace' }}
                          >
                            Redeem
                          </button>
                        </div>
                      </div>

                      {/* Input Section */}
                      <div className="flex flex-col gap-2">
                        {modalMode === "deposit" ? (
                          <>
                            <div className="relative">
                              <input
                                type="text"
                                placeholder="0.0"
                                value={amount}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  if (value === "" || /^\d*\.?\d*$/.test(value)) {
                                    setAmount(value);
                                  }
                                }}
                                className="w-full h-[56px] px-3 pr-24 bg-[#2a2a2a] rounded-[6px] text-white placeholder-gray-600 focus:outline-none border border-[#191919] text-2xl font-ibm-plex-mono"
                                style={{ WebkitAppearance: 'none', MozAppearance: 'textfield', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0em' }}
                                disabled={!wallet}
                                autoComplete="off"
                              />
                              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (zcBalance) {
                                      setAmount(zcBalance.toString());
                                    }
                                  }}
                                  className="px-2 h-7 rounded hover:bg-[#404040] transition cursor-pointer text-xs font-medium"
                                  style={{ color: '#AFAFAF' }}
                                >
                                  MAX
                                </button>
                                <div className="flex items-center justify-center px-2 h-7 bg-[#333] rounded">
                                  <span className="text-xs text-[#AFAFAF] font-bold">ZC</span>
                                </div>
                              </div>
                            </div>
                          </>
                        ) : (
                          <>
                            <div className="relative">
                              <input
                                type="text"
                                value="100"
                                readOnly
                                className="w-full h-[56px] px-3 pr-16 bg-[#1a1a1a] rounded-[6px] text-white focus:outline-none border border-[#191919] text-2xl font-ibm-plex-mono cursor-not-allowed"
                                style={{ WebkitAppearance: 'none', MozAppearance: 'textfield', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0em' }}
                              />
                              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                                <div className="flex items-center justify-center px-2 h-7 bg-[#333] rounded">
                                  <span className="text-xs text-[#AFAFAF] font-bold">%</span>
                                </div>
                              </div>
                            </div>
                          </>
                        )}
                      </div>

                      {/* Action Button */}
                      <div className="flex items-center justify-center mt-2">
                        {!wallet ? (
                          <button
                            onClick={login}
                            disabled={loading}
                            className="w-full h-[56px] rounded-full font-semibold transition cursor-pointer uppercase font-ibm-plex-mono bg-[#DDDDD7] disabled:opacity-50"
                            style={{ color: '#161616' }}
                          >
                            Connect Wallet
                          </button>
                        ) : modalMode === "deposit" ? (
                          <button
                            onClick={handleDeposit}
                            className="w-full h-[56px] rounded-full font-semibold transition cursor-pointer uppercase font-ibm-plex-mono disabled:cursor-not-allowed"
                            style={{
                              backgroundColor: loading || !amount || parseFloat(amount) <= 0 ? '#414346' : '#DDDDD7',
                              color: '#161616'
                            }}
                            disabled={loading || !amount || parseFloat(amount) <= 0}
                          >
                            {loading ? (
                              <span className="flex items-center justify-center gap-2">
                                <div className="animate-spin h-4 w-4 rounded-full border-2 border-[#161616] border-t-transparent"></div>
                                Processing...
                              </span>
                            ) : (
                              "Stake"
                            )}
                          </button>
                        ) : (
                          /* Redeem button with new unstaking flow */
                          (() => {
                            const now = Date.now() / 1000;
                            const hasUnbonding = unbondingShares > 0;
                            const unbondingComplete = hasUnbonding && expectedUnlockTime > 0 && now >= expectedUnlockTime;
                            const hasStakedFunds = userShares > 0 || hasUnbonding;

                            // No staked funds - show disabled button
                            if (!hasStakedFunds) {
                              return (
                                <button
                                  className="w-full h-[56px] rounded-full font-semibold transition uppercase font-ibm-plex-mono cursor-not-allowed"
                                  style={{ backgroundColor: '#414346', color: '#161616' }}
                                  disabled={true}
                                >
                                  No Shares to Redeem
                                </button>
                              );
                            }

                            // State 1: Before exit mode - show countdown (only if user has staked funds)
                            if (!isFrozen && !hasUnbonding) {
                              return (
                                <button
                                  className="w-full h-[56px] rounded-full font-semibold transition uppercase font-ibm-plex-mono cursor-not-allowed"
                                  style={{ backgroundColor: '#414346', color: '#161616' }}
                                  disabled={true}
                                >
                                  {exitModeCountdown || "AWAITING EXIT MODE"}
                                </button>
                              );
                            }

                            // State 4: Unbonding complete - COMPLETE UNSTAKE
                            if (unbondingComplete) {
                              return (
                                <button
                                  onClick={handleCompleteUnstake}
                                  className="w-full h-[56px] rounded-full font-semibold transition cursor-pointer uppercase font-ibm-plex-mono disabled:cursor-not-allowed"
                                  style={{
                                    backgroundColor: loading ? '#414346' : '#DDDDD7',
                                    color: '#161616'
                                  }}
                                  disabled={loading}
                                >
                                  {loading ? (
                                    <span className="flex items-center justify-center gap-2">
                                      <div className="animate-spin h-4 w-4 rounded-full border-2 border-[#161616] border-t-transparent"></div>
                                      Processing...
                                    </span>
                                  ) : (
                                    "COMPLETE UNSTAKE"
                                  )}
                                </button>
                              );
                            }

                            // State 3: Unbonding in progress - show countdown, hover shows CANCEL
                            if (hasUnbonding && !unbondingComplete) {
                              return (
                                <button
                                  onClick={isHoveringRedeem ? handleCancelUnstake : undefined}
                                  onMouseEnter={() => setIsHoveringRedeem(true)}
                                  onMouseLeave={() => setIsHoveringRedeem(false)}
                                  className="w-full h-[56px] rounded-full font-semibold transition cursor-pointer uppercase font-ibm-plex-mono disabled:cursor-not-allowed"
                                  style={{
                                    backgroundColor: loading ? '#414346' : isHoveringRedeem ? '#FF6F94' : '#DDDDD7',
                                    color: '#161616'
                                  }}
                                  disabled={loading}
                                >
                                  {loading ? (
                                    <span className="flex items-center justify-center gap-2">
                                      <div className="animate-spin h-4 w-4 rounded-full border-2 border-[#161616] border-t-transparent"></div>
                                      Processing...
                                    </span>
                                  ) : isHoveringRedeem ? (
                                    "CANCEL UNSTAKE"
                                  ) : (
                                    unbondingCountdown || "UNBONDING..."
                                  )}
                                </button>
                              );
                            }

                            // State 2: Exit mode active, no unbonding - REQUEST UNSTAKE
                            return (
                              <button
                                onClick={handleRequestUnstake}
                                className="w-full h-[56px] rounded-full font-semibold transition cursor-pointer uppercase font-ibm-plex-mono disabled:cursor-not-allowed"
                                style={{
                                  backgroundColor: loading || userShares === 0 ? '#414346' : '#DDDDD7',
                                  color: '#161616'
                                }}
                                disabled={loading || userShares === 0}
                              >
                                {loading ? (
                                  <span className="flex items-center justify-center gap-2">
                                    <div className="animate-spin h-4 w-4 rounded-full border-2 border-[#161616] border-t-transparent"></div>
                                    Processing...
                                  </span>
                                ) : userShares === 0 ? (
                                  "No Shares to Unstake"
                                ) : (
                                  "REQUEST UNSTAKE"
                                )}
                              </button>
                            );
                          })()
                        )}
                      </div>
                    </div>
                  </div>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
