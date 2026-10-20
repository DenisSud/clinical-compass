"""The clinical application module: nine methods over one seam.

Everything that decides order, authority, entitlement or audit lives behind this
interface. The HTTP layer maps refusals to status codes and formats projections;
it makes no clinical decisions of its own.

Two laws are not restated here because they already live in ``compass``:

* ordering — ``triage.merge`` is called, never re-implemented;
* scoring — ``instruments.score`` is called, never re-implemented.

Deterministic signals are derived on read (D10). The model's free-text screening
runs once, at write time, and is stored with the message.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta, timezone
from hashlib import sha256
from typing import Callable, Iterable, Mapping
from uuid import uuid4

from compass.ai.triage import Candidate, Rank, Severity, from_instrument, merge
from compass.insights import adherence, analyse, build, maximum_of
from compass.instruments import Registry, score

from .cadence import Cadence, load_cadences
from .errors import ErrorKind, Rejected
from .ports import Catalog, Drafter, PatientBundle, PatientState, Screener, Store
from .types import (
    Actor, Advice, Alert, AlertState, Appointment, AppointmentDraft, Assessment,
    Assignment, AuditEntry, Card, CaseFile, Dashboard, DueTest, Feed, Message,
    Obligation, PatientRow, PatientSummary, Question,
    Queue, Response, ResponseRow, Role, ScoreView, SignalKey, SignalRow,
    Submitted, Today, Visit,
)


def _utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Clinical:
    def __init__(
        self,
        store: Store,
        registry: Registry,
        catalog: Catalog,
        *,
        screener: Screener | None = None,
        drafter: Drafter | None = None,
        clock: Callable[[], datetime] = _utcnow,
        new_id: Callable[[], str] | None = None,
        cadences: Mapping[str, Cadence] | None = None,
    ) -> None:
        self._store = store
        self._registry = registry
        self._catalog = catalog
        self._screen = screener
        self._drafter = drafter
        self._clock = clock
        self._new_id = new_id or (lambda: uuid4().hex[:12])
        self._cadences = cadences if cadences is not None else load_cadences()

    # ------------------------------------------------------------ queue

    def queue(self, actor: Actor, *, since_revision: str | None = None) -> Queue:
        if actor.role is not Role.DOCTOR:
            raise Rejected(ErrorKind.ROLE, "queue is a doctor view")

        bundles = self._store.doctor_patients(actor.id)
        best: list[tuple[PatientBundle, Candidate, int]] = []
        others: list[PatientRow] = []
        for bundle in bundles:
            candidates = self._candidates(bundle.responses, bundle.messages)
            if candidates:
                best.append((bundle, candidates[0], len(candidates) - 1))
            else:
                others.append(self._patient_row(bundle))

        # Ordering comes from merge(); mapping back to the patient is by identity.
        owner = {id(c): (b, more) for b, c, more in best}
        ordered = merge([c for _, c, _ in best])

        alert_keys = {
            (a.key.patient_id, a.key.signal, a.key.source, a.key.item)
            for b in bundles
            for a in b.alerts
        }
        rows: list[SignalRow] = []
        for candidate in ordered:
            bundle, more = owner[id(candidate)]
            key = SignalKey(bundle.patient.id, candidate.signal, candidate.origin, "")
            rows.append(
                SignalRow(
                    key=key,
                    label=candidate.label,
                    reason=candidate.reason,
                    severity=candidate.severity,
                    authoritative=candidate.authoritative,
                    rank=candidate.rank,
                    waiting_since=bundle.last_contact_at,
                    more=more,
                )
            )

        revision = self._revision(rows, others)
        unseen_criticals = sum(
            1
            for r in rows
            if r.severity is Severity.CRITICAL
            and (r.key.patient_id, r.key.signal, r.key.source, r.key.item) not in alert_keys
        )
        return Queue(
            revision=revision,
            attention=tuple(rows),
            others=tuple(others),
            new_criticals=unseen_criticals,
            stable=since_revision is not None and since_revision == revision,
        )

    # ------------------------------------------------------------- card

    def card(self, actor: Actor, patient_id: str) -> CaseFile:
        state = self._state(actor, patient_id)
        candidates = self._candidates(state.responses, state.messages)
        signals = tuple(
            SignalRow(
                key=SignalKey(patient_id, c.signal, c.origin, ""),
                label=c.label,
                reason=c.reason,
                severity=c.severity,
                authoritative=c.authoritative,
                rank=c.rank,
                waiting_since=None,
            )
            for c in candidates
        )
        scores = tuple(
            view
            for view in (self._score_view(r) for r in sorted(state.responses, key=lambda r: r.submitted_at))
            if view is not None
        )
        prescriptions = [
            f"{p.drug_code} {p.dose} {p.schedule}"
            for a in sorted(state.appointments, key=lambda a: a.signed_at)
            for p in a.prescriptions
        ]
        return CaseFile(
            patient=state.patient,
            scores=scores,
            signals=signals,
            medications=tuple(prescriptions),
            alerts=state.alerts,
            thread=tuple(sorted(state.messages, key=lambda m: m.at)),
            last_appointment_at=(
                max(a.signed_at for a in state.appointments) if state.appointments else None
            ),
        )

    # ------------------------------------------------------------- feed

    def feed(self, actor: Actor) -> Feed:
        if actor.role is not Role.PATIENT:
            raise Rejected(ErrorKind.ROLE, "feed is a patient view")
        state = self._store.patient_state(actor.id)
        if state is None:
            raise Rejected(ErrorKind.NOT_FOUND, "no such patient")

        cards: list[Card] = []
        for r in state.responses:
            cards.append(
                Card(kind="assignment", title="Анкета отправлена", at=r.submitted_at,
                     ref_id=r.id)
            )
        for a in state.appointments:
            if "plan" in a.published:
                body = a.plan.notes or ""
                if a.plan.next_visit_on:
                    body = (body + f" Следующий приём: {a.plan.next_visit_on:%d.%m.%Y}.").strip()
                cards.append(
                    Card(kind="published", title="Ответ врача", body=body,
                         at=a.signed_at, ref_id=a.id)
                )
        for m in state.messages:
            if m.direction == "to_patient":
                cards.append(Card(kind="message", title="Сообщение от врача",
                                  body=m.text, at=m.at, ref_id=m.id))
        cards.sort(key=lambda c: (c.at is None, c.at), reverse=True)
        return Feed(cards=tuple(cards))

    # ------------------------------------------------------ write: therapy

    def commit_appointment(
        self, actor: Actor, draft: AppointmentDraft, *, submission_key: str
    ) -> Appointment:
        if actor.role is not Role.DOCTOR:
            raise Rejected(ErrorKind.ROLE, "only a doctor signs")
        state = self._state(actor, draft.patient_id)

        if not draft.signature.strip():
            raise Rejected(ErrorKind.UNSIGNED, "приём не подписан", field="signature")

        for line in draft.prescriptions:
            self._catalog.validate(line.drug_code, line.dose)

        candidates = self._candidates(state.responses, state.messages)
        critical = {SignalKey(draft.patient_id, c.signal, c.origin, "")
                    for c in candidates if c.severity is Severity.CRITICAL}
        unexamined = critical - set(draft.acknowledged)
        if unexamined:
            key = sorted(unexamined, key=lambda k: k.signal)[0]
            raise Rejected(
                ErrorKind.NEEDS_ACKNOWLEDGEMENT,
                f"критическая находка не разобрана: {key.signal}",
                field="acknowledged",
            )

        if draft.referral is not None:
            required = (
                Obligation.OBLIGATORY
                if any(c.severity in (Severity.CRITICAL, Severity.DANGER) for c in candidates)
                else Obligation.DESIRABLE
            )
            if draft.referral.obligation is Obligation.DESIRABLE and required is Obligation.OBLIGATORY:
                raise Rejected(
                    ErrorKind.OBLIGATION_DOWNGRADED,
                    "по правилам эскалации направление обязательно",
                    field="referral.obligation",
                )

        revision = len(state.appointments) + 1
        if draft.expected_revision is not None and draft.expected_revision != str(revision - 1):
            raise Rejected(ErrorKind.STALE, "приём уже подписан другим действием")

        fingerprint = sha256(repr(draft).encode("utf-8")).hexdigest()
        previous = self._store.idem_get(submission_key)
        if previous is not None:
            stored, payload = previous
            if stored != fingerprint:
                raise Rejected(ErrorKind.CONFLICT, "ключ повтора использован с другим содержанием")
            existing = self._store.appointment(payload["id"])
            if existing is None:
                raise Rejected(ErrorKind.NOT_FOUND, "повтор ссылается на пропавший приём")
            return existing

        appointment = Appointment(
            id=self._new_id(),
            patient_id=draft.patient_id,
            doctor_id=actor.id,
            revision=revision,
            signature=draft.signature,
            complaint=draft.complaint,
            prescriptions=draft.prescriptions,
            referral=draft.referral,
            plan=draft.plan,
            signed_at=self._clock(),
        )
        # One transaction: the appointment, the alerts it closes, the receipt and
        # the audit entry. A half-signed encounter is the failure worth excluding,
        # so this is the one place where the seam must be atomic.
        with self._store.unit_of_work():
            self._store.append_appointment(appointment)
            for key in draft.acknowledged:
                self._materialise(actor, key, AlertState.RESOLVED, "закрыто приёмом",
                                  candidates, state.alerts)
            self._store.idem_put(submission_key, fingerprint, {"id": appointment.id})
            self._audit(actor, draft.patient_id, "appointment.signed",
                        f"revision={revision} lines={len(draft.prescriptions)}")
        return appointment

    def publish(self, actor: Actor, appointment_id: str, fields: Iterable[str]) -> None:
        if actor.role is not Role.DOCTOR:
            raise Rejected(ErrorKind.ROLE, "only a doctor publishes")
        appointment = self._store.appointment(appointment_id)
        if appointment is None:
            raise Rejected(ErrorKind.NOT_FOUND, "no such appointment")
        self._state(actor, appointment.patient_id)

        allowed = {"plan", "referral", "prescriptions", "complaint"}
        chosen = frozenset(fields) & allowed
        if not chosen:
            raise Rejected(ErrorKind.ROLE, "nothing publishable in fields", field="fields")

        with self._store.unit_of_work():
            self._store.replace_appointment(
                Appointment(**{**appointment.__dict__,
                               "published": appointment.published | chosen})
            )
            self._audit(actor, appointment.patient_id, "appointment.published",
                        ",".join(sorted(chosen)))

    # ------------------------------------------------ write: intake, talk

    def submit_response(
        self, actor: Actor, assignment_id: str, answers: Mapping[str, int | None],
        *, submission_key: str,
    ) -> Assessment:
        if actor.role is not Role.PATIENT:
            raise Rejected(ErrorKind.ROLE, "only a patient submits a questionnaire")
        assignment = self._store.assignment(assignment_id)
        if assignment is None:
            raise Rejected(ErrorKind.NOT_FOUND, "no such assignment")
        if assignment.patient_id != actor.id:
            raise Rejected(ErrorKind.NOT_YOUR_PATIENT, "assignment belongs to another patient")

        if assignment.instrument_code not in self._registry:
            raise Rejected(ErrorKind.NOT_FOUND, "unknown instrument")
        instrument = self._registry.get(assignment.instrument_code)
        if set(answers) != set(instrument.item_keys):
            raise Rejected(ErrorKind.INCOMPLETE, "answers must name every item exactly once",
                           field="answers")

        fingerprint = sha256(
            repr(sorted(answers.items(), key=lambda kv: kv[0])).encode()
        ).hexdigest()
        previous = self._store.idem_get(submission_key)
        if previous is not None:
            stored, payload = previous
            if stored != fingerprint:
                raise Rejected(ErrorKind.CONFLICT, "ключ повтора использован с другими ответами")
            return Assessment(
                accepted=True,
                response_id=payload["response_id"],
                submitted_at=datetime.fromisoformat(payload["submitted_at"]),
            )

        response = Response(
            id=self._new_id(),
            assignment_id=assignment_id,
            patient_id=actor.id,
            instrument_code=instrument.code,
            definition_sha256=instrument.sha256,
            answers=dict(answers),
            submitted_at=self._clock(),
        )
        assessment = Assessment(accepted=True, response_id=response.id,
                                submitted_at=response.submitted_at)
        with self._store.unit_of_work():
            self._store.append_response(response)
            self._store.idem_put(
                submission_key,
                fingerprint,
                {"response_id": assessment.response_id,
                 "submitted_at": assessment.submitted_at.isoformat()},
            )
            self._audit(actor, actor.id, "response.submitted", instrument.code)
        return assessment

    def send_message(
        self, actor: Actor, patient_id: str, text: str, *, submission_key: str
    ) -> Message:
        state = self._state(actor, patient_id)
        direction = "to_doctor" if actor.role is Role.PATIENT else "to_patient"

        fingerprint = sha256(text.encode()).hexdigest()
        previous = self._store.idem_get(submission_key)
        if previous is not None:
            stored, payload = previous
            if stored != fingerprint:
                raise Rejected(ErrorKind.CONFLICT, "ключ повтора использован с другим текстом")
            existing = self._store.message(payload["id"])
            if existing is None:
                raise Rejected(ErrorKind.NOT_FOUND, "повтор ссылается на пропавшее сообщение")
            return existing

        screened: tuple[Candidate, ...] = ()
        if direction == "to_doctor" and self._screen is not None:
            result = self._screen(text)
            screened = result or ()

        message = Message(
            id=self._new_id(), patient_id=patient_id, author_id=actor.id,
            direction=direction, text=text, at=self._clock(), screened=screened,
        )
        with self._store.unit_of_work():
            self._store.append_message(message)
            self._store.idem_put(submission_key, fingerprint, {"id": message.id})
            self._audit(actor, patient_id, "message.sent", direction)
        return message

    # -------------------------------------------------------------- alerts

    def acknowledge(
        self, actor: Actor, signal_key: SignalKey, action: AlertState, note: str = ""
    ) -> Alert:
        if actor.role is not Role.DOCTOR:
            raise Rejected(ErrorKind.ROLE, "only a doctor acknowledges")
        state = self._state(actor, signal_key.patient_id)
        candidates = self._candidates(state.responses, state.messages)
        return self._materialise(actor, signal_key, action, note, candidates, state.alerts)

    # --------------------------------------------------- the patient's day

    def today(self, actor: Actor) -> Today:
        """What a patient is expected to do today, plus their next visit.

        Assignment creation happens here, lazily. There is no scheduler process:
        a cadence is a pure predicate over the last due date, so "what is due" is
        answered on read and testable with a fixed clock.
        """
        if actor.role is not Role.PATIENT:
            raise Rejected(ErrorKind.ROLE, "today is a patient view")
        state = self._state(actor, actor.id)
        now = self._clock()
        self._ensure_assignments(actor.id, now)

        answered = {r.assignment_id for r in state.responses}
        due: list[DueTest] = []
        for assignment in self._store.assignments_of(actor.id):
            if assignment.due_on != now.date() or assignment.id in answered:
                continue
            if assignment.instrument_code not in self._registry:
                continue
            instrument = self._registry.get(assignment.instrument_code)
            cadence = self._cadences.get(assignment.instrument_code)
            due.append(
                DueTest(
                    assignment_id=assignment.id,
                    instrument_code=instrument.code,
                    title=instrument.title,
                    instruction=instrument.instruction,
                    cadence=cadence.label if cadence else "",
                    items=tuple(
                        Question(
                            key=item.key,
                            text=item.text,
                            options=tuple((o.points, o.label) for o in item.options),
                        )
                        for item in instrument.items
                    ),
                    due_on=now.date(),
                )
            )

        planned = [
            v for v in state.visits
            if v.status == "planned" and v.scheduled_at >= now - timedelta(hours=6)
        ]
        titles = {code: self._registry.get(code).short for code in self._registry.codes()}
        recent = tuple(
            Submitted(r.submitted_at, titles.get(r.instrument_code, r.instrument_code))
            for r in sorted(state.responses, key=lambda r: r.submitted_at, reverse=True)[:5]
        )
        return Today(
            next_visit=min(planned, key=lambda v: v.scheduled_at) if planned else None,
            due=tuple(due),
            recent=recent,
        )

    # ------------------------------------------------- the doctor's panel

    def patients(self, actor: Actor) -> tuple[PatientSummary, ...]:
        """The panel: one row per patient, worst state first.

        Ordered by the severity of the worst deterministic finding, then by rank,
        then by name — the same two axes as the queue, so a doctor does not have
        to learn a second ordering.
        """
        if actor.role is not Role.DOCTOR:
            raise Rejected(ErrorKind.ROLE, "the panel is a doctor view")
        now = self._clock()
        rows: list[PatientSummary] = []
        for bundle in self._store.doctor_patients(actor.id):
            state = self._store.patient_state(bundle.patient.id)
            if state is None:
                continue
            series = build(state.responses, self._registry)
            report, findings = self._insight(state, series, now)
            signals = self._safety_only(self._candidates(state.responses, state.messages))
            weekly = next((s for s in series if s.kind == "validated_scale"), None)
            latest = weekly.latest if weekly else None
            upcoming = [
                v for v in state.visits
                if v.status == "planned" and v.scheduled_at >= now
            ]
            rows.append(
                PatientSummary(
                    patient=state.patient,
                    age=self._age(state.patient.birth_year),
                    last_contact_at=bundle.last_contact_at,
                    adherence=report,
                    latest_total=latest.total if latest else None,
                    latest_maximum=latest.maximum if latest else 0,
                    latest_band=latest.band_label if latest else None,
                    signals=signals,
                    findings=findings,
                    headline=self._headline(signals, findings),
                    next_visit_at=(
                        min(v.scheduled_at for v in upcoming) if upcoming else None
                    ),
                )
            )
        rows.sort(key=self._panel_key)
        return tuple(rows)

    @staticmethod
    def _safety_only(candidates: Iterable[Candidate]) -> tuple[Candidate, ...]:
        """Safety signals for display.

        ``severe_score`` is deliberately dropped: the score and its band are
        printed two columns to the left, and a card that repeats them teaches the
        doctor to skim the section that must never be skimmed.
        """
        return tuple(c for c in candidates if c.signal != "severe_score")

    @staticmethod
    def _headline(signals: Iterable[Candidate], findings: Iterable[Finding]) -> str:
        """Pick the row's one-line reason for attention.

        Priority is deliberate: a safety signal, then an insight that the score
        column cannot show (trend, staleness, adherence), then the score itself.
        Without the middle step every severe patient would read «тяжёлый балл»,
        which the next column already says.
        """
        signals = list(signals)
        if signals:
            return signals[0].label
        findings = list(findings)
        informative = [f for f in findings if f.code not in {"notable_band"}]
        if informative:
            return informative[0].title
        if findings:
            return findings[0].title
        return ""

    @staticmethod
    def _panel_key(row: PatientSummary) -> tuple:
        """Worst safety signal first, then worst finding, then name.

        A reported thought of self-harm must never sit below a questionnaire band
        just because the band happens to be the more recent row.
        """
        if row.signals:
            worst = row.signals[0]
            return (int(worst.severity), -int(worst.rank), 0, row.patient.display)
        return (
            min((int(f.severity) for f in row.findings), default=int(Severity.INFO)),
            -max((int(f.rank) for f in row.findings), default=0),
            1,
            row.patient.display,
        )

    def dashboard(self, actor: Actor, patient_id: str) -> Dashboard:
        """One patient, read for a doctor: series, deterministic findings, visits."""
        state = self._state(actor, patient_id)
        now = self._clock()
        series = build(state.responses, self._registry)
        report, findings = self._insight(state, series, now)

        rows: list[ResponseRow] = []
        for response in sorted(state.responses, key=lambda r: r.submitted_at, reverse=True):
            view = self._score_view(response)
            if view is None:
                continue
            rows.append(
                ResponseRow(
                    at=view.at,
                    instrument_code=view.instrument_code,
                    title=view.title,
                    total=view.total,
                    maximum=view.maximum,
                    band_label=view.band_label,
                    complete=view.completed == view.required,
                )
            )
        return Dashboard(
            patient=state.patient,
            age=self._age(state.patient.birth_year),
            series=series,
            signals=self._safety_only(self._candidates(state.responses, state.messages)),
            findings=findings,
            adherence=report,
            visits=state.visits,
            responses=tuple(rows),
            last_contact_at=max(
                (r.submitted_at for r in state.responses), default=None
            ),
        )

    # ------------------------------------------------------------ schedule

    def visits(self, actor: Actor) -> tuple[Visit, ...]:
        if actor.role is Role.DOCTOR:
            return self._store.visits_of_doctor(actor.id)
        return self._store.visits_of_patient(actor.id)

    def schedule_visit(
        self, actor: Actor, patient_id: str, at: datetime,
        kind: str = "консультация", note: str = "",
    ) -> Visit:
        if actor.role is not Role.DOCTOR:
            raise Rejected(ErrorKind.ROLE, "only a doctor schedules a visit")
        self._state(actor, patient_id)
        if at <= self._clock():
            raise Rejected(ErrorKind.INCOMPLETE, "визит нельзя назначить в прошлое",
                           field="scheduled_at")
        visit = Visit(
            id=self._new_id(), patient_id=patient_id, doctor_id=actor.id,
            scheduled_at=at, kind=kind, note=note,
        )
        with self._store.unit_of_work():
            self._store.append_visit(visit)
            self._audit(actor, patient_id, "visit.scheduled", at.isoformat())
        return visit

    # -------------------------------------------------------------- advice

    def advise(self, actor: Actor, patient_id: str, question: str) -> Advice:
        state = self._state(actor, patient_id)
        if self._drafter is None:
            return Advice(answer=None, citations=(), degraded=True,
                          reason="модель не подключена")
        context = (
            f"Пациент {state.patient.display}, {self._age(state.patient.birth_year)} лет. "
            f"Шкал: {len(state.responses)}. Приёмов: {len(state.appointments)}."
        )
        answer, citations, degraded = self._drafter(question, context)
        return Advice(answer=answer, citations=tuple(citations), degraded=bool(degraded),
                      reason=degraded)

    # ----------------------------------------------------------- internals

    def _state(self, actor: Actor, patient_id: str) -> PatientState:
        state = self._store.patient_state(patient_id)
        if state is None:
            raise Rejected(ErrorKind.NOT_FOUND, "no such patient")
        if actor.role is Role.DOCTOR:
            if state.patient.doctor_id != actor.id:
                raise Rejected(ErrorKind.NOT_YOUR_PATIENT, "patient is not linked to you")
        elif state.patient.id != actor.id:
            raise Rejected(ErrorKind.NOT_YOUR_PATIENT, "not your own record")
        return state

    def _candidates(
        self, responses: Iterable[Response] | Response | None,
        messages: Iterable[Message],
    ) -> tuple[Candidate, ...]:
        """Candidates from every answer, newest first.

        Which answers count depends on the signal:

        * a total or a band describes *now*, so only the latest answer per
          instrument may produce one — an old score is history, not state;
        * a safety finding describes *an event*, and an event does not stop
          mattering because the patient filled in something else afterwards.

        Reading only the most recent response was a real bug: today's self-harm
        tick disappeared behind the same day's questionnaire.
        """
        if isinstance(responses, Response) or responses is None:
            responses = () if responses is None else (responses,)
        ordered = sorted(responses, key=lambda r: r.submitted_at, reverse=True)
        latest: dict[str, str] = {}
        for response in ordered:
            latest.setdefault(response.instrument_code, response.id)

        groups: list[list[Candidate]] = []
        seen: set[tuple[str, str]] = set()
        for response in ordered:
            candidates = self._instrument_candidates(response)
            if response.id != latest[response.instrument_code]:
                candidates = [c for c in candidates if c.signal != "severe_score"]
            fresh = []
            for candidate in candidates:
                key = (candidate.signal, candidate.origin)
                if key in seen:
                    continue
                seen.add(key)
                fresh.append(candidate)
            if fresh:
                groups.append(fresh)
        for message in messages:
            for candidate in message.screened:
                key = (candidate.signal, candidate.origin)
                if key in seen:
                    continue
                seen.add(key)
                groups.append([candidate])
        return tuple(merge(*groups))

    def _instrument_candidates(self, response: Response) -> list[Candidate]:
        if response.instrument_code not in self._registry:
            return [self._definition_changed("шкала не загружена")]
        instrument = self._registry.get(response.instrument_code)
        if instrument.sha256 != response.definition_sha256:
            return [self._definition_changed("версия шкалы изменилась")]
        return from_instrument(score(instrument, response.answers))

    @staticmethod
    def _definition_changed(reason: str) -> Candidate:
        return Candidate(
            signal="definition_changed", origin="instrument", rank=Rank.INFO,
            authoritative=True, reason=reason, severity_override=Severity.INFO,
        )

    def _materialise(
        self, actor: Actor, key: SignalKey, action: AlertState, note: str,
        candidates: Iterable[Candidate], existing: Iterable[Alert],
    ) -> Alert:
        found = next(
            (c for c in candidates
             if c.signal == key.signal and c.origin == key.source),
            None,
        )
        previous = next(
            (a for a in existing
             if a.key.signal == key.signal and a.key.source == key.source
             and a.key.item == key.item),
            None,
        )
        alert = Alert(
            key=key,
            state=action,
            at=self._clock(),
            actor_id=actor.id,
            note=note,
            evidence_label=previous.evidence_label if previous else (found.label if found else key.signal),
            evidence_reason=previous.evidence_reason if previous else (found.reason if found else ""),
            evidence_severity=previous.evidence_severity if previous else (
                found.severity if found else Severity.INFO
            ),
        )
        self._store.save_alert(alert)
        self._audit(actor, key.patient_id, f"alert.{action.value}", key.signal)
        return alert

    def _score_view(self, response: Response) -> ScoreView | None:
        if response.instrument_code not in self._registry:
            return None
        instrument = self._registry.get(response.instrument_code)
        if instrument.sha256 != response.definition_sha256:
            return None
        result = score(instrument, response.answers)
        primary = result.primary
        return ScoreView(
            instrument_code=result.code,
            version=result.version,
            title=instrument.title,
            maximum=maximum_of(instrument),
            total=primary.total,
            band_label=primary.band_label,
            severity=primary.severity,
            completed=result.completed,
            required=result.required,
            at=response.submitted_at,
        )

    def _ensure_assignments(self, patient_id: str, now: datetime) -> None:
        """Make today's assignments exist, once.

        Write-on-read is a compromise, taken deliberately: it removes a scheduler
        process from a ten-day demo. It is idempotent because the predicate is
        "days since the last due date", and the adapter enforces one assignment
        per (patient, instrument, day).
        """
        today = now.date()
        last: dict[str, date] = {}
        for assignment in self._store.assignments_of(patient_id):
            day = assignment.due_on or assignment.created_at.date()
            code = assignment.instrument_code
            if code not in last or day > last[code]:
                last[code] = day
        for code, cadence in self._cadences.items():
            if code not in self._registry:
                continue
            if not cadence.is_due(last.get(code), today):
                continue
            self._store.append_assignment(
                Assignment(
                    id=self._new_id(), patient_id=patient_id, instrument_code=code,
                    created_at=now, due_on=today,
                )
            )

    def _insight(self, state: PatientState, series, now: datetime):
        daily = next((s for s in series if s.kind == "daily_check"), None)
        report = adherence(daily, now)
        return report, analyse(series, daily_adherence=report, now=now)

    @staticmethod
    def _latest(responses: Iterable[Response]) -> Response | None:
        latest = None
        for response in responses:
            if latest is None or response.submitted_at > latest.submitted_at:
                latest = response
        return latest

    def _patient_row(self, bundle: PatientBundle) -> PatientRow:
        age = self._age(bundle.patient.birth_year)
        linked = (
            (self._clock() - bundle.patient.linked_since).days
            if bundle.patient.linked_since
            else None
        )
        return PatientRow(
            patient_id=bundle.patient.id,
            display=bundle.patient.display,
            age=age,
            linked_days=linked,
            last_contact_at=bundle.last_contact_at,
        )

    def _age(self, birth_year: int) -> int:
        return max(0, self._clock().year - birth_year)

    @staticmethod
    def _revision(rows: Iterable[SignalRow], others: Iterable[PatientRow]) -> str:
        """Digest of the whole list, not just the attention block.

        A patient joining with nothing wrong does not reshuffle attention, but the
        list did change, and "the list you saw is the list you get" is the claim the
        interface makes. Hashing only the attention rows would have made ``stable``
        say more than it knows.
        """
        material = [
            f"{r.key.patient_id}|{r.key.signal}|{r.key.source}|{r.key.item}" for r in rows
        ] + [f"P|{p.patient_id}" for p in others]
        return sha256("\n".join(material).encode("utf-8")).hexdigest()[:12]

    def _audit(self, actor: Actor, patient_id: str, action: str, detail: str = "") -> None:
        self._store.append_audit(
            AuditEntry(seq=0, at=self._clock(), actor_id=actor.id,
                       patient_id=patient_id, action=action, detail=detail)
        )


__all__ = ["Clinical"]
