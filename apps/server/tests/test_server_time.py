from django.urls import reverse
from django.utils.dateparse import parse_datetime


def test_every_response_exposes_a_parseable_server_clock_sample(client):
    response = client.get(reverse("core:landing"))

    assert response.status_code == 200
    server_time = parse_datetime(response["X-Hlasimse-Server-Time"])
    assert server_time is not None
    assert server_time.tzinfo is not None


def test_api_clock_samples_cannot_be_replayed_from_an_http_cache(client):
    response = client.get("/api/v1/client-config/")

    assert response.status_code == 200
    assert "no-store" in response["Cache-Control"]
    assert response["Pragma"] == "no-cache"
