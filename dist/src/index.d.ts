/**
 * Configuration options for the AIMD Bucket rate limiter
 */
export interface AIMDBucketConfig {
    /** Initial rate limit (tokens per second) */
    initialRate?: number;
    /** Maximum rate limit (tokens per second) */
    maxRate?: number;
    /** Minimum rate limit (tokens per second) */
    minRate?: number;
    /** Amount to increase rate by on success (additive increase) */
    increaseDelta?: number;
    /** Multiplier to decrease rate by on failure (multiplicative decrease) */
    decreaseMultiplier?: number;
    /** Failure threshold (0-1) that triggers rate decrease */
    failureThreshold?: number;
    /** Token timeout in milliseconds */
    tokenTimeoutMs?: number;
    /** Sliding window duration in milliseconds for rate adjustment decisions */
    windowMs?: number;
}
/**
 * Statistics about the rate limiter's performance
 */
export interface AIMDBucketStatistics {
    currentRate: number;
    tokensIssued: number;
    successCount: number;
    failureCount: number;
    rateLimitedCount: number;
    timeoutCount: number;
    successRate: number;
}
/**
 * One token that has been successfully acquired from the bucket
 * Expected to be completed once as either a success, failure, rate limited, or timeout
 */
export declare class Token {
    private bucket;
    private completed;
    private expired;
    private timeoutHandle?;
    constructor(bucket: AIMDBucket, timeoutMs: number);
    /**
     * Report successful completion of the request
     */
    success(): void;
    /**
     * Report failed completion of the request
     */
    failure(): void;
    /**
     * Report that the request was rate limited (429 status)
     */
    rateLimited(): void;
    /**
     * Report that the request timed out
     */
    timeout(): void;
    /**
     * Check if the token has been completed (success/failure reported)
     */
    isCompleted(): boolean;
    /**
     * Check if the token has expired
     */
    isExpired(): boolean;
    private _complete;
}
/**
 * AIMD (Additive Increase Multiplicative Decrease) Rate Limiting Bucket
 *
 * Implements a leaky bucket rate limiter with adaptive rate adjustment based on
 * success/failure feedback. Ideal for distributed systems that need to discover
 * and adapt to unknown rate limits.
 */
export declare class AIMDBucket {
    private rate;
    private tokens;
    private lastRefill;
    private recentOutcomes;
    private tokensIssued;
    private pending;
    private isShutdown;
    private config;
    constructor(config?: AIMDBucketConfig);
    /**
     * Acquire a token to make a request
     * @returns Promise that resolves to a Token when one becomes available
     */
    acquire(): Promise<Token>;
    /**
     * Get current rate limit (tokens per second)
     */
    getCurrentRate(): number;
    /**
     * Get current statistics (based on sliding window)
     */
    getStatistics(): AIMDBucketStatistics;
    /**
     * Gracefully shut down the bucket
     */
    shutdown(): Promise<void>;
    /**
     * @internal Called by Token when it's completed
     */
    _onTokenComplete(outcome: "success" | "failure" | "rateLimited" | "timeout"): void;
    /**
     * @internal Called by Token when it times out
     */
    _onTokenTimeout(): void;
    private _validate;
    private _refill;
    private _processPending;
    private _adjustRate;
}
