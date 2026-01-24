/**
 * Safe Process Execution Utilities
 *
 * Security invariants:
 * - shell: false ALWAYS
 * - Arguments passed as array, never interpolated
 * - Python executable must be from allowlist
 */

import { spawn, type SpawnOptions, type ChildProcess } from "child_process";
import * as path from "path";

/**
 * Allowlist of valid Python executable names.
 * Only these are permitted for spawning Python processes.
 */
const PYTHON_ALLOWLIST = ["python", "python3", "py"] as const;
type PythonExecutable = (typeof PYTHON_ALLOWLIST)[number];

/**
 * Validate that a Python command is from the allowlist.
 * Rejects commands with spaces (inline args), path traversal, or unknown executables.
 *
 * @param cmd - Python command to validate
 * @returns true if valid
 * @throws Error if invalid
 */
export function validatePythonExecutable(cmd: string): boolean {
  // Reject commands with spaces (attempts to inject args)
  if (cmd.includes(" ")) {
    throw new Error(
      `Invalid Python command: contains spaces. Use args array instead: "${cmd}"`,
    );
  }

  // Get basename and normalize
  const basename = path.basename(cmd).toLowerCase();
  const normalized = basename.replace(/\.exe$/, "");

  // Check allowlist
  if (!PYTHON_ALLOWLIST.includes(normalized as PythonExecutable)) {
    throw new Error(
      `Invalid Python executable: "${cmd}". ` +
        `Allowed: ${PYTHON_ALLOWLIST.join(", ")}`,
    );
  }

  return true;
}

/**
 * Options for safe process execution.
 */
export interface SafeSpawnOptions extends Omit<SpawnOptions, "shell"> {
  timeout?: number;
}

/**
 * Result of process execution.
 */
export interface ProcessResult {
  code: number | null;
  signal: NodeJS.Signals | null;
  stdout: string;
  stderr: string;
}

/**
 * Spawn a process safely with shell: false enforced.
 *
 * @param exe - Executable path
 * @param args - Arguments array (NOT a command string)
 * @param opts - Spawn options (shell is forced to false)
 * @returns ChildProcess
 */
export function safeSpawn(
  exe: string,
  args: string[],
  opts: SafeSpawnOptions = {},
): ChildProcess {
  // SECURITY INVARIANT: Never use shell
  const spawnOpts: SpawnOptions = {
    ...opts,
    shell: false, // ENFORCED: Never shell
  };

  return spawn(exe, args, spawnOpts);
}

/**
 * Execute a process and collect output.
 *
 * @param exe - Executable path
 * @param args - Arguments array
 * @param opts - Spawn options
 * @returns Promise resolving to process result
 */
export function runProcess(
  exe: string,
  args: string[],
  opts: SafeSpawnOptions = {},
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const proc = safeSpawn(exe, args, opts);

    let stdout = "";
    let stderr = "";

    proc.stdout?.on("data", (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on("data", (data) => {
      stderr += data.toString();
    });

    proc.on("close", (code, signal) => {
      resolve({ code, signal, stdout, stderr });
    });

    proc.on("error", (err) => {
      reject(err);
    });

    // Handle timeout if specified
    if (opts.timeout && opts.timeout > 0) {
      setTimeout(() => {
        proc.kill("SIGTERM");
        reject(new Error(`Process timed out after ${opts.timeout}ms`));
      }, opts.timeout);
    }
  });
}

/**
 * Validate a numeric input for safe command-line usage.
 *
 * @param value - Value to validate
 * @param name - Parameter name for error messages
 * @param min - Minimum allowed value (default: 0)
 * @param max - Maximum allowed value (default: Number.MAX_SAFE_INTEGER)
 * @returns Validated number
 * @throws Error if invalid
 */
export function validatePositiveInt(
  value: unknown,
  name: string,
  min = 0,
  max = Number.MAX_SAFE_INTEGER,
): number {
  const num = typeof value === "number" ? value : parseInt(String(value), 10);

  if (!Number.isSafeInteger(num)) {
    throw new Error(`${name} must be a safe integer, got: ${value}`);
  }

  if (num < min || num > max) {
    throw new Error(`${name} must be between ${min} and ${max}, got: ${num}`);
  }

  return num;
}
