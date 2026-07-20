from django import forms
from django.contrib.auth import get_user_model
from django.contrib.auth.forms import AuthenticationForm
from django.contrib.auth.password_validation import validate_password
from django.core.exceptions import ValidationError

from .models import MAX_INTERVAL_SECONDS, MIN_INTERVAL_SECONDS, CheckInProfile


class LoginForm(AuthenticationForm):
    error_messages = {
        "invalid_login": ("E-mail nebo heslo není správné, případně e-mail ještě nebyl ověřený."),
        "inactive": "Tento účet není aktivní.",
    }
    username = forms.EmailField(
        label="E-mail",
        widget=forms.EmailInput(attrs={"autocomplete": "email", "autofocus": True}),
    )
    password = forms.CharField(
        label="Heslo",
        strip=False,
        widget=forms.PasswordInput(attrs={"autocomplete": "current-password"}),
    )


class RegisterForm(forms.Form):
    email = forms.EmailField(
        label="E-mail",
        widget=forms.EmailInput(attrs={"autocomplete": "email", "autofocus": True}),
    )
    first_name = forms.CharField(label="Jméno", max_length=150, required=False)
    last_name = forms.CharField(label="Příjmení", max_length=150, required=False)
    password1 = forms.CharField(
        label="Heslo",
        strip=False,
        widget=forms.PasswordInput(attrs={"autocomplete": "new-password"}),
    )
    password2 = forms.CharField(
        label="Heslo znovu",
        strip=False,
        widget=forms.PasswordInput(attrs={"autocomplete": "new-password"}),
    )

    def clean_email(self):
        return get_user_model().objects.normalize_email(self.cleaned_data["email"]).lower()

    def clean(self):
        cleaned_data = super().clean()
        password = cleaned_data.get("password1")
        if password and password != cleaned_data.get("password2"):
            self.add_error("password2", "Hesla se neshodují.")
        elif password:
            try:
                validate_password(password)
            except ValidationError as exc:
                self.add_error("password1", exc)
        if not self.data.get("terms"):
            raise ValidationError("Pro vytvoření účtu je nutné přijmout podmínky.")
        return cleaned_data


class EmailVerificationResendForm(forms.Form):
    email = forms.EmailField(
        label="E-mail",
        widget=forms.EmailInput(attrs={"autocomplete": "email", "autofocus": True}),
    )

    def clean_email(self):
        return get_user_model().objects.normalize_email(self.cleaned_data["email"]).lower()


INTERVAL_CHOICES = (
    (3_600, "1 hodina"),
    (7_200, "2 hodiny"),
    (14_400, "4 hodiny"),
    (28_800, "8 hodin"),
    (43_200, "12 hodin"),
    (86_400, "24 hodin"),
    (172_800, "2 dny"),
    (259_200, "3 dny"),
    (604_800, "7 dní"),
)


class CheckInProfileForm(forms.ModelForm):
    interval_seconds = forms.TypedChoiceField(
        label="Interval ohlášení",
        choices=INTERVAL_CHOICES,
        coerce=int,
        help_text=(
            "Po uplynutí intervalu bez ohlášení server vytvoří incident a pokusí se "
            "upozornit aktivní strážce best-effort push notifikací."
        ),
    )

    class Meta:
        model = CheckInProfile
        fields = ("name", "interval_seconds")
        labels = {"name": "Název profilu"}
        widgets = {"name": forms.TextInput(attrs={"autocomplete": "name"})}

    def clean_interval_seconds(self):
        value = self.cleaned_data["interval_seconds"]
        if not MIN_INTERVAL_SECONDS <= value <= MAX_INTERVAL_SECONDS or value % 60:
            raise ValidationError("Interval musí být od jedné hodiny do sedmi dní.")
        return value


class PauseProfileForm(forms.Form):
    paused_until = forms.DateTimeField(
        label="Automaticky obnovit",
        required=False,
        input_formats=("%Y-%m-%dT%H:%M",),
        widget=forms.DateTimeInput(attrs={"type": "datetime-local"}),
        help_text="Nepovinné. Bez data profil obnovíte později ručně.",
    )


class BrowserCheckInForm(forms.Form):
    """Validate one-shot browser coordinates without ever making them required."""

    location_requested = forms.BooleanField(required=False)
    latitude = forms.DecimalField(
        required=False,
        max_digits=9,
        decimal_places=6,
        min_value=-90,
        max_value=90,
    )
    longitude = forms.DecimalField(
        required=False,
        max_digits=9,
        decimal_places=6,
        min_value=-180,
        max_value=180,
    )
    location_accuracy_meters = forms.DecimalField(
        required=False,
        max_digits=10,
        decimal_places=2,
        min_value=0,
        max_value=1_000_000,
    )

    def clean(self):
        cleaned_data = super().clean()
        latitude = cleaned_data.get("latitude")
        longitude = cleaned_data.get("longitude")
        accuracy = cleaned_data.get("location_accuracy_meters")
        if (latitude is None) != (longitude is None):
            raise ValidationError("Souřadnice musí obsahovat šířku i délku.")
        if accuracy is not None and latitude is None:
            raise ValidationError("Přesnost polohy vyžaduje souřadnice.")
        return cleaned_data


class GuardianInvitationForm(forms.Form):
    profile = forms.ModelChoiceField(
        label="Profil",
        queryset=CheckInProfile.objects.none(),
        empty_label=None,
    )
    email = forms.EmailField(
        label="E-mail strážce",
        widget=forms.EmailInput(attrs={"autocomplete": "email"}),
    )

    def __init__(self, *args, owner, **kwargs):
        super().__init__(*args, **kwargs)
        self.fields["profile"].queryset = CheckInProfile.objects.filter(
            owner=owner,
            archived_at__isnull=True,
        ).order_by("created_at")


class AccountSettingsForm(forms.ModelForm):
    email = forms.EmailField(label="E-mail", disabled=True)

    class Meta:
        model = get_user_model()
        fields = ("email", "first_name", "last_name")
        labels = {"first_name": "Jméno", "last_name": "Příjmení"}


class ExportDataForm(forms.Form):
    confirmation = forms.BooleanField(
        label="Rozumím, že export obsahuje citlivé osobní údaje.",
        required=True,
    )


class DeleteAccountForm(forms.Form):
    password = forms.CharField(
        label="Současné heslo",
        strip=False,
        widget=forms.PasswordInput(attrs={"autocomplete": "current-password"}),
    )
    confirmation = forms.CharField(
        label="Pro potvrzení napište SMAZAT",
        strip=True,
        widget=forms.TextInput(attrs={"autocomplete": "off"}),
    )

    def clean_confirmation(self):
        value = self.cleaned_data["confirmation"]
        if value != "SMAZAT":
            raise ValidationError("Napište přesně SMAZAT.")
        return value

    def clean(self):
        cleaned_data = super().clean()
        if not self.data.get("understood"):
            raise ValidationError("Potvrďte, že rozumíte následkům smazání účtu.")
        return cleaned_data
