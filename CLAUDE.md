# ado-git-repo-insights Development Guidelines

Auto-generated from all feature plans. Last updated: 2026-01-26

## Active Technologies
- Python 3.10+ (backend), TypeScript (frontend) (004-ml-features-enhancement)
- Pipeline artifacts (`insights/cache.json`, `predictions/trends.json`) (004-ml-features-enhancement)
- Python 3.10+ (backend), TypeScript (frontend) + pandas, numpy (Python); esbuild (TypeScript bundling) (005-ml-metrics-fixes)
- SQLite (source of truth per Constitution Principle V) (005-ml-metrics-fixes)

-\ Python\ 3\.10\+\ \(matches\ existing\ project\ requirement\)\ \+\ argparse\ \(stdlib\),\ pathlib\ \(stdlib\),\ shutil\ \(stdlib\),\ subprocess\ \(stdlib\),\ sys\ \(stdlib\)\ \(003-cli-distribution\)

## Project Structure

```text
src/
tests/
```

## Commands

cd\ src;\ pytest;\ ruff\ check\ \.

## Code Style

Python\ 3\.10\+\ \(matches\ existing\ project\ requirement\):\ Follow\ standard\ conventions

## Recent Changes
- 005-ml-metrics-fixes: Added Python 3.10+ (backend), TypeScript (frontend) + pandas, numpy (Python); esbuild (TypeScript bundling)
- 004-ml-features-enhancement: Added Python 3.10+ (backend), TypeScript (frontend)

-\ 003-cli-distribution:\ Added\ Python\ 3\.10\+\ \(matches\ existing\ project\ requirement\)\ \+\ argparse\ \(stdlib\),\ pathlib\ \(stdlib\),\ shutil\ \(stdlib\),\ subprocess\ \(stdlib\),\ sys\ \(stdlib\)

<!-- MANUAL ADDITIONS START -->
<!-- MANUAL ADDITIONS END -->
