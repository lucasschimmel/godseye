"""Immutable, explicitly promoted Hermes setup snapshots; never an execution broker."""

import os
from pathlib import Path
import re
import tempfile
import uuid
from hermes_catalog import COMMIT, HASH, ROLES, VERSION, catalog, configuration, exact
from hermes_files import (
    digest, document, existing_directory, private_directory, read_bytes, read_json, replace_json,
    sync_directory, write_new,
)

MAX_PROFILES = 64
MAX_REVISIONS = 32
MAX_INTERRUPTED = 8
MODEL = re.compile(r"[A-Za-z0-9][A-Za-z0-9._:-]{0,127}\Z")
ROLE_PURPOSE = {
    "operations": "Prepare scoped deployment, service health and job observations for the owner.",
    "security": "Prepare evidence-based findings about owned applications; active checks need later grants.",
    "research-marketing": "Prepare source-linked research and marketing drafts; publication needs later approval.",
}
BINDING_FIELDS = {"schema", "profileId", "workspaceHash", "projectId", "environmentId", "role", "binding"}
IDENTITY_FIELDS = BINDING_FIELDS | {"hermesVersion", "hermesCommit", "provider", "model", "skills"}


def identifier(value: object) -> str:
    if not isinstance(value, str) or str(uuid.UUID(value)) != value:
        raise ValueError("A canonical UUID is required")
    return value


def revision_id(value: object) -> str:
    if not isinstance(value, str) or not HASH.fullmatch(value):
        raise ValueError("An exact revision digest is required")
    return value


def binding(workspace: Path, payload: dict) -> dict:
    project = identifier(payload.get("projectId"))
    environment = identifier(payload.get("environmentId"))
    role = payload.get("role")
    if role not in ROLES:
        raise ValueError("Unsupported Hermes profile role")
    workspace_hash = digest(str(workspace).encode())
    name = f"godseye:{workspace_hash}:{project}:{environment}:{role}"
    return {"schema": 1, "profileId": str(uuid.uuid5(uuid.NAMESPACE_URL, name)),
            "workspaceHash": workspace_hash, "projectId": project,
            "environmentId": environment, "role": role, "binding": "declared-local"}


def recipe(workspace: Path, payload: dict) -> tuple[dict, dict[str, bytes]]:
    identity = binding(workspace, payload)
    model = payload.get("model")
    if model is not None and (not isinstance(model, str) or not MODEL.fullmatch(model)):
        raise ValueError("Invalid OpenAI model identifier")
    registry, files = catalog(workspace)
    identity.update({"hermesVersion": VERSION, "hermesCommit": COMMIT,
                     "provider": "openai", "model": model,
                     "skills": [{"id": entry["id"], "version": entry["version"],
                                 "provenance": entry["provenance"], "files": entry["files"]}
                                for entry in registry["skills"]]})
    soul = ("# G.O.D.S.E.Y.E local setup\n\n"
            f"Project: {identity['projectId']}\nEnvironment: {identity['environmentId']}\n"
            f"Role: {identity['role']}\n\n"
            f"Purpose: {ROLE_PURPOSE[identity['role']]}\n\n"
            "This identity is a local declaration. No project admission, execution grant,\n"
            "budget or external authority has been issued. Report preparation only.\n"
            "Do not execute commands, publish, fetch private data, learn or promote skills.\n")
    files.update({"config.yaml": document(configuration(model)), "SOUL.md": soul.encode(),
                  ".no-bundled-skills": b"", "identity.json": document(identity)})
    manifest = {"schema": 1, "identity": identity,
                "files": {name: digest(content) for name, content in sorted(files.items())}}
    files["snapshot.json"] = document(manifest)
    return identity, files


def list_entries(root: Path) -> list[Path]:
    existing_directory(root)
    entries = list(root.iterdir())
    if len(entries) > MAX_PROFILES + MAX_INTERRUPTED + 1:
        raise RuntimeError("Hermes profile capacity exceeded")
    profiles = []
    for path in entries:
        if path.name == ".operation.lock":
            continue
        if path.name.startswith(".prepare-"):
            existing_directory(path)
            continue  # Interrupted staging is retained, never adopted as a ready profile.
        identifier(path.name)
        existing_directory(path)
        profiles.append(path)
    if len(profiles) > MAX_PROFILES:
        raise RuntimeError("Hermes profile capacity exceeded")
    return sorted(profiles)


def read_binding(profile: Path, workspace: Path) -> dict:
    existing_directory(profile)
    result = exact(read_json(profile / "binding.json"), BINDING_FIELDS)
    expected = binding(workspace, result)
    if result != expected or result["profileId"] != profile.name:
        raise RuntimeError("Hermes profile identity was changed")
    return result


def active(profile: Path) -> str:
    pointer = exact(read_json(profile / "active.json"), {"revision"})
    return revision_id(pointer["revision"])


def verify_snapshot(profile: Path, revision: str, identity: dict) -> dict:
    home = profile / "revisions" / revision_id(revision)
    existing_directory(home)
    raw = read_bytes(home / "snapshot.json")
    if digest(raw) != revision:
        raise RuntimeError("Hermes snapshot manifest was changed")
    manifest = exact(read_json(home / "snapshot.json"), {"schema", "identity", "files"})
    detail = exact(manifest["identity"], IDENTITY_FIELDS)
    if manifest["schema"] != 1 or any(detail[key] != identity[key] for key in BINDING_FIELDS):
        raise RuntimeError("Hermes snapshot was rebound")
    if detail["hermesVersion"] != VERSION or detail["hermesCommit"] != COMMIT or detail["provider"] != "openai":
        raise RuntimeError("Hermes snapshot compatibility differs")
    model = detail["model"]
    if model is not None and (not isinstance(model, str) or not MODEL.fullmatch(model)):
        raise RuntimeError("Invalid retained Hermes model identifier")
    if not isinstance(manifest["files"], dict) or not 5 <= len(manifest["files"]) <= 260:
        raise RuntimeError("Invalid Hermes snapshot file count")
    found = set()
    for path in home.rglob("*"):
        if path.is_dir():
            existing_directory(path)
            continue
        name = path.relative_to(home).as_posix()
        if name == "snapshot.json":
            continue
        # Read only exact known preparation paths, never arbitrary runtime/private files.
        if name not in manifest["files"] or not re.fullmatch(r"(?:config\.yaml|SOUL\.md|identity\.json|\.no-bundled-skills|skills/[a-z][a-z0-9-]{0,63}/[A-Za-z0-9_-]+\.md)", name):
            raise RuntimeError("Unrecognized Hermes snapshot content")
        if digest(read_bytes(path)) != manifest["files"][name]:
            raise RuntimeError("Hermes snapshot content was changed")
        found.add(name)
    if found != set(manifest["files"]) or read_json(home / "identity.json") != detail:
        raise RuntimeError("Hermes snapshot content is missing")
    if read_json(home / "config.yaml") != configuration(detail["model"]):
        raise RuntimeError("Hermes snapshot policy differs")
    return detail


def view(profile: Path, workspace: Path, revision: str | None = None) -> dict:
    identity = read_binding(profile, workspace)
    current = active(profile)
    selected = revision or current
    detail = verify_snapshot(profile, selected, identity)
    return {**identity, "revision": selected, "activeRevision": current,
            "home": str(profile / "revisions" / selected), "provider": "openai", "model": detail["model"],
            "skills": [{"id": item["id"], "version": item["version"]} for item in detail["skills"]],
            "runEnabled": False, "providerConnected": False,
            "homeKind": "immutable-setup-snapshot", "runtimeHome": None,
            "state": "prepared-local", "admission": "not-qualified"}


def publish_revision(profile: Path, files: dict[str, bytes], revision: str) -> None:
    root = profile / "revisions"
    private_directory(root)
    entries = list(root.iterdir())
    if len(entries) >= MAX_REVISIONS + MAX_INTERRUPTED:
        raise RuntimeError("Hermes revision or interrupted staging capacity exceeded")
    if sum(not entry.name.startswith(".prepare-") for entry in entries) >= MAX_REVISIONS:
        raise RuntimeError("Hermes revision capacity exceeded")
    stage = Path(tempfile.mkdtemp(prefix=".prepare-", dir=root))
    for name, content in files.items():
        target = stage / name
        private_directory(target.parent)
        write_new(target, content)
    for directory in sorted((p for p in stage.rglob("*") if p.is_dir()), reverse=True):
        sync_directory(directory)
    sync_directory(stage)
    os.rename(stage, root / revision)
    sync_directory(root)


def prepare(root: Path, workspace: Path, payload: dict) -> dict:
    identity, files = recipe(workspace, payload)
    revision = digest(files["snapshot.json"])
    profile = root / identity["profileId"]
    profiles = list_entries(root)
    exists = profile.exists()
    if exists:
        read_binding(profile, workspace)
        view(profile, workspace)
    else:
        if len(profiles) >= MAX_PROFILES:
            raise RuntimeError("Hermes profile capacity exceeded")
        # Publish the complete first profile atomically; failed staging is retained for inspection.
        stage = Path(tempfile.mkdtemp(prefix=".prepare-", dir=root))
        write_new(stage / "binding.json", document({key: identity[key] for key in BINDING_FIELDS}))
        publish_revision(stage, files, revision)
        write_new(stage / "active.json", document({"revision": revision}))
        sync_directory(stage)
        os.rename(stage, profile)
        sync_directory(root)
    target = profile / "revisions" / revision
    if exists and target.exists():
        verify_snapshot(profile, revision, identity)
    elif exists:
        publish_revision(profile, files, revision)
    return view(profile, workspace, revision)


def inspect(root: Path, workspace: Path, payload: dict) -> dict:
    profile = root / identifier(payload.get("profileId"))
    selected = payload.get("revision")
    if selected is not None:
        revision_id(selected)
    result = view(profile, workspace, selected)
    revisions = list((profile / "revisions").iterdir())
    if len(revisions) > MAX_REVISIONS + MAX_INTERRUPTED:
        raise RuntimeError("Hermes revision capacity exceeded")
    result["revisions"] = []
    for path in sorted(revisions):
        if path.name.startswith(".prepare-"):
            existing_directory(path)
            continue
        revision_id(path.name)
        verify_snapshot(profile, path.name, read_binding(profile, workspace))
        result["revisions"].append(path.name)
    return result


def promote(root: Path, workspace: Path, payload: dict) -> dict:
    profile = root / identifier(payload.get("profileId"))
    requested = revision_id(payload.get("revision"))
    expected = revision_id(payload.get("expectedRevision"))
    identity = read_binding(profile, workspace)
    current = active(profile)
    verify_snapshot(profile, current, identity)
    verify_snapshot(profile, requested, identity)
    if current != expected:
        raise RuntimeError("Hermes active revision changed; inspect before promotion")
    if current != requested:
        replace_json(profile / "active.json", {"revision": requested})
    return view(profile, workspace)
