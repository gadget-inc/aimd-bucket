"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.AIMDBucket = exports.AIMDBucketToken = void 0;
const api_1 = require("@opentelemetry/api");
/**
 * One token that has been successfully acquired from the bucket
 * Expected to be completed once as either a success, failure, rate limited, or timeout
 */
class AIMDBucketToken {
    constructor(bucket, timeoutMs) {
        this.bucket = bucket;
        this.completed = false;
        this.expired = false;
        if (timeoutMs > 0) {
            this.timeoutHandle = setTimeout(() => {
                this.expired = true;
                this.bucket._onTokenTimeout();
            }, timeoutMs).unref();
        }
    }
    /**
     * Report successful completion of the request
     */
    success() {
        this._complete("success");
    }
    /**
     * Report failed completion of the request
     */
    failure() {
        this._complete("failure");
    }
    /**
     * Report that the request was rate limited (429 status)
     */
    rateLimited() {
        this._complete("rateLimited");
    }
    /**
     * Report that the request timed out
     */
    timeout() {
        this._complete("timeout");
    }
    /**
     * Check if the token has been completed (success/failure reported)
     */
    get isCompleted() {
        return this.completed;
    }
    /**
     * Check if the token has expired
     */
    get isExpired() {
        return this.expired;
    }
    _complete(outcome) {
        if (this.completed) {
            throw new Error("Token has already been completed");
        }
        if (this.expired) {
            throw new Error("Token has expired");
        }
        this.completed = true;
        if (this.timeoutHandle) {
            clearTimeout(this.timeoutHandle);
        }
        this.bucket._onTokenComplete(outcome);
    }
}
exports.AIMDBucketToken = AIMDBucketToken;
const tracer = api_1.trace.getTracer("aimd-bucket");
/**
 * AIMD (Additive Increase Multiplicative Decrease) Rate Limiting Bucket
 *
 * Implements a leaky bucket rate limiter with adaptive rate adjustment based on
 * success/failure feedback. Ideal for distributed systems that need to discover
 * and adapt to unknown rate limits.
 */
class AIMDBucket {
    constructor(config = {}) {
        this.lastRefill = Date.now();
        this.recentOutcomes = [];
        this.tokensIssued = 0; // Only track total issued for reporting
        this.pending = [];
        this.isShutdown = false;
        const maxRate = config.maxRate ?? Number.MAX_SAFE_INTEGER / 2; // effectively infinity, but we can still do math on it
        this.config = {
            initialRate: config.initialRate ?? maxRate,
            maxRate,
            minRate: config.minRate ?? 1,
            increaseDelta: config.increaseDelta ?? 1,
            decreaseMultiplier: config.decreaseMultiplier ?? 0.5,
            failureThreshold: config.failureThreshold ?? 0.2,
            tokenReturnTimeoutMs: config.tokenReturnTimeoutMs ?? 30000,
            windowMs: config.windowMs ?? 30000,
        };
        this._validate();
        this.rate = Math.min(this.config.initialRate, this.config.maxRate);
        // Capacity should be at least 1 to allow issuing tokens, even with fractional rates
        this.capacity = Math.max(1, this.rate);
        this.tokens = this.capacity;
    }
    /**
     * Acquire a token to make a request
     * @returns Promise that resolves to a Token when one becomes available
     */
    async acquire() {
        if (this.isShutdown) {
            throw new Error("Bucket has been shut down");
        }
        // Update token count and process any pending requests that can now be fulfilled
        this._refill();
        if (this.tokens >= 1) {
            // capacity is available now, immediately issue a token
            this.tokens--;
            this.tokensIssued++;
            return new AIMDBucketToken(this, this.config.tokenReturnTimeoutMs);
        }
        else {
            // capacity is not available now, return a promise for a future token
            const span = tracer.startSpan("token-bucket.wait", {
                attributes: {
                    "token_bucket.current_rate": this.rate,
                    "token_bucket.available_tokens": this.tokens,
                    "token_bucket.pending_requests": this.pending.length,
                },
            });
            return new Promise((resolve, reject) => {
                this.pending.push({
                    resolve: (token) => {
                        span.end();
                        resolve(token);
                    },
                    reject: (error) => {
                        span.recordException(error);
                        span.end();
                        reject(error);
                    },
                    timestamp: Date.now(),
                });
                // Set a one-shot timer to process pending requests if no events occur
                this._schedulePendingCheck();
            });
        }
    }
    /**
     * Get current rate limit (tokens per second)
     */
    getCurrentRate() {
        return this.rate;
    }
    /**
     * Get current statistics (based on sliding window)
     */
    getStatistics() {
        const windowMs = this.config.windowMs;
        const now = Date.now();
        // Filter to recent outcomes
        const recentOutcomes = this.recentOutcomes.filter((o) => now - o.timestamp <= windowMs);
        const successCount = recentOutcomes.filter((o) => o.outcome === "success").length;
        const failureCount = recentOutcomes.filter((o) => o.outcome === "failure").length;
        const rateLimitedCount = recentOutcomes.filter((o) => o.outcome === "rateLimited").length;
        const timeoutCount = recentOutcomes.filter((o) => o.outcome === "timeout").length;
        const total = recentOutcomes.length;
        return {
            currentRate: this.rate,
            tokensAvailable: this.tokens,
            pendingCount: this.pending.length,
            tokensIssued: this.tokensIssued,
            successCount,
            failureCount,
            rateLimitedCount,
            timeoutCount,
            successRate: total > 0 ? successCount / total : 0,
        };
    }
    /**
     * Gracefully shut down the bucket
     */
    async shutdown() {
        this.isShutdown = true;
        // Clear pending timer
        if (this.pendingTimer) {
            clearTimeout(this.pendingTimer);
            this.pendingTimer = undefined;
        }
        // Reject all pending acquisitions
        const pendingRequests = [...this.pending];
        this.pending = [];
        pendingRequests.forEach(({ reject }) => {
            reject(new Error("Bucket has been shut down"));
        });
    }
    /**
     * @internal Called by Token when it's completed
     */
    _onTokenComplete(outcome) {
        this.recentOutcomes.push({ timestamp: Date.now(), outcome });
        this._adjustRate();
        // Process pending requests in case rate adjustment or time passage made tokens available
        this._refill();
    }
    /**
     * @internal Called by Token when it times out
     */
    _onTokenTimeout() {
        this.recentOutcomes.push({ timestamp: Date.now(), outcome: "timeout" });
        this._adjustRate();
        // Process pending requests in case rate adjustment or time passage made tokens available
        this._refill();
    }
    _validate() {
        const { initialRate, maxRate, minRate, decreaseMultiplier, failureThreshold } = this.config;
        if (initialRate <= 0)
            throw new Error("initialRate must be positive");
        if (maxRate <= 0)
            throw new Error("maxRate must be positive");
        if (minRate <= 0)
            throw new Error("minRate must be positive");
        if (minRate > maxRate)
            throw new Error("minRate cannot be greater than maxRate");
        if (decreaseMultiplier <= 0 || decreaseMultiplier >= 1) {
            throw new Error("decreaseMultiplier must be between 0 and 1");
        }
        if (failureThreshold < 0 || failureThreshold > 1) {
            throw new Error("failureThreshold must be between 0 and 1");
        }
    }
    /**
     * Update token count based on elapsed time and process any pending requests
     */
    _refill() {
        const now = Date.now();
        const elapsed = (now - this.lastRefill) / 1000;
        // Use capacity instead of rate for the token limit to support fractional rates
        this.tokens = Math.min(this.capacity, this.tokens + elapsed * this.rate);
        this.lastRefill = now;
        while (this.pending.length > 0 && this.tokens >= 1) {
            const request = this.pending.shift();
            this.tokens--;
            this.tokensIssued++;
            request.resolve(new AIMDBucketToken(this, this.config.tokenReturnTimeoutMs));
        }
        // Clear pending timer if no more pending requests
        if (this.pending.length === 0 && this.pendingTimer) {
            clearTimeout(this.pendingTimer);
            this.pendingTimer = undefined;
        }
    }
    /**
     * Schedule a one-shot timer to process pending requests if no events occur
     */
    _schedulePendingCheck() {
        // Don't schedule if already scheduled or shutting down
        if (this.pendingTimer || this.isShutdown) {
            return;
        }
        // Calculate next expected refill time based on current rate
        // At minimum, check every 100ms, but ideally check when next token should be available
        const nextTokenTime = Math.max(100, 1000 / this.rate);
        this.pendingTimer = setTimeout(() => {
            this.pendingTimer = undefined;
            this._refill();
            // If there are still pending requests after refill, schedule another check
            if (this.pending.length > 0 && !this.isShutdown) {
                this._schedulePendingCheck();
            }
        }, nextTokenTime).unref(); // Use unref() so this doesn't keep the process alive
    }
    _adjustRate() {
        const windowMs = this.config.windowMs;
        const now = Date.now();
        // Remove old outcomes outside the window
        this.recentOutcomes = this.recentOutcomes.filter((o) => now - o.timestamp <= windowMs);
        // Need minimum samples to make rate decisions
        if (this.recentOutcomes.length < 5)
            return;
        const failures = this.recentOutcomes.filter((o) => o.outcome !== "success").length;
        const failureRate = failures / this.recentOutcomes.length;
        if (failureRate > this.config.failureThreshold) {
            // Multiplicative decrease
            this.rate = Math.max(this.config.minRate, this.rate * this.config.decreaseMultiplier);
        }
        else {
            // Additive increase
            this.rate = Math.min(this.config.maxRate, this.rate + this.config.increaseDelta);
        }
        // Update capacity when rate changes, ensuring it's at least 1
        this.capacity = Math.max(1, this.rate);
    }
}
exports.AIMDBucket = AIMDBucket;
