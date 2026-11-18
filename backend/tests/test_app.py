"""App-level behaviour: health, auth modes, startup checks, headers, rate limit."""
import pytest

import main


def test_health(client):
    r = client.get("/health")
    assert r.status_code == 200
    assert r.json() == {"status": "ok"}


@pytest.mark.parametrize("value", [None, "", "   "])
def test_unset_or_blank_key_means_open_mode(client, monkeypatch, value):
    # docker-compose.yml passes BACKEND_API_KEY empty by default; that must not 403/500
    if value is None:
        monkeypatch.delenv("BACKEND_API_KEY", raising=False)
    else:
        monkeypatch.setenv("BACKEND_API_KEY", value)
    r = client.post("/transcribe/musicxml2midi", files={"file": ("x.txt", b"hi")})
    assert r.status_code == 422  # reached the route: not 403, not a 500


def test_key_set_rejects_missing_or_wrong_key(client, monkeypatch):
    monkeypatch.setenv("BACKEND_API_KEY", "s3cret")
    assert client.post("/fingering/generate", json={"musicxml": ""}).status_code == 403
    r = client.post(
        "/fingering/generate", json={"musicxml": ""}, headers={"X-API-Key": "nope"}
    )
    assert r.status_code == 403


def test_key_set_accepts_correct_key(client, monkeypatch):
    monkeypatch.setenv("BACKEND_API_KEY", "s3cret")
    r = client.post(
        "/transcribe/musicxml2midi",
        files={"file": ("x.txt", b"hi")},
        headers={"X-API-Key": "s3cret"},
    )
    assert r.status_code == 422  # got past auth, rejected on file type


def test_health_is_also_behind_the_key(client, monkeypatch):
    # The dependency is app-wide; documents current behaviour
    monkeypatch.setenv("BACKEND_API_KEY", "s3cret")
    assert client.get("/health").status_code == 403


@pytest.mark.parametrize("flag", ["1", "true", "YES"])
@pytest.mark.parametrize("key", [None, "", "  "])
def test_require_auth_without_key_refuses_to_start(monkeypatch, flag, key):
    monkeypatch.setenv("REQUIRE_AUTH", flag)
    if key is None:
        monkeypatch.delenv("BACKEND_API_KEY", raising=False)
    else:
        monkeypatch.setenv("BACKEND_API_KEY", key)
    with pytest.raises(SystemExit):
        main._startup_checks()


def test_require_auth_with_key_starts(monkeypatch):
    monkeypatch.setenv("REQUIRE_AUTH", "1")
    monkeypatch.setenv("BACKEND_API_KEY", "s3cret")
    main._startup_checks()  # no exception


def test_security_headers(client):
    h = client.get("/health").headers
    assert h["X-Content-Type-Options"] == "nosniff"
    assert h["X-Frame-Options"] == "DENY"
    assert h["Referrer-Policy"] == "no-referrer"
    assert "max-age=" in h["Strict-Transport-Security"]


def test_rate_limit(client, monkeypatch):
    monkeypatch.setattr(main, "_RATE_LIMIT", 2)
    main._rate_window.clear()
    codes = [client.post("/fingering/generate", json={}).status_code for _ in range(3)]
    main._rate_window.clear()
    assert codes[:2] != [429, 429]
    assert codes[2] == 429


def test_health_is_not_rate_limited(client, monkeypatch):
    monkeypatch.setattr(main, "_RATE_LIMIT", 1)
    main._rate_window.clear()
    assert all(client.get("/health").status_code == 200 for _ in range(3))
    main._rate_window.clear()
