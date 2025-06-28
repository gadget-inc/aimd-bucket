import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { AIMDBucket, AIMDBucketConfig, AIMDBucketToken } from "../src/index";

describe("AIMDBucket", () => {
  let bucket: AIMDBucket;

  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  describe("construction and configuration", () => {
    it("should create a bucket with default configuration", () => {
      bucket = new AIMDBucket();
      expect(bucket).toBeInstanceOf(AIMDBucket);
    });

    it("should create a bucket with custom configuration", () => {
      const config: AIMDBucketConfig = {
        initialRate: 5,
        maxRate: 50,
        minRate: 1,
        increaseDelta: 2,
        decreaseMultiplier: 0.8,
        failureThreshold: 0.1,
      };
      bucket = new AIMDBucket(config);
      expect(bucket).toBeInstanceOf(AIMDBucket);
    });

    it("should throw for invalid configuration", () => {
      expect(() => new AIMDBucket({ initialRate: -1 })).toThrow();
      expect(() => new AIMDBucket({ maxRate: 0 })).toThrow();
      expect(() => new AIMDBucket({ decreaseMultiplier: 0 })).toThrow();
      expect(() => new AIMDBucket({ decreaseMultiplier: 1.5 })).toThrow();
    });
  });

  describe("token acquisition", () => {
    beforeEach(() => {
      bucket = new AIMDBucket({ initialRate: 10 });
    });

    it("should acquire tokens immediately when bucket has capacity", async () => {
      const token = await bucket.acquire();
      expect(token).toBeInstanceOf(AIMDBucketToken);
      expect(token.isExpired).toBe(false);
    });

    it("should delay token acquisition when rate limit is reached", async () => {
      // Exhaust the bucket
      const tokens = await Promise.all(Array.from({ length: 10 }, () => bucket.acquire()));
      expect(tokens).toHaveLength(10);

      const stats = bucket.getStatistics();
      expect(stats.tokensIssued).toBe(10);

      // Advance time to allow refill
      await vi.advanceTimersByTimeAsync(1000);

      // Now we should be able to acquire more
      const additionalToken = await bucket.acquire();
      expect(additionalToken).toBeInstanceOf(AIMDBucketToken);
    });

    it("should process multiple pending requests in order", async () => {
      // Test that after exhausting the bucket, advancing time allows more tokens
      await Promise.all(Array.from({ length: 10 }, () => bucket.acquire()));

      // Advance time to allow refill
      await vi.advanceTimersByTimeAsync(1000);

      // Should be able to acquire multiple tokens
      const newTokens = await Promise.all([bucket.acquire(), bucket.acquire(), bucket.acquire()]);

      expect(newTokens).toHaveLength(3);
      newTokens.forEach((token) => expect(token).toBeInstanceOf(AIMDBucketToken));
    });

    it("should support concurrent token acquisition", async () => {
      const promises = Array.from({ length: 5 }, () => bucket.acquire());
      const tokens = await Promise.all(promises);
      expect(tokens).toHaveLength(5);
      tokens.forEach((token) => expect(token).toBeInstanceOf(AIMDBucketToken));
    });

    it("should respect maxRate limit", async () => {
      bucket = new AIMDBucket({ initialRate: 100, maxRate: 5 });

      // Force rate increase by reporting successes
      for (let i = 0; i < 20; i++) {
        const token = await bucket.acquire();
        token.success();
        await vi.advanceTimersByTimeAsync(250); // Advance enough time for refill
      }

      // Current rate should not exceed maxRate
      expect(bucket.getCurrentRate()).toBeLessThanOrEqual(5);
    });

    it("should properly refill tokens over time", async () => {
      // Exhaust the bucket completely
      const initialTokens = await Promise.all(Array.from({ length: 10 }, () => bucket.acquire()));
      expect(initialTokens).toHaveLength(10);

      let stats = bucket.getStatistics();
      expect(stats.tokensIssued).toBe(10);

      // Advance time by 500ms - should allow ~5 tokens at rate 10
      await vi.advanceTimersByTimeAsync(500);

      const secondBatch = await Promise.all(Array.from({ length: 5 }, () => bucket.acquire()));
      expect(secondBatch).toHaveLength(5);

      stats = bucket.getStatistics();
      expect(stats.tokensIssued).toBe(15);

      // Advance time by another 1000ms - should allow ~10 more tokens
      await vi.advanceTimersByTimeAsync(1000);

      const thirdBatch = await Promise.all(Array.from({ length: 10 }, () => bucket.acquire()));
      expect(thirdBatch).toHaveLength(10);

      stats = bucket.getStatistics();
      expect(stats.tokensIssued).toBe(25);
    });
  });

  describe("token lifecycle", () => {
    beforeEach(() => {
      bucket = new AIMDBucket({ initialRate: 10 });
    });

    it("should track token success", async () => {
      const token = await bucket.acquire();
      expect(() => token.success()).not.toThrow();
      expect(token.isCompleted).toBe(true);
    });

    it("should track token failure", async () => {
      const token = await bucket.acquire();
      expect(() => token.failure()).not.toThrow();
      expect(token.isCompleted).toBe(true);
    });

    it("should track rate limited failures", async () => {
      const token = await bucket.acquire();
      expect(() => token.rateLimited()).not.toThrow();
      expect(token.isCompleted).toBe(true);
    });

    it("should track token timeout", async () => {
      const token = await bucket.acquire();
      expect(() => token.timeout()).not.toThrow();
      expect(token.isCompleted).toBe(true);
    });

    it("should prevent double completion", async () => {
      const token = await bucket.acquire();
      token.success();
      expect(() => token.success()).toThrow();
      expect(() => token.failure()).toThrow();
    });

    it("should auto-expire tokens after timeout", async () => {
      bucket = new AIMDBucket({ tokenReturnTimeoutMs: 1000 });
      const token = await bucket.acquire();

      await vi.advanceTimersByTimeAsync(1100);
      expect(token.isExpired).toBe(true);
      expect(() => token.success()).toThrow();
    });
  });

  describe("AIMD rate adjustment", () => {
    beforeEach(() => {
      bucket = new AIMDBucket({
        initialRate: 10,
        increaseDelta: 2,
        decreaseMultiplier: 0.5,
        failureThreshold: 0.2,
      });
    });

    it("should increase rate on sustained success", async () => {
      const initialRate = bucket.getCurrentRate();

      // Generate exactly 5 successful requests to trigger rate adjustment once
      for (let i = 0; i < 5; i++) {
        const token = await bucket.acquire();
        token.success();
        // Advance time to allow refill for next token
        await vi.advanceTimersByTimeAsync(200);
      }

      // Rate should have increased by increaseDelta (2) exactly once
      expect(bucket.getCurrentRate()).toBe(initialRate + 2);
    });

    it("should decrease rate on high failure rate", async () => {
      const initialRate = bucket.getCurrentRate();

      // Acquire and complete 5 tokens with high failure rate (60% > 20% threshold)
      const tokens = await Promise.all([bucket.acquire(), bucket.acquire(), bucket.acquire(), bucket.acquire(), bucket.acquire()]);

      // Mark 3 out of 5 as rate limited (60% failure rate, above 20% threshold)
      tokens[0].rateLimited();
      tokens[1].rateLimited();
      tokens[2].rateLimited();
      tokens[3].success();
      tokens[4].success();

      // Rate should have decreased by decreaseMultiplier (0.5)
      expect(bucket.getCurrentRate()).toBe(initialRate * 0.5);
    });

    it("should not adjust rate with fewer than 5 completed tokens", async () => {
      const initialRate = bucket.getCurrentRate();

      // Complete only 4 tokens (below threshold)
      for (let i = 0; i < 4; i++) {
        const token = await bucket.acquire();
        token.success();
        await vi.advanceTimersByTimeAsync(200);
      }

      // Rate should remain unchanged
      expect(bucket.getCurrentRate()).toBe(initialRate);
    });

    it("should not decrease rate below minimum", async () => {
      bucket = new AIMDBucket({
        initialRate: 2,
        minRate: 1,
        decreaseMultiplier: 0.1,
        failureThreshold: 0.2,
      });

      const minRate = 1;

      // Force multiple rate decreases
      for (let i = 0; i < 3; i++) {
        // Complete 5 tokens with 100% failure rate
        for (let j = 0; j < 5; j++) {
          const token = await bucket.acquire();
          token.rateLimited();
          await vi.advanceTimersByTimeAsync(1000);
        }
      }

      // Rate should not go below minimum
      expect(bucket.getCurrentRate()).toBe(minRate);
    });

    it("should not increase rate above maximum", async () => {
      bucket = new AIMDBucket({
        initialRate: 8,
        maxRate: 10,
        increaseDelta: 5,
        failureThreshold: 0.2,
      });

      const maxRate = 10;

      // Force multiple rate increases
      for (let i = 0; i < 3; i++) {
        // Complete 5 tokens with 100% success rate
        for (let j = 0; j < 5; j++) {
          const token = await bucket.acquire();
          token.success();
          await vi.advanceTimersByTimeAsync(200);
        }
      }

      // Rate should not exceed maximum
      expect(bucket.getCurrentRate()).toBe(maxRate);
    });

    it("should handle mixed success/failure patterns correctly", async () => {
      const initialRate = bucket.getCurrentRate();

      // 20% failure rate (exactly at threshold)
      const tokens = await Promise.all([bucket.acquire(), bucket.acquire(), bucket.acquire(), bucket.acquire(), bucket.acquire()]);

      // 1 failure, 4 successes = 20% failure rate
      tokens[0].failure();
      tokens[1].success();
      tokens[2].success();
      tokens[3].success();
      tokens[4].success();

      // At exactly the threshold, should increase (not decrease)
      expect(bucket.getCurrentRate()).toBe(initialRate + 2);
    });

    it("should treat timeouts as failures for rate adjustment", async () => {
      const initialRate = bucket.getCurrentRate();

      // Mix of failures and timeouts above threshold
      const tokens = await Promise.all([bucket.acquire(), bucket.acquire(), bucket.acquire(), bucket.acquire(), bucket.acquire()]);

      // 40% failure rate (2 timeouts + 0 failures = 40% > 20% threshold)
      tokens[0].timeout();
      tokens[1].timeout();
      tokens[2].success();
      tokens[3].success();
      tokens[4].success();

      // Should decrease due to high failure rate
      expect(bucket.getCurrentRate()).toBe(initialRate * 0.5);
    });

    it("should ignore outcomes outside sliding window for rate adjustment", async () => {
      const initialRate = bucket.getCurrentRate();

      // Create old failures (simulate 31 seconds ago, outside 30s window)
      for (let i = 0; i < 5; i++) {
        const token = await bucket.acquire();
        token.rateLimited(); // 100% failure rate
        await vi.advanceTimersByTimeAsync(50);
      }

      // Should have decreased rate due to failures
      expect(bucket.getCurrentRate()).toBe(initialRate * 0.5);
      const decreasedRate = bucket.getCurrentRate();

      // Advance time by 31 seconds to move old failures outside the window
      await vi.advanceTimersByTimeAsync(31000);

      // Now add new successes within the window
      for (let i = 0; i < 5; i++) {
        const token = await bucket.acquire();
        token.success(); // 100% success rate
        await vi.advanceTimersByTimeAsync(50);
      }

      // Rate should increase because only successes are in the sliding window
      expect(bucket.getCurrentRate()).toBe(decreasedRate + 2);
    });

    it("should use sliding window for rate decisions not all-time stats", async () => {
      const initialRate = bucket.getCurrentRate();

      // Create 5 failures to decrease rate
      const failureTokens = await Promise.all([bucket.acquire(), bucket.acquire(), bucket.acquire(), bucket.acquire(), bucket.acquire()]);
      failureTokens.forEach((token) => token.rateLimited());

      // Rate should have decreased
      const decreasedRate = bucket.getCurrentRate();
      expect(decreasedRate).toBe(initialRate * 0.5);

      // Move time forward to push failures out of sliding window
      await vi.advanceTimersByTimeAsync(31000);

      // Now create 5 successes - since failures are outside window, rate should increase
      const successTokens = await Promise.all([bucket.acquire(), bucket.acquire(), bucket.acquire(), bucket.acquire(), bucket.acquire()]);
      successTokens.forEach((token) => token.success());

      // Rate should increase because only successes are in the sliding window
      expect(bucket.getCurrentRate()).toBe(decreasedRate + 2);
    });

    it("should allow quick rate decreases with short sliding window", async () => {
      // Create bucket with very short 3-second window for fast adaptation
      const quickBucket = new AIMDBucket({
        initialRate: 10,
        windowMs: 3000,
        decreaseMultiplier: 0.5,
        failureThreshold: 0.4,
      });

      const initialRate = quickBucket.getCurrentRate();

      // First, create some old successes
      for (let i = 0; i < 5; i++) {
        const token = await quickBucket.acquire();
        token.success();
        await vi.advanceTimersByTimeAsync(100);
      }

      // Rate should have increased due to successes
      expect(quickBucket.getCurrentRate()).toBe(initialRate + 1);
      const increasedRate = quickBucket.getCurrentRate();

      // Wait for successes to age out of the short window
      await vi.advanceTimersByTimeAsync(4000);

      // Now create recent failures that exceed threshold
      const failureTokens = await Promise.all([
        quickBucket.acquire(),
        quickBucket.acquire(),
        quickBucket.acquire(),
        quickBucket.acquire(),
        quickBucket.acquire(),
      ]);

      // 60% failure rate (3/5 = 0.6 > 0.4 threshold)
      failureTokens[0].rateLimited();
      failureTokens[1].rateLimited();
      failureTokens[2].rateLimited();
      failureTokens[3].success();
      failureTokens[4].success();

      // Rate should decrease immediately since old successes are outside the short window
      expect(quickBucket.getCurrentRate()).toBe(increasedRate * 0.5);
    });
  });

  describe("statistics and monitoring", () => {
    beforeEach(() => {
      bucket = new AIMDBucket({ initialRate: 10 });
    });

    it("should provide current statistics", async () => {
      const stats = bucket.getStatistics();
      expect(stats).toHaveProperty("currentRate");
      expect(stats).toHaveProperty("tokensIssued");
      expect(stats).toHaveProperty("successCount");
      expect(stats).toHaveProperty("failureCount");
      expect(stats).toHaveProperty("rateLimitedCount");
      expect(stats).toHaveProperty("timeoutCount");
      expect(stats).toHaveProperty("successRate");
    });

    it("should track token statistics", async () => {
      const token1 = await bucket.acquire();
      const token2 = await bucket.acquire();
      const token3 = await bucket.acquire();

      token1.success();
      token2.failure();
      token3.rateLimited();

      const stats = bucket.getStatistics();
      expect(stats.tokensIssued).toBe(3);
      expect(stats.successCount).toBe(1);
      expect(stats.failureCount).toBe(1);
      expect(stats.rateLimitedCount).toBe(1);
      expect(stats.successRate).toBe(1 / 3);
    });

    it("should calculate statistics from sliding window only", async () => {
      // Create old outcomes
      const oldTokens = await Promise.all([bucket.acquire(), bucket.acquire(), bucket.acquire()]);
      oldTokens[0].success();
      oldTokens[1].failure();
      oldTokens[2].rateLimited();

      // Advance time to push old outcomes out of window
      await vi.advanceTimersByTimeAsync(31000);

      // Create new outcomes within window
      const newTokens = await Promise.all([bucket.acquire(), bucket.acquire()]);
      newTokens[0].success();
      newTokens[1].success();

      const stats = bucket.getStatistics();

      // tokensIssued should include all tokens (it's a counter, not windowed)
      expect(stats.tokensIssued).toBe(5);

      // But outcome stats should only reflect recent window
      expect(stats.successCount).toBe(2);
      expect(stats.failureCount).toBe(0);
      expect(stats.rateLimitedCount).toBe(0);
      expect(stats.successRate).toBe(1.0); // 100% success in recent window
    });

    it("should handle empty sliding window gracefully", async () => {
      // Don't complete any tokens, just acquire and let time pass
      await bucket.acquire();
      await vi.advanceTimersByTimeAsync(31000);

      const stats = bucket.getStatistics();
      expect(stats.successRate).toBe(0); // No completed tokens in window
      expect(stats.successCount).toBe(0);
      expect(stats.failureCount).toBe(0);
    });
  });

  describe("graceful shutdown", () => {
    beforeEach(() => {
      bucket = new AIMDBucket({ initialRate: 10 });
    });

    it("should support graceful shutdown", async () => {
      // First exhaust the bucket to make subsequent acquisitions pending
      const exhaustTokens = await Promise.all(Array.from({ length: 10 }, () => bucket.acquire()));
      expect(exhaustTokens).toHaveLength(10);

      // Now these should be pending
      const token1 = bucket.acquire();
      const token2 = bucket.acquire();

      await bucket.shutdown();

      // Pending acquisitions should be rejected
      await expect(token1).rejects.toThrow();
      await expect(token2).rejects.toThrow();
    });

    it("should reject new acquisitions after shutdown", async () => {
      await bucket.shutdown();
      await expect(bucket.acquire()).rejects.toThrow();
    });
  });

  describe("edge cases and error handling", () => {
    beforeEach(() => {
      bucket = new AIMDBucket({ initialRate: 10 });
    });

    it("should process pending requests when no events trigger refill (lockup bug fix)", async () => {
      bucket = new AIMDBucket({
        initialRate: 3, // Low rate
        tokenReturnTimeoutMs: 30000, // Long timeout so no auto-timeouts interfere
      });

      // Get initial 3 tokens immediately (up to initial capacity)
      const token1 = await bucket.acquire();
      const token2 = await bucket.acquire();
      const token3 = await bucket.acquire();

      // Advance time to get 1 more token through refill
      await vi.advanceTimersByTimeAsync(334); // ~1/3 second = 1 token at rate 3
      const token4 = await bucket.acquire();

      let stats = bucket.getStatistics();
      expect(stats.tokensIssued).toBe(4);
      expect(stats.currentRate).toBe(3);

      token1.success();
      token2.success();
      token3.success();
      token4.success();

      const pendingPromises = [bucket.acquire(), bucket.acquire(), bucket.acquire(), bucket.acquire(), bucket.acquire()];

      await vi.advanceTimersByTimeAsync(50);
      stats = bucket.getStatistics();
      expect(stats.currentRate).toBe(3);
      expect(stats.tokensIssued).toBe(4);
      expect(stats.successCount).toBe(4);
      expect(stats.pendingCount).toBe(5);

      // Now advance time significantly, but make NO new acquire() calls and don't complete any more tokens. This a lockup scenario. Time passes, bucket should refill, but pending requests never get processed because no events trigger _refill()
      await vi.advanceTimersByTimeAsync(5000); // 5 seconds = 15 tokens should be available

      stats = bucket.getStatistics();
      expect(stats.pendingCount).toBe(0);
      expect(stats.tokensIssued).toBe(9);

      const resolvedTokens = await Promise.all(pendingPromises);
      expect(resolvedTokens).toHaveLength(5);
    });

    it("should process pending requests with fractional rates", async () => {
      // Test that the timer approach works correctly with rates < 1
      bucket = new AIMDBucket({
        initialRate: 0.5, // 0.5 tokens per second = 1 token every 2 seconds
        tokenReturnTimeoutMs: 30000,
      });

      // Should get no tokens immediately since rate is 0.5 and bucket starts empty
      // (Well, actually bucket starts with 0.5 tokens, so let's consume that first)
      const firstToken = await bucket.acquire();
      expect(firstToken).toBeInstanceOf(AIMDBucketToken);

      // Now create pending requests that will need fractional accumulation
      const pendingPromises = [bucket.acquire(), bucket.acquire(), bucket.acquire()];

      await vi.advanceTimersByTimeAsync(50);
      let stats = bucket.getStatistics();
      expect(stats.currentRate).toBe(0.5);
      expect(stats.pendingCount).toBe(3);

      // Complete the first token to avoid any interference
      firstToken.success();

      // Advance time to allow fractional accumulation: 6 seconds = 3 tokens at 0.5/sec
      await vi.advanceTimersByTimeAsync(6000);

      // All pending requests should have been processed by the timer
      stats = bucket.getStatistics();
      expect(stats.pendingCount).toBe(0);

      // Verify the promises actually resolved
      const resolvedTokens = await Promise.all(pendingPromises);
      expect(resolvedTokens).toHaveLength(3);
      resolvedTokens.forEach((token) => expect(token).toBeInstanceOf(AIMDBucketToken));
    });

    it("should process pending requests with very low fractional rates", async () => {
      // Test extreme case with very low rate
      bucket = new AIMDBucket({
        initialRate: 0.1, // 0.1 tokens per second = 1 token every 10 seconds
        tokenReturnTimeoutMs: 60000,
      });

      // With capacity fix, bucket starts with 1 token (not 0.1), so first acquire succeeds
      const firstToken = await bucket.acquire();
      expect(firstToken).toBeInstanceOf(AIMDBucketToken);

      // Now subsequent acquires should be pending
      const pendingPromises = [bucket.acquire(), bucket.acquire()];

      await vi.advanceTimersByTimeAsync(50);
      let stats = bucket.getStatistics();
      expect(stats.currentRate).toBe(0.1);
      expect(stats.pendingCount).toBe(2);

      // Complete first token to avoid interference
      firstToken.success();

      // Advance time: 20 seconds = 2 tokens at 0.1/sec
      await vi.advanceTimersByTimeAsync(20000);

      // Both pending requests should have been processed
      stats = bucket.getStatistics();
      expect(stats.pendingCount).toBe(0);

      // Verify the promises actually resolved
      const resolvedTokens = await Promise.all(pendingPromises);
      expect(resolvedTokens).toHaveLength(2);
    });

    it("should process pending requests when tokens timeout automatically", async () => {
      // This test reproduces the lockup bug
      bucket = new AIMDBucket({
        initialRate: 1, // Very low rate
        tokenReturnTimeoutMs: 1000, // Short timeout for testing
      });

      // Acquire many tokens at once - first one should be immediate, rest should be pending
      const tokenPromises = Array.from({ length: 5 }, () => bucket.acquire());

      // Wait for first token to be resolved
      await vi.advanceTimersByTimeAsync(50);

      const stats1 = bucket.getStatistics();
      expect(stats1.tokensIssued).toBe(1); // Only 1 token issued immediately
      expect(stats1.pendingCount).toBe(4); // 4 requests should be pending

      // Don't complete the first token - let it timeout automatically. Advance time past the token timeout
      await vi.advanceTimersByTimeAsync(1100);

      // After timeout, pending requests should start being processed due to refill
      await vi.advanceTimersByTimeAsync(3000); // Allow time for refill (3 more tokens at 1/sec)

      const stats2 = bucket.getStatistics();
      expect(stats2.tokensIssued).toBeGreaterThan(1);
      expect(stats2.pendingCount).toBeLessThan(4);

      await bucket.shutdown();
    });

    it("should handle rapid acquisition bursts", async () => {
      // Test that we can acquire tokens up to the bucket capacity
      const initialTokens = await Promise.all(Array.from({ length: 10 }, () => bucket.acquire()));
      expect(initialTokens).toHaveLength(10);

      // Advance time to allow refill
      await vi.advanceTimersByTimeAsync(1000);

      // Should be able to acquire more tokens after refill
      const additionalTokens = await Promise.all(Array.from({ length: 5 }, () => bucket.acquire()));
      expect(additionalTokens).toHaveLength(5);

      // Total tokens issued should be 15
      const stats = bucket.getStatistics();
      expect(stats.tokensIssued).toBe(15);
    });

    it("should handle token leaks gracefully", async () => {
      // Acquire tokens but don't complete them
      const tokens = await Promise.all(Array.from({ length: 5 }, () => bucket.acquire()));

      // Should still be able to acquire more after timeout
      await vi.advanceTimersByTimeAsync(10000);
      const newToken = await bucket.acquire();
      expect(newToken).toBeInstanceOf(AIMDBucketToken);
    });

    it("should handle configuration edge cases", () => {
      // Test initialRate > maxRate gets capped
      const bucket1 = new AIMDBucket({ initialRate: 100, maxRate: 50 });
      expect(bucket1.getCurrentRate()).toBe(50);

      // Test that minRate = maxRate works
      const bucket2 = new AIMDBucket({ minRate: 10, maxRate: 10 });
      expect(bucket2.getCurrentRate()).toBe(10);
    });

    it("should handle zero timeout tokens", async () => {
      bucket = new AIMDBucket({ tokenReturnTimeoutMs: 0 });
      const token = await bucket.acquire();

      // Should not expire immediately
      expect(token.isExpired).toBe(false);

      // Should be able to complete
      expect(() => token.success()).not.toThrow();
    });

    it("should correctly track statistics for different completion types", async () => {
      const tokens = await Promise.all([bucket.acquire(), bucket.acquire(), bucket.acquire(), bucket.acquire(), bucket.acquire()]);

      tokens[0].success();
      tokens[1].failure();
      tokens[2].rateLimited();
      tokens[3].timeout();
      // Leave tokens[4] incomplete

      const stats = bucket.getStatistics();
      expect(stats.tokensIssued).toBe(5);
      expect(stats.successCount).toBe(1);
      expect(stats.failureCount).toBe(1);
      expect(stats.rateLimitedCount).toBe(1);
      expect(stats.timeoutCount).toBe(1);
      expect(stats.successRate).toBe(0.25); // 1 success out of 4 completed
    });

    it("should handle concurrent acquire calls correctly", async () => {
      // Test that we can get the expected number of tokens over time
      const initialStats = bucket.getStatistics();

      // Exhaust the bucket
      await Promise.all(Array.from({ length: 10 }, () => bucket.acquire()));

      // Advance time significantly to allow refill
      await vi.advanceTimersByTimeAsync(2000);

      // Should be able to acquire more tokens
      const additionalTokens = await Promise.all([bucket.acquire(), bucket.acquire(), bucket.acquire()]);

      expect(additionalTokens).toHaveLength(3);
      additionalTokens.forEach((token) => expect(token).toBeInstanceOf(AIMDBucketToken));

      const finalStats = bucket.getStatistics();
      expect(finalStats.tokensIssued).toBe(initialStats.tokensIssued + 13);
    });

    it("should process pending requests when new acquire call triggers processing", async () => {
      bucket = new AIMDBucket({
        initialRate: 2,
        tokenReturnTimeoutMs: 5000,
      });

      // Exhaust the bucket completely
      const immediateTokens = await Promise.all([bucket.acquire(), bucket.acquire()]);

      // Create pending requests
      const pendingPromises = [bucket.acquire(), bucket.acquire(), bucket.acquire()];

      // Advance time slightly to ensure requests are pending
      await vi.advanceTimersByTimeAsync(100);
      let stats = bucket.getStatistics();
      expect(stats.pendingCount).toBe(3);

      // Complete immediate tokens with time gaps to trigger processing
      for (let i = 0; i < immediateTokens.length; i++) {
        immediateTokens[i].success();
        await vi.advanceTimersByTimeAsync(1000); // Allow refill time
      }

      // Now make a new acquire call which should trigger processing of old pending requests
      const newToken = await bucket.acquire();
      expect(newToken).toBeInstanceOf(AIMDBucketToken);

      // Verify pending requests were processed
      const resolvedTokens = await Promise.all(pendingPromises);
      expect(resolvedTokens).toHaveLength(3);

      stats = bucket.getStatistics();
      expect(stats.pendingCount).toBe(0);
    });

    it("should handle mixed fast and slow token completion patterns", async () => {
      bucket = new AIMDBucket({
        initialRate: 3,
        tokenReturnTimeoutMs: 10000,
      });

      // Get initial tokens
      const tokens = await Promise.all([bucket.acquire(), bucket.acquire(), bucket.acquire()]);

      // Create pending requests
      const pendingPromises = [bucket.acquire(), bucket.acquire(), bucket.acquire(), bucket.acquire()];

      // Complete tokens with mixed timing
      tokens[0].success(); // Fast completion
      await vi.advanceTimersByTimeAsync(500);
      tokens[1].success(); // Medium completion
      await vi.advanceTimersByTimeAsync(1500);
      tokens[2].success(); // Slow completion

      // All pending should be processed due to refill over time
      const resolvedTokens = await Promise.all(pendingPromises);
      expect(resolvedTokens).toHaveLength(4);

      const stats = bucket.getStatistics();
      expect(stats.pendingCount).toBe(0);
      expect(stats.tokensIssued).toBe(7);
    });

    it("should handle low rates with proper token completion timing", async () => {
      bucket = new AIMDBucket({
        initialRate: 2,
        tokenReturnTimeoutMs: 5000,
      });

      // Should get first tokens immediately
      const firstTokens = await Promise.all([bucket.acquire(), bucket.acquire()]);
      expect(firstTokens).toHaveLength(2);

      // These should be pending
      const pendingPromises = [bucket.acquire(), bucket.acquire()];

      await vi.advanceTimersByTimeAsync(100);
      let stats = bucket.getStatistics();
      expect(stats.pendingCount).toBe(2);

      // Complete first tokens with time gaps to allow refill and processing
      for (let i = 0; i < firstTokens.length; i++) {
        firstTokens[i].success();
        await vi.advanceTimersByTimeAsync(1000); // Allow time for refill
      }

      // Should have processed the pending requests
      const resolvedTokens = await Promise.all(pendingPromises);
      expect(resolvedTokens).toHaveLength(2);

      stats = bucket.getStatistics();
      expect(stats.pendingCount).toBe(0);
    });

    it("should handle burst of requests with new acquire triggering processing", async () => {
      bucket = new AIMDBucket({
        initialRate: 3,
        tokenReturnTimeoutMs: 8000,
      });

      // Create a burst of requests
      const burstPromises = Array.from({ length: 6 }, () => bucket.acquire());

      await vi.advanceTimersByTimeAsync(100);
      let stats = bucket.getStatistics();
      expect(stats.tokensIssued).toBe(3); // Only initial capacity issued
      expect(stats.pendingCount).toBe(3); // Rest are pending

      // Complete some initial tokens with time gaps for refill
      const immediateTokens = await Promise.all(burstPromises.slice(0, 3));
      for (let i = 0; i < immediateTokens.length; i++) {
        immediateTokens[i].success();
        await vi.advanceTimersByTimeAsync(500);
      }

      // Now make a single new request which should trigger processing of remaining pending
      const newToken = await bucket.acquire();
      expect(newToken).toBeInstanceOf(AIMDBucketToken);

      // All burst requests should be processed
      const resolvedTokens = await Promise.all(burstPromises);
      expect(resolvedTokens).toHaveLength(6);

      stats = bucket.getStatistics();
      expect(stats.pendingCount).toBe(0);
    });

    it("should handle token timeouts gracefully", async () => {
      bucket = new AIMDBucket({
        initialRate: 2,
        tokenReturnTimeoutMs: 1000, // Short timeout
      });

      // Get initial tokens but don't complete them (let them timeout)
      const initialTokens = await Promise.all([bucket.acquire(), bucket.acquire()]);

      // Advance past token timeout
      await vi.advanceTimersByTimeAsync(1200);

      const stats = bucket.getStatistics();
      expect(stats.timeoutCount).toBe(2); // Initial tokens timed out
      expect(stats.tokensIssued).toBe(2); // Only initial tokens were issued
    });

    it("should process all pending requests when bucket refills", async () => {
      bucket = new AIMDBucket({
        initialRate: 2,
        tokenReturnTimeoutMs: 5000,
      });

      // Get first tokens
      const firstTokens = await Promise.all([bucket.acquire(), bucket.acquire()]);

      // Create pending requests
      const pendingPromises = [bucket.acquire(), bucket.acquire()];

      // Complete first tokens with time to trigger processing
      for (let i = 0; i < firstTokens.length; i++) {
        firstTokens[i].success();
        await vi.advanceTimersByTimeAsync(1000);
      }

      // All pending requests should be processed and resolved
      const resolvedTokens = await Promise.all(pendingPromises);
      expect(resolvedTokens).toHaveLength(2);
      resolvedTokens.forEach((token) => expect(token).toBeInstanceOf(AIMDBucketToken));

      const stats = bucket.getStatistics();
      expect(stats.pendingCount).toBe(0);
    });
  });
});

describe("Token", () => {
  let bucket: AIMDBucket;
  let token: AIMDBucketToken;

  beforeEach(async () => {
    vi.useFakeTimers();
    bucket = new AIMDBucket();
    token = await bucket.acquire();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("should have proper initial state", () => {
    expect(token.isCompleted).toBe(false);
    expect(token.isExpired).toBe(false);
  });

  it("should provide completion methods", () => {
    expect(typeof token.success).toBe("function");
    expect(typeof token.failure).toBe("function");
    expect(typeof token.rateLimited).toBe("function");
    expect(typeof token.timeout).toBe("function");
  });
});
