import { Bench, type Options } from "tinybench";
import { Session } from "inspector";
export declare const newInspectorSession: () => {
    session: Session;
    post: (method: string, params?: Record<string, unknown>) => any;
};
export type BenchmarkGenerator = ((suite: Bench) => Bench | Promise<Bench>) & {
    options?: Options;
};
/**
 * Set up a new benchmark in our library of benchmarks
 * If this file is executed directly, it will run the benchmark
 * Otherwise, it will export the benchmark for use in other files
 *
 * @example
 * export default benchmarker((suite) => {
 *   return suite.add("My Benchmark", async () => {
 *     // ...
 *   });
 * });
 **/
export declare const benchmarker: (fn: BenchmarkGenerator, options?: Options) => {
    fn: BenchmarkGenerator;
} | undefined;
/** Wrap a plain old async function in the weird deferred management code benchmark.js requires */
export declare const asyncBench: (fn: () => Promise<void>) => {
    defer: boolean;
    fn: (deferred: any) => Promise<void>;
};
/** Boot up a benchmark suite for registering new cases on */
export declare const createSuite: (options?: Options) => Bench;
export declare const benchTable: (bench: Bench) => {
    "Task Name": string;
    "ops/sec": string;
    "Average Time (ms)": string | number;
    "p99 Time (ms)": string | number;
    Margin: string;
    Samples: string | number;
}[];
export declare const registerBenchProfiler: (suite: Bench) => Promise<void>;
export declare const registerBenchHeapProfiler: (suite: Bench) => Promise<void>;
export declare const registerGcStats: (suite: Bench) => void;
