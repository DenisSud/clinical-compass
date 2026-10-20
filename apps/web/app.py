"""Routes: HTTP in, `Clinical` calls out.

Nothing here decides who may see what, which patient comes first, or what a score
means. Those questions are answered one layer down, once, and this file is not
allowed to answer them again.
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from pathlib import Path
from urllib.parse import quote
from zoneinfo import ZoneInfo

from fastapi import FastAPI, Form, Request
from fastapi.responses import HTMLResponse, RedirectResponse
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

from apps.api.clinic import Actor, ErrorKind, Rejected, Role
from compass.insights import maximum_of

from . import auth, db
from .charts import HEIGHT, WIDTH, sparkline

ROOT = Path(__file__).resolve().parents[2]

#: A datetime-local field carries no zone. The clinic's zone is the only sane
#: reading, and guessing UTC silently moves every appointment by three hours.
CLINIC_ZONE = ZoneInfo("Europe/Moscow")
TEMPLATES = Jinja2Templates(directory=str(Path(__file__).parent / "templates"))


def _fmt_dt(value: datetime | None) -> str:
    return value.strftime("%d.%m.%Y %H:%M") if value else "—"


def _fmt_day(value: datetime | date | None) -> str:
    return value.strftime("%d.%m.%Y") if value is not None else "—"


def _fmt_kind(value: str) -> str:
    return {"doctor": "врач", "patient": "пациент"}.get(value, value)


TEMPLATES.env.filters.update(
    dt=_fmt_dt, day=_fmt_day, role=_fmt_kind,
)
TEMPLATES.env.globals.update(chart_height=HEIGHT, chart_width=WIDTH)


def create_app(db_path: Path | None = None) -> FastAPI:
    app = FastAPI(title="Клинический компас", docs_url="/api/docs")
    app.state.clinical = db.connect(db_path)
    app.state.authdb = auth.open_db(Path(db_path) if db_path else db.DEFAULT_PATH)
    # The prototypes' stylesheet is the app's design system: one file, one
    # source. A copy would drift the day someone edits a token.
    app.mount("/ux", StaticFiles(directory=str(ROOT / "docs" / "ux")), name="ux")
    app.mount("/static", StaticFiles(directory=str(Path(__file__).parent / "static")),
              name="static")

    # ------------------------------------------------------------ helpers

    def current(request: Request) -> auth.User | None:
        return auth.session_user(
            request.app.state.authdb, request.cookies.get(auth.SESSION_COOKIE)
        )

    def doctor_or_login(request: Request) -> auth.User | RedirectResponse:
        user = current(request)
        if user is None:
            return RedirectResponse("/login", status_code=303)
        if user.role != "doctor":
            return RedirectResponse("/today", status_code=303)
        return user

    def patient_or_login(request: Request) -> auth.User | RedirectResponse:
        user = current(request)
        if user is None:
            return RedirectResponse("/login", status_code=303)
        if user.role != "patient":
            return RedirectResponse("/panel", status_code=303)
        return user

    def render(request: Request, template: str, **context) -> HTMLResponse:
        return TEMPLATES.TemplateResponse(
            request, template, {"user": current(request), **context}
        )

    # -------------------------------------------------------------- auth

    @app.get("/", response_class=HTMLResponse)
    def index(request: Request):
        user = current(request)
        if user is None:
            return RedirectResponse("/login", status_code=303)
        return RedirectResponse("/panel" if user.role == "doctor" else "/today",
                                status_code=303)

    @app.get("/login", response_class=HTMLResponse)
    def login_form(request: Request):
        return render(request, "login.html", error="")

    @app.post("/login")
    def login(request: Request, email: str = Form(""), password: str = Form("")):
        row = auth.find_by_email(request.app.state.authdb, email)
        if row is None or not auth.verify_password(password, row["password_hash"]):
            return render(request, "login.html", error="Неверная почта или пароль")
        token = auth.create_session(request.app.state.authdb, row["id"])
        user = auth.to_user(row)
        response = RedirectResponse(
            "/panel" if user.role == "doctor" else "/today", status_code=303
        )
        response.set_cookie(
            auth.SESSION_COOKIE, token, httponly=True, samesite="lax",
            max_age=int(auth.SESSION_TTL.total_seconds()),
        )
        return response

    @app.get("/enter/{token}")
    def enter(request: Request, token: str):
        row = auth.find_by_token(request.app.state.authdb, token)
        if row is None:
            return RedirectResponse("/login", status_code=303)
        session = auth.create_session(request.app.state.authdb, row["id"])
        response = RedirectResponse("/today", status_code=303)
        response.set_cookie(
            auth.SESSION_COOKIE, session, httponly=True, samesite="lax",
            max_age=int(auth.SESSION_TTL.total_seconds()),
        )
        return response

    @app.post("/logout")
    def logout(request: Request):
        auth.drop_session(
            request.app.state.authdb, request.cookies.get(auth.SESSION_COOKIE)
        )
        response = RedirectResponse("/login", status_code=303)
        response.delete_cookie(auth.SESSION_COOKIE)
        return response

    # ------------------------------------------------------------- doctor

    @app.get("/panel", response_class=HTMLResponse)
    def panel(request: Request):
        user = doctor_or_login(request)
        if isinstance(user, RedirectResponse):
            return user
        clinical = request.app.state.clinical
        rows = clinical.patients(Actor(user.id, Role.DOCTOR))
        return render(request, "panel.html", rows=rows,
                      visits=clinical.visits(Actor(user.id, Role.DOCTOR)))

    @app.get("/panel/{patient_id}", response_class=HTMLResponse)
    def patient_card(request: Request, patient_id: str, error: str = ""):
        user = doctor_or_login(request)
        if isinstance(user, RedirectResponse):
            return user
        clinical = request.app.state.clinical
        try:
            board = clinical.dashboard(Actor(user.id, Role.DOCTOR), patient_id)
        except Rejected:
            return RedirectResponse("/panel", status_code=303)
        daily = next((s for s in board.series if s.kind == "daily_check"), None)
        points = [(p.at.date(), p.total) for p in daily.points if p.total is not None] if daily else []
        chart = sparkline(points, daily.maximum if daily else 0)
        return render(request, "patient.html", board=board, daily=daily,
                      chart=chart, points=points, error=error)

    @app.post("/panel/{patient_id}/visits")
    def schedule(request: Request, patient_id: str, when: str = Form(""),
                 kind: str = Form("консультация")):
        user = doctor_or_login(request)
        if isinstance(user, RedirectResponse):
            return user
        try:
            scheduled = datetime.fromisoformat(when).replace(tzinfo=CLINIC_ZONE)
        except ValueError:
            message = "не удалось прочитать время приёма"
        else:
            try:
                request.app.state.clinical.schedule_visit(
                    Actor(user.id, Role.DOCTOR), patient_id, scheduled, kind
                )
            except Rejected as refused:
                message = refused.message
            else:
                message = ""
        target = f"/panel/{patient_id}"
        if message:
            # The design says a refusal carries its reason to the screen.
            # Swallowing it here is how a UI bug starts to look like a click.
            return RedirectResponse(f"{target}?error={quote(message)}", status_code=303)
        return RedirectResponse(target, status_code=303)

    @app.get("/visits", response_class=HTMLResponse)
    def visits(request: Request):
        user = doctor_or_login(request)
        if isinstance(user, RedirectResponse):
            return user
        clinical = request.app.state.clinical
        actor = Actor(user.id, Role.DOCTOR)
        board_rows = {r.patient.id: r for r in clinical.patients(actor)}
        upcoming = [v for v in clinical.visits(actor) if v.status == "planned"]
        return render(request, "visits.html", visits=upcoming, rows=board_rows,
                      now=datetime.now())

    # ------------------------------------------------------------ patient

    @app.get("/today", response_class=HTMLResponse)
    def today(request: Request, saved: str = ""):
        user = patient_or_login(request)
        if isinstance(user, RedirectResponse):
            return user
        clinical = request.app.state.clinical
        view = clinical.today(Actor(user.patient_id, Role.PATIENT))
        return render(request, "today.html", view=view, name=user.display,
                      saved=bool(saved))

    @app.get("/tests/{assignment_id}", response_class=HTMLResponse)
    def test_form(request: Request, assignment_id: str):
        user = patient_or_login(request)
        if isinstance(user, RedirectResponse):
            return user
        clinical = request.app.state.clinical
        view = clinical.today(Actor(user.patient_id, Role.PATIENT))
        due = next((d for d in view.due if d.assignment_id == assignment_id), None)
        if due is None:
            return RedirectResponse("/today", status_code=303)
        return render(request, "test.html", test=due)

    @app.post("/tests/{assignment_id}")
    async def test_submit(request: Request, assignment_id: str):
        user = patient_or_login(request)
        if isinstance(user, RedirectResponse):
            return user
        clinical = request.app.state.clinical
        actor = Actor(user.patient_id, Role.PATIENT)
        form = await request.form()
        answers = {
            key[2:]: int(value)
            for key, value in form.items()
            if key.startswith("q_") and str(value).isdigit()
        }
        view = clinical.today(actor)
        due = next((d for d in view.due if d.assignment_id == assignment_id), None)
        if due is None:
            return render(
                request, "expired.html",
                message="Эта анкета уже отправлена или её срок вышел. "
                        "Ответ не сохранён.",
            )
        missing = [q.key for q in due.items if q.key not in answers]
        if missing:
            return render(request, "test.html", test=due,
                          error=f"Остались вопросы без ответа: {len(missing)}")
        try:
            clinical.submit_response(
                actor, assignment_id, answers,
                submission_key=f"{assignment_id}:{len(answers)}:{sum(answers.values())}",
            )
        except Rejected as refused:
            return render(request, "test.html", test=due, error=refused.message)
        return RedirectResponse("/today?saved=1", status_code=303)

    @app.get("/my", response_class=HTMLResponse)
    def my_history(request: Request):
        user = patient_or_login(request)
        if isinstance(user, RedirectResponse):
            return user
        clinical = request.app.state.clinical
        actor = Actor(user.patient_id, Role.PATIENT)
        view = clinical.today(actor)
        return render(request, "my.html", view=view,
                      visits=clinical.visits(actor), name=user.display)

    return app


app = create_app()
