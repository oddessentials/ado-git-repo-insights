# Contract: pagination module

**Module**: `src/ado_git_repo_insights/extractor/pagination.py`
**Feature**: 017-security-fixes

## Functions

### `add_continuation_token(url: str, token: str | None) -> str`

Add a continuation token to a URL with proper encoding.

**Parameters**:
- `url`: Base URL (may or may not have existing query parameters)
- `token`: Raw continuation token from ADO API response, or `None`

**Returns**: URL with encoded continuation token appended, or original URL if token is `None`/empty

**Behavior**:
- Returns `url` unchanged if `token` is `None` or empty string
- URL-encodes token using `urllib.parse.quote_plus()`
- Appends `?continuationToken=...` or `&continuationToken=...` as appropriate

**Example**:
```python
# No existing params
add_continuation_token("https://dev.azure.com/org/proj/_apis/git/pullrequests", "abc+def")
# Returns: "https://dev.azure.com/org/proj/_apis/git/pullrequests?continuationToken=abc%2Bdef"

# With existing params
add_continuation_token("https://dev.azure.com/org/_apis/teams?api-version=7.0", "foo&bar=baz")
# Returns: "https://dev.azure.com/org/_apis/teams?api-version=7.0&continuationToken=foo%26bar%3Dbaz"

# None token
add_continuation_token("https://example.com/api", None)
# Returns: "https://example.com/api"
```

---

### `extract_continuation_token(response: requests.Response) -> str | None`

Extract continuation token from ADO API response.

**Parameters**:
- `response`: A `requests.Response` object from ADO API call

**Returns**: Raw token string, or `None` if no token present

**Token Sources** (checked in order):
1. Response header `x-ms-continuationtoken`
2. Response JSON field `continuationToken`

**Behavior**:
- Returns `None` if neither source contains a token
- Returns the raw value without any encoding/decoding
- Does not validate token format (treated as opaque)

---

### `paginate(base_url: str, headers: dict, *, max_pages: int = 1000) -> Iterator[dict]`

Generator that yields all pages from a paginated ADO API endpoint.

**Parameters**:
- `base_url`: Initial API URL
- `headers`: Request headers (including auth)
- `max_pages`: Safety limit to prevent infinite loops (default: 1000)

**Yields**: Response JSON dict for each page

**Raises**:
- `PaginationError`: If max_pages exceeded or request fails

**Behavior**:
- Makes initial request to `base_url`
- Extracts continuation token from response
- Repeats with token until no token returned or max_pages reached
- Uses `add_continuation_token()` for URL construction

---

### Exception Classes

```python
class PaginationError(Exception):
    """Raised when pagination fails or exceeds limits."""
    pass
```

## Usage Example

```python
from ado_git_repo_insights.extractor.pagination import (
    add_continuation_token,
    extract_continuation_token,
    paginate,
)

# Manual token handling
url = "https://dev.azure.com/org/_apis/teams"
response = requests.get(url, headers=auth_headers)
token = extract_continuation_token(response)
next_url = add_continuation_token(url, token)

# Automatic pagination
for page in paginate(url, auth_headers):
    process_teams(page["value"])
```

## Migration Guide

Replace direct string concatenation:

```python
# BEFORE (vulnerable)
if continuation_token:
    page_url += f"&continuationToken={continuation_token}"

# AFTER (safe)
from ado_git_repo_insights.extractor.pagination import add_continuation_token
page_url = add_continuation_token(base_url, continuation_token)
```
