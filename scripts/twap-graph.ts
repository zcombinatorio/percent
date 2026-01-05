#!/usr/bin/env tsx
/**
 * Premium vs Spot Chart Generator
 *
 * Generates an interactive HTML chart showing the premium/discount of each
 * conditional market relative to spot price over time. Includes background
 * shading to indicate which market is leading at any point.
 *
 * Usage: pnpm tsx scripts/twap-graph.ts [moderatorId] [proposalId] [fromDate]
 * Output: /tmp/twap-chart.html
 *
 * Default: Moderator 6, Proposal 9 (the SURF proposal)
 */

import * as dotenv from 'dotenv';
import * as fs from 'fs';

dotenv.config();

const API_BASE_URL = process.env.PERCENT_API_URL || 'http://localhost:3000';

// Configuration - can be overridden via CLI args
const MODERATOR_ID = parseInt(process.argv[2]) || 6;
const PROPOSAL_ID = parseInt(process.argv[3]) || 9;
const FROM_DATE = process.argv[4] || '';  // Empty = show full proposal history

interface TWAPHistoryEntry {
  id: number;
  timestamp: string;
  twaps: string[];
  aggregations: string[];
}

interface TWAPHistoryResponse {
  moderatorId: number;
  proposalId: number;
  count: number;
  data: TWAPHistoryEntry[];
}

interface ChartDataEntry {
  timestamp: string;
  market: string | number;
  open: string;
  high: string;
  low: string;
  close: string;
  volume: string;
}

interface ChartDataResponse {
  moderatorId: number;
  proposalId: number;
  interval: string;
  count: number;
  data: ChartDataEntry[];
}

interface ProposalData {
  id: number;
  title: string;
  markets: number;
  marketLabels?: string[];
  createdAt: number;
  finalizedAt: number;
}

// ANSI color codes for terminal output
const COLORS = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  red: '\x1b[31m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  cyan: '\x1b[36m',
  white: '\x1b[37m',
};

async function fetchProposal(moderatorId: number, proposalId: number): Promise<ProposalData> {
  const url = `${API_BASE_URL}/api/proposals/${proposalId}?moderatorId=${moderatorId}`;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch proposal: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<ProposalData>;
}

async function fetchTWAPHistory(moderatorId: number, proposalId: number, from?: string): Promise<TWAPHistoryResponse> {
  let url = `${API_BASE_URL}/api/history/${proposalId}/twap?moderatorId=${moderatorId}`;
  if (from) {
    url += `&from=${encodeURIComponent(from)}`;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch TWAP history: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<TWAPHistoryResponse>;
}

async function fetchChartData(moderatorId: number, proposalId: number, from?: string): Promise<ChartDataResponse> {
  let url = `${API_BASE_URL}/api/history/${proposalId}/chart?moderatorId=${moderatorId}&interval=5m`;
  if (from) {
    url += `&from=${encodeURIComponent(from)}`;
  }
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to fetch chart data: ${response.status} ${response.statusText}`);
  }
  return response.json() as Promise<ChartDataResponse>;
}

async function main() {
  console.log(`\n${COLORS.bright}=== TWAP History Graph ===${COLORS.reset}`);
  console.log(`Moderator: ${MODERATOR_ID}, Proposal: ${PROPOSAL_ID}`);
  console.log(`From: ${FROM_DATE}`);
  console.log(`API: ${API_BASE_URL}\n`);

  // Fetch proposal data for labels
  let proposal: ProposalData;
  try {
    proposal = await fetchProposal(MODERATOR_ID, PROPOSAL_ID);
    console.log(`${COLORS.bright}Proposal:${COLORS.reset} ${proposal.title}`);
    console.log(`${COLORS.bright}Markets:${COLORS.reset} ${proposal.markets}`);
  } catch (error) {
    console.error(`${COLORS.red}Failed to fetch proposal:${COLORS.reset}`, error);
    console.error('\nMake sure the API server is running at', API_BASE_URL);
    process.exit(1);
  }

  // Use proposal createdAt if no FROM_DATE specified
  const fromDate = FROM_DATE || new Date(proposal.createdAt).toISOString();
  console.log(`${COLORS.bright}From date:${COLORS.reset} ${fromDate}`);

  // Fetch chart data (contains both spot and conditional market prices)
  let chartData: ChartDataResponse;
  try {
    chartData = await fetchChartData(MODERATOR_ID, PROPOSAL_ID, fromDate);
    const spotData = chartData.data.filter(d => d.market === 'spot');
    console.log(`${COLORS.bright}Spot price points:${COLORS.reset} ${spotData.length}`);
    for (let i = 0; i < proposal.markets; i++) {
      const marketData = chartData.data.filter(d => d.market === i);
      console.log(`${COLORS.bright}Market ${i} price points:${COLORS.reset} ${marketData.length}`);
    }
  } catch (error) {
    console.error(`${COLORS.red}Failed to fetch chart data:${COLORS.reset}`, error);
    process.exit(1);
  }

  // Fetch TWAP history for leader calculations
  let twapHistory: TWAPHistoryResponse;
  try {
    twapHistory = await fetchTWAPHistory(MODERATOR_ID, PROPOSAL_ID, fromDate);
    console.log(`${COLORS.bright}TWAP history points:${COLORS.reset} ${twapHistory.data.length}`);
  } catch (error) {
    console.error(`${COLORS.red}Failed to fetch TWAP history:${COLORS.reset}`, error);
    process.exit(1);
  }

  // Build price series for spot and each conditional market
  const spotPrices = chartData.data
    .filter(d => d.market === 'spot')
    .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  if (spotPrices.length === 0) {
    console.log('\nNo spot price data available for this period.');
    process.exit(0);
  }

  // Get all unique timestamps from spot prices
  const timestamps = spotPrices.map(d => new Date(d.timestamp).getTime());

  // Create price lookup maps for each market
  const marketPriceMaps: Map<number, { time: number; price: number }[]> = new Map();

  for (let i = 0; i < proposal.markets; i++) {
    const marketPrices = chartData.data
      .filter(d => d.market === i)
      .sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
      .map(d => ({
        time: new Date(d.timestamp).getTime(),
        price: parseFloat(d.close)
      }));
    marketPriceMaps.set(i, marketPrices);
  }

  // Spot price map
  const spotPriceMap = spotPrices.map(d => ({
    time: new Date(d.timestamp).getTime(),
    price: parseFloat(d.close)
  }));

  // Function to get interpolated price at a given timestamp
  function getPriceAt(priceMap: { time: number; price: number }[], timestamp: number): number | null {
    if (priceMap.length === 0) return null;

    // Find surrounding points
    let before = priceMap[0];
    let after = priceMap[priceMap.length - 1];

    for (let i = 0; i < priceMap.length - 1; i++) {
      if (priceMap[i].time <= timestamp && priceMap[i + 1].time >= timestamp) {
        before = priceMap[i];
        after = priceMap[i + 1];
        break;
      }
    }

    if (timestamp <= before.time) return before.price;
    if (timestamp >= after.time) return after.price;

    // Linear interpolation
    const ratio = (timestamp - before.time) / (after.time - before.time);
    return before.price + ratio * (after.price - before.price);
  }

  // Prepare series data for each market
  // Show premium/discount vs spot at each point in time (like the arb script does)
  const numMarkets = proposal.markets;
  const series: number[][] = [];
  const labels: string[] = [];

  for (let i = 0; i < numMarkets; i++) {
    const marketData: number[] = [];
    const marketMap = marketPriceMaps.get(i) || [];

    for (const timestamp of timestamps) {
      const marketPrice = getPriceAt(marketMap, timestamp);
      const spotPrice = getPriceAt(spotPriceMap, timestamp);

      if (!marketPrice || !spotPrice || spotPrice === 0) {
        marketData.push(NaN);
        continue;
      }

      // Calculate premium/discount at this point in time
      // This is what the arb script shows: (conditional - spot) / spot * 100
      const premiumPercent = ((marketPrice - spotPrice) / spotPrice) * 100;
      marketData.push(premiumPercent);
    }

    series.push(marketData);
    labels.push(proposal.marketLabels?.[i] || `Market ${i}`);
  }

  // Calculate time range
  const startTime = new Date(timestamps[0]);
  const endTime = new Date(timestamps[timestamps.length - 1]);
  const durationMs = endTime.getTime() - startTime.getTime();
  const durationHours = (durationMs / (1000 * 60 * 60)).toFixed(1);

  // Calculate spot price change over the period
  const startSpotPrice = spotPriceMap[0].price;
  const endSpotPrice = getPriceAt(spotPriceMap, timestamps[timestamps.length - 1]);
  const spotChangePercent = endSpotPrice && startSpotPrice
    ? ((endSpotPrice - startSpotPrice) / startSpotPrice) * 100
    : 0;

  console.log(`${COLORS.bright}Time range:${COLORS.reset} ${startTime.toLocaleString()} → ${endTime.toLocaleString()}`);
  console.log(`${COLORS.bright}Duration:${COLORS.reset} ${durationHours} hours`);
  console.log(`${COLORS.bright}Spot price change:${COLORS.reset} ${spotChangePercent >= 0 ? '+' : ''}${spotChangePercent.toFixed(2)}%`);

  // Generate HTML chart
  const htmlPath = '/tmp/twap-chart.html';
  const chartColors = ['#22c55e', '#3b82f6', '#eab308', '#a855f7'];

  const datasets = labels.map((label, i) => ({
    label,
    data: series[i],
    borderColor: chartColors[i % chartColors.length],
    backgroundColor: chartColors[i % chartColors.length],
    borderWidth: 2,
    pointRadius: 0,
    tension: 0.1,
  }));

  const chartLabels = timestamps.map(ts => new Date(ts).toISOString());

  // Calculate which market is highest at each timestamp for background shading
  interface LeaderSegment {
    startIdx: number;
    endIdx: number;
    leader: number;
    color: string;
  }

  // Helper to calculate leader segments from a series of leader indices
  function calculateLeaderSegments(leaderAtEachPoint: number[]): LeaderSegment[] {
    const segments: LeaderSegment[] = [];
    let currentLeader = -1;
    let segmentStart = 0;

    for (let i = 0; i < leaderAtEachPoint.length; i++) {
      const leader = leaderAtEachPoint[i];
      if (leader !== currentLeader) {
        if (currentLeader !== -1) {
          segments.push({
            startIdx: segmentStart,
            endIdx: i - 1,
            leader: currentLeader,
            color: chartColors[currentLeader % chartColors.length]
          });
        }
        currentLeader = leader;
        segmentStart = i;
      }
    }

    if (currentLeader !== -1) {
      segments.push({
        startIdx: segmentStart,
        endIdx: leaderAtEachPoint.length - 1,
        leader: currentLeader,
        color: chartColors[currentLeader % chartColors.length]
      });
    }

    return segments;
  }

  // 1. Price Leader - which market has highest premium at each timestamp
  const priceLeaderAtEachPoint: number[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    let maxValue = -Infinity;
    let leader = -1;
    for (let m = 0; m < series.length; m++) {
      const val = series[m][i];
      if (!isNaN(val) && val > maxValue) {
        maxValue = val;
        leader = m;
      }
    }
    priceLeaderAtEachPoint.push(leader);
  }
  const priceLeaderSegments = calculateLeaderSegments(priceLeaderAtEachPoint);

  // 2. TWAP Leader - which market has highest current TWAP value at each point
  // 3. Expected Winner - using UI formula: expectedFinal = currentTwap × elapsed% + currentPrice × remaining%
  //    This projects what final TWAP would be if current price holds for remaining time

  // Map TWAP history to chart timestamps
  const twapData = twapHistory.data.sort((a, b) =>
    new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );

  // Get proposal timing for elapsed percentage calculation
  const proposalStartTime = proposal.createdAt;
  const proposalEndTime = proposal.finalizedAt || (proposal.createdAt + 7 * 24 * 60 * 60 * 1000); // Default 7 days if not finalized
  const totalDuration = proposalEndTime - proposalStartTime;

  const twapLeaderAtEachPoint: number[] = [];
  const expectedWinnerAtEachPoint: number[] = [];

  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];

    // Find closest TWAP entry to this timestamp
    let closestEntry: TWAPHistoryEntry | null = null;
    let closestDiff = Infinity;

    for (const entry of twapData) {
      const entryTime = new Date(entry.timestamp).getTime();
      const diff = Math.abs(entryTime - ts);
      if (diff < closestDiff) {
        closestDiff = diff;
        closestEntry = entry;
      }
    }

    if (closestEntry) {
      // TWAP Leader - market with highest current TWAP value
      let maxTwap = -Infinity;
      let twapLeader = 0;
      for (let m = 0; m < closestEntry.twaps.length; m++) {
        const twap = parseFloat(closestEntry.twaps[m]);
        if (twap > maxTwap) {
          maxTwap = twap;
          twapLeader = m;
        }
      }
      twapLeaderAtEachPoint.push(twapLeader);

      // Expected Winner - using same formula as UI (ModeToggle.tsx):
      // expectedFinal = currentTwap × elapsed% + currentPrice × remaining%
      const currentTime = new Date(closestEntry.timestamp).getTime();
      const elapsedPercent = Math.min(1, Math.max(0, (currentTime - proposalStartTime) / totalDuration));
      const remainingPercent = 1 - elapsedPercent;

      let maxExpected = -Infinity;
      let expectedLeader = 0;
      for (let m = 0; m < closestEntry.twaps.length; m++) {
        const currentTwap = parseFloat(closestEntry.twaps[m]);
        // Get current price for this market at this timestamp from our price series
        const currentPrice = series[m][i];

        if (isNaN(currentPrice)) {
          continue;
        }

        // The series contains premium %, but we need actual price for the formula
        // Get the raw conditional price from our marketPriceMaps
        const marketMap = marketPriceMaps.get(m) || [];
        const rawPrice = getPriceAt(marketMap, ts);

        if (!rawPrice) continue;

        // Formula: expectedFinal = currentTwap × elapsed% + currentPrice × remaining%
        const expectedFinal = currentTwap * elapsedPercent + rawPrice * remainingPercent;

        if (expectedFinal > maxExpected) {
          maxExpected = expectedFinal;
          expectedLeader = m;
        }
      }
      expectedWinnerAtEachPoint.push(expectedLeader);
    } else {
      twapLeaderAtEachPoint.push(0);
      expectedWinnerAtEachPoint.push(0);
    }
  }

  const twapLeaderSegments = calculateLeaderSegments(twapLeaderAtEachPoint);
  const expectedWinnerSegments = calculateLeaderSegments(expectedWinnerAtEachPoint);

  // Create annotation boxes for price leader (main chart shading)
  const annotations = priceLeaderSegments.map((seg) => ({
    type: 'box',
    xMin: chartLabels[seg.startIdx],
    xMax: chartLabels[seg.endIdx],
    backgroundColor: seg.color + '25', // Semi-transparent
    borderWidth: 0,
  }));

  // Log leader segments
  console.log(`\n${COLORS.bright}Price Leader Segments:${COLORS.reset}`);
  for (const seg of priceLeaderSegments) {
    const duration = ((timestamps[seg.endIdx] - timestamps[seg.startIdx]) / (1000 * 60 * 60)).toFixed(1);
    console.log(`  ${labels[seg.leader]}: ${duration}h`);
  }
  console.log(`\n${COLORS.bright}TWAP Leader Segments:${COLORS.reset}`);
  for (const seg of twapLeaderSegments) {
    const duration = ((timestamps[seg.endIdx] - timestamps[seg.startIdx]) / (1000 * 60 * 60)).toFixed(1);
    console.log(`  ${labels[seg.leader]}: ${duration}h`);
  }
  console.log(`\n${COLORS.bright}Expected Winner Segments:${COLORS.reset}`);
  for (const seg of expectedWinnerSegments) {
    const duration = ((timestamps[seg.endIdx] - timestamps[seg.startIdx]) / (1000 * 60 * 60)).toFixed(1);
    console.log(`  ${labels[seg.leader]}: ${duration}h`);
  }

  const html = `<!DOCTYPE html>
<html>
<head>
  <title>Premium vs Spot - ${proposal.title}</title>
  <script src="https://cdn.jsdelivr.net/npm/chart.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-adapter-date-fns"></script>
  <script src="https://cdn.jsdelivr.net/npm/chartjs-plugin-annotation"></script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #0a0a0a;
      color: #fff;
      margin: 0;
      padding: 20px;
    }
    .container { max-width: 1400px; margin: 0 auto; }
    h1 { font-size: 24px; margin-bottom: 8px; }
    .subtitle { color: #888; margin-bottom: 20px; }
    .chart-container { background: #111; border-radius: 12px; padding: 20px; }
    .controls { margin-bottom: 16px; display: flex; align-items: center; gap: 12px; }
    .controls label { font-size: 13px; color: #888; }
    .controls select { background: #222; color: #fff; border: 1px solid #444; border-radius: 6px; padding: 6px 12px; font-size: 13px; cursor: pointer; }
    .controls select:hover { border-color: #666; }
    .leader-bars { margin-top: 16px; }
    .leader-bar { margin-bottom: 16px; }
    .leader-bar:last-child { margin-bottom: 0; }
    .leader-bar-label { font-size: 12px; color: #888; margin-bottom: 6px; margin-left: var(--chart-left-padding, 0); }
    .leader-bar-track { height: 24px; border-radius: 4px; display: flex; overflow: hidden; background: #222; margin-left: var(--chart-left-padding, 0); margin-right: var(--chart-right-padding, 0); }
    .leader-bar-segment { height: 100%; opacity: 0.5; }
  </style>
</head>
<body>
  <div class="container">
    <h1>Conditionals vs Spot Over Time</h1>
    <div class="subtitle">${proposal.title} | ${startTime.toLocaleDateString()} - ${endTime.toLocaleDateString()}</div>

    <div class="chart-container">
      <div class="controls">
        <label for="overlay-select">Chart Overlay:</label>
        <select id="overlay-select">
          <option value="price">Price Leader</option>
          <option value="twap">TWAP Leader</option>
          <option value="expected">Expected Winner</option>
        </select>
      </div>
      <canvas id="chart"></canvas>

      <div class="leader-bars" id="leader-bars-container">
        <div class="leader-bar" id="bar1-container">
          <div class="leader-bar-label" id="bar1-label">TWAP Leader</div>
          <div class="leader-bar-track" id="bar1"></div>
        </div>
        <div class="leader-bar" id="bar2-container">
          <div class="leader-bar-label" id="bar2-label">Expected Winner</div>
          <div class="leader-bar-track" id="bar2"></div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const ctx = document.getElementById('chart').getContext('2d');
    const chart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: ${JSON.stringify(chartLabels)},
        datasets: ${JSON.stringify(datasets)}
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: 2.5,
        interaction: { intersect: false, mode: 'index' },
        plugins: {
          legend: { position: 'top', labels: { color: '#fff', boxWidth: 12, boxHeight: 12 } },
          annotation: { annotations: ${JSON.stringify(annotations)} },
          tooltip: {
            backgroundColor: '#222',
            titleColor: '#fff',
            bodyColor: '#fff',
            callbacks: {
              label: (ctx) => ctx.dataset.label + ': ' + (ctx.parsed.y >= 0 ? '+' : '') + ctx.parsed.y.toFixed(2) + '%'
            }
          }
        },
        scales: {
          x: {
            type: 'time',
            time: { unit: 'day', displayFormats: { day: 'MMM d', hour: 'ha' } },
            grid: { color: '#333' },
            ticks: { color: '#888', maxTicksLimit: 8 }
          },
          y: {
            min: -20,
            max: 40,
            grid: { color: '#333' },
            ticks: {
              color: '#888',
              callback: (v) => (v >= 0 ? '+' : '') + v + '%'
            }
          }
        }
      }
    });

    // Leader bar data
    const totalPoints = ${timestamps.length};
    const chartLabelsData = ${JSON.stringify(chartLabels)};
    const allSegments = {
      price: { segments: ${JSON.stringify(priceLeaderSegments)}, label: 'Price Leader' },
      twap: { segments: ${JSON.stringify(twapLeaderSegments)}, label: 'TWAP Leader' },
      expected: { segments: ${JSON.stringify(expectedWinnerSegments)}, label: 'Expected Winner' }
    };
    const marketLabels = ${JSON.stringify(labels)};

    function segmentsToAnnotations(segments) {
      return segments.map(seg => ({
        type: 'box',
        xMin: chartLabelsData[seg.startIdx],
        xMax: chartLabelsData[seg.endIdx],
        backgroundColor: seg.color + '25',
        borderWidth: 0,
      }));
    }

    function renderLeaderBar(barId, segments) {
      const bar = document.getElementById(barId);
      bar.innerHTML = '';
      segments.forEach(seg => {
        const width = ((seg.endIdx - seg.startIdx + 1) / totalPoints) * 100;
        const div = document.createElement('div');
        div.className = 'leader-bar-segment';
        div.style.width = width + '%';
        div.style.backgroundColor = seg.color;
        div.title = marketLabels[seg.leader] + ' (' + width.toFixed(1) + '%)';
        bar.appendChild(div);
      });
    }

    function updateDisplay(overlayType) {
      // Update chart annotations
      chart.options.plugins.annotation.annotations = segmentsToAnnotations(allSegments[overlayType].segments);
      chart.update();

      // Determine which two types to show as bars (the ones not selected)
      const types = ['price', 'twap', 'expected'];
      const barTypes = types.filter(t => t !== overlayType);

      document.getElementById('bar1-label').textContent = allSegments[barTypes[0]].label;
      renderLeaderBar('bar1', allSegments[barTypes[0]].segments);

      document.getElementById('bar2-label').textContent = allSegments[barTypes[1]].label;
      renderLeaderBar('bar2', allSegments[barTypes[1]].segments);
    }

    // Wait for chart to render, then align bars with chart area
    setTimeout(() => {
      const chartArea = chart.chartArea;
      const container = document.querySelector('.leader-bars');
      if (chartArea && container) {
        container.style.setProperty('--chart-left-padding', chartArea.left + 'px');
        container.style.setProperty('--chart-right-padding', (chart.width - chartArea.right) + 'px');
      }
      updateDisplay('price');
    }, 100);

    // Handle dropdown change
    document.getElementById('overlay-select').addEventListener('change', (e) => {
      updateDisplay(e.target.value);
    });
  </script>
</body>
</html>`;

  fs.writeFileSync(htmlPath, html);
  console.log(`\n${COLORS.bright}Interactive chart saved to:${COLORS.reset} ${htmlPath}`);
  console.log(`Open with: ${COLORS.cyan}open ${htmlPath}${COLORS.reset}`);
}

main().catch(console.error);
