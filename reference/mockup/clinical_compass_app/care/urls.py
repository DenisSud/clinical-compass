from django.contrib.auth.views import LogoutView
from django.urls import path
from . import views

urlpatterns = [
    path("", views.home, name="home"),
    path("login/", views.CompassLoginView.as_view(), name="login"),
    path("logout/", LogoutView.as_view(), name="logout"),
    path("doctor/", views.doctor_dashboard, name="doctor_dashboard"),
    path("doctor/patients/<uuid:patient_id>/", views.patient_detail, name="patient_detail"),
    path("doctor/invitations/", views.invitations, name="invitations"),
    path("doctor/invitations/<uuid:invitation_id>/revoke/", views.revoke, name="revoke_invitation"),
    path("doctor/reports/<uuid:report_id>/review/", views.review, name="review_report"),
    path("doctor/requests/<uuid:item_id>/answer/", views.answer, name="answer_request"),
    path("doctor/relationships/<uuid:relation_id>/end/", views.disconnect, name="end_relationship"),
    path("doctor/sources/", views.sources, name="sources"),
    path("doctor/sources/<uuid:source_id>/", views.source_detail, name="source_detail"),
    path("doctor/sources/<uuid:source_id>/pages/<int:page_number>/", views.source_page, name="source_page"),
    path("doctor/sources/<uuid:source_id>/original/", views.source_original, name="source_original"),
    path("doctor/audit/", views.audit_log, name="audit_log"),
    path("patient/", views.patient_dashboard, name="patient_dashboard"),
    path("patient/connect/", views.connect, name="connect"),
    path("patient/report/", views.new_report, name="new_report"),
    path("patient/assessment/phq9/", views.new_assessment, name="new_assessment"),
    path("assessments/<uuid:assessment_id>/", views.assessment_detail, name="assessment_detail"),
    path("doctor/assessments/<uuid:assessment_id>/review/", views.assessment_review, name="assessment_review"),
    path("doctor/assessments/<uuid:assessment_id>/acknowledge/", views.assessment_acknowledge, name="assessment_acknowledge"),
    path("patient/request/", views.new_support, name="new_support"),
    path("health/", views.health, name="health"),
]
