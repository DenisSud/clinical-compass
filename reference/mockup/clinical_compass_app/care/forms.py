import uuid
from django import forms
from django.contrib.auth.forms import AuthenticationForm
from django.utils import timezone
from .models import SupportRequest
from . import assessments


class LoginForm(AuthenticationForm):
    username = forms.CharField(label="Логин", widget=forms.TextInput(attrs={"autocomplete": "username", "autofocus": True}))
    password = forms.CharField(label="Пароль", widget=forms.PasswordInput(attrs={"autocomplete": "current-password"}))
    error_messages = {"invalid_login": "Не удалось войти. Проверьте данные; после нескольких ошибок повторите попытку через 10 минут.", "inactive": "Не удалось войти."}


class ReportForm(forms.Form):
    submission_key = forms.UUIDField(widget=forms.HiddenInput, initial=uuid.uuid4)
    reported_for = forms.DateField(label="За какую дату", initial=timezone.localdate, widget=forms.DateInput(attrs={"type": "date"}, format="%Y-%m-%d"))
    wellbeing = forms.TypedChoiceField(
        label="Как вы оцениваете своё самочувствие?", required=False, coerce=int, empty_value=None,
        choices=[("", "Не хочу оценивать")] + [(i, str(i)) for i in range(1, 11)],
        help_text="Личная оценка от 1 до 10. Это дневник самочувствия, не диагностическая шкала.",
    )
    note = forms.CharField(label="Что изменилось", required=False, max_length=2000,
                          widget=forms.Textarea(attrs={"rows": 4, "placeholder": "Например: стало легче соблюдать привычный режим дня"}))

    def clean_reported_for(self):
        value = self.cleaned_data["reported_for"]
        if value > timezone.localdate():
            raise forms.ValidationError("Выберите сегодняшнюю или прошедшую дату.")
        return value

    def clean(self):
        data = super().clean()
        if data.get("wellbeing") is None and not data.get("note", "").strip():
            raise forms.ValidationError("Выберите оценку или добавьте комментарий.")
        return data


class SupportForm(forms.Form):
    submission_key = forms.UUIDField(widget=forms.HiddenInput, initial=uuid.uuid4)
    category = forms.ChoiceField(label="Тема обращения", choices=SupportRequest.Category.choices)
    body = forms.CharField(label="Ваш вопрос", max_length=2000, widget=forms.Textarea(attrs={"rows": 4}))


class AnswerForm(forms.Form):
    response = forms.CharField(label="Ответ пациенту", max_length=3000, widget=forms.Textarea(attrs={"rows": 4}))


class ConnectForm(forms.Form):
    code = forms.CharField(label="Код приглашения", max_length=80, min_length=20, widget=forms.TextInput(attrs={"autocomplete": "off", "spellcheck": "false"}))


class AssessmentForm(forms.Form):
    submission_key = forms.UUIDField(widget=forms.HiddenInput, initial=uuid.uuid4)
    content_token = forms.CharField(widget=forms.HiddenInput, initial=assessments.form_token)

    def __init__(self, *args, **kwargs):
        super().__init__(*args, **kwargs)
        options = [(str(value), label) for value, label in assessments.DEFINITION["options"]] + [("skip", "Не хочу отвечать")]
        for number, item in enumerate(assessments.DEFINITION["items"], start=1):
            self.fields[item["key"]] = forms.ChoiceField(label=f'{number}. {item["text"]}', choices=options,
                widget=forms.RadioSelect, error_messages={"required": "Выберите ответ или явно отметьте пропуск."})
        self.fields["difficulty"] = forms.ChoiceField(label=assessments.DEFINITION["difficulty_question"], required=False,
            choices=[("", "Не применимо / не указано")] + [(str(i), text) for i, text in enumerate(assessments.DEFINITION["difficulty_options"])])
        self.fields["adult"] = forms.BooleanField(label="Мне 18 лет или больше. Я заполняю опросник за себя.")

    def clean(self):
        data = super().clean()
        if all(key in data for key in assessments.KEYS):
            data["answers"] = {key: None if data[key] == "skip" else int(data[key]) for key in assessments.KEYS}
            difficulty = data.get("difficulty")
            data["difficulty"] = int(difficulty) if difficulty not in {"", None} else None
            if any(value is not None and value > 0 for value in data["answers"].values()) and data["difficulty"] is None:
                self.add_error("difficulty", "При отмеченных проблемах выберите степень затруднений.")
        return data
