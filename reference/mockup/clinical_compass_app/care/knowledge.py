"""Local, unverified reference corpus. No generation, scoring or rule activation."""
import hashlib
import json
import re
from datetime import date
from django.conf import settings
from django.core.exceptions import ValidationError
from django.core.validators import URLValidator
from django.db import transaction
from django.utils import timezone
from .models import KnowledgePassage, KnowledgeSnapshot, SourceDocument, User
from .services import audit, require_role

MAX_BUNDLE_BYTES = 4_000_000


def digest(text):
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


def exact_keys(value, keys, label):
    if not isinstance(value, dict) or set(value) != set(keys):
        raise ValidationError(f"{label}: неверные или лишние поля.")


def checked_text(value, maximum, label, required=True):
    if not isinstance(value, str) or len(value) > maximum or (required and not value.strip()) or "\x00" in value:
        raise ValidationError(f"{label}: требуется текст допустимой длины.")
    return value


def validate_bundle(bundle):
    exact_keys(bundle, {"schema_version", "document", "text", "text_sha256", "passages"}, "Пакет")
    if type(bundle["schema_version"]) is not int or bundle["schema_version"] != 1:
        raise ValidationError("Поддерживается schema_version=1.")
    doc = bundle["document"]
    fields = {"title", "version", "kind", "url", "publisher", "language", "applicability", "usage_rights", "retrieved_on",
              "original_filename", "original_sha256", "extraction_notes"}
    exact_keys(doc, fields, "Документ")
    limits = {"title": 250, "version": 80, "kind": 20, "url": 200, "publisher": 200,
              "language": 20, "applicability": 2000, "usage_rights": 2000, "retrieved_on": 10,
              "original_filename": 250, "original_sha256": 64, "extraction_notes": 2000}
    for field, maximum in limits.items():
        checked_text(doc[field], maximum, field, required=field not in {"url", "original_filename", "original_sha256", "extraction_notes"})
    if doc["original_sha256"] and not re.fullmatch(r"[a-f0-9]{64}", doc["original_sha256"]):
        raise ValidationError("original_sha256: требуется SHA256 в нижнем регистре.")
    if bool(doc["original_filename"]) != bool(doc["original_sha256"]):
        raise ValidationError("Имя и SHA256 оригинала указываются вместе.")
    if doc["kind"] not in {"guideline", "label", "scale", "synthetic"}:
        raise ValidationError("Неизвестный тип источника.")
    if doc["kind"] == "synthetic" and not settings.DEMO_MODE:
        raise ValidationError("Синтетические источники разрешены только в деморежиме.")
    if doc["url"]:
        URLValidator(schemes=["https"])(doc["url"])
    try:
        retrieved = date.fromisoformat(doc["retrieved_on"])
    except ValueError as exc:
        raise ValidationError("retrieved_on: требуется дата ISO.") from exc
    if retrieved > timezone.localdate():
        raise ValidationError("Дата получения не может быть в будущем.")
    text = checked_text(bundle["text"], 2_000_000, "Текст")
    if bundle["text_sha256"] != digest(text):
        raise ValidationError("SHA256 текста не совпадает.")
    passages = bundle["passages"]
    if not isinstance(passages, list) or not 1 <= len(passages) <= 500:
        raise ValidationError("Нужно от 1 до 500 фрагментов.")
    keys = set()
    for passage in passages:
        exact_keys(passage, {"key", "locator", "start", "end"}, "Фрагмент")
        key = checked_text(passage["key"], 80, "key")
        if not re.fullmatch(r"[a-zA-Z0-9_-]+", key) or key in keys:
            raise ValidationError("Ключи фрагментов должны быть уникальны и содержать только ASCII буквы, цифры, _ и -.")
        keys.add(key)
        checked_text(passage["locator"], 250, "locator")
        start, end = passage["start"], passage["end"]
        if type(start) is not int or type(end) is not int or not 0 <= start < end <= len(text) or end - start > 12000:
            raise ValidationError("Неверные границы фрагмента (индексы символов Python, конец не включён; максимум 12000).")
        if not text[start:end].strip():
            raise ValidationError("Пустой фрагмент.")
    return retrieved


@transaction.atomic
def import_bundle(actor, bundle):
    require_role(actor, User.Role.OPERATOR)
    retrieved = validate_bundle(bundle)
    canonical = json.dumps(bundle, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    if len(canonical.encode("utf-8")) > MAX_BUNDLE_BYTES:
        raise ValidationError("Пакет превышает 4 МБ.")
    fingerprint = digest(canonical)
    doc = bundle["document"]
    source, created = SourceDocument.objects.get_or_create(
        title=doc["title"], version=doc["version"], defaults={
            **{k: v for k, v in doc.items() if k not in {"title", "version", "retrieved_on"}},
            "retrieved_on": retrieved, "sha256": bundle["text_sha256"],
        })
    if not created:
        snapshot = KnowledgeSnapshot.objects.filter(source=source).first()
        if snapshot and snapshot.bundle_sha256 == fingerprint:
            return source, False
        raise ValidationError("Версия уже существует с другим содержимым или без снимка. Нужна новая версия; перезапись запрещена.")
    KnowledgeSnapshot.objects.create(source=source, text=bundle["text"], text_sha256=bundle["text_sha256"],
                                     bundle_sha256=fingerprint, imported_by=actor)
    for item in bundle["passages"]:
        text = bundle["text"][item["start"]:item["end"]]
        KnowledgePassage.objects.create(source=source, **item, text=text, sha256=digest(text))
    audit(actor, "knowledge.imported", source.id, passage_count=len(bundle["passages"]), status="unverified")
    return source, True


def search_staging(actor, query, kinds=None):
    """Literal case-insensitive phrase search for doctors; never assistant context."""
    require_role(actor, User.Role.DOCTOR)
    query = checked_text(query, 200, "Запрос", required=False).strip()
    if len(query) < 2:
        return [], False
    matches = []
    passages = KnowledgePassage.objects.select_related("source")
    if kinds is not None:
        passages = passages.filter(source__kind__in=kinds)
    for passage in passages.order_by("source__title", "source__version", "start").iterator():
        if query.casefold() in (passage.text + " " + passage.source.title + " " + passage.locator).casefold():
            if len(matches) == 30:
                return matches, True
            matches.append(passage)
    return matches, False
