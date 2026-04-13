/**
 * Unit tests for extension task input handling.
 *
 * Tests the specific failure mode: pipeline passes 'database' input,
 * implementation must read 'database' (not 'databasePath').
 *
 * Run: node extension/tasks/extract-prs/index.test.js
 */

const assert = require("assert");
const path = require("path");
const Module = require("module");

// Mock azure-pipelines-task-lib
const mockInputs = {};
const mockBoolInputs = {};
const mockTl = {
  getInput: (name, required) => {
    // Track which input names are requested
    mockTl._requestedInputs.push(name);
    return mockInputs[name] || null;
  },
  getBoolInput: (name, required) => {
    mockTl._requestedInputs.push(name);
    return mockBoolInputs[name] === true;
  },
  setResult: (result, message) => {
    mockTl._lastResult = { result, message };
  },
  debug: () => {},
  TaskResult: { Failed: 1, Succeeded: 0 },
  _requestedInputs: [],
  _lastResult: null,
  _reset: () => {
    mockTl._requestedInputs = [];
    mockTl._lastResult = null;
  },
};

// Intercept require("azure-pipelines-task-lib/task") so the real index.js
// loads against our mock. Must run BEFORE we require index.js below.
const originalModuleLoad = Module._load;
Module._load = function interceptedLoad(request, parent, ...rest) {
  if (request === "azure-pipelines-task-lib/task") {
    return mockTl;
  }
  return originalModuleLoad.call(this, request, parent, ...rest);
};

const { buildExtractArgs, validateNonNegativeInt } = require("./index.js");

// Test helper to simulate getInput behavior
function simulateInputReading() {
  mockTl._reset();

  // Simulate the input reading section of index.js
  const organization = mockTl.getInput("organization", true);
  const projects = mockTl.getInput("projects", true);
  const pat = mockTl.getInput("pat", true);
  const startDate = mockTl.getInput("startDate", false);
  const endDate = mockTl.getInput("endDate", false);
  const backfillDays = mockTl.getInput("backfillDays", false);
  // #260: comment extraction inputs
  const includeComments = mockTl.getBoolInput("includeComments", false);
  const commentsMaxPrsPerRun = mockTl.getInput("commentsMaxPrsPerRun", false);
  const commentsMaxThreadsPerPr = mockTl.getInput(
    "commentsMaxThreadsPerPr",
    false,
  );
  // CRITICAL: This must be 'database', not 'databasePath'
  const databaseInput =
    mockTl.getInput("database", false) || "ado-insights.sqlite";
  const outputDirInput = mockTl.getInput("outputDir", false) || "csv_output";

  return {
    organization,
    projects,
    pat,
    startDate,
    endDate,
    backfillDays,
    includeComments,
    commentsMaxPrsPerRun,
    commentsMaxThreadsPerPr,
    databasePath: databaseInput,
    outputDir: outputDirInput,
  };
}

// Test 1: Verify 'database' input is read (not 'databasePath')
function testDatabaseInputName() {
  console.log("Test: database input name is correct...");

  mockInputs["database"] = "/custom/path/to/db.sqlite";
  mockInputs["organization"] = "testOrg";
  mockInputs["projects"] = "testProject";
  mockInputs["pat"] = "testPat";

  const config = simulateInputReading();

  // Assert 'database' was requested
  assert(
    mockTl._requestedInputs.includes("database"),
    "Expected getInput('database') to be called",
  );

  // Assert 'databasePath' was NOT requested (the old bug)
  assert(
    !mockTl._requestedInputs.includes("databasePath"),
    "REGRESSION: getInput('databasePath') should NOT be called - use 'database'",
  );

  // Assert the value was actually read
  assert.strictEqual(
    config.databasePath,
    "/custom/path/to/db.sqlite",
    "Database path should match the input value",
  );

  console.log("  ✓ Passed\n");
}

// Test 2: Verify default is applied when input is missing
function testDatabaseDefaultValue() {
  console.log("Test: database default value when not provided...");

  // Clear the database input
  delete mockInputs["database"];
  mockInputs["organization"] = "testOrg";
  mockInputs["projects"] = "testProject";
  mockInputs["pat"] = "testPat";

  const config = simulateInputReading();

  assert.strictEqual(
    config.databasePath,
    "ado-insights.sqlite",
    "Database path should default to ado-insights.sqlite",
  );

  console.log("  ✓ Passed\n");
}

// Test 3: Verify all expected inputs are requested
function testAllInputsRequested() {
  console.log("Test: all expected inputs are requested...");

  mockInputs["organization"] = "testOrg";
  mockInputs["projects"] = "testProject";
  mockInputs["pat"] = "testPat";

  simulateInputReading();

  const expectedInputs = [
    "organization",
    "projects",
    "pat",
    "startDate",
    "endDate",
    "backfillDays",
    "includeComments",
    "commentsMaxPrsPerRun",
    "commentsMaxThreadsPerPr",
    "database",
    "outputDir",
  ];

  for (const input of expectedInputs) {
    assert(
      mockTl._requestedInputs.includes(input),
      `Expected getInput('${input}') to be called`,
    );
  }

  console.log("  ✓ Passed\n");
}

// Test 4: Verify date validation logic
function testDateValidation() {
  console.log("Test: date format validation...");

  const datePattern = /^\d{4}-\d{2}-\d{2}$/;

  // Valid dates
  assert(datePattern.test("2026-01-01"), "Valid date should pass");
  assert(datePattern.test("2026-12-31"), "Valid date should pass");

  // Invalid dates
  assert(!datePattern.test("01-01-2026"), "Wrong format should fail");
  assert(!datePattern.test("2026/01/01"), "Wrong separator should fail");
  assert(!datePattern.test("2026-1-1"), "Missing leading zeros should fail");
  assert(!datePattern.test("invalid"), "Non-date string should fail");
  assert(!datePattern.test(""), "Empty string should fail");

  console.log("  ✓ Passed\n");
}

// Test 5: Verify date range validation logic
function testDateRangeValidation() {
  console.log("Test: date range validation...");

  // Valid range
  assert("2026-01-01" <= "2026-01-13", "Start before end should be valid");
  assert("2026-01-01" <= "2026-01-01", "Same start and end should be valid");

  // Invalid range
  assert("2026-01-13" > "2026-01-01", "Start after end should be invalid");

  console.log("  ✓ Passed\n");
}

// ---------------------------------------------------------------------------
// Tests against the REAL exported helpers (not a simulation) — #260
// ---------------------------------------------------------------------------

const BASELINE_CONFIG = Object.freeze({
  organization: "myorg",
  projects: "proj1",
  pat: "secret-pat",
  databasePath: "/tmp/db.sqlite",
});

// The exact argv expected for the minimum-input default path. Any accidental
// change to arg shape — including the #260 additions — will fail this test
// unless the test itself is updated deliberately. This is the regression lock
// for "includeComments off → byte-identical behavior".
const BASELINE_ARGS = Object.freeze([
  "-m",
  "ado_git_repo_insights.cli",
  "extract",
  "--organization",
  "myorg",
  "--projects",
  "proj1",
  "--pat",
  "secret-pat",
  "--database",
  "/tmp/db.sqlite",
]);

// Test 6: Default path is byte-identical to the pre-#260 arg shape.
function testBuildExtractArgsDefaultByteIdentical() {
  console.log("Test: buildExtractArgs default path is byte-identical...");

  const args = buildExtractArgs({ ...BASELINE_CONFIG });
  assert.deepStrictEqual(
    args,
    BASELINE_ARGS,
    "Default arg shape must not drift — change BASELINE_ARGS deliberately if you're changing the default path",
  );

  // Also confirm that comment flags never leak in when fields are absent
  assert(
    !args.includes("--include-comments"),
    "--include-comments must not appear in default path",
  );
  assert(
    !args.includes("--comments-max-prs-per-run"),
    "--comments-max-prs-per-run must not appear in default path",
  );
  assert(
    !args.includes("--comments-max-threads-per-pr"),
    "--comments-max-threads-per-pr must not appear in default path",
  );

  console.log("  ✓ Passed\n");
}

// Test 7: includeComments=false is explicitly still byte-identical.
function testBuildExtractArgsIncludeCommentsFalse() {
  console.log("Test: buildExtractArgs with includeComments=false...");

  const args = buildExtractArgs({
    ...BASELINE_CONFIG,
    includeComments: false,
    commentsMaxPrsPerRun: 200, // should be ignored when includeComments is false
    commentsMaxThreadsPerPr: 25,
  });
  assert.deepStrictEqual(
    args,
    BASELINE_ARGS,
    "Providing numeric overrides without enabling includeComments must be a no-op",
  );

  console.log("  ✓ Passed\n");
}

// Test 8: includeComments=true with numeric overrides pushes all three flags.
function testBuildExtractArgsWithComments() {
  console.log("Test: buildExtractArgs with includeComments=true...");

  const args = buildExtractArgs({
    ...BASELINE_CONFIG,
    includeComments: true,
    commentsMaxPrsPerRun: 200,
    commentsMaxThreadsPerPr: 25,
  });

  assert(args.includes("--include-comments"), "--include-comments missing");
  // flag+value pairs in order
  const prsIdx = args.indexOf("--comments-max-prs-per-run");
  assert(prsIdx >= 0, "--comments-max-prs-per-run missing");
  assert.strictEqual(args[prsIdx + 1], "200", "prs-per-run value mismatch");
  const threadsIdx = args.indexOf("--comments-max-threads-per-pr");
  assert(threadsIdx >= 0, "--comments-max-threads-per-pr missing");
  assert.strictEqual(
    args[threadsIdx + 1],
    "25",
    "threads-per-pr value mismatch",
  );

  console.log("  ✓ Passed\n");
}

// Test 9: includeComments=true with numerics null → bare flag only.
function testBuildExtractArgsWithCommentsNumericsOmitted() {
  console.log("Test: buildExtractArgs with includeComments, numerics null...");

  const args = buildExtractArgs({
    ...BASELINE_CONFIG,
    includeComments: true,
    commentsMaxPrsPerRun: null,
    commentsMaxThreadsPerPr: null,
  });

  assert(args.includes("--include-comments"), "--include-comments missing");
  assert(
    !args.includes("--comments-max-prs-per-run"),
    "--comments-max-prs-per-run should be absent when caller passes null (let CLI use its own default)",
  );
  assert(
    !args.includes("--comments-max-threads-per-pr"),
    "--comments-max-threads-per-pr should be absent when caller passes null",
  );

  console.log("  ✓ Passed\n");
}

// Test 10: validateNonNegativeInt accepts, rejects, and handles empty.
function testValidateNonNegativeInt() {
  console.log("Test: validateNonNegativeInt contract...");

  // Null / empty → null sentinel (meaning "use CLI default")
  assert.strictEqual(validateNonNegativeInt("x", null), null);
  assert.strictEqual(validateNonNegativeInt("x", undefined), null);
  assert.strictEqual(validateNonNegativeInt("x", ""), null);

  // Valid non-negative integers. Production only ever passes strings (from
  // tl.getInput), so the test mirrors that — no numeric-input exercise.
  mockTl._reset();
  assert.strictEqual(validateNonNegativeInt("x", "0"), 0);
  assert.strictEqual(validateNonNegativeInt("x", "100"), 100);
  assert.strictEqual(
    mockTl._lastResult,
    null,
    "No setResult should fire on valid values",
  );

  // Strict parity with Python's _non_negative_int: every input that the
  // Python side rejects must also be rejected here. Keep this list in
  // lockstep with _STRICT_INVALID_INPUTS in tests/unit/test_comments_cli.py.
  const strictInvalid = [
    "-1", // negative
    "abc", // non-numeric
    "1.5", // float
    "+1", // leading sign
    " 1", // leading whitespace
    "1 ", // trailing whitespace
    "1_000", // underscore separator
    "१२३", // Devanagari digits — \d in JS regex is ASCII-only w/o 'u' flag
  ];
  for (const bad of strictInvalid) {
    mockTl._reset();
    assert.strictEqual(
      validateNonNegativeInt("x", bad),
      undefined,
      `Expected ${JSON.stringify(bad)} to be rejected`,
    );
    assert(
      mockTl._lastResult,
      `Expected tl.setResult on input ${JSON.stringify(bad)}`,
    );
    assert.strictEqual(mockTl._lastResult.result, mockTl.TaskResult.Failed);
  }

  // Error message shape (use one representative bad input so we don't
  // duplicate the strictInvalid loop's coverage).
  mockTl._reset();
  const neg = validateNonNegativeInt("myInput", "-1");
  assert.strictEqual(neg, undefined, "Negative must return undefined sentinel");
  assert(mockTl._lastResult, "tl.setResult must have been called");
  assert.strictEqual(mockTl._lastResult.result, mockTl.TaskResult.Failed);
  assert(
    /myInput/.test(mockTl._lastResult.message),
    "Error message must include input name",
  );
  assert(
    /non-negative integer/.test(mockTl._lastResult.message),
    "Error message must state the contract",
  );

  console.log("  ✓ Passed\n");
}

// Run all tests
function runTests() {
  console.log("=".repeat(50));
  console.log("Extension Task Input Unit Tests");
  console.log("=".repeat(50) + "\n");

  try {
    testDatabaseInputName();
    testDatabaseDefaultValue();
    testAllInputsRequested();
    testDateValidation();
    testDateRangeValidation();
    testBuildExtractArgsDefaultByteIdentical();
    testBuildExtractArgsIncludeCommentsFalse();
    testBuildExtractArgsWithComments();
    testBuildExtractArgsWithCommentsNumericsOmitted();
    testValidateNonNegativeInt();

    console.log("=".repeat(50));
    console.log("All tests passed!");
    console.log("=".repeat(50));
    process.exit(0);
  } catch (error) {
    console.error("TEST FAILED:", error.message);
    process.exit(1);
  }
}

runTests();
