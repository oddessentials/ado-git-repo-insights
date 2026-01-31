Issues to Resolve (Low Churn)

Harden ZIP extraction against Zip Slip
Before calling ZipFile.extractall(out_dir), validate every ZIP entry by resolving its target path and enforcing that it remains within out_dir. If any entry escapes the directory, abort extraction with a clear error. This is a localized, defensive fix that does not alter normal behavior for valid artifacts.

URL-encode Azure DevOps continuation tokens
When appending continuationToken values to request URLs, URL-encode them using urllib.parse.quote_plus (or equivalent) before adding them to the query string. This ensures pagination remains reliable even if tokens contain special characters and does not change request semantics or data shape.

🚫 Avoid List (Churn-Inducing, Do Not Do)
Replacing extractall() with a custom extraction pipeline or streaming ZIP parser
Introducing new third-party ZIP libraries or refactoring artifact staging architecture
Changing pagination logic, request sequencing, or retry semantics beyond token encoding
Adding new configuration flags or feature toggles for either fix

---

- **Zip Slip**: The “validate each ZIP member stays inside `out_dir` before extraction” fix fully addresses the `extractall()` vulnerability called out in both reports (and is the only “required” security remediation).
- **Continuation tokens**: **URL-encoding the continuation token before appending it to query strings** addresses the pagination reliability concern across all endpoints where tokens are used (PRs, teams, team members, PR threads), eliminating the intermittent/incomplete pagination risk.
