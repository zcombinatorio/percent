#!/usr/bin/env npx ts-node
/*
 * SSE Listener - Pretty prints events from the monitor server
 * Usage: npx ts-node monitor/scripts/sse-listener.ts [url]
 * Default: http://localhost:4000/events
 */

const url = process.argv[2] || 'http://localhost:4000/events';

// ANSI colors
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  blue: '\x1b[34m',
};

const eventColors: Record<string, string> = {
  CONNECTED: colors.green,
  PRICE_UPDATE: colors.cyan,
  COND_SWAP: colors.yellow,
  TWAP_UPDATE: colors.magenta,
  PROPOSAL_TRACKED: colors.blue,
  PROPOSAL_REMOVED: colors.blue,
};

console.log(`${colors.dim}Connecting to ${url}...${colors.reset}\n`);

async function listen() {
  const response = await fetch(url);

  if (!response.ok) {
    console.error(`Failed to connect: ${response.status} ${response.statusText}`);
    process.exit(1);
  }

  if (!response.body) {
    console.error('No response body');
    process.exit(1);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;

    buffer += decoder.decode(value, { stream: true });

    // Process complete events (double newline separated)
    const events = buffer.split('\n\n');
    buffer = events.pop() || ''; // Keep incomplete event in buffer

    for (const event of events) {
      if (!event.trim() || event.startsWith(':')) continue; // Skip keepalive

      const lines = event.split('\n');
      let eventType = 'message';
      let data = '';

      for (const line of lines) {
        if (line.startsWith('event: ')) {
          eventType = line.slice(7);
        } else if (line.startsWith('data: ')) {
          data = line.slice(6);
        }
      }

      if (data) {
        const color = eventColors[eventType] || colors.reset;
        const timestamp = new Date().toISOString().slice(11, 23);

        console.log(`${colors.dim}[${timestamp}]${colors.reset} ${color}${eventType}${colors.reset}`);

        try {
          const parsed = JSON.parse(data);
          console.log(JSON.stringify(parsed, null, 2));
        } catch {
          console.log(data);
        }
        console.log();
      }
    }
  }

  console.log('Connection closed');
}

listen().catch((err) => {
  console.error('Error:', err.message);
  process.exit(1);
});
