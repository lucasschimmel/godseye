"""Local Hermes setup commands. No provider, task execution or model authority."""

import json
import os
from pathlib import Path
import sys
from hermes_catalog import COMMIT, VERSION, catalog, exact
from hermes_files import (
    DurabilityUncertain, digest, document, exclusive, private_directory,
    read_json, runtime_root, write_new,
)
import hermes_profiles as profiles

MAX_REQUEST_BYTES = 16384
ACTIONS = {
    "catalog": {"workspace", "action"},
    "prepare": {"workspace", "action", "projectId", "environmentId", "role", "model"},
    "profiles": {"workspace", "action"},
    "inspect": {"workspace", "action", "profileId", "revision"},
    "verify": {"workspace", "action", "profileId", "revision"},
    "promote": {"workspace", "action", "profileId", "revision", "expectedRevision"},
}


def owned_root(workspace: Path) -> Path:
    root = runtime_root(workspace)
    private_directory(root)
    marker = root / ".godseye-hermes.json"
    expected = {"schema": 1, "workspace": str(workspace),
                "workspaceHash": digest(str(workspace).encode()), "ownerUid": os.getuid()}
    if not marker.exists():
        if list(root.iterdir()):
            raise RuntimeError("Unmarked Hermes runtime cannot be adopted")
        try:
            write_new(marker, document(expected))
        except FileExistsError:
            pass  # Another installer may have published the identical workspace marker.
    if read_json(marker) != expected:
        raise RuntimeError("Hermes runtime workspace ownership differs")
    return root


def execute(payload: dict) -> dict:
    """Validate a public request before accessing any profile or private runtime path."""
    if not isinstance(payload, dict):
        raise ValueError("Hermes setup request must be an object")
    action = payload.get("action")
    if not isinstance(action, str) or action not in ACTIONS or not set(payload) <= ACTIONS[action]:
        raise ValueError("Unsupported Hermes setup command or fields")
    raw_workspace = payload.get("workspace")
    if not isinstance(raw_workspace, str) or len(raw_workspace) > 4096:
        raise ValueError("Explicit local workspace is required")
    workspace = Path(raw_workspace)
    if not workspace.is_absolute() or workspace.resolve(strict=True) != workspace:
        raise ValueError("A canonical local workspace is required")
    if action == "prepare":
        profiles.binding(workspace, payload)
    elif action not in ("catalog", "profiles"):
        profiles.identifier(payload.get("profileId"))
        if payload.get("revision") is not None:
            profiles.revision_id(payload["revision"])
        if action == "promote":
            profiles.revision_id(payload.get("revision"))
            profiles.revision_id(payload.get("expectedRevision"))
    if action == "catalog":
        registry, _ = catalog(workspace)
        return {**registry, "hermesCommit": COMMIT, "runEnabled": False}
    root = owned_root(workspace) / "profiles"
    with exclusive(root):
        if action == "prepare":
            return profiles.prepare(root, workspace, payload)
        if action == "profiles":
            entries = [profiles.view(path, workspace) for path in profiles.list_entries(root)]
            return {"profiles": entries, "runEnabled": False, "hermesVersion": VERSION}
        if action == "promote":
            return profiles.promote(root, workspace, payload)
        result = profiles.inspect(root, workspace, payload)
        if action == "verify":
            result["verified"] = True
        return result


def main() -> None:
    os.umask(0o077)
    if os.getuid() == 0:
        raise RuntimeError("Local Hermes preparation requires a non-root account")
    raw = sys.stdin.buffer.read(MAX_REQUEST_BYTES + 1)
    if len(raw) > MAX_REQUEST_BYTES:
        raise ValueError("Hermes setup request exceeds its bound")
    print(json.dumps(execute(json.loads(raw))))


if __name__ == "__main__":
    try:
        main()
    except Exception as error:
        code = "DURABILITY_UNCERTAIN" if isinstance(error, DurabilityUncertain) else "SETUP_REFUSED"
        print(json.dumps({"error": {"code": code, "message":
              "Local Hermes setup was refused; inspect retained state before retrying."}}))
        sys.exit(1)
