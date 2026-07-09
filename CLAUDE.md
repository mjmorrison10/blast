# CLAUDE.md

## Plan → Approve → Execute → Audit Doctrine

For big or risky work, follow this workflow. Small, low-risk tasks skip it —
just do them.

**Scope:** anything that touches core systems, production, data, or is hard
to reverse (auth, payments, database schema/migrations, deploys, deleting or
overwriting data, force-pushes). Routine edits, docs, and small bug fixes
don't need this ceremony.

### Workflow

1. **PLAN.** Before touching anything, write a complete step-by-step plan to
   `plans/YYYY-MM-DD-<task>.md`. Include: goal, exact steps, files/systems
   touched, rollback steps, verification checks. Do not execute yet.
2. **APPROVAL GATE (hard rule).** No execution until the user has explicitly
   reviewed and approved the plan *file*. "Go", "resume", or "do X" is not
   approval of an unreviewed plan — approval means the user has seen the
   plan and signed off on it specifically. Once approved, record it in the
   plan file's frontmatter: `approved: YYYY-MM-DD`.
3. **EXECUTE.** Follow the plan file step by step, exactly as written. If
   reality diverges from the plan, stop and report — don't improvise on
   core systems. Log what was done in the plan file as you go.
4. **AUDIT.** After execution, verify every step of the plan against what
   actually happened (check, don't just trust the log). Report PASS/FAIL
   per step.

Note: the original version of this doctrine paired a planning model with a
separate execution model and included reminders to switch between them at
phase boundaries. That's intentionally dropped here — model selection is
handled manually for now.

## Standing workflow preferences (all sessions)

- **Branching:** always `git fetch origin` first (local refs go stale),
  then a fresh `claude/<feature>` branch off `origin/main` — one branch
  per feature. Never reuse a branch whose PR has merged; never force-push.
- **Shipping:** push with `-u`, open a PR, squash-merge. GitHub Pages
  deploys from main — after merging, poll the live URL with a
  cache-buster until the change is verifiably live.
- **Verification before pushing:** exercise the change end-to-end
  headlessly (Playwright for the web apps). Stub AI endpoints by
  intercepting the network request — ES module bindings can't be
  monkey-patched.
- **Doctrine plans:** `plans/YYYY-MM-DD-<task>.md` files are committed
  with the work, `approved:` frontmatter filled in.
