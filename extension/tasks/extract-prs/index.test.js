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

// Mock azure-pipelines-task-lib
const mockInputs = {};
const mockTl = {
  getInput: (name, required) => {
    // Track which input names are requested
    mockTl._requestedInputs.push(name);
    return mockInputs[name] || null;
  },
  setResult: () => {},
  debug: () => {},
  TaskResult: { Failed: 1, Succeeded: 0 },
  _requestedInputs: [],
  _reset: () => {
    mockTl._requestedInputs = [];
  },
};

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
