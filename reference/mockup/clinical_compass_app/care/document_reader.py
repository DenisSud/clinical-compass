"""Private, pre-rendered pages bound to the imported original's SHA256."""
import hashlib
import json
from pathlib import Path
import re
from django.conf import settings


def document_folder(source):
    if not re.fullmatch(r"[a-f0-9]{64}", source.original_sha256):
        return None
    root = Path(getattr(settings, "KNOWLEDGE_ASSET_ROOT", settings.BASE_DIR / "knowledge_assets")).resolve()
    folder = (root / source.original_sha256).resolve()
    return folder if folder.parent == root else None


def document_manifest(source):
    folder = document_folder(source)
    if folder is None:
        return None
    try:
        data = json.loads((folder / "manifest.json").read_text(encoding="utf-8"))
        pages = data["pages"]
        if data["original_sha256"] != source.original_sha256 or not isinstance(pages, list) or not 1 <= len(pages) <= 500:
            return None
        if not (folder / "original.pdf").is_file():
            return None
        for page in pages:
            if (not isinstance(page, dict) or not re.fullmatch(r"[a-f0-9]{64}", page["sha256"])
                    or type(page["width"]) is not int or type(page["height"]) is not int
                    or not 0 < page["width"] <= 10000 or not 0 < page["height"] <= 10000):
                return None
        return data
    except (OSError, ValueError, KeyError, TypeError):
        return None


def verified_asset(source, page_number=None):
    data = document_manifest(source)
    if not data:
        return None
    if page_number is None:
        name, expected = "original.pdf", source.original_sha256
    else:
        if not 1 <= page_number <= len(data["pages"]):
            return None
        name, expected = f"page-{page_number}.png", data["pages"][page_number - 1]["sha256"]
    folder = document_folder(source)
    path = (folder / name).resolve()
    if path.parent != folder:
        return None
    try:
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            return None
    except OSError:
        return None
    return path
