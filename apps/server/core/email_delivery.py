import smtplib
from urllib.parse import urlencode

from django.conf import settings
from django.core.mail import EmailMultiAlternatives, get_connection
from django.utils.html import escape

from .email_verification import verification_url
from .models import EmailVerificationChallenge, GuardianInvitation, OutboxEvent


class InvitationEmailDeliveryError(RuntimeError):
    """A transient SMTP failure that is safe for the outbox worker to retry."""


class VerificationEmailDeliveryError(RuntimeError):
    """A transient SMTP failure that is safe for the outbox worker to retry."""


def invitation_response_url(invitation: GuardianInvitation) -> str:
    query = urlencode({"invitation": str(invitation.id)})
    return f"{settings.APP_BASE_URL.rstrip('/')}/strazci/?{query}"


def send_guardian_invitation_email(*, invitation: GuardianInvitation, event: OutboxEvent) -> None:
    """Send a minimal invitation without embedding credentials or safety data."""
    response_url = invitation_response_url(invitation)
    subject = "Pozvánka ke strážení v Hlásím se"
    text_body = (
        "Dobrý den,\n\n"
        "někdo vás pozval jako strážce v aplikaci Hlásím se. "
        "Po přihlášení můžete pozvánku přijmout nebo odmítnout:\n\n"
        f"{response_url}\n\n"
        "Pozvánka platí sedm dní. Pokud ji neočekáváte, tento e-mail ignorujte.\n\n"
        "Hlásím se nenahrazuje tísňovou linku. V bezprostředním ohrožení volejte 112 nebo 155."
    )
    escaped_url = escape(response_url)
    html_body = (
        "<p>Dobrý den,</p>"
        "<p>Někdo vás pozval jako strážce v aplikaci Hlásím se. "
        "Po přihlášení můžete pozvánku přijmout nebo odmítnout.</p>"
        f'<p><a href="{escaped_url}">Zobrazit pozvánku</a></p>'
        "<p>Pozvánka platí sedm dní. Pokud ji neočekáváte, tento e-mail ignorujte.</p>"
        "<p><strong>Hlásím se nenahrazuje tísňovou linku.</strong> "
        "V bezprostředním ohrožení volejte 112 nebo 155.</p>"
    )
    message = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[invitation.normalized_email],
        connection=get_connection(fail_silently=False),
        headers={"Message-ID": f"<guardian-invitation-{event.id}@hlasim.se>"},
    )
    message.attach_alternative(html_body, "text/html")
    try:
        sent_count = message.send(fail_silently=False)
    except (smtplib.SMTPException, OSError, TimeoutError) as exc:
        raise InvitationEmailDeliveryError(
            f"SMTP invitation delivery failed: {type(exc).__name__}"
        ) from exc
    if sent_count != 1:
        raise InvitationEmailDeliveryError(
            f"SMTP invitation delivery returned unexpected count: {sent_count}"
        )


def send_verification_email(*, challenge: EmailVerificationChallenge, event: OutboxEvent) -> None:
    """Send the minimum necessary one-time ownership verification link."""
    verify_url = verification_url(challenge)
    subject = "Ověřte svůj e-mail pro Hlásím se"
    text_body = (
        "Dobrý den,\n\n"
        "pro dokončení registrace ověřte svůj e-mail tímto jednorázovým odkazem:\n\n"
        f"{verify_url}\n\n"
        "Odkaz platí 24 hodin. Pokud jste účet nevytvářeli, e-mail ignorujte."
    )
    escaped_url = escape(verify_url)
    html_body = (
        "<p>Dobrý den,</p>"
        "<p>Pro dokončení registrace ověřte svůj e-mail tímto jednorázovým odkazem.</p>"
        f'<p><a href="{escaped_url}">Ověřit e-mail</a></p>'
        "<p>Odkaz platí 24 hodin. Pokud jste účet nevytvářeli, e-mail ignorujte.</p>"
    )
    message = EmailMultiAlternatives(
        subject=subject,
        body=text_body,
        from_email=settings.DEFAULT_FROM_EMAIL,
        to=[challenge.user.email],
        connection=get_connection(fail_silently=False),
        headers={"Message-ID": f"<email-verification-{event.id}@hlasim.se>"},
    )
    message.attach_alternative(html_body, "text/html")
    try:
        sent_count = message.send(fail_silently=False)
    except (smtplib.SMTPException, OSError, TimeoutError) as exc:
        raise VerificationEmailDeliveryError(
            f"SMTP verification delivery failed: {type(exc).__name__}"
        ) from exc
    if sent_count != 1:
        raise VerificationEmailDeliveryError(
            f"SMTP verification delivery returned unexpected count: {sent_count}"
        )
