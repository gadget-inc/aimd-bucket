# AIMD Bucket

A TypeScript/JavaScript implementation of an **AIMD (Additive Increase Multiplicative Decrease)** rate limiting token bucket with adaptive rate adjustment. This library is ideal for clients in distributed systems that need to discover and adapt to unknown remote system limits dynamically.

You can create a bucket with some configured defaults and boundaries, and then ask for tokens from it. You report if each token was successful in doing a unit of work, or if it encountered an error or a server side rate limit. The bucket will then start brokering tokens faster or slower depending on the outcomes you report. The bucket adjusts the rate limit using the smae simple adaptive limiting algorithm used in TCP: AIMD.

## Example uses cases

- throttle your outgoing requests to a system that starts breaking under load to not break it
- throttle your outgoing requests to a rate limited API from 3 different processes all competing for that rate limit

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

// Create a bucket with default settings (starts with unlimited rate)
const bucket = new AIMDBucket();

// Or create a bucket with a conservative initial rate
const conservativeBucket = new AIMDBucket({ initialRate: 10 });

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
  /**
   * Initial rate to start the bucket at (tokens per second)
   * @default maxRate
   */
  initialRate?: number;
  /**
   * Maximum rate limit (tokens per second)
   * @default Infinity
   */
  maxRate?: number;
  /**
   * Minimum rate limit (tokens per second)
   * @default 1
   */
  minRate?: number;
  /**
   * Amount to increase rate by on success (additive increase)
   * @default 1
   */
  increaseDelta?: number;
  /**
   * Multiplier to decrease rate by on failure (multiplicative decrease)
   * @default 0.5
   */
  decreaseMultiplier?: number;
  /**
   * Failure threshold (0-1) that triggers decrease
   * @default 0.2
   */
  failureThreshold?: number;
  /**
   * Token timeout in milliseconds (if not completed in this time, marked as timed out)
   * @default 30000
   */
  tokenReturnTimeoutMs?: number;
  /**
   * Sliding window duration for rate decisions (ms)
   * @default 30000
   */
  windowMs?: number;
  /**
   * Optional cooldown period (ms) between rate adjustments. If set, rate will only adjust at most once per this interval.
   * @default 0 (no cooldown)
   */
  rateAdjustmentCooldownMs?: number;
  /**
   * Bucket name used for observability spans
   */
  name?: string;
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
  tokenReturnTimeoutMs: 60000, // Tokens expire after 60 seconds
  windowMs: 60000, // Use 60-second window for rate decisions
  rateAdjustmentCooldownMs: 2000, // Only allow one rate adjustment every 2 seconds
});
```

## Token Lifecycle

Each token must be completed exactly once with one of these methods:

- `token.success()` - Request completed successfully
- `token.failure()` - Request failed (non-429 error)
- `token.rateLimited()` - Request was rate limited (429 status)
- `token.timeout()` - Request timed out

Successful responses will allow the rate limit to increase, and failed responses will force the rate limit to decrease.

### Token States

```typescript
const token = await bucket.acquire();

console.log(token.isCompleted); // false
console.log(token.isExpired); // false

token.success();
console.log(token.isCompleted); // true

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

## Observability

The library includes built-in OpenTelemetry support for monitoring token bucket behavior. When a token is not immediately available and the request needs to wait, a span named `"token-bucket.wait"` is automatically created with the following attributes:

- `token_bucket.current_rate` - Current rate limit (tokens per second)
- `token_bucket.available_tokens` - Number of tokens currently available
- `token_bucket.pending_requests` - Number of requests waiting for tokens
- `token_bucket.name` - Bucket name (if configured)

## API Reference

### `AIMDBucket`

#### Constructor

```typescript
new AIMDBucket(config?: AIMDBucketConfig)
```

#### Methods

- `acquire(): Promise<AIMDBucketToken>` - Acquire a token for making a request
- `getCurrentRate(): number` - Get current rate limit (tokens per second)
- `getStatistics(): AIMDBucketStatistics` - Get current statistics
- `shutdown(): Promise<void>` - Gracefully shut down the bucket

### `AIMDBucketToken`

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
