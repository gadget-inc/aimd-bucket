import { writeFile } from "fs-extra";
import type { HeapProfiler, Profiler } from "node:inspector";
import { PerformanceObserver } from "perf_hooks";
import { Bench, type Options } from "tinybench";
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { Session } from "inspector";
import { compact } from "lodash";

export const newInspectorSession = () => {
  const session = new Session();
  const post = (method: string, params?: Record<string, unknown>): any =>
    new Promise((resolve, reject) => {
      session.post(method, params, (err: Error | null, result: any) => {
        if (err) {
          reject(err);
        } else {
          resolve(result);
        }
      });
    });

  session.connect();
  return { session, post };
};

export type BenchmarkGenerator = ((suite: Bench) => Bench | Promise<Bench>) & { options?: Options };

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
export const benchmarker = (fn: BenchmarkGenerator, options?: Options) => {
  fn.options = options;

  const err = new NiceStackError();
  const callerFile = (err.stack as unknown as NodeJS.CallSite[])[2].getFileName();

  if (require.main?.filename === callerFile) {
    void runBenchmark(fn);
  } else {
    return { fn };
  }
};

/** Wrap a plain old async function in the weird deferred management code benchmark.js requires */
export const asyncBench = (fn: () => Promise<void>) => {
  return {
    defer: true,
    fn: async (deferred: any) => {
      await fn();
      deferred.resolve();
    },
  };
};

/** Boot up a benchmark suite for registering new cases on */
export const createSuite = (options: Options = { iterations: 100 }) => {
  const suite = new Bench(options);

  suite.addEventListener("error", (event: any) => {
    console.error("benchmark error", { ...event, error: event.error ?? event.task?.result?.error });
  });

  return suite;
};

/** Run one benchmark function in isolation */
const runBenchmark = async (fn: BenchmarkGenerator) => {
  const args = await yargs(hideBin(process.argv))
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

  let suite = createSuite(fn.options);

  if (args.profile) {
    await registerBenchProfiler(suite);
  }

  if (args["heap-profile"]) {
    await registerBenchHeapProfiler(suite);
  }

  if (args["gc-stats"]) {
    registerGcStats(suite);
  }

  suite = await fn(suite);

  console.log("running benchmark");

  await suite.warmup();
  await suite.run();

  console.table(benchTable(suite));
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
    } finally {
      Error.prepareStackTrace = oldStackTrace;
    }
  }
}

export const benchTable = (bench: Bench) => {
  return compact(
    bench.tasks.map(({ name: t, result: e }) => {
      if (!e) return null;
      return {
        "Task Name": t,
        "ops/sec": e.error ? "NaN" : parseInt(e.hz.toString(), 10).toLocaleString(),
        "Average Time (ms)": e.error ? "NaN" : e.mean,
        "p99 Time (ms)": e.error ? "NaN" : e.p99,
        Margin: e.error ? "NaN" : `\xB1${e.rme.toFixed(2)}%`,
        Samples: e.error ? "NaN" : e.samples.length,
      };
    })
  );
};

const formatDateForFile = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}_${String(
    now.getHours()
  ).padStart(2, "0")}-${String(now.getMinutes()).padStart(2, "0")}-${String(now.getSeconds()).padStart(2, "0")}`;
};

export const registerBenchProfiler = async (suite: Bench) => {
  const key = formatDateForFile();

  const { post } = newInspectorSession();
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
        const { profile } = (await post("Profiler.stop")) as Profiler.StopReturnType;
        await writeFile(`./bench-${event.task.name}-${key}.cpuprofile`, JSON.stringify(profile));
      },
    };
  });
};

export const registerBenchHeapProfiler = async (suite: Bench) => {
  const key = formatDateForFile();

  const { post } = newInspectorSession();
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
        const { profile } = (await post("HeapProfiler.stopSampling")) as HeapProfiler.StopSamplingReturnType;
        await writeFile(`./bench-${event.task.name}-${key}.heapprofile`, JSON.stringify(profile));
      },
    };
  });
};

export const registerGcStats = (suite: Bench) => {
  let totalGcCount = 0;
  let totalGcPause = 0;

  // Create a performance observer
  const obs = new PerformanceObserver((list) => {
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
