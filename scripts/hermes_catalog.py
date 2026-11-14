"""Reviewed first-party Hermes bootstrap catalog, independent of runtime homes."""

from pathlib import Path
import re
from hermes_files import digest, read_bytes, read_json

VERSION = "0.23.1"
COMMIT = "3b421578588243f920886e6fe79a6faa87ea026e"
ROLES = ("operations", "security", "research-marketing")
MAX_SKILLS = 16
MAX_FILES = 16
MAX_SKILL_BYTES = 65536
NAME = re.compile(r"[a-z][a-z0-9-]{0,63}\Z")
SEMVER = re.compile(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\Z")
HASH = re.compile(r"[a-f0-9]{64}\Z")


def exact(value: object, fields: set[str]) -> dict:
    if not isinstance(value, dict) or set(value) != fields:
        raise ValueError("Unexpected Hermes document fields")
    return value


def catalog(workspace: Path) -> tuple[dict, dict[str, bytes]]:
    """Verify every declared file and refuse unreviewed additions or path aliases."""
    root = workspace / "infra/hermes"
    value = exact(read_json(root / "catalog.json", False), {"schema", "hermesVersion", "roles", "skills"})
    if value["schema"] != 1 or value["hermesVersion"] != VERSION or value["roles"] != list(ROLES):
        raise ValueError("Unsupported Hermes catalog policy")
    entries = value["skills"]
    if not isinstance(entries, list) or not 1 <= len(entries) <= MAX_SKILLS:
        raise ValueError("Invalid Hermes skill count")
    files: dict[str, bytes] = {}
    seen: set[str] = set()
    source_files: set[Path] = set()
    for entry in entries:
        exact(entry, {"id", "version", "description", "provenance", "hermesVersion", "files"})
        name, version = entry["id"], entry["version"]
        if not isinstance(name, str) or not NAME.fullmatch(name) or name in seen:
            raise ValueError("Invalid or duplicate Hermes skill identity")
        if not isinstance(version, str) or not SEMVER.fullmatch(version):
            raise ValueError("Invalid Hermes skill version")
        if entry["provenance"] != "first-party:godseye" or entry["hermesVersion"] != VERSION:
            raise ValueError("Unreviewed Hermes skill provenance or compatibility")
        if not isinstance(entry["description"], str) or not 1 <= len(entry["description"]) <= 512:
            raise ValueError("Invalid Hermes skill description")
        hashes = entry["files"]
        if not isinstance(hashes, dict) or not 1 <= len(hashes) <= MAX_FILES or "SKILL.md" not in hashes:
            raise ValueError("Invalid Hermes skill file manifest")
        seen.add(name)
        for relative, expected in hashes.items():
            # This preparation catalog intentionally permits documentation only, no executable assets.
            if not isinstance(relative, str) or not re.fullmatch(r"[A-Za-z0-9_-]+\.md", relative):
                raise ValueError("Unsafe Hermes skill document path")
            if not isinstance(expected, str) or not HASH.fullmatch(expected):
                raise ValueError("Invalid Hermes skill digest")
            path = root / "skills" / name / version / relative
            content = read_bytes(path, False).decode("utf-8", errors="strict").replace("\r\n", "\n").encode()
            if len(content) > MAX_SKILL_BYTES or digest(content) != expected:
                raise ValueError("Hermes skill differs from the reviewed version")
            if relative == "SKILL.md":
                sections = content.decode().split("---\n", 2)
                if len(sections) != 3 or sections[0] or f"name: {name}" not in sections[1].splitlines():
                    raise ValueError("Hermes skill frontmatter identity differs")
            files[f"skills/{name}/{relative}"] = content
            source_files.add(path)
    discovered: set[Path] = set()
    for path in (root / "skills").rglob("*"):
        if path.is_symlink():
            raise ValueError("Linked Hermes catalog entry")
        if path.is_file():
            discovered.add(path)
        elif not path.is_dir():
            raise ValueError("Unsupported Hermes catalog entry")
        if len(discovered) > MAX_SKILLS * MAX_FILES:
            raise ValueError("Hermes catalog exceeds its bound")
    if discovered != source_files:
        raise ValueError("Hermes catalog contains unreviewed documents")
    return value, files


def configuration(model: str | None) -> dict:
    """No tools or model admission: setup metadata cannot enable an agent run."""
    return {
        "model": {"provider": "openai", "default": model or "UNCONFIGURED"},
        "platform_toolsets": {"cli": [], "api_server": []},
        "agent": {"max_turns": 1, "coding_context": "off"},
        "skills": {"project_discovery": False, "trusted_project_dirs": [], "external_dirs": [],
                   "auto_load": [], "inline_shell": False, "template_vars": False, "write_approval": True},
        "curator": {"enabled": False},
        "memory": {"memory_enabled": False, "user_profile_enabled": False, "nudge_interval": 0},
        "auxiliary": {"background_review": {"enabled": False}, "title_generation": {"enabled": False},
                      "model_upgrade_enabled": False},
        "compression": {"enabled": False},
        "terminal": {"home_mode": "profile", "env_passthrough": []},
        "webapp": {"enabled": False},
        "mcp_servers": {},
    }
