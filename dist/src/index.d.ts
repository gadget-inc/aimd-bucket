/**
 * Configuration options for the AIMD Bucket rate limiter
 */
export interface AIMDBucketConfig {
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
     * Initial rate limit (tokens per second)
     * @default maxRate
     */
    initialRate?: number;
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
     * Failure threshold (0-1) that triggers rate decrease
     * @default 0.2
     */
    failureThreshold?: number;
    /**
     * If tokens aren't marked with an outcome within this timeout, they'll be automatically marked as timed out. Measured in milliseconds.
     * @default 30000
     */
    tokenReturnTimeoutMs?: number;
    /**
     * Sliding window stats collection duration for rate adjustment decisions in milliseconds
     * @default 30000
     */
    windowMs?: number;
}
/**
 * Statistics about the rate limiter's performance
 */
export interface AIMDBucketStatistics {
    currentRate: number;
    tokensAvailable: number;
    tokensIssued: number;
    successCount: number;
    failureCount: number;
    pendingCount: number;
    rateLimitedCount: number;
    timeoutCount: number;
    successRate: number;
}
/**
 * One token that has been successfully acquired from the bucket
 * Expected to be completed once as either a success, failure, rate limited, or timeout
 */
export declare class AIMDBucketToken {
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
    get isCompleted(): boolean;
    /**
     * Check if the token has expired
     */
    get isExpired(): boolean;
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
    private capacity;
    private lastRefill;
    private recentOutcomes;
    private tokensIssued;
    private pending;
    private isShutdown;
    private pendingTimer?;
    private config;
    constructor(config?: AIMDBucketConfig);
    /**
     * Acquire a token to make a request
     * @returns Promise that resolves to a Token when one becomes available
     */
    acquire(): Promise<AIMDBucketToken>;
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
    /**
     * Update token count based on elapsed time and process any pending requests
     */
    private _refill;
    /**
     * Schedule a one-shot timer to process pending requests if no events occur
     */
    private _schedulePendingCheck;
    private _adjustRate;
}
