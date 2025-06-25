# AIMD Bucket

A TypeScript/JavaScript implementation of an **AIMD (Additive Increase Multiplicative Decrease)** rate limiting token bucket with adaptive rate adjustment. This library is ideal for clients in distributed systems that need to discover and adapt to unknown server-side rate limits dynamically.

You can create a bucket with some configured defaults and boundaries, and then ask for tokens from it. You report if each token was successful in doing a unit of work, or if it encountered an error or a server side rate limit. The bucket will then start brokering tokens faster or slower depending on the outcomes you report. The bucket adjusts the rate limit using the smae simple adaptive limiting algorithm used in TCP: AIMD.

## Installation

```bash
npm install aimd-bucket
# or
yarn add aimd-bucket
# or
pnpm add aimd-bucket
```

## Quick Start

```typescript
import { AIMDBucket } from "aimd-bucket";

// Create a bucket with default settings
const bucket = new AIMDBucket();

// Acquire a token before making a request
const token = await bucket.acquire();

try {
  // Make your API call
  const response = await fetch("https://api.example.com/data");

  if (response.ok) {
    token.success(); // Report successful completion
  } else if (response.status === 429) {
    token.rateLimited(); // Report rate limiting
  } else {
    token.failure(); // Report failure
  }
} catch (error) {
  token.failure(); // Report failure on exception
}
```

## Configuration

The `AIMDBucket` constructor accepts a configuration object with the following options:

```typescript
interface AIMDBucketConfig {
  initialRate?: number; // Initial rate limit (tokens per second), default: 10
  maxRate?: number; // Maximum rate limit, default: 100
  minRate?: number; // Minimum rate limit, default: 1
  increaseDelta?: number; // Amount to increase rate by on success, default: 1
  decreaseMultiplier?: number; // Multiplier to decrease rate by on failure, default: 0.5
  failureThreshold?: number; // Failure threshold (0-1) that triggers decrease, default: 0.2
  tokenTimeoutMs?: number; // Token timeout in milliseconds, default: 30000
  windowMs?: number; // Sliding window duration for rate decisions, default: 30000
}
```

### Example Configuration

```typescript
const bucket = new AIMDBucket({
  initialRate: 5, // Start at 5 requests per second
  maxRate: 50, // Never exceed 50 requests per second
  minRate: 1, // Never go below 1 request per second
  increaseDelta: 2, // Increase by 2 on success
  decreaseMultiplier: 0.8, // Decrease to 80% on failure
  failureThreshold: 0.1, // Decrease rate if >10% failures
  tokenTimeoutMs: 60000, // Tokens expire after 60 seconds
  windowMs: 60000, // Use 60-second window for rate decisions
});
```

## Usage Patterns

### Basic API Rate Limiting

```typescript
import { AIMDBucket } from "aimd-bucket";

const bucket = new AIMDBucket({ initialRate: 10 });

async function makeApiCall() {
  const token = await bucket.acquire();

  try {
    const response = await fetch("https://api.example.com/endpoint");

    if (response.ok) {
      token.success();
      return await response.json();
    } else if (response.status === 429) {
      token.rateLimited();
      throw new Error("Rate limited");
    } else {
      token.failure();
      throw new Error(`API error: ${response.status}`);
    }
  } catch (error) {
    token.failure();
    throw error;
  }
}
```

### Concurrent Request Handling

```typescript
async function makeConcurrentRequests(count: number) {
  const promises = Array.from({ length: count }, async () => {
    const token = await bucket.acquire();

    try {
      const response = await fetch("https://api.example.com/endpoint");
      token.success();
      return response.json();
    } catch (error) {
      token.failure();
      throw error;
    }
  });

  return Promise.all(promises);
}
```

### Monitoring and Statistics

```typescript
// Get current statistics
const stats = bucket.getStatistics();
console.log("Current rate:", stats.currentRate, "tokens/sec");
console.log("Success rate:", (stats.successRate * 100).toFixed(1) + "%");
console.log("Total tokens issued:", stats.tokensIssued);
console.log("Recent failures:", stats.failureCount);

// Monitor rate changes
setInterval(() => {
  const currentRate = bucket.getCurrentRate();
  console.log(`Current rate: ${currentRate} tokens/sec`);
}, 5000);
```

### Graceful Shutdown

```typescript
// Shutdown the bucket gracefully
await bucket.shutdown();

// All pending acquire() calls will be rejected
try {
  await bucket.acquire(); // This will throw an error
} catch (error) {
  console.log("Bucket is shut down");
}
```

## Token Lifecycle

Each token must be completed exactly once with one of these methods:

- `token.success()` - Request completed successfully
- `token.failure()` - Request failed (non-429 error)
- `token.rateLimited()` - Request was rate limited (429 status)
- `token.timeout()` - Request timed out

### Token States

```typescript
const token = await bucket.acquire();

console.log(token.isCompleted()); // false
console.log(token.isExpired()); // false

token.success();
console.log(token.isCompleted()); // true

// Cannot complete the same token twice
token.success(); // Throws error: "Token has already been completed"
```

## How AIMD Works

The AIMD algorithm automatically adjusts the rate limit based on request outcomes:

1. **Additive Increase**: On sustained success, the rate increases by `increaseDelta`
2. **Multiplicative Decrease**: On high failure rates, the rate decreases by multiplying by `decreaseMultiplier`
3. **Sliding Window**: Only recent outcomes (within `windowMs`) are considered for rate decisions
4. **Adaptive Sampling**: The minimum number of samples required for rate adjustment adapts to the current rate

### Failure Handling

**Important**: All non-success outcomes are treated identically for rate adjustment purposes. Whether you call `token.failure()`, `token.rateLimited()`, or `token.timeout()`, they all contribute equally to the failure rate calculation that determines when to decrease the rate.

This means:

- `token.success()` → Counts as success
- `token.failure()` → Counts as failure
- `token.rateLimited()` → Counts as failure
- `token.timeout()` → Counts as failure

The distinction between different failure types is primarily for **statistics and monitoring** - you can see separate counts for each type in `getStatistics()`, but they all trigger the same rate decrease behavior when the failure threshold is exceeded.

### Rate Adjustment Example

```typescript
const bucket = new AIMDBucket({
  initialRate: 10,
  increaseDelta: 2,
  decreaseMultiplier: 0.5,
  failureThreshold: 0.2, // 20%
});

// Start with 10 tokens/sec
console.log(bucket.getCurrentRate()); // 10

// 5 successful requests → rate increases by 2
for (let i = 0; i < 5; i++) {
  const token = await bucket.acquire();
  token.success();
}
console.log(bucket.getCurrentRate()); // 12

// 5 failed requests (100% failure rate > 20% threshold) → rate decreases by 50%
for (let i = 0; i < 5; i++) {
  const token = await bucket.acquire();
  token.failure();
}
console.log(bucket.getCurrentRate()); // 6
```

## Best Practices

### 1. Always Complete Tokens

```typescript
// ❌ Bad - token never completed
const token = await bucket.acquire();
await fetch("https://api.example.com/endpoint");

// ✅ Good - token properly completed
const token = await bucket.acquire();
try {
  const response = await fetch("https://api.example.com/endpoint");
  token.success();
} catch (error) {
  token.failure();
}
```

### 2. Handle Different Response Types

```typescript
const token = await bucket.acquire();

try {
  const response = await fetch("https://api.example.com/endpoint");

  if (response.ok) {
    token.success();
  } else if (response.status === 429) {
    token.rateLimited();
  } else if (response.status >= 500) {
    token.failure(); // Server error
  } else {
    token.success(); // Client error (4xx) - still a "success" for rate limiting
  }
} catch (error) {
  if (error.name === "TimeoutError") {
    token.timeout();
  } else {
    token.failure();
  }
}
```

### 3. Use Appropriate Configuration

```typescript
// For aggressive rate discovery
const aggressiveBucket = new AIMDBucket({
  initialRate: 1,
  maxRate: 100,
  increaseDelta: 5,
  decreaseMultiplier: 0.3,
  failureThreshold: 0.1,
});

// For conservative rate limiting
const conservativeBucket = new AIMDBucket({
  initialRate: 10,
  maxRate: 20,
  increaseDelta: 1,
  decreaseMultiplier: 0.8,
  failureThreshold: 0.3,
});
```

## API Reference

### AIMDBucket

#### Constructor

```typescript
new AIMDBucket(config?: AIMDBucketConfig)
```

#### Methods

- `acquire(): Promise<Token>` - Acquire a token for making a request
- `getCurrentRate(): number` - Get current rate limit (tokens per second)
- `getStatistics(): AIMDBucketStatistics` - Get current statistics
- `shutdown(): Promise<void>` - Gracefully shut down the bucket

### Token

#### Methods

- `success(): void` - Report successful completion
- `failure(): void` - Report failed completion
- `rateLimited(): void` - Report rate limited (429 status)
- `timeout(): void` - Report timeout
- `isCompleted(): boolean` - Check if token has been completed
- `isExpired(): boolean` - Check if token has expired

### AIMDBucketStatistics

```typescript
interface AIMDBucketStatistics {
  currentRate: number; // Current rate limit (tokens per second)
  tokensIssued: number; // Total tokens issued since creation
  successCount: number; // Successful requests in sliding window
  failureCount: number; // Failed requests in sliding window
  rateLimitedCount: number; // Rate limited requests in sliding window
  timeoutCount: number; // Timed out requests in sliding window
  successRate: number; // Success rate (0-1) in sliding window
}
```

## Testing

Run the test suite:

```bash
pnpm test
```

Run a specific test:

```bash
pnpm test -- -t "should respect maxRate limit"
```

## License

MIT License - see LICENSE.txt for details.
