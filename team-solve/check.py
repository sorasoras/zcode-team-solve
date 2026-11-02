"""Port of memdoor's check-samples.sh, so the gate runs without bash on Windows.

Runs solution.py against every public sample and compares stdout to the expected
output. Writes the transcript (and optionally the exit status) to disk, the way
the original `test` and `verify` command steps did with shell redirection.

usage: check.py <run-dir> [log-file] [status-file]

Exit status is 0 only when every sample passed, and is what decides the workflow.
"""

import difflib
import subprocess
import sys
from pathlib import Path


def normalise(data: bytes) -> bytes:
    """Drop the CR of a CRLF pair, so the comparison is newline-agnostic.

    A piped stdout on Windows carries CRLF while a sample checked out with
    LF endings carries LF. Comparing those verbatim fails every sample for a
    reason that has nothing to do with the answer.
    """
    return data.replace(b"\r\n", b"\n")


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("usage: check.py <run-dir> [log-file] [status-file]", file=sys.stderr)
        return 2

    run_dir = Path(argv[1])
    log_path = Path(argv[2]) if len(argv) > 2 else None
    status_path = Path(argv[3]) if len(argv) > 3 else None

    lines: list[str] = []

    def emit(text: str = "") -> None:
        lines.append(text)
        print(text, flush=True)

    inputs = sorted((run_dir / "tests").glob("*.in"))
    if not inputs:
        emit("FAIL: no sample inputs found")
        return finish(1, log_path, status_path, lines)

    failures = 0
    for input_path in inputs:
        expected_path = input_path.with_suffix(".out")
        label = f"tests/{input_path.name}"

        if not expected_path.is_file():
            emit(f"FAIL {label}: missing tests/{expected_path.name}")
            failures += 1
            continue

        with input_path.open("rb") as stdin:
            proc = subprocess.run(
                [sys.executable, "-I", "solution.py"],
                cwd=run_dir,
                stdin=stdin,
                capture_output=True,
            )

        if proc.returncode != 0:
            emit(f"FAIL {label}: solution exited unsuccessfully")
            stderr = proc.stderr.decode("utf-8", "replace").rstrip()
            if stderr:
                emit(stderr)
            failures += 1
            continue

        expected = normalise(expected_path.read_bytes())
        actual = normalise(proc.stdout)
        if expected == actual:
            emit(f"PASS {label}")
            continue

        emit(f"FAIL {label}: output differs")
        emit(
            "".join(
                difflib.unified_diff(
                    expected.decode("utf-8", "replace").splitlines(keepends=True),
                    actual.decode("utf-8", "replace").splitlines(keepends=True),
                    fromfile=f"expected/{expected_path.name}",
                    tofile=f"actual/{input_path.with_suffix('.actual').name}",
                )
            ).rstrip()
        )
        failures += 1

    emit(f"Samples: {len(inputs)}; failures: {failures}")
    return finish(0 if failures == 0 else 1, log_path, status_path, lines)


def finish(code: int, log_path: Path | None, status_path: Path | None, lines: list[str]) -> int:
    if log_path is not None:
        log_path.parent.mkdir(parents=True, exist_ok=True)
        log_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    if status_path is not None:
        status_path.parent.mkdir(parents=True, exist_ok=True)
        status_path.write_text(f"{code}\n", encoding="utf-8")
    return code


if __name__ == "__main__":
    sys.exit(main(sys.argv))
