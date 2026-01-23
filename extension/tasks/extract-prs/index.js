/**
 * Node.js wrapper for ado-git-repo-insights Python CLI.
 *
 * Adjustment 6: Locked Node → Python Execution Contract
 * - Python 3.10+ required
 * - Explicit entrypoint: python -m ado_git_repo_insights.cli
 * - Fail-fast diagnostics if runtime environment invalid
 *
 * Invariant 17: Must run on hosted and self-hosted agents
 * Invariant 18: Clear failures with actionable logs
 * Invariant 19: PAT is never logged
 */

const tl = require("azure-pipelines-task-lib/task");
const { execSync, spawn } = require("child_process");
const path = require("path");

// Adjustment 6: Locked execution contract
const PYTHON_MIN_VERSION = "3.10";
const PACKAGE_NAME = "ado-git-repo-insights";
const CLI_MODULE = "ado_git_repo_insights.cli";

/**
 * Validate Python environment meets requirements.
 * Invariant 18: Fail-fast with actionable error message.
 */
async function validatePythonEnvironment() {
  try {
    // Try common Python commands
    const pythonCommands = ["python", "python3", "py"];
    let pythonCmd = null;
    let versionInfo = null;

    for (const cmd of pythonCommands) {
      try {
        const output = execSync(`${cmd} --version 2>&1`, { encoding: "utf-8" });
        const match = output.match(/Python (\d+)\.(\d+)/);
        if (match) {
          const major = parseInt(match[1], 10);
          const minor = parseInt(match[2], 10);
          const version = major + minor / 100;
          const required = parseFloat(PYTHON_MIN_VERSION);

          if (version >= required) {
            pythonCmd = cmd;
            versionInfo = `${major}.${minor}`;
            break;
          }
        }
      } catch (e) {
        // This command not available, try next
        continue;
      }
    }

    if (!pythonCmd) {
      throw new Error(
        `Python ${PYTHON_MIN_VERSION}+ not found.\n` +
          `Tried commands: ${pythonCommands.join(", ")}\n` +
          `Please ensure Python is installed and available in PATH.`,
      );
    }

    tl.debug(`Using Python: ${pythonCmd} (version ${versionInfo})`);
    return pythonCmd;
  } catch (err) {
    tl.setResult(
      tl.TaskResult.Failed,
      `Python environment validation failed:\n${err.message}\n\n` +
        `Resolution:\n` +
        `1. On hosted agents: Use 'UsePythonVersion@0' task before this task\n` +
        `2. On self-hosted agents: Install Python ${PYTHON_MIN_VERSION}+ and add to PATH`,
    );
    return null;
  }
}

/**
 * Install the Python package if not already installed.
 * @param {string} pythonCmd - Python executable command
 * @param {boolean} withML - Install ML extras (prophet, openai)
 */
function installPackage(pythonCmd, withML = false) {
  try {
    const packageSpec = withML ? `${PACKAGE_NAME}[ml]` : PACKAGE_NAME;
    tl.debug(`Checking if ${packageSpec} is installed...`);

    // Check if package is already installed
    try {
      execSync(`${pythonCmd} -c "import ado_git_repo_insights"`, {
        encoding: "utf-8",
        stdio: "pipe",
      });

      // If ML is needed, verify ML dependencies are available
      if (withML) {
        try {
          execSync(`${pythonCmd} -c "import prophet; import openai"`, {
            encoding: "utf-8",
            stdio: "pipe",
          });
          tl.debug(`${packageSpec} already installed with ML extras`);
          return true;
        } catch (e) {
          // ML dependencies missing, need to install them
          tl.debug(`ML dependencies missing, installing ${packageSpec}...`);
          execSync(`${pythonCmd} -m pip install "${packageSpec}" --quiet`, {
            stdio: "inherit",
          });
          return true;
        }
      }

      tl.debug(`${PACKAGE_NAME} already installed`);
      return true;
    } catch (e) {
      // Package not installed, install it
      tl.debug(`Installing ${packageSpec}...`);
      execSync(`${pythonCmd} -m pip install "${packageSpec}" --quiet`, {
        stdio: "inherit",
      });
      return true;
    }
  } catch (err) {
    tl.setResult(
      tl.TaskResult.Failed,
      `Failed to install ${PACKAGE_NAME}:\n${err.message}\n\n` +
        `Resolution:\n` +
        `1. Check network connectivity\n` +
        `2. Ensure pip is available: ${pythonCmd} -m pip --version`,
    );
    return false;
  }
}

/**
 * Main task execution.
 */
async function run() {
  // Invariant 18: Fail-fast on invalid runtime environment
  const pythonCmd = await validatePythonEnvironment();
  if (!pythonCmd) return;

  // Phase 5: Check if ML features are requested (need ML extras)
  const enablePredictions = tl.getBoolInput("enablePredictions", false);
  const enableInsights = tl.getBoolInput("enableInsights", false);
  const needsML = enablePredictions || enableInsights;

  // Install package (with ML extras if needed)
  if (!installPackage(pythonCmd, needsML)) return;

  try {
    // Get task inputs
    const organization = tl.getInput("organization", true);
    const projects = tl.getInput("projects", true);
    const pat = tl.getInput("pat", true);
    const startDate = tl.getInput("startDate", false);
    const endDate = tl.getInput("endDate", false);
    const backfillDays = tl.getInput("backfillDays", false);
    // Phase 3: Aggregates generation
    const generateAggregates = tl.getBoolInput("generateAggregates", false);
    const aggregatesDirInput =
      tl.getInput("aggregatesDir", false) || "aggregates";
    // Phase 5: ML features (enablePredictions/enableInsights already read above for install)
    const openaiApiKey = tl.getInput("openaiApiKey", false);
    // CRITICAL: Input name must match task.json contract ('database', not 'databasePath')
    const databaseInput =
      tl.getInput("database", false) || "ado-insights.sqlite";
    const outputDirInput = tl.getInput("outputDir", false) || "csv_output";

    // Normalize paths to absolute for deterministic behavior across agents
    const databasePath = path.resolve(databaseInput);
    const outputDir = path.resolve(outputDirInput);
    const aggregatesDir = path.resolve(aggregatesDirInput);

    // Validate database directory is writable (fail fast on misconfiguration)
    const fs = require("fs");
    const dbDir = path.dirname(databasePath);
    try {
      if (!fs.existsSync(dbDir)) {
        fs.mkdirSync(dbDir, { recursive: true });
        tl.debug(`Created database directory: ${dbDir}`);
      }
      // Test writability
      const testFile = path.join(dbDir, ".write-test-" + Date.now());
      fs.writeFileSync(testFile, "test");
      fs.unlinkSync(testFile);
    } catch (err) {
      tl.setResult(
        tl.TaskResult.Failed,
        `Database directory is not writable: ${dbDir}\n` +
          `Error: ${err.message}\n\n` +
          `Resolution: Ensure the database path points to a writable location.`,
      );
      return;
    }

    // Validate output directory is writable
    try {
      if (!fs.existsSync(outputDir)) {
        fs.mkdirSync(outputDir, { recursive: true });
        tl.debug(`Created output directory: ${outputDir}`);
      }
      const testFile = path.join(outputDir, ".write-test-" + Date.now());
      fs.writeFileSync(testFile, "test");
      fs.unlinkSync(testFile);
    } catch (err) {
      tl.setResult(
        tl.TaskResult.Failed,
        `Output directory is not writable: ${outputDir}\n` +
          `Error: ${err.message}\n\n` +
          `Resolution: Ensure the output path points to a writable location.`,
      );
      return;
    }

    // Log configuration (Invariant 19: Never log PAT)
    console.log("=".repeat(50));
    console.log("ADO Git Repo Insights - Configuration");
    console.log("=".repeat(50));
    console.log(`Organization: ${organization}`);
    console.log(
      `Projects: ${projects
        .split(/[\n,]/)
        .map((p) => p.trim())
        .filter(Boolean)
        .join(", ")}`,
    );
    console.log(`Database (input): ${databaseInput}`);
    console.log(`Database (resolved): ${databasePath}`);
    console.log(`Output (input): ${outputDirInput}`);
    console.log(`Output (resolved): ${outputDir}`);
    console.log(`PAT: ********`); // Invariant 19: Redacted
    if (startDate) console.log(`Start Date: ${startDate}`);
    if (endDate) console.log(`End Date: ${endDate}`);
    if (backfillDays) console.log(`Backfill Days: ${backfillDays}`);
    if (generateAggregates) {
      console.log(`Generate Aggregates: true`);
      console.log(`Aggregates Dir: ${aggregatesDir}`);
      if (enablePredictions) console.log(`ML Predictions: enabled`);
      if (enableInsights) console.log(`AI Insights: enabled`);
      if (enableInsights && openaiApiKey)
        console.log(`OpenAI API Key: ********`);
    }
    console.log("=".repeat(50));

    // Phase 5: Validate insights configuration
    if (enableInsights && !openaiApiKey) {
      tl.setResult(
        tl.TaskResult.Failed,
        `AI Insights enabled but OpenAI API Key not provided.\n\n` +
          `Resolution:\n` +
          `1. Create a variable group with OPENAI_API_KEY secret\n` +
          `2. Set openaiApiKey input to $(OPENAI_API_KEY)`,
      );
      return;
    }

    // Validate date formats if provided (fail fast on invalid input)
    const datePattern = /^\d{4}-\d{2}-\d{2}$/;
    if (startDate && !datePattern.test(startDate)) {
      tl.setResult(
        tl.TaskResult.Failed,
        `Invalid startDate format: "${startDate}"\n` +
          `Expected format: YYYY-MM-DD (e.g., 2026-01-01)`,
      );
      return;
    }
    if (endDate && !datePattern.test(endDate)) {
      tl.setResult(
        tl.TaskResult.Failed,
        `Invalid endDate format: "${endDate}"\n` +
          `Expected format: YYYY-MM-DD (e.g., 2026-01-13)`,
      );
      return;
    }
    if (startDate && endDate && startDate > endDate) {
      tl.setResult(
        tl.TaskResult.Failed,
        `Invalid date range: startDate (${startDate}) is after endDate (${endDate})`,
      );
      return;
    }

    // Build extraction command
    const extractArgs = [
      "-m",
      CLI_MODULE,
      "extract",
      "--organization",
      organization,
      "--projects",
      projects.replace(/\n/g, ","),
      "--pat",
      pat,
      "--database",
      databasePath,
    ];

    if (startDate) extractArgs.push("--start-date", startDate);
    if (endDate) extractArgs.push("--end-date", endDate);
    if (backfillDays) extractArgs.push("--backfill-days", backfillDays);

    // Run extraction
    const totalSteps = generateAggregates ? 3 : 2;
    console.log(`\n[1/${totalSteps}] Running extraction...`);
    const extractResult = await runPython(pythonCmd, extractArgs);
    if (!extractResult) return;

    // Build CSV generation command
    const csvArgs = [
      "-m",
      CLI_MODULE,
      "generate-csv",
      "--database",
      databasePath,
      "--output",
      outputDir,
    ];

    // Run CSV generation
    console.log(`\n[2/${totalSteps}] Generating CSVs...`);
    const csvResult = await runPython(pythonCmd, csvArgs);
    if (!csvResult) return;

    // Phase 3: Generate aggregates if enabled
    if (generateAggregates) {
      // Validate aggregates directory
      try {
        if (!fs.existsSync(aggregatesDir)) {
          fs.mkdirSync(aggregatesDir, { recursive: true });
          tl.debug(`Created aggregates directory: ${aggregatesDir}`);
        }
      } catch (err) {
        tl.setResult(
          tl.TaskResult.Failed,
          `Aggregates directory is not writable: ${aggregatesDir}\n` +
            `Error: ${err.message}`,
        );
        return;
      }

      const aggArgs = [
        "-m",
        CLI_MODULE,
        "generate-aggregates",
        "--database",
        databasePath,
        "--output",
        aggregatesDir,
      ];

      // Phase 5: Add ML flags
      if (enablePredictions) {
        aggArgs.push("--enable-predictions");
      }
      if (enableInsights) {
        aggArgs.push("--enable-insights");
      }

      console.log(`\n[3/${totalSteps}] Generating aggregates...`);

      // Phase 5: Set OPENAI_API_KEY environment variable for insights
      const aggEnv =
        enableInsights && openaiApiKey ? { OPENAI_API_KEY: openaiApiKey } : {};

      const aggResult = await runPython(pythonCmd, aggArgs, aggEnv);
      if (!aggResult) return;
    }

    // Success
    console.log("\n" + "=".repeat(50));
    console.log("Extraction and generation completed successfully!");
    console.log(`Database: ${databasePath}`);
    console.log(`CSVs: ${outputDir}/`);
    if (generateAggregates) {
      console.log(`Aggregates: ${aggregatesDir}/`);
    }
    console.log("=".repeat(50));

    tl.setResult(tl.TaskResult.Succeeded, "Extraction completed successfully");
  } catch (err) {
    tl.setResult(tl.TaskResult.Failed, `Task failed: ${err.message}`);
  }
}

/**
 * Run Python command and return success status.
 * @param {string} pythonCmd - Python executable command
 * @param {string[]} args - Command arguments
 * @param {Object} extraEnv - Additional environment variables to pass
 */
function runPython(pythonCmd, args, extraEnv = {}) {
  return new Promise((resolve) => {
    const proc = spawn(pythonCmd, args, {
      stdio: "inherit",
      shell: false, // SECURITY: Never use shell to prevent command injection
      env: { ...process.env, ...extraEnv },
    });

    proc.on("close", (code) => {
      if (code !== 0) {
        tl.setResult(
          tl.TaskResult.Failed,
          `Python process exited with code ${code}`,
        );
        resolve(false);
      } else {
        resolve(true);
      }
    });

    proc.on("error", (err) => {
      tl.setResult(
        tl.TaskResult.Failed,
        `Failed to spawn Python process: ${err.message}`,
      );
      resolve(false);
    });
  });
}

// Execute
run();
