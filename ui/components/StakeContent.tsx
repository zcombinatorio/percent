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
import VaultIDL from '@/lib/vault-idl.json';

const ZC_TOKEN_MINT = new PublicKey("GVvPZpC6ymCoiHzYJ7CWZ8LhVn9tL2AUpRjSAsLh6jZC");
const PROGRAM_ID = new PublicKey("6CETAFdgoMZgNHCcjnnQLN2pu5pJgUz8QQd7JzcynHmD");

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
  const [redeemPercent, setRedeemPercent] = useState<string>("");

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
    return new Program(VaultIDL as unknown as Program['idl'], provider);
  }, [getProvider]);

  const program = useMemo(() => getProgram(), [getProgram]);

  const calculateAPY = useCallback((): number => {
    if (vaultBalance === 0) return 0;
    const REWARD_TOKENS = 0;
    const rewardPerToken = REWARD_TOKENS / vaultBalance;
    const compoundingPeriodsPerYear = 52;
    return 100 * (Math.pow(1 + rewardPerToken, compoundingPeriodsPerYear) - 1);
  }, [vaultBalance]);

  // Fetch public vault data (TVL, exchange rate) - doesn't require wallet
  const fetchPublicVaultData = useCallback(async () => {
    try {
      const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_vault"), ZC_TOKEN_MINT.toBuffer()],
        PROGRAM_ID
      );
      const [shareMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("share_mint")],
        PROGRAM_ID
      );

      // Fetch TVL directly from vault token account
      try {
        const vaultTokenAccountInfo = await getAccount(connection, vaultTokenAccount);
        setVaultBalance(Number(vaultTokenAccountInfo.amount) / 1_000_000);
      } catch (error) {
        console.error("Failed to fetch vault balance:", error);
        setVaultBalance(0);
      }

      // Fetch exchange rate by comparing share supply to vault balance
      try {
        const shareMintInfo = await connection.getParsedAccountInfo(shareMint);
        const vaultTokenAccountInfo = await getAccount(connection, vaultTokenAccount);

        if (shareMintInfo.value?.data && 'parsed' in shareMintInfo.value.data) {
          const shareSupply = Number(shareMintInfo.value.data.parsed.info.supply);
          const vaultAmount = Number(vaultTokenAccountInfo.amount);

          if (shareSupply > 0) {
            // Exchange rate = vaultAmount / shareSupply (how much ZC per 1 sZC)
            setExchangeRate(vaultAmount / shareSupply);
          } else {
            setExchangeRate(1);
          }
        }
      } catch (error) {
        console.error("Failed to fetch exchange rate:", error);
        setExchangeRate(1);
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
  }, [connection]);

  // Fetch user-specific data (requires wallet)
  const fetchUserData = useCallback(async (retryCount = 0, maxRetries = 3) => {
    if (!program || !wallet) {
      setUserShareBalance(0);
      setUserShareValue(0);
      setZcBalance(0);
      return;
    }

    try {
      setRefreshing(true);

      const [vaultState] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_state")],
        PROGRAM_ID
      );
      const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_vault"), ZC_TOKEN_MINT.toBuffer()],
        PROGRAM_ID
      );
      const [shareMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("share_mint")],
        PROGRAM_ID
      );

      // Fetch vault state for withdrawals enabled
      try {
        const vaultStateAccountInfo = await connection.getAccountInfo(vaultState);
        if (vaultStateAccountInfo && vaultStateAccountInfo.data) {
          const vaultStateAccount = program.coder.accounts.decode("vaultState", vaultStateAccountInfo.data);
          setWithdrawalsEnabled(vaultStateAccount.operationsEnabled);
        } else {
          setWithdrawalsEnabled(false);
        }
      } catch (error) {
        console.error("Failed to fetch vault state:", error);
        setWithdrawalsEnabled(false);
      }

      // Fetch user ZC balance
      try {
        const userTokenAccount = await getAssociatedTokenAddress(ZC_TOKEN_MINT, wallet);
        const userTokenAccountInfo = await getAccount(connection, userTokenAccount);
        setZcBalance(Number(userTokenAccountInfo.amount) / 1_000_000);
      } catch {
        setZcBalance(0);
      }

      // Fetch user share balance and value
      try {
        const userShareAccount = await getAssociatedTokenAddress(shareMint, wallet);
        const userShareAccountInfo = await getAccount(connection, userShareAccount);
        const shareBalance = Number(userShareAccountInfo.amount) / 1_000_000;
        setUserShareBalance(shareBalance);

        if (shareBalance > 0) {
          const assets = await program.methods
            .previewRedeem(new BN(userShareAccountInfo.amount.toString()))
            .accounts({
              shareMint,
              vaultTokenAccount,
              mintOfTokenBeingSent: ZC_TOKEN_MINT,
            })
            .view();
          setUserShareValue(Number(assets) / 1_000_000);
        } else {
          setUserShareValue(0);
        }
      } catch {
        console.log("User share account not found");
        if (retryCount < maxRetries) {
          const delay = Math.pow(2, retryCount) * 1000;
          setTimeout(() => {
            fetchUserData(retryCount + 1, maxRetries);
          }, delay);
          return;
        }
        setUserShareBalance(0);
        setUserShareValue(0);
      }
    } catch (error) {
      console.error("Failed to fetch user data:", error);
    } finally {
      setRefreshing(false);
    }
  }, [wallet, connection, program]);

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
      const [tokenAccountOwnerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_account_owner_pda")],
        PROGRAM_ID
      );
      const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_vault"), ZC_TOKEN_MINT.toBuffer()],
        PROGRAM_ID
      );
      const [shareMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("share_mint")],
        PROGRAM_ID
      );

      const senderTokenAccount = await getAssociatedTokenAddress(ZC_TOKEN_MINT, wallet);
      const senderShareAccount = await getAssociatedTokenAddress(shareMint, wallet);

      const transaction = new Transaction();
      try {
        await getAccount(connection, senderShareAccount);
      } catch {
        const createATAIx = createAssociatedTokenAccountInstruction(
          wallet,
          senderShareAccount,
          wallet,
          shareMint,
          TOKEN_PROGRAM_ID
        );
        transaction.add(createATAIx);
      }

      const depositIx = await program.methods
        .deposit(depositAmountBN)
        .accounts({
          vaultState,
          tokenAccountOwnerPda,
          vaultTokenAccount,
          senderTokenAccount,
          senderShareAccount,
          shareMint,
          mintOfTokenBeingSent: ZC_TOKEN_MINT,
          signer: wallet,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();

      transaction.add(depositIx);

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

  const handleRedeem = async () => {
    const redeemPercentNum = parseFloat(redeemPercent);
    if (!redeemPercentNum || redeemPercentNum <= 0 || redeemPercentNum > 100) {
      toast.error('Please enter a valid percentage between 0 and 100');
      return;
    }

    const walletProvider = (window as WindowWithWallets).solana || (window as WindowWithWallets).solflare;
    if (!wallet || !walletProvider) {
      toast.error('Please connect your wallet first');
      return;
    }

    const toastId = toast.loading(`Redeeming ${redeemPercentNum}% of staked ZC...`);

    try {
      setLoading(true);
      if (!program) throw new Error("Program not available");

      const [shareMint] = PublicKey.findProgramAddressSync(
        [Buffer.from("share_mint")],
        PROGRAM_ID
      );
      const userShareAccount = await getAssociatedTokenAddress(shareMint, wallet);
      const userShareAccountInfo = await getAccount(connection, userShareAccount);
      const totalShares = userShareAccountInfo.amount;
      const sharesToRedeem = (totalShares * BigInt(Math.floor(redeemPercentNum * 100))) / BigInt(10000);

      const [vaultState] = PublicKey.findProgramAddressSync(
        [Buffer.from("vault_state")],
        PROGRAM_ID
      );
      const [tokenAccountOwnerPda] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_account_owner_pda")],
        PROGRAM_ID
      );
      const [vaultTokenAccount] = PublicKey.findProgramAddressSync(
        [Buffer.from("token_vault"), ZC_TOKEN_MINT.toBuffer()],
        PROGRAM_ID
      );

      const senderTokenAccount = await getAssociatedTokenAddress(ZC_TOKEN_MINT, wallet);
      const senderShareAccount = userShareAccount;

      const transaction = new Transaction();

      try {
        await getAccount(connection, senderTokenAccount);
      } catch {
        const createATAIx = createAssociatedTokenAccountInstruction(
          wallet,
          senderTokenAccount,
          wallet,
          ZC_TOKEN_MINT,
          TOKEN_PROGRAM_ID
        );
        transaction.add(createATAIx);
      }

      const redeemIx = await program.methods
        .redeem(new BN(sharesToRedeem.toString()))
        .accounts({
          vaultState,
          tokenAccountOwnerPda,
          vaultTokenAccount,
          senderTokenAccount,
          senderShareAccount,
          shareMint,
          mintOfTokenBeingSent: ZC_TOKEN_MINT,
          signer: wallet,
          tokenProgram: TOKEN_PROGRAM_ID,
        })
        .instruction();

      transaction.add(redeemIx);

      const { blockhash, lastValidBlockHeight } = await connection.getLatestBlockhash();
      transaction.recentBlockhash = blockhash;
      transaction.feePayer = wallet;

      const { signature } = await walletProvider.signAndSendTransaction(transaction);
      await connection.confirmTransaction({
        signature,
        blockhash,
        lastValidBlockHeight,
      });

      toast.success(`Redeemed ${redeemPercentNum}% of your vault shares for ZC`, { id: toastId });
      setRedeemPercent("");

      setPostTransactionRefreshing(true);
      setTimeout(async () => {
        await Promise.all([fetchPublicVaultData(), fetchUserData()]);
        setPostTransactionRefreshing(false);
      }, 8000);
    } catch (error) {
      console.error("Redemption failed:", error);
      toast.error(error instanceof Error ? error.message : "Failed to redeem shares", { id: toastId });
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
                    <span className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] uppercase" style={{ color: '#DDDDD7' }}>
                      {vaultTab === 'stats' ? 'ZC Stakers Vault' : vaultTab === 'stakers' ? 'ZC Stakers' : 'ZC Stakers QM Trades'}
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
                      <div className="grid grid-cols-2 gap-x-3 gap-y-5 flex-1">
                        {/* TVL Box */}
                        <div className="flex flex-col">
                          <div className="flex-1 border border-[#191919] rounded-[30px] px-4 flex flex-col items-center justify-center">
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
                          <div className="flex-1 border border-[#191919] rounded-[30px] px-4 flex flex-col items-center justify-center">
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
                          <div className="flex-1 border border-[#191919] rounded-[30px] px-4 flex flex-col items-center justify-center">
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
                          <div className="flex-1 border border-[#191919] rounded-[30px] px-4 flex flex-col items-center justify-center">
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
                      <div className="flex-1 min-h-0 relative border border-[#191919] rounded-[6px]">
                        <div className="absolute inset-0 overflow-y-auto scrollbar-hide">
                        <table className="w-full text-sm">
                          <thead className="text-[#6B6E71] font-medium uppercase">
                            <tr>
                              <th className="py-3 pl-3 text-left font-medium">Staker</th>
                              <th className="py-3 text-left font-medium w-[100px]">QM</th>
                              <th className="py-3 text-left font-medium w-[100px]">Coin</th>
                              <th className="py-3 text-left font-medium w-[100px]">Trade</th>
                              <th className="py-3 text-left font-medium w-[100px]">Amount</th>
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
                                    {formatTradeAddress(trade.userAddress)}
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
                                  <td className="py-3 w-[100px]" style={{ color: isBuy ? '#6ECC94' : '#FF6F94' }}>
                                    {isBuy ? 'Buy' : 'Sell'}
                                  </td>
                                  <td className="py-3 w-[100px]" style={{ color: '#DDDDD7' }}>
                                    {formattedAmount} {tokenUsed}
                                  </td>
                                  <td className="py-3 whitespace-nowrap" style={{ color: '#DDDDD7' }}>
                                    {trade.txSignature ? `${trade.txSignature.slice(0, 12)}...` : '—'}
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
                      <div className="flex-1 min-h-0 relative border border-[#191919] rounded-[6px]">
                        <div className="absolute inset-0 overflow-y-auto scrollbar-hide">
                        <table className="w-full text-sm">
                          <thead className="text-[#6B6E71] font-medium uppercase">
                            <tr>
                              <th className="py-3 pl-3 text-left font-medium">Staker</th>
                              <th
                                className="py-3 text-right font-medium cursor-pointer hover:text-[#DDDDD7] transition-colors select-none"
                                onClick={() => toggleStakersSort('volume')}
                              >
                                QM Trade Vol
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
                                  {formatTradeAddress(staker.address)}
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
                                  {parseFloat(staker.balance).toLocaleString()} ({staker.percentage}%)
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
                  <div className="bg-[#121212] border border-[#191919] rounded-[9px] pt-4 pb-5 px-5">
                    <h1 className="text-sm font-semibold font-ibm-plex-mono tracking-[0.2em] mb-4 uppercase text-center" style={{ color: '#DDDDD7' }}>
                      How It Works
                    </h1>
                    <div className="text-sm" style={{ color: '#DDDDD7' }}>
                      Staked $ZC acts as a license to earn protocol fees, conditional on you trading and proposing QMs. The community polices this obligation. If you passively collect rewards without contributing, a{' '}
                      <a
                        href="/zc/create?reportStaker=true"
                        className="underline hover:text-white transition-colors"
                        style={{ color: '#BEE8FC' }}
                      >
                        QM is initiated to slash
                      </a>
                      {' '}and redistribute your stake.
                    </div>
                  </div>

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
                            className="flex-1 border border-[#191919] rounded-[30px] px-4 flex flex-col items-center justify-center"
                            onMouseEnter={() => setIsHoveringStaked(true)}
                            onMouseLeave={() => setIsHoveringStaked(false)}
                          >
                            <p className="text-4xl font-semibold font-ibm-plex-mono" style={{ color: isHoveringStaked ? '#FF6F94' : '#DDDDD7', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0em' }}>
                              {wallet ? formatCompactNumber(userShareValue) : '0'}
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
                                placeholder="0.0"
                                value={redeemPercent}
                                onChange={(e) => {
                                  const value = e.target.value;
                                  if (value === "" || (/^\d*\.?\d*$/.test(value) && parseFloat(value) <= 100)) {
                                    setRedeemPercent(value);
                                  }
                                }}
                                className="w-full h-[56px] px-3 pr-24 bg-[#2a2a2a] rounded-[6px] text-white placeholder-gray-600 focus:outline-none border border-[#191919] text-2xl font-ibm-plex-mono"
                                style={{ WebkitAppearance: 'none', MozAppearance: 'textfield', fontFamily: 'IBM Plex Mono, monospace', letterSpacing: '0em' }}
                                disabled={!withdrawalsEnabled || !wallet}
                                autoComplete="off"
                              />
                              <div className="absolute right-2 top-1/2 -translate-y-1/2 flex items-center gap-1">
                                <button
                                  type="button"
                                  onClick={() => {
                                    if (userShareBalance > 0) {
                                      setRedeemPercent('100');
                                    }
                                  }}
                                  className="px-2 h-7 rounded hover:bg-[#404040] transition cursor-pointer text-xs font-medium"
                                  style={{ color: '#AFAFAF' }}
                                >
                                  MAX
                                </button>
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
                        ) : (
                          <button
                            onClick={modalMode === "deposit" ? handleDeposit : handleRedeem}
                            className="w-full h-[56px] rounded-full font-semibold transition cursor-pointer uppercase font-ibm-plex-mono disabled:cursor-not-allowed"
                            style={{
                              backgroundColor: loading || (modalMode === "deposit" ? (!amount || parseFloat(amount) <= 0) : (!redeemPercent || parseFloat(redeemPercent) <= 0 || !withdrawalsEnabled || userShareBalance === 0)) ? '#414346' : '#DDDDD7',
                              color: '#161616'
                            }}
                            disabled={
                              loading ||
                              (modalMode === "deposit" ? (!amount || parseFloat(amount) <= 0) : (!redeemPercent || parseFloat(redeemPercent) <= 0 || !withdrawalsEnabled || userShareBalance === 0))
                            }
                          >
                            {loading ? (
                              <span className="flex items-center justify-center gap-2">
                                <div className="animate-spin h-4 w-4 rounded-full border-2 border-[#161616] border-t-transparent"></div>
                                Processing...
                              </span>
                            ) : modalMode === "deposit" ? (
                              "Stake"
                            ) : !withdrawalsEnabled ? (
                              "Redemptions Disabled"
                            ) : userShareBalance === 0 ? (
                              "No Shares to Redeem"
                            ) : (
                              "Redeem"
                            )}
                          </button>
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
