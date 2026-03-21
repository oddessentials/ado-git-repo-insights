import { execFileSync } from "child_process";

type PythonInvocation = {
  command: string;
  prefixArgs: string[];
};

type PythonSubprocessProbe = {
  supported: boolean;
  reason?: string;
};

function resolvePythonInvocation(): PythonInvocation {
  const overridden = process.env["GRI_TEST_PYTHON"] ?? process.env["PYTHON"];
  if (overridden) {
    return { command: overridden, prefixArgs: [] };
  }

  if (process.platform === "win32") {
    return { command: "python", prefixArgs: [] };
  }

  return { command: "python3", prefixArgs: [] };
}

let cachedProbe: PythonSubprocessProbe | null = null;

export function probePythonSubprocessSupport(): PythonSubprocessProbe {
  if (cachedProbe) {
    return cachedProbe;
  }

  const invocation = resolvePythonInvocation();

  try {
    execFileSync(
      invocation.command,
      [...invocation.prefixArgs, "-c", "print(0)"],
      { stdio: "pipe" },
    );
    cachedProbe = { supported: true };
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    cachedProbe = { supported: false, reason };
  }

  return cachedProbe;
}

export function assertPythonSubprocessSupport(suiteName: string): void {
  const probe = probePythonSubprocessSupport();
  if (probe.supported) {
    return;
  }

  const message =
    `${suiteName} requires Node-to-Python subprocess execution. ` +
    `Set GRI_TEST_PYTHON to a working interpreter if needed. ` +
    `Probe failure: ${probe.reason ?? "unknown error"}`;

  if (process.env["CI"]) {
    throw new Error(message);
  }

  console.warn(message);
}

export function runPythonScript(scriptPath: string, args: string[]): void {
  const invocation = resolvePythonInvocation();
  execFileSync(
    invocation.command,
    [...invocation.prefixArgs, scriptPath, ...args],
    { stdio: "pipe" },
  );
}
