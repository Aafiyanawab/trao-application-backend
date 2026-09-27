const assert = require("node:assert/strict");
const test = require("node:test");
const { parseArgs, runCli } = require("../src/cli/evaluate");

test("parses the required input and output paths", () => {
  assert.deepEqual(parseArgs(["--input", "in.json", "--output", "out.json"]), { inputPath: "in.json", outputPath: "out.json" });
});

test("rejects unknown, duplicate, and missing CLI arguments", () => {
  assert.throws(() => parseArgs(["--other", "x"]), /Unknown argument/);
  assert.throws(() => parseArgs(["--input", "a", "--input", "b", "--output", "c"]), /Duplicate/);
  assert.throws(() => parseArgs([]), /Usage/);
});

test("validates input before evaluation and writes only a complete result", async () => {
  const writes = [];
  let evaluations = 0;
  const dependencies = {
    cwd: "C:/tmp",
    readFile: async () => JSON.stringify([{ id: "a", jd: "Job Title: Engineer", company_url: "https://example.test", days: 1 }]),
    evaluateBatch: async () => { evaluations += 1; return { version: "1.0", generated_at: "date", kits: [] }; },
    writeFile: async (...args) => writes.push(args),
  };
  const result = await runCli(["--input", "cases.json", "--output", "result.json"], dependencies);
  assert.equal(evaluations, 1);
  assert.equal(writes.length, 1);
  assert.match(writes[0][1], /"version": "1.0"/);
  assert.equal(result.version, "1.0");
});

test("does not write output for malformed or structurally invalid input", async () => {
  for (const content of ["{", JSON.stringify([{ id: "a", jd: "", company_url: "https://example.test", days: 1 }])]) {
    let writes = 0;
    await assert.rejects(runCli(["--input", "cases.json", "--output", "result.json"], {
      cwd: "C:/tmp",
      readFile: async () => content,
      writeFile: async () => { writes += 1; },
      evaluateBatch: async () => assert.fail("evaluation must not run"),
    }));
    assert.equal(writes, 0);
  }
});
