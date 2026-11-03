"""Bounded read-only access to explicitly registered local project files."""
import hashlib
import io
import os
import stat
import zipfile
from xml.etree import ElementTree
from pathlib import Path, PureWindowsPath

from .contracts import Problem, local_path, string

SOURCE_NAMES = ("README.md", "PLAN.md", "HISTORY.md", "AGENTS.md")
MAX_SOURCE = 1024 * 1024
MAX_HASH = 64 * 1024 * 1024


def relative_path(value):
    string(value, "relative_path", 1024)
    p = PureWindowsPath(value)
    if p.drive or p.root or not p.parts or any(part == ".." for part in p.parts):
        raise Problem("invalid_path", "A relative file path inside the workspace is required")
    local_path("D:\\workspace\\" + str(p), "relative_path")
    return str(p)


def checked_path(root, relative):
    relative = relative_path(relative)
    if os.name != "nt":
        raise Problem("unsupported_platform", "Project file access currently requires Windows", 422)
    base = Path(root)
    path = base.joinpath(*PureWindowsPath(relative).parts)
    # Refuse symlinks/junctions at every ancestor, including the registered root.
    # Do this for every read: a directory may have changed since registration.
    for part in (path, *path.parents):
        try:
            info = part.lstat()
        except FileNotFoundError:
            continue
        if stat.S_ISLNK(info.st_mode) or getattr(info, "st_file_attributes", 0) & 0x400:
            raise Problem("unsafe_path", "Symlink and reparse-point access is not supported")
    if not path.resolve().is_relative_to(base.resolve()):
        raise Problem("unsafe_path", "File escapes the registered workspace")
    return path


def inspect_file(root, relative, expected_sha256=None, source=False):
    result = {"relative_path": relative_path(relative), "status": "missing", "size": None,
              "sha256": None, "hash_match": None, "text": None, "truncated": False,
              "file_served": False}
    try:
        path = checked_path(root, relative)
        before = path.stat()
        if not path.is_file():
            result["status"] = "not_a_file"
            return result
        result["size"] = before.st_size
        bound = MAX_SOURCE if source else MAX_HASH
        if before.st_size > bound:
            result["status"] = "too_large"
            return result
        digest = hashlib.sha256()
        prefix = bytearray()
        read = 0
        with path.open("rb") as stream:
            while chunk := stream.read(65536):
                read += len(chunk)
                if read > bound:
                    result["status"] = "changed_or_too_large"
                    return result
                digest.update(chunk)
                if source and len(prefix) < 65536:
                    prefix.extend(chunk[:65536-len(prefix)])
            after = os.fstat(stream.fileno())
        current = path.stat()
        checked_path(root, relative)
        if (before.st_ino, before.st_size, before.st_mtime_ns) != (after.st_ino, after.st_size, after.st_mtime_ns) or (after.st_ino, after.st_size, after.st_mtime_ns) != (current.st_ino, current.st_size, current.st_mtime_ns):
            result["status"] = "changed_during_read"
            return result
        result.update(status="exists", sha256=digest.hexdigest())
        if expected_sha256:
            result["hash_match"] = result["sha256"] == expected_sha256
            if not result["hash_match"]:
                result["status"] = "hash_mismatch"
        if source:
            # A prefix may end in a partial UTF-8 character; decode a complete
            # file strictly, and permit only a cut final character on a prefix.
            text = bytes(prefix).decode("utf-8-sig", errors="replace" if read > len(prefix) else "strict")
            result["text"] = text[:12000]
            result["truncated"] = read > len(prefix) or len(text) > 12000
    except FileNotFoundError:
        pass
    except (PermissionError, OSError):
        result["status"] = "inaccessible"
    except UnicodeError:
        result.update(status="unsupported_encoding", text=None)
    except Problem as exc:
        result["status"] = exc.code
    return result


def preview_file(root, relative, expected_sha256=None):
    result = inspect_file(root, relative, expected_sha256)
    result.update(preview_status="unavailable", preview_scope="bounded_plain_text_only")
    if result["status"] != "exists":
        return result
    suffix = PureWindowsPath(relative).suffix.lower()
    if suffix not in (".md", ".docx"):
        result["preview_status"] = "external_viewer_required"
        return result
    if result["size"] > 8*1024*1024:
        result["preview_status"] = "too_large"
        return result
    try:
        path = checked_path(root, relative)
        with path.open("rb") as stream:
            raw = stream.read(8*1024*1024+1)
        checked_path(root, relative)
        if len(raw) > 8*1024*1024 or hashlib.sha256(raw).hexdigest() != result["sha256"]:
            result["preview_status"] = "changed_during_read"
            return result
        if suffix == ".md":
            text = raw.decode("utf-8-sig")
        else:
            with zipfile.ZipFile(io.BytesIO(raw)) as document:
                info = document.getinfo("word/document.xml")
                if info.file_size > 2*1024*1024:
                    raise ValueError("Oversized document XML")
                with document.open(info) as entry:
                    xml = entry.read(2*1024*1024+1)
                if len(xml) > 2*1024*1024 or b"<!DOCTYPE" in xml.upper() or b"<!ENTITY" in xml.upper():
                    raise ValueError("Unsupported XML")
                tree = ElementTree.fromstring(xml)
                namespace = "{http://schemas.openxmlformats.org/wordprocessingml/2006/main}"
                text = "\n".join("".join(node.text or "" for node in paragraph.iter(namespace+"t")) for paragraph in tree.iter(namespace+"p"))
        result.update(preview_status="ready", text=text[:12000], truncated=len(text)>12000)
    except (OSError, UnicodeError, ValueError, KeyError, zipfile.BadZipFile, ElementTree.ParseError, Problem):
        result["preview_status"] = "unreadable_or_unsupported_document"
    return result
