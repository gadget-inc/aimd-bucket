#!/usr/bin/env node

import * as http from "http";
import { AIMDBucket } from "./src/index";

// ANSI escape codes for colors and cursor control
const COLORS = {
  reset: "\x1b[0m",
  red: "\x1b[31m",
  green: "\x1b[32m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

class SinusoidalRateLimiter {
  private requests = new Map<string, { count: number; windowStart: number }>();
  private readonly windowMs = 1000; // 1 second windows

  constructor(private baseRate: number = 20, private amplitude: number = 15, private periodMs: number = 60000) {}

  getCurrentLimit(): number {
    const now = Date.now();
    const phase = (2 * Math.PI * now) / this.periodMs;
    return Math.max(1, Math.round(this.baseRate + this.amplitude * Math.sin(phase)));
  }

  isAllowed(ip: string = "default"): boolean {
    const now = Date.now();
    const limit = this.getCurrentLimit();

    if (!this.requests.has(ip)) {
      this.requests.set(ip, { count: 0, windowStart: now });
    }

    const data = this.requests.get(ip)!;

    // Reset window if it's been more than windowMs
    if (now - data.windowStart >= this.windowMs) {
      data.count = 0;
      data.windowStart = now;
    }

    if (data.count >= limit) {
      return false;
    }

    data.count++;
    return true;
  }

  getStats() {
    return {
      currentLimit: this.getCurrentLimit(),
      period: this.periodMs / 1000,
      baseRate: this.baseRate,
      amplitude: this.amplitude,
    };
  }
}

class TerminalGraph {
  private serverRateHistory: number[] = [];
  private bucketRateHistory: number[] = [];
  private successRateHistory: number[] = [];
  private readonly maxHistory = 200;

  constructor(private readonly width: number = 80, private readonly height: number = 20) {}

  addData(serverRate: number, bucketRate: number, successRate: number): void {
    this.serverRateHistory.push(serverRate);
    this.bucketRateHistory.push(bucketRate);
    this.successRateHistory.push(successRate);

    // Keep only recent history
    if (this.serverRateHistory.length > this.maxHistory) {
      this.serverRateHistory.shift();
      this.bucketRateHistory.shift();
      this.successRateHistory.shift();
    }
  }

  render(): string {
    if (this.serverRateHistory.length === 0) return "";

    const maxRate = Math.max(...this.serverRateHistory, ...this.bucketRateHistory, 50);
    const minRate = 0;
    const range = maxRate - minRate;

    let output = `\n${COLORS.cyan}━━━ AIMD Bucket Integration Test ━━━${COLORS.reset}\n\n`;

    // Graph
    const graphWidth = Math.min(this.width - 10, this.serverRateHistory.length);
    const startIndex = Math.max(0, this.serverRateHistory.length - graphWidth);

    for (let row = this.height - 1; row >= 0; row--) {
      const value = minRate + (range * row) / (this.height - 1);
      output += `${value.toFixed(0).padStart(3)} `;

      for (let col = 0; col < graphWidth; col++) {
        const index = startIndex + col;
        if (index >= this.serverRateHistory.length) break;

        const serverRate = this.serverRateHistory[index];
        const bucketRate = this.bucketRateHistory[index];
        const successRate = this.successRateHistory[index];

        let char = " ";
        let color = COLORS.reset;

        // Determine what to show at this position
        const serverY = Math.round(((serverRate - minRate) / range) * (this.height - 1));
        const bucketY = Math.round(((bucketRate - minRate) / range) * (this.height - 1));

        if (row === serverY && row === bucketY) {
          char = "◆";
          color = COLORS.magenta;
        } else if (row === serverY) {
          char = "═";
          color = COLORS.yellow;
        } else if (row === bucketY) {
          char = successRate > 0.8 ? "─" : successRate > 0.5 ? "┄" : "┈";
          color = successRate > 0.8 ? COLORS.green : successRate > 0.5 ? COLORS.yellow : COLORS.red;
        }

        output += `${color}${char}${COLORS.reset}`;
      }
      output += "\n";
    }

    // X-axis
    output += "    ";
    for (let i = 0; i < graphWidth; i += 10) {
      output += `${i.toString().padEnd(10)}`;
    }
    output += "\n";

    // Legend
    output += `\n${COLORS.yellow}═══${COLORS.reset} Server Rate Limit (Sinusoidal)\n`;
    output += `${COLORS.green}───${COLORS.reset} Bucket Rate (High Success) `;
    output += `${COLORS.yellow}┄┄┄${COLORS.reset} Bucket Rate (Med Success) `;
    output += `${COLORS.red}┈┈┈${COLORS.reset} Bucket Rate (Low Success)\n`;
    output += `${COLORS.magenta}◆◆◆${COLORS.reset} Both rates aligned\n`;

    return output;
  }

  renderStats(stats: ReturnType<SinusoidalRateLimiter["getStats"]>, bucketStats: any): string {
    const latest = this.serverRateHistory[this.serverRateHistory.length - 1] || 0;
    const bucketRate = this.bucketRateHistory[this.bucketRateHistory.length - 1] || 0;
    const successRate = this.successRateHistory[this.successRateHistory.length - 1] || 0;

    let output = `\n${COLORS.cyan}Current Status:${COLORS.reset}\n`;
    output += `Server Rate Limit: ${COLORS.yellow}${latest.toFixed(1)} req/s${COLORS.reset}\n`;
    output += `Bucket Rate: ${COLORS.green}${bucketRate.toFixed(1)} req/s${COLORS.reset}\n`;
    output += `Success Rate: ${this.getSuccessRateColor(successRate)}${(successRate * 100).toFixed(1)}%${COLORS.reset}\n`;
    output += `Tokens Issued: ${bucketStats.tokensIssued}\n`;
    output += `Success: ${COLORS.green}${bucketStats.successCount}${COLORS.reset} `;
    output += `Failed: ${COLORS.red}${bucketStats.failureCount}${COLORS.reset} `;
    output += `Rate Limited: ${COLORS.yellow}${bucketStats.rateLimitedCount}${COLORS.reset} `;
    output += `Timeouts: ${COLORS.gray}${bucketStats.timeoutCount}${COLORS.reset}\n`;

    return output;
  }

  private getSuccessRateColor(rate: number): string {
    if (rate > 0.8) return COLORS.green;
    if (rate > 0.5) return COLORS.yellow;
    return COLORS.red;
  }
}

interface RequestResponse {
  statusCode: number;
  data?: string;
  error?: string;
}

class IntegrationTestRunner {
  private rateLimiter = new SinusoidalRateLimiter(20, 15, 60000); // 60 second period
  private bucket = new AIMDBucket({
    initialRate: 10,
    maxRate: 50,
    minRate: 1,
    increaseDelta: 1,
    decreaseMultiplier: 0.7,
    failureThreshold: 0.3,
    tokenReturnTimeoutMs: 5000,
    windowMs: 10000,
  });
  private graph = new TerminalGraph(80, 15);
  private server?: http.Server;
  private readonly port = 3000;
  private running = false;
  private requestCount = 0;

  private createServer(): void {
    this.server = http.createServer((req, res) => {
      const ip = req.socket.remoteAddress || "unknown";

      if (!this.rateLimiter.isAllowed(ip)) {
        res.writeHead(429, { "Content-Type": "text/plain" });
        res.end("Too Many Requests");
        return;
      }

      // Simulate some processing time
      setTimeout(() => {
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(
          JSON.stringify({
            success: true,
            requestNumber: ++this.requestCount,
            serverRate: this.rateLimiter.getCurrentLimit(),
            timestamp: Date.now(),
          })
        );
      }, Math.random() * 50 + 10); // 10-60ms processing time
    });
  }

  private async startServer(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.server!.listen(this.port, (err?: Error) => {
        if (err) reject(err);
        else resolve();
      });
    });
  }

  private async makeRequest(): Promise<RequestResponse> {
    return new Promise((resolve) => {
      const startTime = Date.now();

      const req = http.request(
        {
          hostname: "localhost",
          port: this.port,
          path: "/",
          method: "GET",
        },
        (res) => {
          let data = "";
          res.on("data", (chunk) => (data += chunk));
          res.on("end", () => {
            const duration = Date.now() - startTime;
            if (duration > 1000) {
              // Log slow requests
              console.error(`DEBUG: Slow HTTP request: ${duration}ms, status: ${res.statusCode}`);
            }
            resolve({
              statusCode: res.statusCode!,
              data: data,
            });
          });
        }
      );

      req.on("error", (err) => {
        console.error(`DEBUG: HTTP error: ${err.message}`);
        resolve({
          statusCode: 0,
          error: err.message,
        });
      });

      req.setTimeout(3000, () => {
        console.error(`DEBUG: HTTP timeout after 3s`);
        req.destroy();
        resolve({
          statusCode: 0,
          error: "Request timeout",
        });
      });

      req.end();
    });
  }

  private async runRequestLoop(): Promise<void> {
    let requestsCompleted = 0;
    let lastDebugTime = Date.now();

    while (this.running) {
      try {
        const token = await this.bucket.acquire();

        const response = await this.makeRequest();
        requestsCompleted++;

        if (response.statusCode === 200) {
          token.success();
        } else if (response.statusCode === 429) {
          token.rateLimited();
        } else if (response.statusCode === 0) {
          token.timeout();
        } else {
          token.failure();
        }

        // Debug logging every 5 seconds
        const now = Date.now();
        if (now - lastDebugTime > 5000) {
          console.error(`DEBUG: Completed ${requestsCompleted} requests, last response: ${response.statusCode}`);
          lastDebugTime = now;
        }
      } catch (error: any) {
        console.error(`Request loop error:`, error);
        // Handle bucket acquisition errors
        if (error.message?.includes("shut down")) {
          break;
        }
      }

      // More realistic pacing - don't overwhelm the server's time windows
      const minDelay = Math.max(50, 1000 / this.bucket.getCurrentRate());
      await new Promise((resolve) => setTimeout(resolve, minDelay));
    }
  }

  private async updateDisplay(): Promise<void> {
    while (this.running) {
      const stats = this.rateLimiter.getStats();
      const bucketStats = this.bucket.getStatistics();

      this.graph.addData(stats.currentLimit, this.bucket.getCurrentRate(), bucketStats.successRate);

      // Clear screen and show graph
      process.stdout.write("\x1b[2J\x1b[H");
      console.log(this.graph.render());
      console.log(this.graph.renderStats(stats, bucketStats));

      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }

  async run(): Promise<void> {
    console.log(`${COLORS.cyan}🚀 Starting AIMD Bucket Integration Test...${COLORS.reset}`);

    this.createServer();
    await this.startServer();

    console.log(`${COLORS.green}✅ Server started on port ${this.port}${COLORS.reset}`);
    console.log(`${COLORS.yellow}📊 Starting rate limit adaptation test...${COLORS.reset}`);
    console.log(`${COLORS.gray}Press Ctrl+C to stop${COLORS.reset}\n`);

    this.running = true;

    // Start concurrent loops
    const requestLoop = this.runRequestLoop();
    const displayLoop = this.updateDisplay();

    // Handle graceful shutdown
    process.on("SIGINT", async () => {
      console.log(`\n${COLORS.yellow}🛑 Shutting down...${COLORS.reset}`);
      this.running = false;

      await this.bucket.shutdown();
      this.server?.close();

      console.log(`${COLORS.green}✅ Shutdown complete${COLORS.reset}`);
      process.exit(0);
    });

    await Promise.all([requestLoop, displayLoop]);
  }
}

// Run the integration test
if (require.main === module) {
  const runner = new IntegrationTestRunner();
  runner.run().catch(console.error);
}

export { IntegrationTestRunner, SinusoidalRateLimiter };
