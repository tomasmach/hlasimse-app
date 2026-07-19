from django import forms
from django.contrib.auth import get_user_model
from django.contrib.auth.forms import AuthenticationForm, UserCreationForm
from django.core.exceptions import ValidationError

from .models import MAX_INTERVAL_SECONDS, MIN_INTERVAL_SECONDS, CheckInProfile


class LoginForm(AuthenticationForm):
    username = forms.EmailField(
        label="E-mail",
        widget=forms.EmailInput(attrs={"autocomplete": "email", "autofocus": True}),
    )
    password = forms.CharField(
        label="Heslo",
        strip=False,
        widget=forms.PasswordInput(attrs={"autocomplete": "current-password"}),
    )


class RegisterForm(UserCreationForm):
    email = forms.EmailField(
        label="E-mail",
        widget=forms.EmailInput(attrs={"autocomplete": "email", "autofocus": True}),
    )
    first_name = forms.CharField(label="Jméno", max_length=150, required=False)
    last_name = forms.CharField(label="Příjmení", max_length=150, required=False)

    class Meta:
        model = get_user_model()
        fields = ("email", "first_name", "last_name", "password1", "password2")

    def clean_email(self):
        email = get_user_model().objects.normalize_email(self.cleaned_data["email"]).lower()
        if get_user_model().objects.filter(email__iexact=email).exists():
            raise ValidationError("Účet s tímto e-mailem už existuje.")
        return email

    def clean(self):
        cleaned_data = super().clean()
        if not self.data.get("terms"):
            raise ValidationError("Pro vytvoření účtu je nutné přijmout podmínky.")
        return cleaned_data


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
        help_text="Po uplynutí intervalu bez ohlášení upozorníme aktivní strážce.",
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
        self.fields["profile"].queryset = CheckInProfile.objects.filter(owner=owner).order_by(
            "created_at"
        )


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
