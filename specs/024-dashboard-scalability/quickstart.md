# Quickstart: Dashboard Scalability

**Feature**: 024-dashboard-scalability
**Date**: 2026-02-05

## Overview

This guide helps developers quickly implement and test dashboard scalability features.

---

## Prerequisites

- Python 3.11+
- Node.js 22+
- pnpm 9.15+

---

## Phase 0: Generator Enhancement

### Step 1: Add CLI Arguments

Edit `scripts/generate-synthetic-dataset.py`:

```python
# Add to argument parser (around line 318)
parser.add_argument(
    "--users",
    type=int,
    default=None,
    help="Number of users/reviewers to generate (1-500, default: auto)",
)
parser.add_argument(
    "--include-comments",
    action="store_true",
    help="Generate PR threads and comments",
)
```

### Step 2: Remove Caps

```python
# Line 50: Remove 30-user cap
# BEFORE:
num_users = min(30, max(10, pr_count // 10))
# AFTER:
num_users = args.users if args.users else min(200, max(10, pr_count // 10))

# Line 82: Remove 52-week cap
# BEFORE:
weeks = min(52, max(4, pr_count // 20))
# AFTER:
weeks = args.weeks if args.weeks else min(156, max(4, pr_count // 20))
```

### Step 3: Add Comment Generation

```python
def generate_comments(pr_count: int, users: list, seed: int) -> tuple[list, list]:
    """Generate synthetic threads and comments."""
    rng = random.Random(seed + 2000)
    threads = []
    comments = []

    for pr_idx in range(pr_count):
        pr_uid = f"pr-{pr_idx + 1}"
        num_threads = rng.randint(2, 5)

        for t_idx in range(num_threads):
            thread_id = f"thread-{pr_idx}-{t_idx}"
            status = rng.choices(
                ["active", "fixed", "closed"],
                weights=[60, 25, 15]
            )[0]

            threads.append({
                "thread_id": thread_id,
                "pull_request_uid": pr_uid,
                "status": status,
                "created_at": "2024-01-01T00:00:00Z",
                "last_updated": "2024-01-01T00:00:00Z",
            })

            num_comments = rng.randint(1, 4)
            for c_idx in range(num_comments):
                comment_type = rng.choices(
                    ["text", "codeChange", "system"],
                    weights=[85, 10, 5]
                )[0]
                author = rng.choice(users)

                comments.append({
                    "comment_id": f"comment-{pr_idx}-{t_idx}-{c_idx}",
                    "thread_id": thread_id,
                    "pull_request_uid": pr_uid,
                    "author_id": author["user_id"],
                    "content": f"Synthetic comment #{len(comments) + 1}",
                    "comment_type": comment_type,
                    "created_at": "2024-01-01T00:00:00Z",
                })

    return threads, comments
```

### Step 4: Verify

```bash
# Generate target scalability dataset
python scripts/generate-synthetic-dataset.py \
  --pr-count 10000 --weeks 156 --users 200 --include-comments \
  --seed 42 --output test-data/scalability

# Verify output
ls test-data/scalability/aggregates/weekly_rollups | wc -l  # Should be 156
cat test-data/scalability/aggregates/dimensions.json | jq '.users | length'  # Should be 200
cat test-data/scalability/dataset-manifest.json | jq '.features.comments'  # Should be true
```

---

## Phase 1: Chart Data Caps

### Step 1: Update Throughput Chart

Edit `extension/ui/modules/charts/throughput.ts`:

```typescript
// Add at top of file
const MAX_THROUGHPUT_POINTS = 104; // 2 years of weekly data

// In render function, add before existing logic:
export function renderThroughputChart(
  container: HTMLElement,
  rollups: WeeklyRollup[]
): void {
  const truncated = rollups.length > MAX_THROUGHPUT_POINTS;
  const limitedRollups = truncated
    ? rollups.slice(-MAX_THROUGHPUT_POINTS)
    : rollups;

  // ... existing render logic using limitedRollups ...

  // Add at end of function:
  if (truncated) {
    const indicator = document.createElement('div');
    indicator.className = 'truncation-indicator';
    indicator.textContent = `Showing last 2 years (${MAX_THROUGHPUT_POINTS} weeks)`;
    container.appendChild(indicator);
  }
}
```

### Step 2: Update Cycle Time Chart

Apply same pattern to `extension/ui/modules/charts/cycle-time.ts`:

```typescript
const MAX_CYCLE_TIME_POINTS = 104;

// Apply same truncation logic in render function
```

### Step 3: Add CSS for Indicator

```css
.truncation-indicator {
  font-size: 0.75rem;
  color: #666;
  margin-top: 0.5rem;
  text-align: left;
}
```

---

## Phase 2: Scalability Tests

### Step 1: Create Test File

Create `extension/tests/unit/chart-scalability.test.ts`:

```typescript
import { renderThroughputChart } from '../../ui/modules/charts/throughput';

describe('Chart Scalability', () => {
  let container: HTMLDivElement;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
  });

  afterEach(() => {
    document.body.removeChild(container);
  });

  it('renders 156 weeks in < 1000ms', () => {
    const rollups = generateMockRollups(156);
    const start = performance.now();
    renderThroughputChart(container, rollups);
    const elapsed = performance.now() - start;
    expect(elapsed).toBeLessThan(1000);
  });

  it('caps DOM elements at 104', () => {
    const rollups = generateMockRollups(156);
    renderThroughputChart(container, rollups);
    const bars = container.querySelectorAll('.throughput-bar');
    expect(bars.length).toBeLessThanOrEqual(104);
  });

  it('shows truncation indicator when data exceeds cap', () => {
    const rollups = generateMockRollups(156);
    renderThroughputChart(container, rollups);
    const indicator = container.querySelector('.truncation-indicator');
    expect(indicator).toBeTruthy();
    expect(indicator?.textContent).toContain('104 weeks');
  });

  it('shows no indicator for 104 weeks or less', () => {
    const rollups = generateMockRollups(104);
    renderThroughputChart(container, rollups);
    const indicator = container.querySelector('.truncation-indicator');
    expect(indicator).toBeFalsy();
  });
});

function generateMockRollups(count: number): WeeklyRollup[] {
  return Array.from({ length: count }, (_, i) => ({
    week: `2024-W${String(i + 1).padStart(2, '0')}`,
    start_date: '2024-01-01',
    end_date: '2024-01-07',
    pr_count: Math.floor(Math.random() * 50) + 10,
    cycle_time_p50: Math.random() * 500,
    cycle_time_p90: Math.random() * 1000,
    authors_count: Math.floor(Math.random() * 10) + 5,
    reviewers_count: Math.floor(Math.random() * 10) + 3,
  }));
}
```

### Step 2: Enable Strict Invariants

Update `extension/tests/scalability-invariants.test.ts`:

```typescript
// Change from warnings to assertions
test("Throughput chart has MAX_THROUGHPUT_POINTS defined", () => {
  // ... existing file check ...
  expect(hasMaxPoints).toBe(true); // Was: console.warn if false
});
```

---

## Phase 3: CI Integration

### Step 1: Update Workflow

Add to `.github/workflows/test.yml`:

```yaml
scalability-tests:
  runs-on: ubuntu-latest
  needs: [lint, type-check]
  steps:
    - uses: actions/checkout@v4

    - name: Set up Python
      uses: actions/setup-python@v5
      with:
        python-version: '3.11'

    - name: Cache scalability data
      uses: actions/cache@v4
      with:
        path: test-data/scalability
        key: scalability-${{ hashFiles('scripts/generate-synthetic-dataset.py') }}

    - name: Generate scalability test data
      run: |
        if [ ! -d "test-data/scalability" ]; then
          python scripts/generate-synthetic-dataset.py \
            --pr-count 10000 --weeks 156 --users 200 \
            --include-comments --seed 42 --output test-data/scalability
        fi

    - name: Set up Node
      uses: actions/setup-node@v4
      with:
        node-version: '22'

    - name: Install pnpm
      uses: pnpm/action-setup@v4
      with:
        version: 9.15.0

    - name: Install dependencies
      run: pnpm install

    - name: Run scalability tests
      working-directory: extension
      run: pnpm test:scalability
```

### Step 2: Add npm Script

Update `extension/package.json`:

```json
{
  "scripts": {
    "test:scalability": "jest --testPathPattern=scalability"
  }
}
```

---

## Verification Checklist

- [ ] Generator produces 156 weekly rollups
- [ ] Generator produces 200 users in dimensions
- [ ] Generator sets `features.comments: true`
- [ ] Throughput chart has `MAX_THROUGHPUT_POINTS = 104`
- [ ] Cycle time chart has `MAX_CYCLE_TIME_POINTS = 104`
- [ ] Truncation indicator appears for 156-week dataset
- [ ] All scalability tests pass
- [ ] CI workflow runs successfully

---

## Troubleshooting

### Generator produces fewer weeks than expected

Check that `--weeks` argument is passed and the cap has been removed from line 82.

### Tests fail with "MAX_*_POINTS not defined"

Ensure the constant is exported or defined at module scope, not inside a function.

### CI timeout on data generation

Use caching (see Phase 3) to avoid regenerating data on every run.

### Performance tests flaky

Increase threshold or run with `--runInBand` to reduce variability.
