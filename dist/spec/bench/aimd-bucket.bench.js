"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
const benchmark_1 = require("../benchmark");
exports.default = (0, benchmark_1.benchmarker)(async (suite) => {
    suite.add("test", function () {
        console.log("test");
    });
    return suite;
});
