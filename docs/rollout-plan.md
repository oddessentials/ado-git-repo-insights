# Rollout Plan: ado-git-repo-insights

This document outlines the phased rollout strategy for transitioning from the legacy system to ado-git-repo-insights.

---

## Phase 1: Parallel Running (Week 1-2)

### Objective
Run both systems in parallel to validate data consistency.

### Steps

1. **Deploy new pipeline** (does NOT replace legacy):
   ```yaml
   # New pipeline: ado-insights-validation
   trigger: none  # Manual only during validation
   schedules:
     - cron: "0 7 * * *"  # Run 1 hour after legacy
       branches:
         include: [main]
   ```

2. **Configure validation job**:
   - Run legacy system at 6 AM
   - Run new system at 7 AM
   - Run CSV diff at 8 AM

3. **Daily validation**:
   ```bash
   python scripts/csv_diff.py \
     ./legacy_output \
     ./new_output
   ```

### Success Criteria
- [ ] 7 consecutive days with no unexplained differences
- [ ] All CSV schemas match exactly
- [ ] Row counts within expected variance (new PRs during the hour)

---

## Phase 2: Shadow Mode (Week 3)

### Objective
Feed new system output to a shadow PowerBI instance.

### Steps

1. **Create shadow PowerBI workspace**
2. **Import new CSVs** into shadow model
3. **Validate all measures compute correctly**
4. **Compare key metrics** between production and shadow:
   - Total PRs per week
   - Average cycle time
   - Top reviewers

### Success Criteria
- [ ] All PowerBI measures compute without error
- [ ] Key metrics match within 1% tolerance
- [ ] No missing data points

---

## Phase 3: Cutover (Week 4)

### Objective
Switch production to new system.

### Steps

1. **Final validation run**:
   - Full backfill (90 days)
   - Complete CSV comparison

2. **Update production pipeline**:
   ```yaml
   # Replace legacy task with new task
   - task: ExtractPullRequests@1
     inputs:
       organization: $(Organization)
       projects: $(Projects)
       pat: $(PAT_SECRET)
   ```

3. **Update PowerBI data source**:
   - Point to new artifact location
   - Validate refresh succeeds

4. **Decommission legacy**:
   - Disable legacy pipeline (keep for 30 days)
   - Archive legacy MongoDB (if applicable)

### Rollback Plan
If issues discovered:
1. Re-enable legacy pipeline
2. Revert PowerBI data source
3. Investigate with CSV diff tool

---

## Phase 4: Monitoring (Ongoing)

### Daily Checks
- [ ] Pipeline succeeded
- [ ] Artifact published
- [ ] Row counts reasonable

### Weekly Checks
- [ ] Backfill run completed
- [ ] No schema warnings in logs
- [ ] PowerBI refresh times normal

### Alerts
Configure pipeline alerts for:
- Any failed run
- Runs with 0 PRs extracted (unexpected)
- Runs taking > 30 minutes

---

## Risk Mitigation

| Risk | Mitigation |
|------|------------|
| Data loss | 90-day artifact retention |
| Schema drift | Automated contract tests in CI |
| PowerBI break | Shadow validation phase |
| Performance issues | Configurable rate limits |

---

## Timeline Summary

| Week | Phase | Key Activity |
|------|-------|--------------|
| 1-2 | Parallel | Daily comparison runs |
| 3 | Shadow | PowerBI validation |
| 4 | Cutover | Production switch |
| 5+ | Monitoring | Ongoing health checks |

---

## Contacts

| Role | Person |
|------|--------|
| Technical Lead | TBD |
| PowerBI Owner | TBD |
| Pipeline Admin | TBD |
