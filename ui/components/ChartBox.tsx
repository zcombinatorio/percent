import MarketChart from './MarketChart';

interface ChartBoxProps {
  proposalId: number;
  selectedMarket: 'pass' | 'fail';
}

export function ChartBox({ proposalId, selectedMarket }: ChartBoxProps) {
  return (
    <div className="bg-[#121212] border border-[#191919] rounded-[9px] p-3 transition-all duration-300">
      <div className="bg-[#181818] overflow-hidden rounded-lg">
        <MarketChart proposalId={proposalId} market={selectedMarket} height={512} />
      </div>
    </div>
  );
}
