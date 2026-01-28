extension/ui/modules/ml/synthetic.ts
🔴 (line 53) [opencode]: Mathematical operation may overflow for large seed values
💡 Suggestion: Add bounds checking or use BigInt for intermediate calculations to prevent overflow
src/ado_git_repo_insights/ui_bundle/dashboard.js
🔴 [semgrep]: User controlled data in methods like innerHTML, outerHTML or document.write is an anti-pattern that can lead to XSS vulnerabilities
🔵 [semgrep]: Detected string concatenation with a non-literal variable in a util.format / console.log function. If an attacker injects a format specifier in the string, it will forge the log message. Try to use constant values for the format string.
extension/ui/modules/charts/predictions.ts
🟡 (line 190) [opencode]: Array destructuring may fail if sparkline array is empty
💡 Suggestion: Add safety check: const firstVal = values[0] ?? 0; const lastVal = values[values.length - 1] ?? 0;
🟡 (line 234) [opencode]: Potential null pointer exception when match[1] or match[2] could be undefined
💡 Suggestion: Add explicit null checks: if (!match?.[1] || !match?.[2]) return isoWeek;
🟡 (line 338) [opencode]: Date parsing without validation could throw runtime errors
💡 Suggestion: Add try-catch around new Date() or validate date format before parsing
extension/ui/modules/ml/setup-guides.ts
🟡 (line 32) [opencode]: Using deprecated document.execCommand('copy') API as fallback
💡 Suggestion: Consider removing the fallback or adding a deprecation warning. Modern browsers support navigator.clipboard.writeText()
🔵 (line 76) [opencode]: DOM element creation without cleanup could cause memory leaks
💡 Suggestion: Store reference to liveRegion and reuse across calls, or implement cleanup mechanism
src/ado_git_repo_insights/ml/insights.py
🟡 (line 283) [opencode]: SQL query vulnerable to edge case where no rows exist
💡 Suggestion: Add COALESCE or handle None result: cursor.fetchone() or {'cycle_time_minutes': 0}
src/ado_git_repo_insights/transform/aggregators.py
🟡 (line 334) [opencode]: Broad exception catching could mask important errors
💡 Suggestion: Catch specific exceptions like ImportError, ModuleNotFoundError instead of generic Exception
extension/ui/dashboard.ts
🔵 [semgrep]: Detected string concatenation with a non-literal variable in a util.format / console.log function. If an attacker injects a format specifier in the string, it will forge the log message. Try to use constant values for the format string.
extension/ui/modules/ml.ts
🔵 (line 102) [opencode]: Inconsistent type annotation - values could be undefined
💡 Suggestion: Update type to values: number[] | undefined or add runtime check
src/ado_git_repo_insights/ml/fallback_forecaster.py
🔵 (line 394) [opencode]: Resource not closed in error paths
💡 Suggestion: Use context manager for file operations or add explicit close() in finally block
