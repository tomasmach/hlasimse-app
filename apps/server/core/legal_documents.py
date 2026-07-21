import hashlib
import hmac
import json
import re
from dataclasses import dataclass
from pathlib import Path

MAX_LEGAL_DOCUMENT_BYTES = 512 * 1024
MIN_LEGAL_CONTENT_CHARACTERS = 200
SHA256_PATTERN = re.compile(r"[0-9a-f]{64}")


class LegalDocumentConfigurationError(ValueError):
    """Raised when a configured public legal document is absent or not immutable."""


class LegalDocumentsUnavailable(RuntimeError):
    """Raised when registration is attempted without publishable legal documents."""


def _unique_json_object(pairs):
    payload = {}
    for key, value in pairs:
        if key in payload:
            raise LegalDocumentConfigurationError(
                f"Legal document JSON contains duplicate field {key!r}"
            )
        payload[key] = value
    return payload


@dataclass(frozen=True)
class LegalDocument:
    kind: str
    version: str
    title: str
    content: str
    sha256: str


@dataclass(frozen=True)
class LegalDocumentSet:
    privacy: LegalDocument
    terms: LegalDocument


def load_legal_document(
    *,
    path_value: str,
    expected_kind: str,
    expected_version: str,
    expected_sha256: str,
) -> LegalDocument:
    if not path_value:
        raise LegalDocumentConfigurationError(
            f"LEGAL_{expected_kind.upper()}_DOCUMENT_PATH is required"
        )
    if not expected_version:
        raise LegalDocumentConfigurationError(f"LEGAL_{expected_kind.upper()}_VERSION is required")
    normalized_sha256 = expected_sha256.strip().lower()
    if SHA256_PATTERN.fullmatch(normalized_sha256) is None:
        raise LegalDocumentConfigurationError(
            f"LEGAL_{expected_kind.upper()}_DOCUMENT_SHA256 must be a lowercase SHA-256 digest"
        )

    path = Path(path_value).expanduser()
    try:
        stat = path.stat()
        if not path.is_file():
            raise LegalDocumentConfigurationError(f"{path} is not a regular file")
        if stat.st_size <= 0 or stat.st_size > MAX_LEGAL_DOCUMENT_BYTES:
            raise LegalDocumentConfigurationError(
                f"{path} must contain between 1 and {MAX_LEGAL_DOCUMENT_BYTES} bytes"
            )
        raw = path.read_bytes()
    except OSError as exc:
        raise LegalDocumentConfigurationError(f"Cannot read legal document {path}") from exc

    actual_sha256 = hashlib.sha256(raw).hexdigest()
    if not hmac.compare_digest(actual_sha256, normalized_sha256):
        raise LegalDocumentConfigurationError(
            f"SHA-256 mismatch for legal document {expected_kind}"
        )

    try:
        payload = json.loads(raw.decode("utf-8"), object_pairs_hook=_unique_json_object)
    except (UnicodeDecodeError, json.JSONDecodeError) as exc:
        raise LegalDocumentConfigurationError(
            f"Legal document {expected_kind} must be valid UTF-8 JSON"
        ) from exc
    if not isinstance(payload, dict):
        raise LegalDocumentConfigurationError(
            f"Legal document {expected_kind} must contain a JSON object"
        )
    required_fields = {"kind", "version", "title", "content"}
    if set(payload) != required_fields:
        raise LegalDocumentConfigurationError(
            f"Legal document {expected_kind} must contain exactly: "
            + ", ".join(sorted(required_fields))
        )

    kind = payload.get("kind")
    version = payload.get("version")
    title = payload.get("title")
    content = payload.get("content")
    if kind != expected_kind:
        raise LegalDocumentConfigurationError(f"Legal document kind must be {expected_kind!r}")
    if version != expected_version:
        raise LegalDocumentConfigurationError(
            f"Legal document {expected_kind} version does not match its configured version"
        )
    if not isinstance(title, str) or not title.strip() or len(title.strip()) > 160:
        raise LegalDocumentConfigurationError(
            f"Legal document {expected_kind} needs a title of at most 160 characters"
        )
    if (
        not isinstance(content, str)
        or len(content.strip()) < MIN_LEGAL_CONTENT_CHARACTERS
        or "\x00" in content
    ):
        raise LegalDocumentConfigurationError(
            f"Legal document {expected_kind} content is missing or not substantive"
        )
    return LegalDocument(
        kind=kind,
        version=version,
        title=title.strip(),
        content=content.strip(),
        sha256=actual_sha256,
    )


def load_legal_document_set(
    *,
    privacy_path: str,
    privacy_version: str,
    privacy_sha256: str,
    terms_path: str,
    terms_version: str,
    terms_sha256: str,
) -> LegalDocumentSet:
    return LegalDocumentSet(
        privacy=load_legal_document(
            path_value=privacy_path,
            expected_kind="privacy",
            expected_version=privacy_version,
            expected_sha256=privacy_sha256,
        ),
        terms=load_legal_document(
            path_value=terms_path,
            expected_kind="terms",
            expected_version=terms_version,
            expected_sha256=terms_sha256,
        ),
    )


def configured_legal_documents() -> LegalDocumentSet | None:
    from django.conf import settings

    documents = getattr(settings, "LEGAL_DOCUMENTS", None)
    return documents if isinstance(documents, LegalDocumentSet) else None


def require_configured_legal_documents() -> LegalDocumentSet:
    documents = configured_legal_documents()
    if documents is None:
        raise LegalDocumentsUnavailable(
            "Registration is unavailable until the current legal documents are published."
        )
    return documents
