#!/usr/bin/env python3
"""Verify that a GitHub Environment REQUIRED-REVIEWER approval really happened for this workflow run.

Input: the JSON of GET /repos/{owner}/{repo}/actions/runs/{run_id}/approvals (a list). If the Environment has no required
reviewer, GitHub starts the job immediately and this list is EMPTY -> this check fails and the workflow stops before any
database secret is used. That is how the workflow proves the approval mechanism is real instead of assuming it.
"""
import json
import sys


def evaluate(approvals, owner, environment):
    if not isinstance(approvals, list) or not approvals:
        return False, "no approval recorded for this run: the Environment has no required reviewer (or nobody approved)"
    ok = False
    for a in approvals:
        if not isinstance(a, dict):
            continue
        envs = [e.get("name") for e in (a.get("environments") or []) if isinstance(e, dict)]
        login = ((a.get("user") or {}).get("login") or "").lower()
        state = a.get("state")
        if environment in envs and state == "rejected":
            return False, "the deployment was rejected"
        if environment in envs and state == "approved" and login == owner.lower():
            ok = True
    if not ok:
        return False, f"no 'approved' review by the repository owner for environment '{environment}'"
    return True, "approved by the repository owner"


def main(argv):
    path, owner, environment = argv[1], argv[2], argv[3]
    with open(path, encoding="utf-8") as f:
        data = json.load(f)
    ok, msg = evaluate(data, owner, environment)
    print(("PASS: " if ok else "STOP: ") + msg)
    return 0 if ok else 1


if __name__ == "__main__":
    sys.exit(main(sys.argv))
