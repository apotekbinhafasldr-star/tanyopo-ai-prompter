#!/usr/bin/env python3
"""Tool/package separation (stdlib only; runs in CI on pull requests, never in the production job).

A pull request that changes the TOOLS side (the runner, its tests' lint rules live there, the workflow, the manifest, CODEOWNERS) must not also
change PACKAGE files (the SQL packages, migrations, rollbacks): otherwise one reviewer-from-a-phone has to trust a lint change and the
SQL it is supposed to judge in the same diff. Usage: check_separation.py --base <sha> --head <sha>   (or --files a b c for tests)."""
import argparse
import re
import subprocess
import sys

TOOL_RE = [
    r"^supabase/prod-packages/tools/",
    r"^supabase/prod-packages/manifest\.json$",
    r"^\.github/workflows/production-migration\.yml$",
    r"^\.github/CODEOWNERS$",
    r"^\.github/workflows/ci\.yml$",
    r"^\.gitattributes$",
]
# package files: SQL packages (not the tools/tests directories), the migrations and rollbacks they embed
PACKAGE_RE = [
    r"^supabase/prod-packages/(?!tools/|tests/)[^/]+/",
    r"^supabase/migrations/",
    r"^supabase/rollback/",
]


def classify(path):
    tool = any(re.search(p, path) for p in TOOL_RE)
    pkg = any(re.search(p, path) for p in PACKAGE_RE)
    return tool, pkg


def check(files):
    tools = sorted(f for f in files if classify(f)[0])
    pkgs = sorted(f for f in files if classify(f)[1])
    if tools and pkgs:
        return [f"this change touches the tools side ({len(tools)} file(s), e.g. {tools[0]}) AND package files ({len(pkgs)} file(s), e.g. {pkgs[0]}): split it into two pull requests"]
    return []


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--base")
    ap.add_argument("--head", default="HEAD")
    ap.add_argument("--files", nargs="*")
    a = ap.parse_args(argv)
    if a.files is None:
        if not a.base:
            print("--base or --files is required", file=sys.stderr)
            return 2
        out = subprocess.run(["git", "diff", "--name-only", f"{a.base}...{a.head}"], capture_output=True, text=True)
        if out.returncode != 0:
            print("git diff failed", file=sys.stderr)
            return 2
        files = [x for x in out.stdout.splitlines() if x]
    else:
        files = a.files
    problems = check(files)
    for p in problems:
        print(f"FAIL: {p}")
    if not problems:
        print(f"PASS: tool/package separation ({len(files)} changed file(s))")
    return 1 if problems else 0


if __name__ == "__main__":
    sys.exit(main())
