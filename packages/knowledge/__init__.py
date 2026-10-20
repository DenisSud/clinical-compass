"""knowledge — the source corpus the assistant is allowed to cite.

Bundles live in ``bundles/``. Each is one document plus its citable passages,
with character offsets into the whole text so a quote is exact.
"""

from .bundle import Bundle, BundleError, DEFAULT_DIR, SourceDocument, load_bundle, load_dir, passages

__all__ = ["Bundle", "BundleError", "DEFAULT_DIR", "SourceDocument", "load_bundle", "load_dir", "passages"]
