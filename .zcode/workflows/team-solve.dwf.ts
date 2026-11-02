/* zcode-workflow
description: "team-solve sample pass (guarded review): a seven-role GVS5H solve
  — planner, two independent ideators, solver, reviewer, repairer, strict
  verifier — over a problem directory whose Python sample checker decides
  success by exit code. Fresh context per role, every handoff a file on disk, at
  most one repair round, and review/repair dispatched only when the first sample
  gate fails."
whenToUse: "Use to solve one competitive-programming-style problem that already
  ships public samples: a directory containing task.md, tests/N.in +
  tests/N.out, and check.py. Produces solution.py, plan.md, notes.md,
  proposals/a.md + b.md, and a run report with both gate transcripts; throws
  when the strict final check exits nonzero. Point runDir at a directory laid
  out like the repo's team-solve/. Not for multi-problem sweeps, and not a
  substitute for hidden-test grading — it only proves the public samples pass."
args:
  runDir:
    type: string
    description: "Directory (relative to the project, or absolute) holding task.md,
      tests/*.in and *.out, check.py, and every generated artifact: plan.md,
      notes.md, proposals/a.md, proposals/b.md, solution.py, review.md and the
      gate logs."
    required: true
    default: team-solve
  runLabel:
    type: string
    description: Identifier the planner stamps into notes.md for this run. Stands in
      for memdoor's {{.partition}}; change it per attempt so a notes.md left by
      an earlier attempt is visibly stale.
    required: true
    default: sample-run-1
  problem:
    type: string
    description: Human-readable problem name, copied into the run report's `problem`
      field. Keep it in sync with the name in task.md.
    required: true
    default: Longest Balanced Substring Count
  gateTimeoutMs:
    type: number
    description: Timeout for each of the two sample-check gates, in milliseconds.
      Raise it for slow solutions (large N, brute force in the reference).
    required: true
    default: 300000
*/
/**
 * GVS5H team-solve, ported from memdoor/examples/workflows/team-solve.
 *
 * Same seven roles, same prompt wording, same file handoffs, fresh context per
 * role, and the sample checker — not a model's claim — decides success.
 *
 * Three deliberate adaptations:
 *  1. Every path is rooted at `args.runDir` (default `team-solve/`), so a run is
 *     self-contained and the same definition serves any problem directory.
 *  2. The ideators write `proposals/a.md` and `proposals/b.md` instead of both
 *     patching one shared `notes.md` at literal markers. memdoor needed the
 *     marker protocol because its `coder` agent could only `apply_patch` a
 *     single file, and the planner had to pad notes.md to 50 lines so two
 *     concurrent insertions would not collide. One file per ideator removes
 *     the race and leaves the ledger discipline (shared notes.md for decisions,
 *     review, repair) that the paper credits.
 *  3. Review and repair run only when the sample gate failed. memdoor runs them
 *     always, and they cost 6.1M tokens on a green run to record that nothing
 *     was wrong. The exit code already answers that question.
 *
 * Everything else is held: the planner's output, the no-chat rule, at most one
 * repair round, and the two command steps becoming `world.run` gates whose exit
 * code is the verdict.
 */

const runDir = typeof args.runDir === "string" ? args.runDir : "team-solve";
const runLabel = typeof args.runLabel === "string" ? args.runLabel : "sample-run-1";
const problem = typeof args.problem === "string" ? args.problem : "Longest Balanced Substring Count";
const gateTimeoutMs = typeof args.gateTimeoutMs === "number" ? args.gateTimeoutMs : 300_000;

const HONEST =
  " Work only from the files on disk and never rely on prior conversation." +
  " If an instruction is impossible or contradicts another, say so plainly instead of working around it.";

/** One line for a gate: its exit code plus the checker's own summary line. */
function summarise(gate: { exitCode: number; stdout: string }): string {
  const lines = gate.stdout.trim().split("\n");
  return `exit ${gate.exitCode}: ${lines[lines.length - 1] ?? "(no output)"}`;
}

// --- 1. plan ---------------------------------------------------------------
phase("Plan the approach");

await agent("Planner", { system: `You plan solves and write only files on disk.${HONEST}` }).ask(
  `You are the planner in a ledger-based team with fresh contexts. Read ${runDir}/task.md
from disk. Write ${runDir}/plan.md with the decomposition, correctness requirements,
two or three candidate algorithms and their time/space complexity, and
instructions for independent ideators, solver, and reviewer. Do not solve
by changing ${runDir}/task.md or ${runDir}/tests. Initialize ${runDir}/notes.md for THIS run, with a title,
the run identifier ${runLabel}, and separate headings for Proposal A,
Proposal B, Solver decision, Review, and Repair.
Verify both files exist. Communicate only through these on-disk files;
do not rely on prior conversation or delegate agents yourself.`,
);

// --- 2. ideate (parallel, independent, fresh contexts) ---------------------
phase("Draw two independent proposals");

const [proposalA, proposalB] = await Promise.all([
  agent("Ideator A", { system: `You produce one provable algorithm, independently.${HONEST}` }).ask(
    `You are independent ideator A in a fresh context. Read ${runDir}/task.md, ${runDir}/plan.md,
and the current ${runDir}/notes.md. Develop one concrete proposal: the most direct
algorithm you can prove meets the stated constraints. Include pseudocode,
the invariant, correctness reasoning, complexity, and edge cases. Write
your proposal to ${runDir}/proposals/a.md; create the file if it does not exist.
Never rewrite ${runDir}/notes.md or modify ${runDir}/solution.py. The other ideator
writes ${runDir}/proposals/b.md concurrently; do not touch it.
Verify your proposal is on disk. Do not spawn other agents or rely on chat context.`,
  ),
  agent("Ideator B", { system: `You produce a different-family algorithm, independently.${HONEST}` }).ask(
    `You are independent ideator B in a fresh context. Read ${runDir}/task.md, ${runDir}/plan.md,
and the current ${runDir}/notes.md. Develop one concrete alternative proposal
from a different family of technique than the most obvious one (if the obvious
approach is dynamic programming, try greedy, math, or a data structure, and so
on), and compare its tradeoffs with the obvious approach. Include pseudocode,
correctness reasoning, complexity, and off-by-one/overflow checks. Write
your proposal to ${runDir}/proposals/b.md; create the file if it does not exist.
Never rewrite ${runDir}/notes.md or modify ${runDir}/solution.py. The other ideator
writes ${runDir}/proposals/a.md concurrently; do not touch it.
Verify your proposal is on disk. Do not spawn other agents or rely on chat context.`,
  ),
]);

log(`Proposals returned (${proposalA.length} / ${proposalB.length} chars)`);

// --- 3. solve --------------------------------------------------------------
phase("Write the solution");

await agent("Solver", { system: `You pick an approach and write the deliverable program.${HONEST}` }).ask(
  `You are the solver in a fresh context. Read ${runDir}/task.md, ${runDir}/plan.md, and ${runDir}/notes.md
from disk, plus both proposals at ${runDir}/proposals/a.md and ${runDir}/proposals/b.md.
Select and justify an approach in the Solver decision section of ${runDir}/notes.md, with a brief
correctness argument and complexity. Write the complete ${runDir}/solution.py using Python's standard library,
reading stdin and printing only the answer. Meet the stated constraints.
Run ${runDir}/solution.py on at least one sample to verify it executes. Do not change
the problem or sample tests. The downstream command runs all samples and
the manager owns any repair round. Do not spawn agents or use chat context.`,
);

// --- 4. test (command step -> world.run; never fails the run) --------------
phase("Run the public samples");

const firstGate = await world.run(
  "python",
  [
    "-I",
    `${runDir}/check.py`,
    runDir,
    `${runDir}/test-output.log`,
    `${runDir}/test-status.txt`,
  ],
  { timeoutMs: gateTimeoutMs },
);
log(`Initial sample-test exit status: ${firstGate.exitCode}`);

// --- 5-6. review and repair, only when the gate failed --------------------
// memdoor runs these two unconditionally (the prompts handle the already-green
// case by recording "repair unnecessary"), which cost 6.1M tokens on a run that
// never needed either. The gate's exit code already decides that question, so
// ask only when there is something to diagnose. On a green run the ledger's
// Review section stays empty and the report says so.
const needsRepair = firstGate.exitCode !== 0;
if (needsRepair) {
  phase("Review the captured results");

  await agent("Manager", { system: `You review evidence on disk and never edit the deliverable.${HONEST}` }).ask(
    `You are the manager/reviewer in a fresh context. Read ${runDir}/task.md, ${runDir}/notes.md, ${runDir}/solution.py,
${runDir}/test-status.txt, and ${runDir}/test-output.log from disk. Inspect the actual captured
results, not a previous agent's claims. Write ${runDir}/review.md describing the result and append the review
to ${runDir}/notes.md. If the status is nonzero, analyze failing samples and append concrete repair
instructions to ${runDir}/notes.md for the next fresh worker. Do not change ${runDir}/solution.py yourself.
Do not alter test data or bypass comparison failures. Verify the review is on disk.
There is exactly one conditional repair round followed by a mandatory strict
test command; do not claim overall completion before that final command passes.`,
  );

  phase("Repair if the samples failed");

  await agent("Repairer", { system: `You make the smallest correct fix to the deliverable.${HONEST}` }).ask(
    `You are the single repair worker in a fresh context. Read ${runDir}/test-status.txt, ${runDir}/review.md,
and ${runDir}/notes.md from disk. If the initial test status is zero, leave ${runDir}/solution.py unchanged
and report that repair was unnecessary. Otherwise read ${runDir}/task.md, ${runDir}/plan.md, ${runDir}/solution.py,
${runDir}/test-output.log, and the relevant samples, then correct ${runDir}/solution.py using the manager's
instructions. Append a concise repair explanation to ${runDir}/notes.md.
Run ${runDir}/solution.py on a failing sample to verify the change, but do not start
another repair round or change any test inputs/expected outputs. The next strict
command alone determines workflow success. Do not spawn agents or rely on chat history.`,
  );
} else {
  log(`Sample gate green (exit 0): skipping review and repair, there is nothing to diagnose.`);
}

// --- 7. verify (strict; this exit code is the verdict) ---------------------
phase("Verify against every sample");

const finalGate = await world.run(
  "python",
  ["-I", `${runDir}/check.py`, runDir, `${runDir}/final-test-output.log`],
  { timeoutMs: gateTimeoutMs },
);
log(`Final strict sample-test exit status: ${finalGate.exitCode}`);

try {
  artifact.file("solution", `${runDir}/solution.py`, { title: "solution.py" });
} catch (error) {
  log(`No solution.py to publish: ${error}`);
}

artifact.markdown(
  "run-report",
  [
    "# Team-solve run",
    "",
    `- Directory: ${runDir}`,
    `- Run identifier: ${runLabel}`,
    `- Initial sample gate: ${summarise(firstGate)}`,
    `- Final strict gate: ${summarise(finalGate)}`,
    `- Review and repair: ${needsRepair ? "ran, the initial gate failed" : "skipped, the initial gate was green"}`,
    "",
    "## Initial transcript",
    "",
    "```",
    firstGate.stdout.trim(),
    "```",
    "",
    "## Final transcript",
    "",
    "```",
    finalGate.stdout.trim(),
    "```",
  ].join("\n"),
  { title: "Run report" },
);

report({
  problem: problem,
  runDir: runDir,
  initial: summarise(firstGate),
  final: summarise(finalGate),
  passed: finalGate.exitCode === 0,
  reviewed: needsRepair,
});

if (finalGate.exitCode !== 0) {
  throw new Error(
    `Team-solve failed: the final sample check exited ${finalGate.exitCode}. See ${runDir}/final-test-output.log.`,
  );
}

return `Solution passes every public sample; verify gate exited 0.`;
