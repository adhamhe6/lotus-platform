from __future__ import annotations

import pandas as pd
import pytest

from tests.helpers import csv_bytes, survey_frame, xlsx_bytes
from tests.integration.conftest import make_user

pytestmark = pytest.mark.integration


async def new_project(api, name="Study"):
    return (await api.post("/projects", json={"name": name})).json()


async def upload(api, pid, content: bytes, filename="survey.csv", ctype="text/csv", **data):
    return await api.post(f"/projects/{pid}/datasets", files={"file": (filename, content, ctype)}, data=data)


async def test_csv_upload_ingestion_profile_and_preview(alice):
    p = await new_project(alice)
    df = survey_frame()
    r = await upload(alice, p["id"], csv_bytes(df), name="Survey")
    assert r.status_code == 202, r.text
    body = r.json()
    assert body["job"]["status"] == "COMPLETED" and body["job"]["progress"] == 1.0  # inline backend finished synchronously
    ds = body["dataset"]
    assert ds["status"] == "READY" and ds["latest_version"]["row_count"] == len(df) and ds["latest_version"]["kind"] == "original"
    prof = (await alice.get(f"/datasets/{ds['id']}/profile")).json()
    cols = {c["name"]: c for c in prof["columns"]}
    assert cols["delivery_time"]["semantic_type"] == "numeric_continuous"
    assert cols["region"]["semantic_type"] == "categorical" and cols["survey_date"]["semantic_type"] == "datetime"
    assert cols["customer_id"]["semantic_type"] == "identifier" and cols["support_rating"]["semantic_type"] == "numeric_discrete"
    # profile numbers are the real statistics of the data
    d = cols["delivery_time"]["profile"]
    assert d["mean"] == pytest.approx(df["delivery_time"].mean()) and d["median"] == pytest.approx(df["delivery_time"].median())
    assert d["std"] == pytest.approx(df["delivery_time"].std(ddof=1)) and d["count"] == len(df)
    assert sum(d["histogram"]["counts"]) == len(df)
    assert {t["value"]: t["count"] for t in cols["region"]["profile"]["top_values"]} == df["region"].value_counts().to_dict()
    # preview pagination / sort / filter
    pv = (await alice.get(f"/datasets/{ds['id']}/preview", params={"page": 2, "page_size": 25})).json()
    assert pv["total"] == len(df) and len(pv["rows"]) == 25 and pv["rows"][0]["customer_id"] == "C0025" and pv["row_offset"] == 25
    srt = (await alice.get(f"/datasets/{ds['id']}/preview", params={"sort": "satisfaction", "order": "desc", "page_size": 3})).json()
    assert srt["rows"][0]["satisfaction"] == df["satisfaction"].max()
    flt = (await alice.get(f"/datasets/{ds['id']}/preview", params={"filters": '[{"column":"region","operator":"eq","value":"West"}]', "page_size": 200})).json()
    assert flt["total"] == int((df["region"] == "West").sum()) and all(r["region"] == "West" for r in flt["rows"])
    bad = await alice.get(f"/datasets/{ds['id']}/preview", params={"sort": "nope"})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "UNKNOWN_COLUMN"


async def test_xlsx_upload(alice):
    p = await new_project(alice)
    df = survey_frame(60)
    r = await upload(alice, p["id"], xlsx_bytes(df), "survey.xlsx", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet")
    assert r.status_code == 202 and r.json()["dataset"]["status"] == "READY"
    prof = (await alice.get(f"/datasets/{r.json()['dataset']['id']}/profile")).json()
    assert prof["version"]["row_count"] == 60 and {c["name"]: c["semantic_type"] for c in prof["columns"]}["survey_date"] == "datetime"


@pytest.mark.parametrize(("name", "content", "status", "code"), [
    ("empty.csv", b"", 422, "EMPTY_FILE"),
    ("notes.pdf", b"%PDF-1.4 hello", 415, "UNSUPPORTED_FILE"),
    ("evil.csv", b"%PDF-1.4 binary", 415, "UNSUPPORTED_FILE"),
    ("fake.xlsx", b"a,b\n1,2\n", 415, "UNSUPPORTED_FILE"),
    ("blob.csv", b"a,b\x00\x01\x02\n", 415, "UNSUPPORTED_FILE"),
])
async def test_rejected_uploads(alice, name, content, status, code):
    p = await new_project(alice)
    r = await upload(alice, p["id"], content, name)
    assert r.status_code == status and r.json()["error"]["code"] == code
    assert (await alice.get(f"/projects/{p['id']}/datasets")).json() == []  # nothing half-created


@pytest.mark.parametrize(("content", "code"), [
    (b"a,b,c\n", "EMPTY_DATASET"),
    (b"a,b\n1,2\n3,4,5,6\n", "MALFORMED_FILE"),
    (b"\n\n\n", "EMPTY_DATASET"),
])
async def test_processing_failures_are_reported_not_raised(alice, content, code):
    p = await new_project(alice)
    r = await upload(alice, p["id"], content)
    assert r.status_code == 202
    body = r.json()
    assert body["job"]["status"] == "FAILED" and body["job"]["error"]["code"] == code
    assert body["dataset"]["status"] == "FAILED" and body["dataset"]["error"]["code"] == code
    n = (await alice.get("/notifications")).json()
    assert n and n[0]["kind"] == "job_failed"


async def test_duplicate_columns_invalid_numbers_and_cp1252(alice):
    p = await new_project(alice)
    raw = "name;score;score;note\nAna;1,5;2;caf\xe9\nBob;x;3;ok\nCy;3;4;ok\nDi;4;5;ok\nEd;5;6;ok\nFay;6;7;ok\n".encode("cp1252")
    r = await upload(alice, p["id"], raw)
    ds = r.json()["dataset"]
    assert ds["status"] == "READY"
    codes = {w["code"] for w in ds["latest_version"]["ingest_warnings"]}
    assert {"DUPLICATE_COLUMN", "ENCODING_FALLBACK"} <= codes
    cols = [c["name"] for c in (await alice.get(f"/datasets/{ds['id']}/profile")).json()["columns"]]
    assert cols == ["name", "score", "score_2", "note"]
    pv = (await alice.get(f"/datasets/{ds['id']}/preview")).json()
    assert pv["rows"][0]["note"] == "café"


async def test_mixed_numeric_text_column_is_flagged_not_silently_coerced(alice):
    p = await new_project(alice)
    vals = [str(i) for i in range(1, 40)] + ["abc"]
    content = ("id,v\n" + "\n".join(f"{i},{v}" for i, v in enumerate(vals))).encode()
    ds = (await upload(alice, p["id"], content)).json()["dataset"]
    assert any(w["code"] == "MIXED_NUMERIC_TEXT" for w in ds["latest_version"]["ingest_warnings"])
    cols = {c["name"]: c for c in (await alice.get(f"/datasets/{ds['id']}/profile")).json()["columns"]}
    assert cols["v"]["dtype"] != "float64"  # remained text — nothing was fabricated or dropped


async def test_oversized_upload_rejected(alice, monkeypatch):
    from app.core.config import get_settings

    monkeypatch.setattr(get_settings(), "max_upload_mb", 1)
    p = await new_project(alice)
    big = b"a,b\n" + b"1,2\n" * 400_000
    r = await upload(alice, p["id"], big)
    assert r.status_code == 413 and r.json()["error"]["code"] == "PAYLOAD_TOO_LARGE"


async def test_versions_are_non_destructive_and_reproducible(alice):
    p = await new_project(alice)
    df = survey_frame(100)
    df.loc[3, "satisfaction"] = None
    dup = pd.concat([df, df.head(5)], ignore_index=True)
    ds = (await upload(alice, p["id"], csv_bytes(dup))).json()["dataset"]
    v1 = ds["latest_version"]
    assert v1["quality"]["duplicate_rows"] == 5
    ops = [{"op": "drop_duplicates"}, {"op": "fill_missing", "column": "satisfaction", "strategy": "median"},
           {"op": "normalize_categories", "column": "region", "case": "upper"}]
    dry = (await alice.post(f"/datasets/{ds['id']}/versions", json={"operations": ops, "dry_run": True})).json()
    assert dry["rows_before"] == 105 and dry["rows_after"] == 100
    r = await alice.post(f"/datasets/{ds['id']}/versions", json={"operations": ops, "label": "Cleaned"})
    assert r.status_code == 202 and r.json()["status"] == "COMPLETED"
    versions = (await alice.get(f"/datasets/{ds['id']}/versions")).json()
    assert [v["version_number"] for v in versions] == [1, 2]
    v2 = versions[1]
    assert v2["parent_version_id"] == v1["id"] and v2["row_count"] == 100 and v2["kind"] == "transformed" and v2["label"] == "Cleaned"
    assert v2["transformation"]["operations"] == ops and v2["transformation"]["log"][0]["rows_after"] == 100
    assert v2["quality"]["missing_cells"] < v1["quality"]["missing_cells"]
    # original untouched
    p1 = (await alice.get(f"/datasets/{ds['id']}/preview", params={"version_id": v1["id"]})).json()
    assert p1["total"] == 105
    p2 = (await alice.get(f"/datasets/{ds['id']}/preview", params={"version_id": v2["id"], "page_size": 200})).json()
    assert all(r["region"] in ("NORTH", "SOUTH", "WEST") for r in p2["rows"])
    # idempotent: same ops on same parent → same version, no duplicate
    again = await alice.post(f"/datasets/{ds['id']}/versions", json={"operations": ops, "label": "Cleaned", "parent_version_id": v1["id"]})
    assert again.status_code == 202 and again.json()["result_ref"]["version_id"] == v2["id"]
    assert len((await alice.get(f"/datasets/{ds['id']}/versions")).json()) == 2
    # invalid op
    bad = await alice.post(f"/datasets/{ds['id']}/versions", json={"operations": [{"op": "explode"}]})
    assert bad.status_code == 422 and bad.json()["error"]["code"] == "INVALID_TRANSFORMATION"
    bad2 = await alice.post(f"/datasets/{ds['id']}/versions", json={"operations": [{"op": "filter_rows", "column": "region", "operator": "eq", "value": "Nowhere"}]})
    assert bad2.json()["status"] == "FAILED" and bad2.json()["error"]["code"] == "EMPTY_RESULT"


async def test_dataset_isolation_between_users(client, alice, bob):
    p = await new_project(alice)
    ds = (await upload(alice, p["id"], csv_bytes(survey_frame(50)))).json()["dataset"]
    for path in (f"/datasets/{ds['id']}", f"/datasets/{ds['id']}/profile", f"/datasets/{ds['id']}/preview", f"/datasets/{ds['id']}/versions", f"/projects/{p['id']}/datasets"):
        assert (await bob.get(path)).status_code == 404, path
    assert (await bob.delete(f"/datasets/{ds['id']}")).status_code == 404
    assert (await upload(bob, p["id"], csv_bytes(survey_frame(50)))).status_code == 404
    await alice.post(f"/projects/{p['id']}/members", json={"email": "bob@example.com", "role": "VIEWER"})
    assert (await bob.get(f"/datasets/{ds['id']}/preview")).status_code == 200
    assert (await upload(bob, p["id"], csv_bytes(survey_frame(50)))).status_code == 403
    assert (await bob.delete(f"/datasets/{ds['id']}")).status_code == 403


async def test_uploaded_files_are_not_web_accessible_and_names_are_sanitised(alice, client):
    from app.core.config import get_settings

    p = await new_project(alice)
    r = await upload(alice, p["id"], csv_bytes(survey_frame(30)), "../../etc/passwd.csv")
    ds = r.json()["dataset"]
    assert ds["original_filename"] == "passwd.csv"
    for path in ("/storage/raw", "/api/v1/storage", "/static/raw", "/raw"):
        assert (await client.get(path)).status_code == 404
    files = list((get_settings().storage_dir / "raw").glob("*"))
    assert files and all(f.name.count(".") == 1 and len(f.stem) == 32 for f in files)
