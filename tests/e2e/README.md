# End-to-end tests

Scaffolding only for Phase 0 — there isn't yet a feature flow (product creation, campaign draft, approval) worth driving end-to-end. Playwright is the intended tool once Phase 1 ships real forms and data.

Planned critical paths (see product spec §74):

- Signup → organization/tenant created → onboarding completed
- Add product → generate Marketing Blueprint
- Create campaign draft → internal approval
- Budget guard rejection
- Tenant isolation (user from tenant A cannot read tenant B's data)
