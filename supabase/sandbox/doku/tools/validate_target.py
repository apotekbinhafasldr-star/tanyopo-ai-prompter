#!/usr/bin/env python3
"""Validate the sandbox target BEFORE any secret is attached to a step (used by the workflow; also unit-tested locally).
Env: INPUT_TARGET_REF (dispatch input), DOKU_DB_HOST, DOKU_DB_USER (Environment variables, not secrets).
Accepts only the linoe-doku-sandbox project; production refs are named here only to be rejected. Prints PASS/STOP, never host/user."""
import os, re, sys

REF, PROD, OTP = "eskqngzhtndkfqjoxxou", "wjjyqovhmwenbcvbnkgx", "bmwpykwoylmzrbmbdeqw"
e = os.environ
ref_in, host, user = e.get("INPUT_TARGET_REF", ""), e.get("DOKU_DB_HOST", ""), e.get("DOKU_DB_USER", "")
blob = (ref_in + "|" + host + "|" + user).lower()
problems = []
if ref_in != REF: problems.append("target_ref bukan project sandbox")
if PROD in blob or OTP in blob: problems.append("ref production/OTP terdeteksi")
direct = host == f"db.{REF}.supabase.co" and user == "postgres"
pooler = bool(re.fullmatch(r"[a-z0-9-]+\.pooler\.supabase\.com", host)) and user == f"postgres.{REF}"
if not (direct or pooler): problems.append("DOKU_DB_HOST/DOKU_DB_USER bukan endpoint sandbox")
if problems:
    print("STOP: " + "; ".join(problems)); sys.exit(1)
print("PASS: target = linoe-doku-sandbox (ref sandbox, host/user cocok); tidak ada rahasia dipakai pada langkah ini")
