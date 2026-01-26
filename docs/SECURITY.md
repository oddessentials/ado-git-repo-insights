# Security Policy

This document outlines the security policies and practices for the ADO Git Repo Insights project.

## Core Security Policies

### 1. No Shell Execution with Untrusted Input

**Policy**: Never use `shell: true` when spawning processes, especially with user-controllable inputs.

**Why**: Shell execution enables command injection attacks where malicious input can execute arbitrary commands.

**Implementation**:
```javascript
// ❌ NEVER do this
spawn(cmd, args, { shell: true });
spawn(cmd, args, { shell: process.platform === "win32" });

// ✅ Always do this
spawn(cmd, args, { shell: false });
execFile(cmd, args); // execFile never uses shell by default
```

### 2. No String Command Construction

**Policy**: Always use argument arrays, never construct command strings.

**Why**: String concatenation with user input enables injection attacks.

**Implementation**:
```javascript
// ❌ NEVER do this
exec(`python script.py --count ${userInput}`);
execSync(`program ${arg1} ${arg2}`);

// ✅ Always do this
execFile('python', ['script.py', '--count', String(validatedInput)]);
spawn('program', [arg1, arg2], { shell: false });
```

### 3. Safe DOM Rendering (XSS Prevention)

**Policy**: Never insert user-controlled or external data into the DOM using raw `innerHTML`, `outerHTML`, or `document.write`. Use the centralized safe rendering utilities.

**Why**: This enables Cross-Site Scripting (XSS) attacks where malicious scripts can execute in the user's browser context.

**Safe Rendering Utilities**: Located in `extension/ui/modules/shared/render.ts`

| Function | Use Case |
|----------|----------|
| `clearElement(el)` | Safe alternative to `el.innerHTML = ""` |
| `createElement(tag, attrs, text)` | Build elements with safe text content |
| `renderNoData(container, msg)` | Render "no data" placeholder messages |
| `renderTrustedHtml(container, html)` | Render HTML when ALL dynamic values are escaped |
| `appendTrustedHtml(container, html)` | Append HTML when ALL dynamic values are escaped |
| `createOption(value, text)` | Create `<option>` elements for dropdowns |
| `escapeHtml(text)` | Escape special HTML characters |

**Implementation Patterns**:

```typescript
// ❌ NEVER do this
element.innerHTML = `<div>${userData}</div>`;
element.innerHTML += userContent;
element.innerHTML = "";

// ✅ For "no data" states
import { renderNoData } from "./modules/shared/render";
renderNoData(container, "No data available");

// ✅ For clearing elements
import { clearElement } from "./modules/shared/render";
clearElement(container);

// ✅ For building DOM trees
import { createElement } from "./modules/shared/render";
const li = createElement("li", { class: "item" }, userText);
container.appendChild(li);

// ✅ For filter dropdowns
import { clearElement, createOption } from "./modules/shared/render";
clearElement(dropdown);
dropdown.appendChild(createOption("", "All"));
Array.from(items).forEach(item => {
    dropdown.appendChild(createOption(item.id, item.name));
});

// ✅ For complex HTML with escaped values
import { escapeHtml, renderTrustedHtml } from "./modules/shared/render";
const html = `<div class="card">
    <h3>${escapeHtml(title)}</h3>
    <p>${escapeHtml(description)}</p>
</div>`;
renderTrustedHtml(container, html);
```

**Critical Rule**: When using `renderTrustedHtml` or `appendTrustedHtml`:
- ALL user-controlled strings must be wrapped in `escapeHtml()`
- Numeric values computed in code are safe without escaping
- Static strings defined in code are safe without escaping
- Add a `// SECURITY:` comment explaining why the content is trusted


### 4. Safe Path Resolution

**Policy**: Always validate that resolved paths stay within expected base directories.

**Why**: Path traversal attacks (e.g., `../../etc/passwd`) can access unauthorized files.

**Implementation**:
```javascript
// ❌ NEVER do this with user input
const filePath = path.join(baseDir, userInput);

// ✅ Always do this
function resolveInside(baseDir, ...parts) {
  const resolved = path.resolve(baseDir, ...parts);
  const normalizedBase = path.resolve(baseDir) + path.sep;
  if (!resolved.startsWith(normalizedBase) && resolved !== path.resolve(baseDir)) {
    throw new Error('Path escapes base directory');
  }
  return resolved;
}
const filePath = resolveInside(baseDir, userInput);
```

### 5. Structured Logging

**Policy**: Use structured logging patterns to prevent log forging.

**Why**: Attackers can inject false log entries if user input is concatenated into log messages.

**Implementation**:
```javascript
// ❌ NEVER do this
console.log("User: " + userName + " performed action");

// ✅ Always do this
console.log("User performed action:", { user: userName });
console.log("User: %s performed action", userName);
```

## Reporting Security Issues

If you discover a security vulnerability, please report it by creating a private security advisory in the GitHub repository.

## Security Testing

- Semgrep runs in CI to detect security anti-patterns
- Security invariants tests prevent regression
- Generated bundles are excluded from scanning (sources are scanned)
