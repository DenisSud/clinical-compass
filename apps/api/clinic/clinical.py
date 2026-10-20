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

from datetime import date, datetime, timezone
from hashlib import sha256
from typing import Callable, Iterable, Mapping
from uuid import uuid4

from compass.ai.triage import Candidate, Rank, Severity, from_instrument, merge
from compass.instruments import Registry, score

from .errors import ErrorKind, Rejected
from .ports import Catalog, Drafter, PatientBundle, PatientState, Screener, Store
from .types import (
    Actor, Advice, Alert, AlertState, Appointment, AppointmentDraft, Assessment,
    Assignment, AuditEntry, Card, CaseFile, Feed, Message, Obligation, PatientRow,
    Queue, Response, Role, ScoreView, SignalKey, SignalRow,
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
    ) -> None:
        self._store = store
        self._registry = registry
        self._catalog = catalog
        self._screen = screener
        self._drafter = drafter
        self._clock = clock
        self._new_id = new_id or (lambda: uuid4().hex[:12])

    # ------------------------------------------------------------ queue

    def queue(self, actor: Actor, *, since_revision: str | None = None) -> Queue:
        if actor.role is not Role.DOCTOR:
            raise Rejected(ErrorKind.ROLE, "queue is a doctor view")

        bundles = self._store.doctor_patients(actor.id)
        best: list[tuple[PatientBundle, Candidate, int]] = []
        others: list[PatientRow] = []
        for bundle in bundles:
            candidates = self._candidates(bundle.latest_response, bundle.messages)
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
        candidates = self._candidates(
            self._latest(state.responses), state.messages
        )
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

        candidates = self._candidates(self._latest(state.responses), state.messages)
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
            stored_key, appointment = previous  # type: ignore[misc]
            if stored_key != fingerprint:
                raise Rejected(ErrorKind.CONFLICT, "ключ повтора использован с другим содержанием")
            return appointment

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
        self._store.append_appointment(appointment)
        for key in draft.acknowledged:
            self._materialise(actor, key, AlertState.RESOLVED, "закрыто приёмом",
                              candidates, state.alerts)
        self._store.idem_put(submission_key, (fingerprint, appointment))
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

        self._store.replace_appointment(
            Appointment(**{**appointment.__dict__, "published": appointment.published | chosen})
        )
        self._audit(actor, appointment.patient_id, "appointment.published", ",".join(sorted(chosen)))

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

        previous = self._store.idem_get(submission_key)
        if previous is not None:
            stored, assessment = previous  # type: ignore[misc]
            if stored != sha256(repr(sorted(answers.items(), key=lambda kv: kv[0])).encode()).hexdigest():
                raise Rejected(ErrorKind.CONFLICT, "ключ повтора использован с другими ответами")
            return assessment

        response = Response(
            id=self._new_id(),
            assignment_id=assignment_id,
            patient_id=actor.id,
            instrument_code=instrument.code,
            definition_sha256=instrument.sha256,
            answers=dict(answers),
            submitted_at=self._clock(),
        )
        self._store.append_response(response)
        assessment = Assessment(accepted=True, response_id=response.id,
                                submitted_at=response.submitted_at)
        self._store.idem_put(
            submission_key,
            (sha256(repr(sorted(answers.items(), key=lambda kv: kv[0])).encode()).hexdigest(),
             assessment),
        )
        self._audit(actor, actor.id, "response.submitted", instrument.code)
        return assessment

    def send_message(
        self, actor: Actor, patient_id: str, text: str, *, submission_key: str
    ) -> Message:
        state = self._state(actor, patient_id)
        direction = "to_doctor" if actor.role is Role.PATIENT else "to_patient"

        previous = self._store.idem_get(submission_key)
        if previous is not None:
            stored, message = previous  # type: ignore[misc]
            if stored != sha256(text.encode()).hexdigest():
                raise Rejected(ErrorKind.CONFLICT, "ключ повтора использован с другим текстом")
            return message

        screened: tuple[Candidate, ...] = ()
        if direction == "to_doctor" and self._screen is not None:
            result = self._screen(text)
            screened = result or ()

        message = Message(
            id=self._new_id(), patient_id=patient_id, author_id=actor.id,
            direction=direction, text=text, at=self._clock(), screened=screened,
        )
        self._store.append_message(message)
        self._store.idem_put(submission_key, (sha256(text.encode()).hexdigest(), message))
        self._audit(actor, patient_id, "message.sent", direction)
        return message

    # -------------------------------------------------------------- alerts

    def acknowledge(
        self, actor: Actor, signal_key: SignalKey, action: AlertState, note: str = ""
    ) -> Alert:
        if actor.role is not Role.DOCTOR:
            raise Rejected(ErrorKind.ROLE, "only a doctor acknowledges")
        state = self._state(actor, signal_key.patient_id)
        candidates = self._candidates(self._latest(state.responses), state.messages)
        return self._materialise(actor, signal_key, action, note, candidates, state.alerts)

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
        self, response: Response | None, messages: Iterable[Message]
    ) -> tuple[Candidate, ...]:
        groups: list[list[Candidate]] = []
        if response is not None:
            if response.instrument_code not in self._registry:
                groups.append([self._definition_changed("шкала не загружена")])
            else:
                instrument = self._registry.get(response.instrument_code)
                if instrument.sha256 != response.definition_sha256:
                    groups.append([self._definition_changed("версия шкалы изменилась")])
                else:
                    groups.append(from_instrument(score(instrument, response.answers)))
        for message in messages:
            if message.screened:
                groups.append(list(message.screened))
        return tuple(merge(*groups))

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
            total=primary.total,
            band_label=primary.band_label,
            severity=primary.severity,
            completed=result.completed,
            required=result.required,
            at=response.submitted_at,
        )

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
