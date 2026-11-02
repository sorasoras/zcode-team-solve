# zcode-team-solve

A port of [`memdoor/examples/workflows/team-solve`](https://github.com/guregodevo/memdoor/tree/main/examples/workflows/team-solve)
to [ZCode](https://zcode.ai) dynamic workflows. Same seven roles, same prompt
wording, same on-disk handoffs, fresh context per role — and the sample checker,
not a model's claim, decides whether the run succeeded.

The definition is a single file: [`.zcode/workflows/team-solve.dwf.ts`](.zcode/workflows/team-solve.dwf.ts).
ZCode discovers saved workflows there, so cloning this repo and opening it as the
project root is enough.

## Quick start

1. Clone the repo and open the directory as a ZCode project.
2. Run the saved workflow `team-solve`, either from the UI or with
   `CreateWorkflow({ saved: { name: "team-solve" } })`.

Defaults reproduce the sample run:

| arg | default | meaning |
|-----|---------|---------|
| `runDir` | `team-solve` | directory holding `task.md`, `tests/`, `check.py`, and every artifact |
| `runLabel` | `sample-run-1` | identifier the planner stamps into `notes.md` |
| `problem` | `Longest Balanced Substring Count` | label used in the run report |
| `gateTimeoutMs` | `300000` | timeout for each of the two sample-check gates |

To solve a different problem, replace the contents of `team-solve/task.md` and
`team-solve/tests/*.in` / `*.out`, then delete the generated files. Nothing else
is problem-specific.

## Pipeline

| # | Step | Kind | Reads | Writes |
|---|------|------|-------|--------|
| 1 | Planner | agent | `task.md` | `plan.md`, `notes.md` |
| 2 | Ideator A ∥ Ideator B | agent ×2 | `task.md`, `plan.md`, `notes.md` | `proposals/a.md`, `proposals/b.md` |
| 3 | Solver | agent | all of the above | `solution.py`, `notes.md` (Solver decision) |
| 4 | Test gate | `world.run` | `solution.py`, `tests/` | `test-output.log`, `test-status.txt` |
| 5 | Manager | agent | `test-status.txt`, `test-output.log` | `review.md`, `notes.md` (Review) |
| 6 | Repair | agent | review + logs | `solution.py` (only if the gate failed) |
| 7 | Verify gate | `world.run` | `solution.py`, `tests/` | `final-test-output.log` |

Step 2 runs the two ideators concurrently, each in its own fresh context.
Steps 5 and 6 run only when step 4 failed.

Step 7's exit code is the verdict. A nonzero exit throws, so the run reports as
errored rather than quietly "done".

## The gate is the verdict

An earlier plan for this was "one skill plus a bunch of subagents". That loses
the only thing worth keeping: a skill is markdown inside an already-populated
context, it has no exit code, it is not journaled, and it cannot fail a run. The
subagents would report success and nothing would check.

So steps 4 and 7 are commands with a status that the orchestrator reads. The gate
is `check.py` — a per-sample byte comparison with a diff, exiting 0 only when
every sample matches. It cannot be talked around, because the model never writes
the exit code.

```cmd
python -I team-solve\check.py team-solve team-solve\test-output.log team-solve\test-status.txt
```

## Deviations from memdoor's workflow

The prompts are the experiment, so they are held word for word. These six things
are not:

1. **No marker protocol.** memdoor's ideators both `apply_patch` one shared
   `notes.md` at literal `<!-- proposal-a -->` / `<!-- proposal-b -->` markers,
   and the planner pads `notes.md` to 50 lines so two concurrent insertions do
   not collide. That machinery exists only because memdoor gives every step one
   `coder` file-editing agent. Here each ideator owns a file, so the race is gone
   and the padding requirement is dropped. The ledger discipline — one shared
   `notes.md` for the decision, review and repair — is kept.
2. **`check-samples.sh` → `check.py`.** A line-for-line port: same glob, same
   byte comparison, same `PASS`/`FAIL` with a unified diff, same
   `Samples: N; failures: M` summary, and it writes the log and status file that
   the original produced with shell redirection. It runs on Windows without a
   shell. One deliberate addition: a CRLF pair is normalised to LF before
   comparing, because a piped stdout on Windows carries CRLF while a sample
   checked out with LF endings carries LF — without that, a clone would fail
   every sample for a reason unrelated to the answer. Verified both ways: the
   sample solution exits 0, a wrong one exits nonzero with a diff.
3. **`{{.partition}}` → `runLabel`.** memdoor injects a partition name per
   sample; here it is an argument, so a stale `notes.md` from an earlier attempt
   is visibly stale.
4. **Timeouts.** `10m`/`5m` become `timeoutMs` on the `world.run` calls.
   `max_retries` has no analogue — the host retries provider errors itself.
5. **`python -I`** for both the checker and the generated solution. No effect on a
   stdlib-only solution; it just stops a planted `json.py` in the run directory
   from being imported.
6. **Review and repair are conditional on the gate.** memdoor runs them on every
   pass, including the green one, where they can only record "repair unnecessary".
   Measured below: 6.09M tokens, 20% of the run, buying nothing. The step-4 exit
   code already answers "did it fail?", so the two roles are asked only when it did.

Resume is a property of the host, not of this script: `world.run` calls are
journaled, so a resumed run replays finished steps without re-paying, and an
amended script reuses completed subagent work as a warm cache.

## Measured on one sample

Problem: count substrings of a string over `{a,b,c}`, `N ≤ 200000`, with equal
counts of each letter.

| run | wall | tokens | subagents | outcome |
|-----|------|--------|-----------|---------|
| unguarded (memdoor shape) | 18m 38s | 30,991,270 | 6 | 5/5 samples, both gates exit 0 |
| guarded | 0s (cache replay) | — | 4 | 5/5 samples, Manager and Repairer never dispatched |

Per-role tokens on the first run: Ideator A 9.12M, Ideator B 7.95M, Solver 4.01M,
Manager 4.76M, Planner 3.82M, Repairer 1.33M. The two ideators are ~55% of the
bill — that is the experiment, not waste. The guard removes 6.09M (Manager +
Repairer) on a green gate; on a failing gate it costs nothing extra.

Both runs had a green first gate, so the repair branch has never executed here.

## What this does not prove

The paper behind this method reports 9.8/10 against 9.6 for the authors' own
harness and 8.0 for a single model call, on 10 LiveCodeBench Hard problems with
five passes each, using Qwen3.8-27B over OpenRouter and hidden-test grading.

This repo reproduces the *behavior* on one public sample with a visible test set.
It cannot reproduce that score: one problem, five public samples, a different
model, and no held-out grading. Sample-based success has no way to catch a
solution that is tuned to the samples it can see.

## Layout

```
.zcode/workflows/team-solve.dwf.ts   the workflow definition
team-solve/task.md                   the problem statement
team-solve/tests/N.in, N.out         public samples
team-solve/check.py                  the gate
team-solve/proposals/                ideator output (generated)
examples/sample-solution.py          the solution the measured run produced
```

Generated files (`plan.md`, `notes.md`, `review.md`, `proposals/*.md`,
`solution.py`, `*.log`, `test-status.txt`) are gitignored.

## License

Apache 2.0, inherited from memdoor. See [LICENSE](LICENSE) and [NOTICE](NOTICE):
the role prompts and the behaviour of `check.py` come from memdoor's
`examples/workflows/team-solve`, Copyright 2026 Gregory Desvaux.
