import { formatNumber, formatCurrency } from '@/lib/formatters';
import { toDecimal } from '@/lib/constants/tokens';

interface PayoutCardProps {
  marketIndex: number;  // Which market this payout is for (0-3)
  isWinning: boolean;   // Whether this was the winning market
  label: string;
  amount: number;
  token: 'sol' | 'zc';
  tokenPrice: number;
  isHovered: boolean;
  onHover: (id: string | null) => void;
  hoverId: string;
}

const SolIcon = ({ className }: { className?: string }) => (
  <svg className={className} viewBox="0 0 101 88" fill="none" xmlns="http://www.w3.org/2000/svg">
    <path d="M100.48 69.3817L83.8068 86.8015C83.4444 87.1799 83.0058 87.4816 82.5185 87.6878C82.0312 87.894 81.5055 88.0003 80.9743 88H1.93563C1.55849 88 1.18957 87.8926 0.874202 87.6912C0.558829 87.4897 0.31074 87.2029 0.160416 86.8659C0.0100923 86.529 -0.0359181 86.1566 0.0280382 85.7945C0.0919944 85.4324 0.263131 85.0964 0.520422 84.8278L17.2061 67.408C17.5676 67.0306 18.0047 66.7295 18.4904 66.5234C18.9762 66.3172 19.5002 66.2104 20.0301 66.2095H99.0644C99.4415 66.2095 99.8104 66.3169 100.126 66.5183C100.441 66.7198 100.689 67.0065 100.84 67.3435C100.99 67.6804 101.036 68.0529 100.972 68.415C100.908 68.7771 100.737 69.1131 100.48 69.3817ZM83.8068 36.3032C83.4444 35.9248 83.0058 35.6231 82.5185 35.4169C82.0312 35.2108 81.5055 35.1045 80.9743 35.1048H1.93563C1.55849 35.1048 1.18957 35.2121 0.874202 35.4136C0.558829 35.6151 0.31074 35.9019 0.160416 36.2388C0.0100923 36.5758 -0.0359181 36.9482 0.0280382 37.3103C0.0919944 37.6723 0.263131 38.0083 0.520422 38.277L17.2061 55.6968C17.5676 56.0742 18.0047 56.3752 18.4904 56.5814C18.9762 56.7875 19.5002 56.8944 20.0301 56.8952H99.0644C99.4415 56.8952 99.8104 56.7879 100.126 56.5864C100.441 56.3849 100.689 56.0981 100.84 55.7612C100.99 55.4242 101.036 55.0518 100.972 54.6897C100.908 54.3277 100.737 53.9917 100.48 53.723L83.8068 36.3032ZM1.93563 21.7905H80.9743C81.5055 21.7898 82.0312 21.6835 82.5185 21.4773C83.0058 21.2712 83.4444 20.9695 83.8068 20.5911L100.48 3.17133C100.737 2.90265 100.908 2.56667 100.972 2.2046C101.036 1.84253 100.99 1.47008 100.84 1.13314C100.689 0.796193 100.441 0.509443 100.126 0.307961C99.8104 0.106479 99.4415 -0.000854492 99.0644 -0.000854492H20.0301C19.5002 -0.00013126 18.9762 0.106791 18.4904 0.312929C18.0047 0.519068 17.5676 0.820087 17.2061 1.19754L0.524723 18.6173C0.267481 18.8859 0.0963642 19.2219 0.0323936 19.584C-0.0315771 19.946 0.0144792 20.3184 0.164862 20.6554C0.315245 20.9923 0.563347 21.2791 0.878727 21.4806C1.19411 21.682 1.56303 21.7894 1.94013 21.7896L1.93563 21.7905Z" fill="currentColor"/>
  </svg>
);

// Market colors for N-ary quantum markets (supports 2-4 options)
const MARKET_COLORS = ['#f87171', '#34d399', '#60a5fa', '#fbbf24']; // red, green, blue, yellow

const StatusIcon = ({ isWinning, marketIndex }: { isWinning: boolean; marketIndex: number }) => {
  const color = isWinning ? '#6ECC94' : MARKET_COLORS[marketIndex % MARKET_COLORS.length];

  if (isWinning) {
    return (
      <svg className="w-3 h-3" fill="currentColor" viewBox="0 0 20 20" style={{ color }}>
        <path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z" clipRule="evenodd" />
      </svg>
    );
  }
  // Show market number for non-winning markets
  return (
    <div
      className="w-3 h-3 rounded-full flex items-center justify-center text-[8px] font-bold text-white"
      style={{ backgroundColor: color }}
    >
      {marketIndex + 1}
    </div>
  );
};

export function PayoutCard({
  marketIndex,
  isWinning,
  label,
  amount,
  token,
  tokenPrice,
  isHovered,
  onHover,
  hoverId,
}: PayoutCardProps) {
  const decimalAmount = toDecimal(amount, token);
  const usdValue = decimalAmount * tokenPrice;
  // Use green for winners, market-specific color otherwise
  const statusColor = isWinning ? '#6ECC94' : MARKET_COLORS[marketIndex % MARKET_COLORS.length];

  return (
    <div
      className="border border-theme-border-hover rounded-lg p-3 flex items-center justify-between cursor-pointer transition-colors hover:bg-theme-input/30"
      onMouseEnter={() => onHover(hoverId)}
      onMouseLeave={() => onHover(null)}
    >
      <div className="flex items-center gap-1">
        <span className="text-xs" style={{ color: statusColor }}>{label}</span>
        <StatusIcon isWinning={isWinning} marketIndex={marketIndex} />
      </div>
      <div className="text-base font-medium text-theme-text">
        {isHovered ? (
          formatCurrency(usdValue)
        ) : (
          <div className="flex items-center gap-1">
            {token === 'zc' ? (
              <>
                {formatNumber(decimalAmount)}
                <span className="text-theme-text-secondary text-sm font-bold">$ZC</span>
              </>
            ) : (
              <>
                {decimalAmount.toFixed(4)}
                <SolIcon className="h-3 w-3 text-theme-text-secondary" />
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
