"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.registerGcStats = exports.registerBenchHeapProfiler = exports.registerBenchProfiler = exports.benchTable = exports.createSuite = exports.asyncBench = exports.benchmarker = exports.newInspectorSession = void 0;
const fs_extra_1 = require("fs-extra");
const perf_hooks_1 = require("perf_hooks");
const tinybench_1 = require("tinybench");
const yargs_1 = __importDefault(require("yargs"));
const helpers_1 = require("yargs/helpers");
const inspector_1 = require("inspector");
const lodash_1 = require("lodash");
const newInspectorSession = () => {
    const session = new inspector_1.Session();
    const post = (method, params) => new Promise((resolve, reject) => {
        session.post(method, params, (err, result) => {
            if (err) {
                reject(err);
            }
            else {
                resolve(result);
            }
        });
    });
    session.connect();
    return { session, post };
};
exports.newInspectorSession = newInspectorSession;
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
const benchmarker = (fn, options) => {
    fn.options = options;
    const err = new NiceStackError();
    const callerFile = err.stack[2].getFileName();
    if (require.main?.filename === callerFile) {
        void runBenchmark(fn);
    }
    else {
        return { fn };
    }
};
exports.benchmarker = benchmarker;
/** Wrap a plain old async function in the weird deferred management code benchmark.js requires */
const asyncBench = (fn) => {
    return {
        defer: true,
        fn: async (deferred) => {
            await fn();
            deferred.resolve();
        },
    };
};
exports.asyncBench = asyncBench;
/** Boot up a benchmark suite for registering new cases on */
const createSuite = (options = { iterations: 100 }) => {
    const suite = new tinybench_1.Bench(options);
    suite.addEventListener("error", (event) => {
        console.error("benchmark error", { ...event, error: event.error ?? event.task?.result?.error });
    });
    return suite;
};
exports.createSuite = createSuite;
/** Run one benchmark function in isolation */
const runBenchmark = async (fn) => {
    const args = await (0, yargs_1.default)((0, helpers_1.hideBin)(process.argv))
        .option("profile", {
        alias: "p",
        default: false,
        describe: "profile each benchmarked case as it runs, writing a CPU profile to disk for each",
        type: "boolean",
    })
        .option("heap-profile", {
        alias: "h",
        default: false,
        describe: "heap profile each benchmarked case as it runs, writing a .heapprofile file to disk for each",
        type: "boolean",
    }).argv;
    let suite = (0, exports.createSuite)(fn.options);
    if (args.profile) {
        await (0, exports.registerBenchProfiler)(suite);
    }
    if (args["heap-profile"]) {
        await (0, exports.registerBenchHeapProfiler)(suite);
    }
    if (args["gc-stats"]) {
        (0, exports.registerGcStats)(suite);
    }
    suite = await fn(suite);
    console.log("running benchmark");
    await suite.warmup();
    await suite.run();
    console.table((0, exports.benchTable)(suite));
};
class NiceStackError extends Error {
    constructor() {
        super();
        const oldStackTrace = Error.prepareStackTrace;
        try {
            Error.prepareStackTrace = (err, structuredStackTrace) => structuredStackTrace;
            Error.captureStackTrace(this);
            // eslint-disable-next-line @typescript-eslint/no-unused-expressions
            this.stack; // Invoke the getter for `stack`.
        }
        finally {
            Error.prepareStackTrace = oldStackTrace;
        }
    }
}
const benchTable = (bench) => {
    return (0, lodash_1.compact)(bench.tasks.map(({ name: t, result: e }) => {
        if (!e)
            return null;
        return {
            "Task Name": t,
            "ops/sec": e.error ? "NaN" : parseInt(e.hz.toString(), 10).toLocaleString(),
            "Average Time (ms)": e.error ? "NaN" : e.mean,
            "p99 Time (ms)": e.error ? "NaN" : e.p99,
            Margin: e.error ? "NaN" : `\xB1${e.rme.toFixed(2)}%`,
            Samples: e.error ? "NaN" : e.samples.length,
        };
    }));
};
exports.benchTable = benchTable;
const formatDateForFile = () => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(now.getHours()).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;
};
const registerBenchProfiler = async (suite) => {
    const key = formatDateForFile();
    const { post } = (0, exports.newInspectorSession)();
    await post("Profiler.enable");
    await post("Profiler.setSamplingInterval", { interval: 20 });
    console.log("profiling enabled", { filenameKey: key });
    suite.addEventListener("add", (event) => {
        const oldBeforeAll = event.task.opts.beforeAll;
        const oldAfterAll = event.task.opts.afterAll;
        event.task.opts = {
            ...event.task.opts,
            beforeAll: async function () {
                await post("Profiler.start");
                await oldBeforeAll?.call(this);
            },
            afterAll: async function () {
                await oldAfterAll?.call(this);
                const { profile } = (await post("Profiler.stop"));
                await (0, fs_extra_1.writeFile)(`./bench-${event.task.name}-${key}.cpuprofile`, JSON.stringify(profile));
            },
        };
    });
};
exports.registerBenchProfiler = registerBenchProfiler;
const registerBenchHeapProfiler = async (suite) => {
    const key = formatDateForFile();
    const { post } = (0, exports.newInspectorSession)();
    await post("HeapProfiler.enable");
    console.log("heap profiling enabled", { filenameKey: key });
    suite.addEventListener("add", (event) => {
        const oldBeforeAll = event.task.opts.beforeAll;
        const oldAfterAll = event.task.opts.afterAll;
        event.task.opts = {
            ...event.task.opts,
            beforeAll: async function () {
                await post("HeapProfiler.startSampling", { samplingInterval: 4096 });
                await oldBeforeAll?.call(this);
            },
            afterAll: async function () {
                await oldAfterAll?.call(this);
                const { profile } = (await post("HeapProfiler.stopSampling"));
                await (0, fs_extra_1.writeFile)(`./bench-${event.task.name}-${key}.heapprofile`, JSON.stringify(profile));
            },
        };
    });
};
exports.registerBenchHeapProfiler = registerBenchHeapProfiler;
const registerGcStats = (suite) => {
    let totalGcCount = 0;
    let totalGcPause = 0;
    // Create a performance observer
    const obs = new perf_hooks_1.PerformanceObserver((list) => {
        const entry = list.getEntries()[0];
        totalGcCount += 1;
        totalGcPause += entry.duration;
    });
    console.log("gcstats enabled");
    suite.addEventListener("add", (event) => {
        const oldBeforeEach = event.task.opts.beforeEach;
        const oldAfterEach = event.task.opts.afterEach;
        const oldAfterAll = event.task.opts.afterAll;
        event.task.opts = {
            ...event.task.opts,
            beforeEach: async function () {
                obs.observe({ entryTypes: ["gc"] });
                await oldBeforeEach?.call(this);
            },
            afterEach: async function () {
                obs.disconnect();
                await oldAfterEach?.call(this);
            },
            afterAll: async function () {
                console.log({ totalGcCount, totalGcPauseMs: totalGcPause / 1e6 }, "gcstats");
                await oldAfterAll?.call(this);
            },
        };
    });
};
exports.registerGcStats = registerGcStats;
