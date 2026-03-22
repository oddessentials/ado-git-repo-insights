from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[2]
EVIDENCE_DIR = REPO_ROOT / "specs" / "034-roadmap-closure" / "evidence"
REQUIRED_FILES = [
    "001-author-filters-evidence.md",
    "002-author-repo-evidence.md",
    "003-comments-evidence.md",
    "004-reviewer-followthrough-evidence.md",
    "005-roadmap-finalization-evidence.md",
]
REQUIRED_SECTIONS = [
    "roadmap_item",
    "status",
    "## implementation_files",
    "## test_files",
    "## docs_files",
    "## commands",
    "## outcomes",
    "## constitution_gates",
]


def test_required_roadmap_closure_evidence_files_exist() -> None:
    assert EVIDENCE_DIR.exists(), "Evidence directory must exist"
    for filename in REQUIRED_FILES:
        assert (EVIDENCE_DIR / filename).exists(), f"Missing evidence file: {filename}"


def test_required_roadmap_closure_evidence_sections_exist() -> None:
    for filename in REQUIRED_FILES:
        content = (EVIDENCE_DIR / filename).read_text(encoding="utf-8")
        for section in REQUIRED_SECTIONS:
            assert section in content, f"{filename} missing required section: {section}"
