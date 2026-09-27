#!/usr/bin/env node
const fs = require("node:fs/promises");
const path = require("node:path");
const { evaluateBatch } = require("../services/batch-evaluator.service");
const { validateBatchInput } = require("../services/batch-evaluator.service");

function parseArgs(args) {
  const values = {};
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag !== "--input" && flag !== "--output") throw new Error(`Unknown argument: ${flag}`);
    if (values[flag] !== undefined) throw new Error(`Duplicate argument: ${flag}`);
    const value = args[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a path`);
    values[flag] = value;
    index += 1;
  }
  if (!values["--input"] || !values["--output"]) throw new Error("Usage: npm run evaluate -- --input <path> --output <path>");
  return { inputPath: values["--input"], outputPath: values["--output"] };
}

async function runCli(args = process.argv.slice(2), dependencies = {}) {
  const readFile = dependencies.readFile || fs.readFile;
  const writeFile = dependencies.writeFile || fs.writeFile;
  const runEvaluation = dependencies.evaluateBatch || evaluateBatch;
  const cwd = dependencies.cwd || process.cwd();
  const { inputPath, outputPath } = parseArgs(args);
  const source = await readFile(path.resolve(cwd, inputPath), "utf8");
  let input;
  try {
    input = JSON.parse(source);
  } catch {
    throw new Error("Input file must contain valid JSON");
  }
  validateBatchInput(input);
  const result = await runEvaluation(input);
  await writeFile(path.resolve(cwd, outputPath), `${JSON.stringify(result, null, 2)}\n`, "utf8");
  return result;
}

if (require.main === module) {
  runCli().catch((error) => {
    process.stderr.write(`Evaluation failed: ${error.message}\n`);
    process.exitCode = 1;
  });
}

module.exports = { parseArgs, runCli };
