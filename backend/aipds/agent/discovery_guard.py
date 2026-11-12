# backend/aipds/agent/discovery_guard.py — Discovery's write-scope decisions.
#
# **Why this file exists (a defect found 2026-08-16).** The Discovery agent went ahead and built a
# prototype in the workspace as `prototype/index.html`. Building and hosting are the Prototypes
# tab's job, and Discovery ends at writing the spec (the "Prototypes" section of
# discovery-config/CLAUDE.md), but that rule was **prose only**, and what the prose forbade was
# build *commands*: npm install / npm run dev / starting a subprocess / choosing a port.
# A single self-contained HTML page needs none of those — the agent's own report
# ("API 키·패키지 설치·외부 통신이 모두 불필요합니다", i.e. "no API key, package install, or
# external communication is needed") is itself proof that it satisfied every enumerated clause.
# **Enumeration invites the item that was left out.**
#
# The SDK itself explains why there was no means of enforcement. Discovery runs with
# `bypassPermissions` (claude_driver.DEFAULT_PERMISSION_MODE), and
# _get_can_use_tool_shadowed_warning in claude_agent_sdk/types.py says:
#
#   "can_use_tool will not be invoked: permission_mode 'bypassPermissions'
#    auto-approves every tool call ... To gate every tool call, use a
#    PreToolUse hook instead."
#
# This module is the decision part of that hook. The wiring is in claude_driver._on_pre_tool_use.
#
# **It is language-neutral.** It returns only the denied target (a path or a command fragment), and
# the wording is owned in two copies by agent/prompts.py — that file's header convention is that
# text the model reads must be in the project language, and putting Korean here would leak into
# English projects.
#
# **For Bash this is narrowing, not sealing.** Unlike the path-based Write/Edit decisions, Bash is
# arbitrary code execution, so a denylist cannot block every bypass (e.g. opening a file with
# `python3 -c`). What is blocked here is the observed path and its close neighbors. Sealing it
# fully would mean removing Bash from Discovery altogether (Read/Glob/Grep are enough for rule
# exploration), but that is a separate decision and was not made.
from __future__ import annotations

import os
import posixpath
import re
from pathlib import PurePosixPath

from aipds.agent_home import SETTINGS_IN_COMMAND
from aipds.pathsafe import workspace_relative
from aipds.proto import layout

#: The only root Discovery may write to. It is the definition of an artifact itself (Workspace.list_artifacts
#: treats the same subtree as project artifacts).
DOCS_ROOT = "aiplc-docs"

#: File-writing tools this gate looks at. Must be the same set as claude_driver._FILE_TOOLS
#: — if a tool is added on only one side, that tool is observed but not blocked.
WRITE_TOOLS = frozenset({"Write", "Edit", "MultiEdit"})

#: Notebook editing. It is a write tool, but its path key is different (`notebook_path`) and it does
#: not produce artifacts, so it is not published (PostToolUse) — it only gets the same write-scope
#: decision. Leaving it out would be a bypass for writing outside `aiplc-docs/`.
NOTEBOOK_TOOL = "NotebookEdit"


def tool_write_path(name: str, tool_input: dict) -> str | None:
    """The path a write tool targets. None if it is not a write tool."""
    if name in WRITE_TOOLS:
        return tool_input.get("file_path")
    if name == NOTEBOOK_TOOL:
        return tool_input.get("notebook_path")
    return None


def write_denial(path: str | None, workspace: str) -> str | None:
    """The denied path if outside `aiplc-docs/`, None if allowed.

    Calls whose path is unknown (no file_path) are **allowed**. Denying with nothing to base the
    decision on would let one tool shape we do not know about block the whole turn — this gate's
    failure direction must be "pass", and PostToolUse is already doing the observation.
    """
    if not path or not isinstance(path, str):
        return None
    rel = workspace_relative(path, workspace)
    if rel is None:
        # Workspace escape. It cannot be made relative, so the original is reported as-is.
        return path
    # This must be a segment comparison, not a prefix **string** comparison —
    # "aiplc-docs-backup/x.md" passes startswith("aiplc-docs").
    if PurePosixPath(rel).parts[:1] == (DOCS_ROOT,):
        return None
    return rel


#: File names inside `aiplc-docs/` that the web app owns. The survey aggregate is regenerated and
#: overwritten by the web app every time, so anything the agent writes there disappears on the next
#: regeneration; the change history is appended by build sessions and read as input by the next
#: build session, so if the agent edits it, the builder's belief about "what was built" changes —
#: for the same reason as the prototype-side gate, this is blocked by a hook, not prose. Deciding by
#: name works because these names are used only by the web app (they are not in the upstream
#: rules). Files whose names could collide are not put here.
WEB_OWNED_NAMES = frozenset({layout.SURVEY_AGGREGATE, layout.CHANGE_HISTORY,
                             layout.DEMO_NOTES})


def web_owned_denial(path: str | None, workspace: str) -> str | None:
    """The denied path if it is a web-owned `aiplc-docs/` file, otherwise None.

    It is decided separately because its wording must differ from `write_denial`: that one says
    "write inside aiplc-docs/", while here the path is already inside aiplc-docs/ — giving the same
    wording makes the model retry the same path (see the defect record in agent/prompts.write_outside_docs).
    """
    if not path or not isinstance(path, str):
        return None
    rel = workspace_relative(path, workspace)
    if rel is None:
        return None
    parts = PurePosixPath(rel).parts
    if parts[:1] == (DOCS_ROOT,) and parts[-1] in WEB_OWNED_NAMES:
        return rel
    return None


#: Audit log where the web app records user input verbatim (aipds/audit_log). Even on the first turn,
#: the web app writes it before the agent does.
AUDIT_KEY = f"{DOCS_ROOT}/audit.md"


def audit_overwrite_denial(tool: str, path: str | None, workspace: str) -> str | None:
    """The denied path if Write would overwrite an existing audit.md wholesale, otherwise None.

    The agent has been creating audit.md fresh with Write on its first turn (measured on ws-e and
    test5). Now the web app creates that file first and records user input verbatim in it, so
    overwriting it wholesale erases that record — the contract (discovery-config/CLAUDE.md) already
    says "append with Edit", but this enforces it with a hook rather than prose. Edit is not blocked.
    """
    if tool != "Write" or not path or not isinstance(path, str):
        return None
    rel = workspace_relative(path, workspace)
    if rel != AUDIT_KEY:
        return None
    return rel if os.path.isfile(os.path.join(workspace, rel)) else None


#: Contents inside quotes. Removed before redirection/command detection — reading the `>` in
#: `echo "a > b"` as a redirection would block a legitimate command that writes a document, which
#: creates pressure to turn the gate off (false positives shorten a gate's life).
_QUOTED = re.compile(r"'[^']*'|\"[^\"]*\"")

#: Package managers. The invocation itself is blocked rather than enumerating subcommands — Discovery
#: writes markdown, so it never needs a package manager, and the lesson of this defect is that
#: enumeration invites the item that was left out.
_PKG = re.compile(r"(?:^|[;&|(]\s*|\s)(npm|npx|pnpm|yarn|bun)\b")

#: Dev servers and runtime serving. `npx serve` and the like are already caught by _PKG above, so a
#: bare `serve` is not included here — including it would catch every file name or body containing "serve".
_SERVERS = re.compile(
    r"\b(http\.server|SimpleHTTPServer|uvicorn|gunicorn|flask\s+run"
    r"|php\s+-S|vite|next\s+(?:dev|start))\b")

#: Targets that are devices, not files. Excluded from the redirection check.
_DEVICES = ("/dev/null", "/dev/stdout", "/dev/stderr")

#: A heredoc opener: `<<EOF`, `<<-EOF`, `<<'EOF'`, `<<"EOF"`. Group 2 is the delimiter word.
_HEREDOC = re.compile(r"<<-?\s*(['\"]?)([A-Za-z_][A-Za-z0-9_]*)\1")

#: A heredoc fed to a shell, whose body is commands rather than document text.
_SHELL_HEREDOC = re.compile(r"\b(?:ba|z|da|k)?sh\b(?:\s+-[a-z]+)*\s*<<")

#: One step of the shell walk in `bash_write_denial`, in source order: a subshell boundary, a `cd`
#: in command position, a redirection target, or a tee target.
_SHELL_STEP = re.compile(
    r"(?P<open>\()|(?P<close>\))"
    r"|(?P<cd>(?:^|(?<=[;&|(\n]))\s*cd\b(?:[ \t]+(?P<cd_arg>[^\s;|&<>()]+))?)"
    r"|(?<![0-9&<])>{1,2}\s*(?!&)(?P<redir>[^\s;|&<>()]+)"
    r"|\btee\b\s+(?:-a\s+)?(?P<tee>[^\s;|&<>()]+)")


def bash_denial(command: str | None) -> str | None:
    """The denied fragment for a package manager or a server start, otherwise None.

    This is a deny**list** (not an allowlist). Discovery has a legitimate path of exploring rule
    files with `ls`/`grep`/`find`, and an allowlist would block all of that. File creation through
    the shell is decided separately by `bash_write_denial`, because the model needs a different
    reason for it: a refused document write that is told "this builds a prototype" looks for a
    build it never started instead of fixing the path.
    """
    if not command or not isinstance(command, str):
        return None
    # Decide on a copy with quoted contents and heredoc bodies removed. The original is not
    # reported — the fragment caught below is what gets named.
    scrubbed = _QUOTED.sub(" ", _strip_heredoc_bodies(command))

    pkg = _PKG.search(scrubbed)
    if pkg:
        return pkg.group(1)

    server = _SERVERS.search(scrubbed)
    if server:
        return server.group(1)
    return None


def bash_write_denial(command: str | None, workspace: str | None = None) -> str | None:
    """The first redirection/tee target outside `aiplc-docs/`, otherwise None.

    **Targets resolve against the shell's directory at that point, not the workspace.** Observed
    (a workshop run): the agent ran `cd <workspace>/aiplc-docs; cat >> discovery/<doc>.md`. Read
    as workspace-relative, `discovery/<doc>.md` falls outside `aiplc-docs/` and a legitimate
    document append was refused. So `cd` steps are followed in order, and absolute targets are made
    workspace-relative with `workspace` (without it they cannot be placed and are refused).

    A directory this cannot follow (`cd` with no argument, `~`, `-`, a variable, a quoted path)
    falls back to the workspace — the same reading as before `cd` was followed.
    """
    if not command or not isinstance(command, str):
        return None
    scrubbed = _QUOTED.sub(" ", _strip_heredoc_bodies(command))
    cwd: str | None = "."          # workspace-relative; None = unknown, _OUTSIDE = left the workspace
    stack: list[str | None] = []   # cwd saved at each "(" — a subshell's cd ends at ")"
    for m in _SHELL_STEP.finditer(scrubbed):
        if m.group("open"):
            stack.append(cwd)
        elif m.group("close"):
            if stack:
                cwd = stack.pop()
        elif m.group("cd") is not None:
            cwd = _follow_cd(cwd, m.group("cd_arg"), workspace)
        else:
            target = m.group("redir") or m.group("tee")
            if target in _DEVICES:
                continue
            if not _inside_docs(target, cwd, workspace):
                return target
    return None


#: The marker that left the workspace (`cd /tmp`, `cd ..`). Relative writes from there are outside.
_OUTSIDE = "\0outside"


def _follow_cd(cwd: str | None, arg: str | None, workspace: str | None) -> str | None:
    if not arg or arg in ("~", "-") or arg.startswith("~") or "$" in arg or "`" in arg:
        return None
    if arg.startswith("/"):
        rel = workspace_relative(arg, workspace) if workspace else None
        return _OUTSIDE if rel is None else (rel or ".")
    if cwd == _OUTSIDE:
        return _OUTSIDE
    joined = posixpath.normpath(posixpath.join(cwd or ".", arg))
    return _OUTSIDE if joined == ".." or joined.startswith("../") else joined


def _inside_docs(target: str, cwd: str | None, workspace: str | None) -> bool:
    if target.startswith("/"):
        rel = workspace_relative(target, workspace) if workspace else None
        if rel is None:
            return False
    else:
        if cwd == _OUTSIDE:
            return False
        rel = posixpath.normpath(posixpath.join(cwd or ".", target))
        if rel == ".." or rel.startswith("../"):
            return False
    # A segment comparison, not a string prefix ("aiplc-docs-backup/x" is outside).
    return PurePosixPath(rel).parts[:1] == (DOCS_ROOT,)


def _strip_heredoc_bodies(command: str) -> str:
    """The command with heredoc bodies removed; the line that opens each heredoc stays.

    A body is document text, not shell: a markdown quote (`> note`) in it read as a redirection,
    and an apostrophe in it paired with a quote lines later, hiding real commands. The opening line
    keeps its redirection, so `cat <<EOF > app.js` is still decided by its target. A body fed to
    a shell (`bash <<EOF`) is commands, not text, so it is kept and checked like any other line.
    """
    out: list[str] = []
    pending: list[str] = []
    for line in command.split("\n"):
        if pending:
            if line.strip() == pending[0]:
                pending.pop(0)
            continue
        out.append(line)
        if not _SHELL_HEREDOC.search(line):
            pending.extend(m.group(2) for m in _HEREDOC.finditer(line))
    return "\n".join(out)


def settings_denial(command: str | None) -> str | None:
    """The fragment if the command touches a CLI settings file, otherwise None.

    Redirections outside the workspace are already blocked by `bash_denial`, but it does not look at
    `cp`, `sed -i`, or interpreters. Settings files have fixed names, so they are blocked by name (agent_home.SETTINGS_IN_COMMAND).
    """
    if not command or not isinstance(command, str):
        return None
    match = SETTINGS_IN_COMMAND.search(_QUOTED.sub(" ", command))
    return match.group(0) if match else None
