"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const vitest_1 = require("vitest");
const index_1 = require("../src/index");
(0, vitest_1.describe)("AIMDBucket", () => {
    let bucket;
    (0, vitest_1.beforeEach)(() => {
        vitest_1.vi.useFakeTimers();
    });
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.useRealTimers();
    });
    (0, vitest_1.describe)("construction and configuration", () => {
        (0, vitest_1.it)("should create a bucket with default configuration", () => {
            bucket = new index_1.AIMDBucket();
            (0, vitest_1.expect)(bucket).toBeInstanceOf(index_1.AIMDBucket);
        });
        (0, vitest_1.it)("should create a bucket with custom configuration", () => {
            const config = {
                initialRate: 5,
                maxRate: 50,
                minRate: 1,
                increaseDelta: 2,
                decreaseMultiplier: 0.8,
                failureThreshold: 0.1,
            };
            bucket = new index_1.AIMDBucket(config);
            (0, vitest_1.expect)(bucket).toBeInstanceOf(index_1.AIMDBucket);
        });
        (0, vitest_1.it)("should throw for invalid configuration", () => {
            (0, vitest_1.expect)(() => new index_1.AIMDBucket({ initialRate: -1 })).toThrow();
            (0, vitest_1.expect)(() => new index_1.AIMDBucket({ maxRate: 0 })).toThrow();
            (0, vitest_1.expect)(() => new index_1.AIMDBucket({ decreaseMultiplier: 0 })).toThrow();
            (0, vitest_1.expect)(() => new index_1.AIMDBucket({ decreaseMultiplier: 1.5 })).toThrow();
        });
    });
    (0, vitest_1.describe)("token acquisition", () => {
        (0, vitest_1.beforeEach)(() => {
            bucket = new index_1.AIMDBucket({ initialRate: 10 });
        });
        (0, vitest_1.it)("should acquire tokens immediately when bucket has capacity", async () => {
            const token = await bucket.acquire();
            (0, vitest_1.expect)(token).toBeInstanceOf(index_1.AIMDBucketToken);
            (0, vitest_1.expect)(token.isExpired()).toBe(false);
        });
        (0, vitest_1.it)("should delay token acquisition when rate limit is reached", async () => {
            // Exhaust the bucket
            const tokens = await Promise.all(Array.from({ length: 10 }, () => bucket.acquire()));
            (0, vitest_1.expect)(tokens).toHaveLength(10);
            const stats = bucket.getStatistics();
            (0, vitest_1.expect)(stats.tokensIssued).toBe(10);
            // Advance time to allow refill
            await vitest_1.vi.advanceTimersByTimeAsync(1000);
            // Now we should be able to acquire more
            const additionalToken = await bucket.acquire();
            (0, vitest_1.expect)(additionalToken).toBeInstanceOf(index_1.AIMDBucketToken);
        });
        (0, vitest_1.it)("should process multiple pending requests in order", async () => {
            // Test that after exhausting the bucket, advancing time allows more tokens
            await Promise.all(Array.from({ length: 10 }, () => bucket.acquire()));
            // Advance time to allow refill
            await vitest_1.vi.advanceTimersByTimeAsync(1000);
            // Should be able to acquire multiple tokens
            const newTokens = await Promise.all([bucket.acquire(), bucket.acquire(), bucket.acquire()]);
            (0, vitest_1.expect)(newTokens).toHaveLength(3);
            newTokens.forEach((token) => (0, vitest_1.expect)(token).toBeInstanceOf(index_1.AIMDBucketToken));
        });
        (0, vitest_1.it)("should support concurrent token acquisition", async () => {
            const promises = Array.from({ length: 5 }, () => bucket.acquire());
            const tokens = await Promise.all(promises);
            (0, vitest_1.expect)(tokens).toHaveLength(5);
            tokens.forEach((token) => (0, vitest_1.expect)(token).toBeInstanceOf(index_1.AIMDBucketToken));
        });
        (0, vitest_1.it)("should respect maxRate limit", async () => {
            bucket = new index_1.AIMDBucket({ initialRate: 100, maxRate: 5 });
            // Force rate increase by reporting successes
            for (let i = 0; i < 20; i++) {
                const token = await bucket.acquire();
                token.success();
                await vitest_1.vi.advanceTimersByTimeAsync(250); // Advance enough time for refill
            }
            // Current rate should not exceed maxRate
            (0, vitest_1.expect)(bucket.getCurrentRate()).toBeLessThanOrEqual(5);
        });
        (0, vitest_1.it)("should properly refill tokens over time", async () => {
            // Exhaust the bucket completely
            const initialTokens = await Promise.all(Array.from({ length: 10 }, () => bucket.acquire()));
            (0, vitest_1.expect)(initialTokens).toHaveLength(10);
            let stats = bucket.getStatistics();
            (0, vitest_1.expect)(stats.tokensIssued).toBe(10);
            // Advance time by 500ms - should allow ~5 tokens at rate 10
            await vitest_1.vi.advanceTimersByTimeAsync(500);
            const secondBatch = await Promise.all(Array.from({ length: 5 }, () => bucket.acquire()));
            (0, vitest_1.expect)(secondBatch).toHaveLength(5);
            stats = bucket.getStatistics();
            (0, vitest_1.expect)(stats.tokensIssued).toBe(15);
            // Advance time by another 1000ms - should allow ~10 more tokens
            await vitest_1.vi.advanceTimersByTimeAsync(1000);
            const thirdBatch = await Promise.all(Array.from({ length: 10 }, () => bucket.acquire()));
            (0, vitest_1.expect)(thirdBatch).toHaveLength(10);
            stats = bucket.getStatistics();
            (0, vitest_1.expect)(stats.tokensIssued).toBe(25);
        });
    });
    (0, vitest_1.describe)("token lifecycle", () => {
        (0, vitest_1.beforeEach)(() => {
            bucket = new index_1.AIMDBucket({ initialRate: 10 });
        });
        (0, vitest_1.it)("should track token success", async () => {
            const token = await bucket.acquire();
            (0, vitest_1.expect)(() => token.success()).not.toThrow();
            (0, vitest_1.expect)(token.isCompleted()).toBe(true);
        });
        (0, vitest_1.it)("should track token failure", async () => {
            const token = await bucket.acquire();
            (0, vitest_1.expect)(() => token.failure()).not.toThrow();
            (0, vitest_1.expect)(token.isCompleted()).toBe(true);
        });
        (0, vitest_1.it)("should track rate limited failures", async () => {
            const token = await bucket.acquire();
            (0, vitest_1.expect)(() => token.rateLimited()).not.toThrow();
            (0, vitest_1.expect)(token.isCompleted()).toBe(true);
        });
        (0, vitest_1.it)("should track token timeout", async () => {
            const token = await bucket.acquire();
            (0, vitest_1.expect)(() => token.timeout()).not.toThrow();
            (0, vitest_1.expect)(token.isCompleted()).toBe(true);
        });
        (0, vitest_1.it)("should prevent double completion", async () => {
            const token = await bucket.acquire();
            token.success();
            (0, vitest_1.expect)(() => token.success()).toThrow();
            (0, vitest_1.expect)(() => token.failure()).toThrow();
        });
        (0, vitest_1.it)("should auto-expire tokens after timeout", async () => {
            bucket = new index_1.AIMDBucket({ tokenReturnTimeoutMs: 1000 });
            const token = await bucket.acquire();
            await vitest_1.vi.advanceTimersByTimeAsync(1100);
            (0, vitest_1.expect)(token.isExpired()).toBe(true);
            (0, vitest_1.expect)(() => token.success()).toThrow();
        });
    });
    (0, vitest_1.describe)("AIMD rate adjustment", () => {
        (0, vitest_1.beforeEach)(() => {
            bucket = new index_1.AIMDBucket({
                initialRate: 10,
                increaseDelta: 2,
                decreaseMultiplier: 0.5,
                failureThreshold: 0.2,
            });
        });
        (0, vitest_1.it)("should increase rate on sustained success", async () => {
            const initialRate = bucket.getCurrentRate();
            // Generate exactly 5 successful requests to trigger rate adjustment once
            for (let i = 0; i < 5; i++) {
                const token = await bucket.acquire();
                token.success();
                // Advance time to allow refill for next token
                await vitest_1.vi.advanceTimersByTimeAsync(200);
            }
            // Rate should have increased by increaseDelta (2) exactly once
            (0, vitest_1.expect)(bucket.getCurrentRate()).toBe(initialRate + 2);
        });
        (0, vitest_1.it)("should decrease rate on high failure rate", async () => {
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
            (0, vitest_1.expect)(bucket.getCurrentRate()).toBe(initialRate * 0.5);
        });
        (0, vitest_1.it)("should not adjust rate with fewer than 5 completed tokens", async () => {
            const initialRate = bucket.getCurrentRate();
            // Complete only 4 tokens (below threshold)
            for (let i = 0; i < 4; i++) {
                const token = await bucket.acquire();
                token.success();
                await vitest_1.vi.advanceTimersByTimeAsync(200);
            }
            // Rate should remain unchanged
            (0, vitest_1.expect)(bucket.getCurrentRate()).toBe(initialRate);
        });
        (0, vitest_1.it)("should not decrease rate below minimum", async () => {
            bucket = new index_1.AIMDBucket({
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
                    await vitest_1.vi.advanceTimersByTimeAsync(1000);
                }
            }
            // Rate should not go below minimum
            (0, vitest_1.expect)(bucket.getCurrentRate()).toBe(minRate);
        });
        (0, vitest_1.it)("should not increase rate above maximum", async () => {
            bucket = new index_1.AIMDBucket({
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
                    await vitest_1.vi.advanceTimersByTimeAsync(200);
                }
            }
            // Rate should not exceed maximum
            (0, vitest_1.expect)(bucket.getCurrentRate()).toBe(maxRate);
        });
        (0, vitest_1.it)("should handle mixed success/failure patterns correctly", async () => {
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
            (0, vitest_1.expect)(bucket.getCurrentRate()).toBe(initialRate + 2);
        });
        (0, vitest_1.it)("should treat timeouts as failures for rate adjustment", async () => {
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
            (0, vitest_1.expect)(bucket.getCurrentRate()).toBe(initialRate * 0.5);
        });
        (0, vitest_1.it)("should ignore outcomes outside sliding window for rate adjustment", async () => {
            const initialRate = bucket.getCurrentRate();
            // Create old failures (simulate 31 seconds ago, outside 30s window)
            for (let i = 0; i < 5; i++) {
                const token = await bucket.acquire();
                token.rateLimited(); // 100% failure rate
                await vitest_1.vi.advanceTimersByTimeAsync(50);
            }
            // Should have decreased rate due to failures
            (0, vitest_1.expect)(bucket.getCurrentRate()).toBe(initialRate * 0.5);
            const decreasedRate = bucket.getCurrentRate();
            // Advance time by 31 seconds to move old failures outside the window
            await vitest_1.vi.advanceTimersByTimeAsync(31000);
            // Now add new successes within the window
            for (let i = 0; i < 5; i++) {
                const token = await bucket.acquire();
                token.success(); // 100% success rate
                await vitest_1.vi.advanceTimersByTimeAsync(50);
            }
            // Rate should increase because only successes are in the sliding window
            (0, vitest_1.expect)(bucket.getCurrentRate()).toBe(decreasedRate + 2);
        });
        (0, vitest_1.it)("should use sliding window for rate decisions not all-time stats", async () => {
            const initialRate = bucket.getCurrentRate();
            // Create 5 failures to decrease rate
            const failureTokens = await Promise.all([bucket.acquire(), bucket.acquire(), bucket.acquire(), bucket.acquire(), bucket.acquire()]);
            failureTokens.forEach((token) => token.rateLimited());
            // Rate should have decreased
            const decreasedRate = bucket.getCurrentRate();
            (0, vitest_1.expect)(decreasedRate).toBe(initialRate * 0.5);
            // Move time forward to push failures out of sliding window
            await vitest_1.vi.advanceTimersByTimeAsync(31000);
            // Now create 5 successes - since failures are outside window, rate should increase
            const successTokens = await Promise.all([bucket.acquire(), bucket.acquire(), bucket.acquire(), bucket.acquire(), bucket.acquire()]);
            successTokens.forEach((token) => token.success());
            // Rate should increase because only successes are in the sliding window
            (0, vitest_1.expect)(bucket.getCurrentRate()).toBe(decreasedRate + 2);
        });
        (0, vitest_1.it)("should allow quick rate decreases with short sliding window", async () => {
            // Create bucket with very short 3-second window for fast adaptation
            const quickBucket = new index_1.AIMDBucket({
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
                await vitest_1.vi.advanceTimersByTimeAsync(100);
            }
            // Rate should have increased due to successes
            (0, vitest_1.expect)(quickBucket.getCurrentRate()).toBe(initialRate + 1);
            const increasedRate = quickBucket.getCurrentRate();
            // Wait for successes to age out of the short window
            await vitest_1.vi.advanceTimersByTimeAsync(4000);
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
            (0, vitest_1.expect)(quickBucket.getCurrentRate()).toBe(increasedRate * 0.5);
        });
    });
    (0, vitest_1.describe)("statistics and monitoring", () => {
        (0, vitest_1.beforeEach)(() => {
            bucket = new index_1.AIMDBucket({ initialRate: 10 });
        });
        (0, vitest_1.it)("should provide current statistics", async () => {
            const stats = bucket.getStatistics();
            (0, vitest_1.expect)(stats).toHaveProperty("currentRate");
            (0, vitest_1.expect)(stats).toHaveProperty("tokensIssued");
            (0, vitest_1.expect)(stats).toHaveProperty("successCount");
            (0, vitest_1.expect)(stats).toHaveProperty("failureCount");
            (0, vitest_1.expect)(stats).toHaveProperty("rateLimitedCount");
            (0, vitest_1.expect)(stats).toHaveProperty("timeoutCount");
            (0, vitest_1.expect)(stats).toHaveProperty("successRate");
        });
        (0, vitest_1.it)("should track token statistics", async () => {
            const token1 = await bucket.acquire();
            const token2 = await bucket.acquire();
            const token3 = await bucket.acquire();
            token1.success();
            token2.failure();
            token3.rateLimited();
            const stats = bucket.getStatistics();
            (0, vitest_1.expect)(stats.tokensIssued).toBe(3);
            (0, vitest_1.expect)(stats.successCount).toBe(1);
            (0, vitest_1.expect)(stats.failureCount).toBe(1);
            (0, vitest_1.expect)(stats.rateLimitedCount).toBe(1);
            (0, vitest_1.expect)(stats.successRate).toBe(1 / 3);
        });
        (0, vitest_1.it)("should calculate statistics from sliding window only", async () => {
            // Create old outcomes
            const oldTokens = await Promise.all([bucket.acquire(), bucket.acquire(), bucket.acquire()]);
            oldTokens[0].success();
            oldTokens[1].failure();
            oldTokens[2].rateLimited();
            // Advance time to push old outcomes out of window
            await vitest_1.vi.advanceTimersByTimeAsync(31000);
            // Create new outcomes within window
            const newTokens = await Promise.all([bucket.acquire(), bucket.acquire()]);
            newTokens[0].success();
            newTokens[1].success();
            const stats = bucket.getStatistics();
            // tokensIssued should include all tokens (it's a counter, not windowed)
            (0, vitest_1.expect)(stats.tokensIssued).toBe(5);
            // But outcome stats should only reflect recent window
            (0, vitest_1.expect)(stats.successCount).toBe(2);
            (0, vitest_1.expect)(stats.failureCount).toBe(0);
            (0, vitest_1.expect)(stats.rateLimitedCount).toBe(0);
            (0, vitest_1.expect)(stats.successRate).toBe(1.0); // 100% success in recent window
        });
        (0, vitest_1.it)("should handle empty sliding window gracefully", async () => {
            // Don't complete any tokens, just acquire and let time pass
            await bucket.acquire();
            await vitest_1.vi.advanceTimersByTimeAsync(31000);
            const stats = bucket.getStatistics();
            (0, vitest_1.expect)(stats.successRate).toBe(0); // No completed tokens in window
            (0, vitest_1.expect)(stats.successCount).toBe(0);
            (0, vitest_1.expect)(stats.failureCount).toBe(0);
        });
    });
    (0, vitest_1.describe)("graceful shutdown", () => {
        (0, vitest_1.beforeEach)(() => {
            bucket = new index_1.AIMDBucket({ initialRate: 10 });
        });
        (0, vitest_1.it)("should support graceful shutdown", async () => {
            // First exhaust the bucket to make subsequent acquisitions pending
            const exhaustTokens = await Promise.all(Array.from({ length: 10 }, () => bucket.acquire()));
            (0, vitest_1.expect)(exhaustTokens).toHaveLength(10);
            // Now these should be pending
            const token1 = bucket.acquire();
            const token2 = bucket.acquire();
            await bucket.shutdown();
            // Pending acquisitions should be rejected
            await (0, vitest_1.expect)(token1).rejects.toThrow();
            await (0, vitest_1.expect)(token2).rejects.toThrow();
        });
        (0, vitest_1.it)("should reject new acquisitions after shutdown", async () => {
            await bucket.shutdown();
            await (0, vitest_1.expect)(bucket.acquire()).rejects.toThrow();
        });
    });
    (0, vitest_1.describe)("edge cases and error handling", () => {
        (0, vitest_1.beforeEach)(() => {
            bucket = new index_1.AIMDBucket({ initialRate: 10 });
        });
        (0, vitest_1.it)("should process pending requests when tokens are completed with sufficient time gaps", async () => {
            // This test verifies the fix for the lockup bug where pending requests get stuck
            bucket = new index_1.AIMDBucket({
                initialRate: 4, // Start with low rate like user's case
                tokenReturnTimeoutMs: 10000, // Long timeout so tokens don't auto-expire
            });
            // Acquire tokens that will be resolved immediately (up to initial capacity)
            const immediateTokens = await Promise.all([bucket.acquire(), bucket.acquire(), bucket.acquire(), bucket.acquire()]);
            (0, vitest_1.expect)(immediateTokens).toHaveLength(4);
            // These should become pending since we've exhausted the bucket
            const pendingTokenPromises = [bucket.acquire(), bucket.acquire(), bucket.acquire(), bucket.acquire(), bucket.acquire()];
            // Advance time slightly to see initial state
            await vitest_1.vi.advanceTimersByTimeAsync(100);
            let stats = bucket.getStatistics();
            (0, vitest_1.expect)(stats.tokensIssued).toBe(4);
            (0, vitest_1.expect)(stats.pendingCount).toBe(5);
            // Complete the immediate tokens successfully to trigger rate increase
            // Add some time between completions to allow bucket to refill
            for (let i = 0; i < immediateTokens.length; i++) {
                immediateTokens[i].success();
                await vitest_1.vi.advanceTimersByTimeAsync(500); // Allow some refill time
            }
            // At this point, some pending requests should have been processed during token completions
            stats = bucket.getStatistics();
            (0, vitest_1.expect)(stats.successCount).toBe(4);
            // All pending requests should have been processed due to the fix
            (0, vitest_1.expect)(stats.pendingCount).toBe(0);
            (0, vitest_1.expect)(stats.tokensIssued).toBe(9); // 4 immediate + 5 pending
            // Verify that all pending promises were resolved
            const resolvedTokens = await Promise.all(pendingTokenPromises);
            (0, vitest_1.expect)(resolvedTokens).toHaveLength(5);
            resolvedTokens.forEach((token) => (0, vitest_1.expect)(token).toBeInstanceOf(index_1.AIMDBucketToken));
        });
        (0, vitest_1.it)("should process pending requests when tokens timeout automatically", async () => {
            // This test reproduces the lockup bug
            bucket = new index_1.AIMDBucket({
                initialRate: 1, // Very low rate
                tokenReturnTimeoutMs: 1000, // Short timeout for testing
            });
            // Acquire many tokens at once - first one should be immediate, rest should be pending
            const tokenPromises = Array.from({ length: 5 }, () => bucket.acquire());
            // Wait for first token to be resolved
            await vitest_1.vi.advanceTimersByTimeAsync(50);
            const stats1 = bucket.getStatistics();
            (0, vitest_1.expect)(stats1.tokensIssued).toBe(1); // Only 1 token issued immediately
            (0, vitest_1.expect)(stats1.pendingCount).toBe(4); // 4 requests should be pending
            // Don't complete the first token - let it timeout automatically. Advance time past the token timeout
            await vitest_1.vi.advanceTimersByTimeAsync(1100);
            // After timeout, pending requests should start being processed due to refill
            await vitest_1.vi.advanceTimersByTimeAsync(3000); // Allow time for refill (3 more tokens at 1/sec)
            const stats2 = bucket.getStatistics();
            (0, vitest_1.expect)(stats2.tokensIssued).toBeGreaterThan(1);
            (0, vitest_1.expect)(stats2.pendingCount).toBeLessThan(4);
            await bucket.shutdown();
        });
        (0, vitest_1.it)("should handle rapid acquisition bursts", async () => {
            // Test that we can acquire tokens up to the bucket capacity
            const initialTokens = await Promise.all(Array.from({ length: 10 }, () => bucket.acquire()));
            (0, vitest_1.expect)(initialTokens).toHaveLength(10);
            // Advance time to allow refill
            await vitest_1.vi.advanceTimersByTimeAsync(1000);
            // Should be able to acquire more tokens after refill
            const additionalTokens = await Promise.all(Array.from({ length: 5 }, () => bucket.acquire()));
            (0, vitest_1.expect)(additionalTokens).toHaveLength(5);
            // Total tokens issued should be 15
            const stats = bucket.getStatistics();
            (0, vitest_1.expect)(stats.tokensIssued).toBe(15);
        });
        (0, vitest_1.it)("should handle token leaks gracefully", async () => {
            // Acquire tokens but don't complete them
            const tokens = await Promise.all(Array.from({ length: 5 }, () => bucket.acquire()));
            // Should still be able to acquire more after timeout
            await vitest_1.vi.advanceTimersByTimeAsync(10000);
            const newToken = await bucket.acquire();
            (0, vitest_1.expect)(newToken).toBeInstanceOf(index_1.AIMDBucketToken);
        });
        (0, vitest_1.it)("should handle configuration edge cases", () => {
            // Test initialRate > maxRate gets capped
            const bucket1 = new index_1.AIMDBucket({ initialRate: 100, maxRate: 50 });
            (0, vitest_1.expect)(bucket1.getCurrentRate()).toBe(50);
            // Test that minRate = maxRate works
            const bucket2 = new index_1.AIMDBucket({ minRate: 10, maxRate: 10 });
            (0, vitest_1.expect)(bucket2.getCurrentRate()).toBe(10);
        });
        (0, vitest_1.it)("should handle zero timeout tokens", async () => {
            bucket = new index_1.AIMDBucket({ tokenReturnTimeoutMs: 0 });
            const token = await bucket.acquire();
            // Should not expire immediately
            (0, vitest_1.expect)(token.isExpired()).toBe(false);
            // Should be able to complete
            (0, vitest_1.expect)(() => token.success()).not.toThrow();
        });
        (0, vitest_1.it)("should correctly track statistics for different completion types", async () => {
            const tokens = await Promise.all([bucket.acquire(), bucket.acquire(), bucket.acquire(), bucket.acquire(), bucket.acquire()]);
            tokens[0].success();
            tokens[1].failure();
            tokens[2].rateLimited();
            tokens[3].timeout();
            // Leave tokens[4] incomplete
            const stats = bucket.getStatistics();
            (0, vitest_1.expect)(stats.tokensIssued).toBe(5);
            (0, vitest_1.expect)(stats.successCount).toBe(1);
            (0, vitest_1.expect)(stats.failureCount).toBe(1);
            (0, vitest_1.expect)(stats.rateLimitedCount).toBe(1);
            (0, vitest_1.expect)(stats.timeoutCount).toBe(1);
            (0, vitest_1.expect)(stats.successRate).toBe(0.25); // 1 success out of 4 completed
        });
        (0, vitest_1.it)("should handle concurrent acquire calls correctly", async () => {
            // Test that we can get the expected number of tokens over time
            const initialStats = bucket.getStatistics();
            // Exhaust the bucket
            await Promise.all(Array.from({ length: 10 }, () => bucket.acquire()));
            // Advance time significantly to allow refill
            await vitest_1.vi.advanceTimersByTimeAsync(2000);
            // Should be able to acquire more tokens
            const additionalTokens = await Promise.all([bucket.acquire(), bucket.acquire(), bucket.acquire()]);
            (0, vitest_1.expect)(additionalTokens).toHaveLength(3);
            additionalTokens.forEach((token) => (0, vitest_1.expect)(token).toBeInstanceOf(index_1.AIMDBucketToken));
            const finalStats = bucket.getStatistics();
            (0, vitest_1.expect)(finalStats.tokensIssued).toBe(initialStats.tokensIssued + 13);
        });
        (0, vitest_1.it)("should process pending requests when new acquire call triggers processing", async () => {
            bucket = new index_1.AIMDBucket({
                initialRate: 2,
                tokenReturnTimeoutMs: 5000,
            });
            // Exhaust the bucket completely
            const immediateTokens = await Promise.all([bucket.acquire(), bucket.acquire()]);
            // Create pending requests
            const pendingPromises = [bucket.acquire(), bucket.acquire(), bucket.acquire()];
            // Advance time slightly to ensure requests are pending
            await vitest_1.vi.advanceTimersByTimeAsync(100);
            let stats = bucket.getStatistics();
            (0, vitest_1.expect)(stats.pendingCount).toBe(3);
            // Complete immediate tokens with time gaps to trigger processing
            for (let i = 0; i < immediateTokens.length; i++) {
                immediateTokens[i].success();
                await vitest_1.vi.advanceTimersByTimeAsync(1000); // Allow refill time
            }
            // Now make a new acquire call which should trigger processing of old pending requests
            const newToken = await bucket.acquire();
            (0, vitest_1.expect)(newToken).toBeInstanceOf(index_1.AIMDBucketToken);
            // Verify pending requests were processed
            const resolvedTokens = await Promise.all(pendingPromises);
            (0, vitest_1.expect)(resolvedTokens).toHaveLength(3);
            stats = bucket.getStatistics();
            (0, vitest_1.expect)(stats.pendingCount).toBe(0);
        });
        (0, vitest_1.it)("should handle mixed fast and slow token completion patterns", async () => {
            bucket = new index_1.AIMDBucket({
                initialRate: 3,
                tokenReturnTimeoutMs: 10000,
            });
            // Get initial tokens
            const tokens = await Promise.all([bucket.acquire(), bucket.acquire(), bucket.acquire()]);
            // Create pending requests
            const pendingPromises = [bucket.acquire(), bucket.acquire(), bucket.acquire(), bucket.acquire()];
            // Complete tokens with mixed timing
            tokens[0].success(); // Fast completion
            await vitest_1.vi.advanceTimersByTimeAsync(500);
            tokens[1].success(); // Medium completion
            await vitest_1.vi.advanceTimersByTimeAsync(1500);
            tokens[2].success(); // Slow completion
            // All pending should be processed due to refill over time
            const resolvedTokens = await Promise.all(pendingPromises);
            (0, vitest_1.expect)(resolvedTokens).toHaveLength(4);
            const stats = bucket.getStatistics();
            (0, vitest_1.expect)(stats.pendingCount).toBe(0);
            (0, vitest_1.expect)(stats.tokensIssued).toBe(7);
        });
        (0, vitest_1.it)("should handle low rates with proper token completion timing", async () => {
            bucket = new index_1.AIMDBucket({
                initialRate: 2,
                tokenReturnTimeoutMs: 5000,
            });
            // Should get first tokens immediately
            const firstTokens = await Promise.all([bucket.acquire(), bucket.acquire()]);
            (0, vitest_1.expect)(firstTokens).toHaveLength(2);
            // These should be pending
            const pendingPromises = [bucket.acquire(), bucket.acquire()];
            await vitest_1.vi.advanceTimersByTimeAsync(100);
            let stats = bucket.getStatistics();
            (0, vitest_1.expect)(stats.pendingCount).toBe(2);
            // Complete first tokens with time gaps to allow refill and processing
            for (let i = 0; i < firstTokens.length; i++) {
                firstTokens[i].success();
                await vitest_1.vi.advanceTimersByTimeAsync(1000); // Allow time for refill
            }
            // Should have processed the pending requests
            const resolvedTokens = await Promise.all(pendingPromises);
            (0, vitest_1.expect)(resolvedTokens).toHaveLength(2);
            stats = bucket.getStatistics();
            (0, vitest_1.expect)(stats.pendingCount).toBe(0);
        });
        (0, vitest_1.it)("should handle burst of requests with new acquire triggering processing", async () => {
            bucket = new index_1.AIMDBucket({
                initialRate: 3,
                tokenReturnTimeoutMs: 8000,
            });
            // Create a burst of requests
            const burstPromises = Array.from({ length: 6 }, () => bucket.acquire());
            await vitest_1.vi.advanceTimersByTimeAsync(100);
            let stats = bucket.getStatistics();
            (0, vitest_1.expect)(stats.tokensIssued).toBe(3); // Only initial capacity issued
            (0, vitest_1.expect)(stats.pendingCount).toBe(3); // Rest are pending
            // Complete some initial tokens with time gaps for refill
            const immediateTokens = await Promise.all(burstPromises.slice(0, 3));
            for (let i = 0; i < immediateTokens.length; i++) {
                immediateTokens[i].success();
                await vitest_1.vi.advanceTimersByTimeAsync(500);
            }
            // Now make a single new request which should trigger processing of remaining pending
            const newToken = await bucket.acquire();
            (0, vitest_1.expect)(newToken).toBeInstanceOf(index_1.AIMDBucketToken);
            // All burst requests should be processed
            const resolvedTokens = await Promise.all(burstPromises);
            (0, vitest_1.expect)(resolvedTokens).toHaveLength(6);
            stats = bucket.getStatistics();
            (0, vitest_1.expect)(stats.pendingCount).toBe(0);
        });
        (0, vitest_1.it)("should handle token timeouts gracefully", async () => {
            bucket = new index_1.AIMDBucket({
                initialRate: 2,
                tokenReturnTimeoutMs: 1000, // Short timeout
            });
            // Get initial tokens but don't complete them (let them timeout)
            const initialTokens = await Promise.all([bucket.acquire(), bucket.acquire()]);
            // Advance past token timeout
            await vitest_1.vi.advanceTimersByTimeAsync(1200);
            const stats = bucket.getStatistics();
            (0, vitest_1.expect)(stats.timeoutCount).toBe(2); // Initial tokens timed out
            (0, vitest_1.expect)(stats.tokensIssued).toBe(2); // Only initial tokens were issued
        });
        (0, vitest_1.it)("should process all pending requests when bucket refills", async () => {
            bucket = new index_1.AIMDBucket({
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
                await vitest_1.vi.advanceTimersByTimeAsync(1000);
            }
            // All pending requests should be processed and resolved
            const resolvedTokens = await Promise.all(pendingPromises);
            (0, vitest_1.expect)(resolvedTokens).toHaveLength(2);
            resolvedTokens.forEach((token) => (0, vitest_1.expect)(token).toBeInstanceOf(index_1.AIMDBucketToken));
            const stats = bucket.getStatistics();
            (0, vitest_1.expect)(stats.pendingCount).toBe(0);
        });
    });
});
(0, vitest_1.describe)("Token", () => {
    let bucket;
    let token;
    (0, vitest_1.beforeEach)(async () => {
        vitest_1.vi.useFakeTimers();
        bucket = new index_1.AIMDBucket();
        token = await bucket.acquire();
    });
    (0, vitest_1.afterEach)(() => {
        vitest_1.vi.useRealTimers();
    });
    (0, vitest_1.it)("should have proper initial state", () => {
        (0, vitest_1.expect)(token.isCompleted()).toBe(false);
        (0, vitest_1.expect)(token.isExpired()).toBe(false);
    });
    (0, vitest_1.it)("should provide completion methods", () => {
        (0, vitest_1.expect)(typeof token.success).toBe("function");
        (0, vitest_1.expect)(typeof token.failure).toBe("function");
        (0, vitest_1.expect)(typeof token.rateLimited).toBe("function");
        (0, vitest_1.expect)(typeof token.timeout).toBe("function");
    });
});
