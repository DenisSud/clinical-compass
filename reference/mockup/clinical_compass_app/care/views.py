from functools import wraps
import re
from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.contrib.auth.views import LoginView
from django.core.exceptions import PermissionDenied, ValidationError
from django.db.models import Case, Q, When
from django.http import FileResponse, Http404, JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.views.decorators.http import require_POST
from . import assessments, services
from .knowledge import search_staging
from .document_reader import document_manifest, verified_asset
from .forms import AnswerForm, AssessmentForm, ConnectForm, LoginForm, ReportForm, SupportForm
from .models import Assessment, AssessmentAttention, AuditEvent, CareRelationship, ClinicalRuleVersion, Invitation, SelfReport, SourceDocument, SupportRequest, User


def role_required(role):
    def decorator(view):
        @login_required
        @wraps(view)
        def wrapped(request, *args, **kwargs):
            services.require_role(request.user, role)
            return view(request, *args, **kwargs)
        return wrapped
    return decorator


class CompassLoginView(LoginView):
    template_name = "registration/login.html"
    authentication_form = LoginForm
    redirect_authenticated_user = True


@login_required
def home(request):
    if request.user.role == User.Role.DOCTOR:
        return redirect("doctor_dashboard")
    if request.user.role == User.Role.PATIENT:
        return redirect("patient_dashboard")
    raise PermissionDenied


def chart_data(reports):
    # Equal day spacing, oldest to newest. No interpolation for missing scores.
    daily = {}
    for report in sorted(reports, key=lambda r: r.created_at):
        daily[report.reported_for] = report
    ordered = sorted(daily.values(), key=lambda r: r.reported_for)[-14:]
    if not ordered:
        return []
    first, last = ordered[0].reported_for, ordered[-1].reported_for
    span = max((last - first).days, 1)
    points = []
    for r in ordered:
        points.append({"x": 45 + 490 * (r.reported_for - first).days / span,
                       "y": None if r.wellbeing is None else 175 - (r.wellbeing - 1) * 16,
                       "value": r.wellbeing, "date": r.reported_for})
    return points


@role_required(User.Role.DOCTOR)
def doctor_dashboard(request):
    relationships = CareRelationship.objects.filter(doctor=request.user, is_active=True, patient__is_active=True).select_related("patient")
    reports = SelfReport.objects.filter(relationship__in=relationships)
    requests = SupportRequest.objects.filter(relationship__in=relationships)
    results = Assessment.objects.filter(relationship__in=relationships)
    attention = AssessmentAttention.objects.filter(assessment__relationship__in=relationships, acknowledged_at__isnull=True)
    search = request.GET.get("q", "").strip()[:100]
    cards = []
    for relation in relationships:
        if search and search.casefold() not in (relation.patient.label + " " + relation.patient.username).casefold():
            continue
        own_reports = reports.filter(relationship=relation)
        cards.append({"relation": relation, "latest": own_reports.first(),
                      "unread": own_reports.filter(review__isnull=True).count(),
                      "open": requests.filter(relationship=relation, answered_at__isnull=True).count(),
                      "scales": results.filter(relationship=relation, review__isnull=True).count(),
                      "attention": attention.filter(assessment__relationship=relation).count()})
    return render(request, "care/doctor_dashboard.html", {
        "cards": cards, "search": search, "patient_count": relationships.count(),
        "new_count": reports.filter(review__isnull=True).count(),
        "open_count": requests.filter(answered_at__isnull=True).count(),
        "assessment_count": results.filter(review__isnull=True).count(), "attention_count": attention.count(),
        "recent": reports.select_related("patient", "review").order_by("-created_at")[:8],
    })


@role_required(User.Role.DOCTOR)
def patient_detail(request, patient_id):
    relation = get_object_or_404(CareRelationship.objects.select_related("patient"), patient_id=patient_id,
                                doctor=request.user, is_active=True, patient__is_active=True)
    # Historical data from other care relationships is not implicitly shared.
    reports = list(SelfReport.objects.filter(relationship=relation).select_related("review")[:100])
    support_query = SupportRequest.objects.filter(relationship=relation).select_related("answered_by")
    support = support_query.order_by(Case(When(answered_at__isnull=True, then=0), default=1), "-created_at")[:100]
    results = list(Assessment.objects.filter(relationship=relation).select_related("review", "attention")[:100])
    services.audit(request.user, "patient.viewed", relation.pk)
    return render(request, "care/patient_detail.html", {
        "relation": relation, "reports": reports, "support": support,
        "chart": chart_data(reports), "answer_form": AnswerForm(),
        "support_open_count": support_query.filter(answered_at__isnull=True).count(),
        "assessment_timeline": assessments.timeline(results),
    })


@role_required(User.Role.PATIENT)
def patient_dashboard(request):
    relation = CareRelationship.objects.filter(patient=request.user, is_active=True, doctor__is_active=True).select_related("doctor").first()
    reports = list(SelfReport.objects.filter(patient=request.user).select_related("review")[:100])
    support_query = SupportRequest.objects.filter(patient=request.user).select_related("answered_by")
    support = support_query.order_by(Case(When(answered_at__isnull=True, then=0), default=1), "-created_at")[:100]
    results = list(Assessment.objects.filter(patient=request.user).select_related("review", "attention")[:100])
    return render(request, "care/patient_dashboard.html", {
        "relation": relation, "reports": reports, "support": support, "chart": chart_data(reports),
        "support_open_count": support_query.filter(answered_at__isnull=True).count(), "assessment_timeline": assessments.timeline(results),
    })


@role_required(User.Role.PATIENT)
def new_report(request):
    form = ReportForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        try:
            _, created = services.submit_report(request.user, **form.cleaned_data)
        except ValidationError as exc:
            form.add_error(None, exc)
        else:
            messages.success(request, "Самоотчёт сохранён и доступен ведущему врачу." if created else "Этот самоотчёт уже сохранён. Повтор не создан.")
            return redirect("patient_dashboard")
    return render(request, "care/form.html", {"form": form, "heading": "Новый самоотчёт", "eyebrow": "Дневник самочувствия", "description": "Запишите наблюдения своими словами. Личная оценка не интерпретируется системой как диагноз или риск.", "submit_label": "Сохранить и передать врачу"})


@role_required(User.Role.PATIENT)
def new_support(request):
    form = SupportForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        try:
            _, created = services.submit_request(request.user, **form.cleaned_data)
        except ValidationError as exc:
            form.add_error(None, exc)
        else:
            messages.success(request, "Обращение сохранено. Ответ появится в вашем кабинете." if created else "Обращение уже сохранено.")
            return redirect("patient_dashboard")
    return render(request, "care/form.html", {"form": form, "heading": "Обращение врачу", "eyebrow": "Сопровождение", "description": "Асинхронный канал для вопросов. Ответ не гарантирован в реальном времени; демонстрационный стенд не оказывает экстренную помощь.", "submit_label": "Передать обращение"})


@role_required(User.Role.PATIENT)
def connect(request):
    form = ConnectForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        try:
            services.accept_invitation(request.user, form.cleaned_data["code"])
        except ValidationError as exc:
            form.add_error(None, exc)
        else:
            messages.success(request, "Вы подключены к ведущему врачу.")
            return redirect("patient_dashboard")
    return render(request, "care/form.html", {"form": form, "heading": "Подключиться к врачу", "eyebrow": "Одноразовое приглашение", "description": "Введите код, который создал ваш врач. Срок действия — 48 часов; повторное использование невозможно.", "submit_label": "Подключиться"})


@role_required(User.Role.DOCTOR)
def invitations(request):
    token = services.issue_invitation(request.user) if request.method == "POST" else None
    items = Invitation.objects.filter(doctor=request.user).order_by("-created_at")[:20]
    return render(request, "care/invitations.html", {"token": token, "invitations": items})


@require_POST
@role_required(User.Role.DOCTOR)
def answer(request, item_id):
    item = get_object_or_404(SupportRequest, pk=item_id, relationship__doctor=request.user,
                             relationship__is_active=True, patient__is_active=True)
    form = AnswerForm(request.POST)
    if form.is_valid():
        try:
            services.answer_request(request.user, item_id, form.cleaned_data["response"])
        except ValidationError as exc:
            messages.error(request, " ".join(exc.messages))
        else:
            messages.success(request, "Ответ отправлен пациенту.")
    else:
        messages.error(request, "Ответ не отправлен: введите от 1 до 3000 символов.")
    return redirect("patient_detail", patient_id=item.patient_id)


@require_POST
@role_required(User.Role.DOCTOR)
def review(request, report_id):
    report = get_object_or_404(SelfReport, pk=report_id, relationship__doctor=request.user, relationship__is_active=True, patient__is_active=True)
    services.review_report(request.user, report_id)
    messages.success(request, "Просмотр отмечен. Это не подтверждение клинического решения.")
    return redirect("patient_detail", patient_id=report.patient_id)


@require_POST
@role_required(User.Role.DOCTOR)
def disconnect(request, relation_id):
    relation = get_object_or_404(CareRelationship, pk=relation_id, doctor=request.user, is_active=True)
    try:
        services.end_relationship(request.user, relation_id)
    except ValidationError as exc:
        messages.error(request, " ".join(exc.messages))
        return redirect("patient_detail", patient_id=relation.patient_id)
    messages.success(request, "Связь завершена. Доступ врача к карточке закрыт.")
    return redirect("doctor_dashboard")


@require_POST
@role_required(User.Role.DOCTOR)
def revoke(request, invitation_id):
    get_object_or_404(Invitation, pk=invitation_id, doctor=request.user, used_at__isnull=True)
    services.revoke_invitation(request.user, invitation_id)
    messages.success(request, "Приглашение отозвано.")
    return redirect("invitations")


@role_required(User.Role.DOCTOR)
def sources(request):
    query = request.GET.get("q", "").strip()[:200]
    section = "medicines" if request.GET.get("section") == "medicines" else "guidance"
    kinds = ["label"] if section == "medicines" else ["guideline", "scale", "synthetic", "unspecified"]
    matches, truncated = search_staging(request.user, query, kinds=kinds)
    return render(request, "care/sources.html", {
        "sources": SourceDocument.objects.filter(kind__in=kinds).order_by("title", "version"), "rule_count": ClinicalRuleVersion.objects.count(),
        "query": query, "matches": matches, "truncated": truncated,
        "section": section, "guidance_count": SourceDocument.objects.exclude(kind="label").count(),
        "medicine_count": SourceDocument.objects.filter(kind="label").count(),
    })


@role_required(User.Role.DOCTOR)
def source_detail(request, source_id):
    source = get_object_or_404(SourceDocument.objects.select_related("snapshot"), pk=source_id)
    passages = list(source.passages.order_by("start", "key"))
    document = document_manifest(source)
    page_number = 1
    requested_page = request.GET.get("page", "1")
    fragment = next((p for p in passages if p.key == request.GET.get("fragment")), None)
    if fragment:
        match = re.search(r"PDF стр\.\s*(\d+)", fragment.locator)
        if match:
            requested_page = match.group(1)
    if document:
        try:
            page_number = int(requested_page)
        except (ValueError, TypeError):
            raise Http404
        if not 1 <= page_number <= len(document["pages"]):
            raise Http404
        visible_passages = [p for p in passages if re.search(rf"PDF стр\.\s*{page_number}(?!\d)", p.locator)]
    else:
        visible_passages = passages
    return render(request, "care/source_detail.html", {
        "source": source, "passages": visible_passages, "document": document,
        "page_number": page_number, "page_count": len(document["pages"]) if document else 0,
        "page_range": range(1, len(document["pages"]) + 1) if document else [],
        "page_dimensions": document["pages"][page_number - 1] if document else None,
        "show_text": bool(fragment) or not document,
    })


@role_required(User.Role.DOCTOR)
def source_page(request, source_id, page_number):
    source = get_object_or_404(SourceDocument, pk=source_id)
    path = verified_asset(source, page_number)
    if path is None:
        raise Http404
    return FileResponse(path.open("rb"), content_type="image/png")


@role_required(User.Role.DOCTOR)
def source_original(request, source_id):
    source = get_object_or_404(SourceDocument, pk=source_id)
    path = verified_asset(source)
    if path is None:
        raise Http404
    return FileResponse(path.open("rb"), content_type="application/pdf", as_attachment=True,
                        filename=source.original_filename or "document.pdf")


@role_required(User.Role.PATIENT)
def new_assessment(request):
    assessments.require_demo()
    if not CareRelationship.objects.filter(patient=request.user, is_active=True, doctor__is_active=True, doctor__role=User.Role.DOCTOR).exists():
        messages.info(request, "Для заполнения опросника сначала подключитесь к ведущему врачу.")
        return redirect("connect")
    form = AssessmentForm(request.POST or None)
    if request.method == "POST" and form.is_valid():
        try:
            result, created = assessments.submit_assessment(request.user,
                submission_key=form.cleaned_data["submission_key"], content_token=form.cleaned_data["content_token"],
                answers=form.cleaned_data["answers"], difficulty=form.cleaned_data["difficulty"])
        except ValidationError as exc:
            form.add_error(None, exc)
        else:
            messages.success(request, "Опросник сохранён и доступен ведущему врачу." if created else "Опросник уже сохранён. Повтор не создан.")
            return redirect("assessment_detail", assessment_id=result.pk)
    latest = Assessment.objects.filter(patient=request.user, instrument_code="PHQ9-RU").first()
    return render(request, "care/assessment_form.html", {"form": form, "definition": assessments.DEFINITION, "latest": latest})


@login_required
def assessment_detail(request, assessment_id):
    assessments.require_demo()
    if request.user.role == User.Role.PATIENT:
        results = Assessment.objects.filter(patient=request.user)
    elif request.user.role == User.Role.DOCTOR:
        results = Assessment.objects.filter(relationship__doctor=request.user, relationship__is_active=True, patient__is_active=True)
    else:
        raise PermissionDenied
    result = get_object_or_404(results.select_related("relationship", "patient", "review", "attention"), pk=assessment_id)
    difficulty_label = result.definition["difficulty_options"][result.difficulty] if result.difficulty is not None else "не указаны / не применимо"
    return render(request, "care/assessment_detail.html", {"result": result, "rows": assessments.result_rows(result), "difficulty_label": difficulty_label})


@require_POST
@role_required(User.Role.DOCTOR)
def assessment_review(request, assessment_id):
    assessments.review_assessment(request.user, assessment_id)
    messages.success(request, "Просмотр опросника отмечен. Это не клиническое заключение.")
    return redirect("assessment_detail", assessment_id=assessment_id)


@require_POST
@role_required(User.Role.DOCTOR)
def assessment_acknowledge(request, assessment_id):
    if request.POST.get("confirm") != "yes":
        messages.error(request, "Подтвердите принятие выделенного ответа к разбору.")
    else:
        try:
            assessments.acknowledge_attention(request.user, assessment_id)
        except ValidationError as exc:
            messages.error(request, " ".join(exc.messages))
        else:
            messages.success(request, "Принятие к разбору зафиксировано. Клинические действия и их результат здесь не подтверждаются.")
    return redirect("assessment_detail", assessment_id=assessment_id)


@role_required(User.Role.DOCTOR)
def audit_log(request):
    # Show own actions plus patient actions within currently active relationships.
    relations = CareRelationship.objects.filter(doctor=request.user, is_active=True)
    relation_ids = [str(x) for x in relations.values_list("id", flat=True)]
    items = AuditEvent.objects.filter(Q(actor=request.user) | Q(details__relationship_id__in=relation_ids) | Q(action="relationship.connected", entity_id__in=relations.values("id"))).select_related("actor")[:100]
    return render(request, "care/audit.html", {"events": items})


def health(request):
    # Readiness uses a lightweight query; exposes neither users nor DB details.
    try:
        User.objects.exists()
    except Exception:
        return JsonResponse({"status": "unavailable"}, status=503)
    return JsonResponse({"status": "ok", "version": "0.3.0", "clinical_engine": "disabled", "assessment_module": "demo_only"})
