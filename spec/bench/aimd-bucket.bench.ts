import { benchmarker } from "../benchmark";

export default benchmarker(async (suite) => {
  suite.add("test", function () {
    console.log("test");
  });

  return suite;
});
