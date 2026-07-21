import hashlib
import json
from dataclasses import replace

import pytest

from core.email_verification import register_unverified_user
from core.legal_documents import (
    LegalDocumentConfigurationError,
    LegalDocumentsUnavailable,
    load_legal_document,
)


def _write_document(path, *, kind="terms", version="legal-v1", content=None):
    payload = {
        "kind": kind,
        "version": version,
        "title": "Bezpečný testovací dokument",
        "content": content or ("Dostatečně dlouhý testovací obsah. " * 10),
    }
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    return hashlib.sha256(path.read_bytes()).hexdigest()


def test_loader_rejects_undocumented_json_fields(tmp_path):
    path = tmp_path / "terms.json"
    _write_document(path)
    payload = json.loads(path.read_text(encoding="utf-8"))
    payload["internal_notes"] = "must never become part of the public document contract"
    path.write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")
    digest = hashlib.sha256(path.read_bytes()).hexdigest()

    with pytest.raises(LegalDocumentConfigurationError, match="exactly"):
        load_legal_document(
            path_value=str(path),
            expected_kind="terms",
            expected_version="legal-v1",
            expected_sha256=digest,
        )


def test_loader_rejects_duplicate_json_fields(tmp_path):
    path = tmp_path / "terms.json"
    content = "Dostatečně dlouhý testovací obsah. " * 10
    path.write_text(
        "{"
        '"kind":"terms",'
        '"version":"legal-v1",'
        '"title":"První název",'
        '"title":"Druhý název",'
        f'"content":{json.dumps(content, ensure_ascii=False)}'
        "}",
        encoding="utf-8",
    )
    digest = hashlib.sha256(path.read_bytes()).hexdigest()

    with pytest.raises(LegalDocumentConfigurationError, match="duplicate field"):
        load_legal_document(
            path_value=str(path),
            expected_kind="terms",
            expected_version="legal-v1",
            expected_sha256=digest,
        )


def test_loader_pins_kind_version_and_exact_file_bytes(tmp_path):
    path = tmp_path / "terms.json"
    digest = _write_document(path)

    document = load_legal_document(
        path_value=str(path),
        expected_kind="terms",
        expected_version="legal-v1",
        expected_sha256=digest,
    )

    assert document.kind == "terms"
    assert document.version == "legal-v1"
    assert document.sha256 == digest


@pytest.mark.parametrize("mutation", ["content", "version", "kind"])
def test_loader_rejects_changed_content_version_or_kind(tmp_path, mutation):
    path = tmp_path / "terms.json"
    digest = _write_document(path)
    if mutation == "content":
        path.write_bytes(path.read_bytes() + b" ")
    elif mutation == "version":
        digest = _write_document(path, version="legal-v2")
    else:
        digest = _write_document(path, kind="privacy")

    with pytest.raises(LegalDocumentConfigurationError):
        load_legal_document(
            path_value=str(path),
            expected_kind="terms",
            expected_version="legal-v1",
            expected_sha256=digest,
        )


@pytest.mark.parametrize(
    ("path_value", "digest"),
    [("", "0" * 64), ("missing.json", "0" * 64), ("missing.json", "not-a-hash")],
)
def test_loader_rejects_missing_configuration(path_value, digest):
    with pytest.raises(LegalDocumentConfigurationError):
        load_legal_document(
            path_value=path_value,
            expected_kind="terms",
            expected_version="legal-v1",
            expected_sha256=digest,
        )


@pytest.mark.django_db
def test_domain_registration_service_has_a_fail_closed_defense(settings):
    settings.LEGAL_DOCUMENTS = None

    with pytest.raises(LegalDocumentsUnavailable):
        register_unverified_user(
            email="blocked-service@example.cz",
            password="A-strong-unique-password-123",
            terms_accepted=True,
        )


def test_legal_template_escapes_document_content(client, settings):
    injected = replace(
        settings.LEGAL_DOCUMENTS.privacy,
        content=("Bezpečný text. " * 20) + "<script>alert('unsafe')</script>",
    )
    settings.LEGAL_DOCUMENTS = replace(settings.LEGAL_DOCUMENTS, privacy=injected)

    response = client.get("/ochrana-soukromi/")
    content = response.content.decode()

    assert response.status_code == 200
    assert "<script>alert" not in content
    assert "&lt;script&gt;alert" in content
