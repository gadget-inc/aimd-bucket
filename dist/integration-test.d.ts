#!/usr/bin/env node
declare class SinusoidalRateLimiter {
    private baseRate;
    private amplitude;
    private periodMs;
    private requests;
    private readonly windowMs;
    constructor(baseRate?: number, amplitude?: number, periodMs?: number);
    getCurrentLimit(): number;
    isAllowed(ip?: string): boolean;
    getStats(): {
        currentLimit: number;
        period: number;
        baseRate: number;
        amplitude: number;
    };
}
declare class IntegrationTestRunner {
    private rateLimiter;
    private bucket;
    private graph;
    private server?;
    private readonly port;
    private running;
    private requestCount;
    private createServer;
    private startServer;
    private makeRequest;
    private runRequestLoop;
    private updateDisplay;
    run(): Promise<void>;
}
export { IntegrationTestRunner, SinusoidalRateLimiter };
