"""Seed a demonstration workspace by driving the real API in-process (ingestion, analyses, themes, mixed methods, AI, report).

Nothing here is hard-coded as a result: every number, theme, insight and report section is produced by the same code paths a user triggers.
Run:  python -m app.scripts.seed_demo
"""

from __future__ import annotations

import asyncio
import os
import sys
from pathlib import Path

os.environ["JOB_BACKEND"] = "inline"  # seeding is a one-off: run jobs in-process, no worker needed

import httpx

from app.core.config import get_settings
from app.core.logging import configure_logging

DEMO_DIR_CANDIDATES = [
    Path(__file__).resolve().parents[3] / "data" / "demo",
    Path("/app/data/demo"),
    Path("data/demo"),
]


def demo_dir() -> Path:
    for p in DEMO_DIR_CANDIDATES:
        if (p / "customer_feedback.csv").exists():
            return p
    raise SystemExit("demo data not found; run scripts/generate_demo_data.py")


class Seeder:
    def __init__(self, client: httpx.AsyncClient):
        self.c = client
        self.h: dict[str, str] = {}

    async def call(self, method: str, url: str, expect: tuple[int, ...] = (200, 201, 202, 204), **kw):
        r = await self.c.request(method, "/api/v1" + url, headers=self.h, **kw)
        if r.status_code not in expect:
            raise SystemExit(f"seed step failed: {method} {url} → {r.status_code} {r.text[:300]}")
        return r.json() if r.content else None

    async def login(self, email: str, password: str) -> None:
        r = await self.c.post(
            "/api/v1/auth/register",
            json={"email": email, "password": password, "full_name": "Demo Researcher"},
        )
        if r.status_code == 409:
            r = await self.c.post("/api/v1/auth/login", json={"email": email, "password": password})
        if r.status_code not in (200, 201):
            raise SystemExit(f"cannot sign in the demo user: {r.status_code} {r.text[:200]}")
        self.h = {"Authorization": f"Bearer {r.json()['access_token']}"}

    async def upload(self, pid: str, path: Path, name: str, description: str) -> dict:
        content = await asyncio.to_thread(path.read_bytes)
        r = await self.c.post(
            f"/api/v1/projects/{pid}/datasets",
            headers=self.h,
            files={"file": (path.name, content, "text/csv")},
            data={"name": name, "description": description},
        )
        r.raise_for_status()
        body = r.json()
        if body["job"]["status"] != "COMPLETED":
            raise SystemExit(f"ingestion failed: {body['job']['error']}")
        return body["dataset"]

    async def analysis(
        self, pid: str, vid: str, type_: str, config: dict, title: str | None = None, save: bool = False
    ) -> dict:
        body = await self.call(
            "POST",
            f"/projects/{pid}/analyses",
            json={"dataset_version_id": vid, "analysis_type": type_, "config": config, "title": title},
        )
        a = body["analysis"]
        if a["status"] != "COMPLETED":
            print(f"  ! {type_} {config} → {a['status']} {a['error']}")
            return a
        if save:
            await self.call("PATCH", f"/analyses/{a['id']}", json={"saved": True})
        return a


async def seed_customer_study(s: Seeder) -> str:
    d = demo_dir()
    p = await s.call(
        "POST",
        "/projects",
        json={
            "name": "Customer Experience Study 2026",
            "description": "Quarterly study of delivery, support and satisfaction across five regions, combining survey scores with open-ended comments.",
            "objective": "Identify what drives customer satisfaction and retention, where the experience is weakest, and whether what customers say in their own words agrees with the measured data.",
        },
    )
    pid = p["id"]
    print("project", pid)
    ds = await s.upload(
        pid,
        d / "customer_feedback.csv",
        "Customer feedback (survey + comments)",
        "600 customers: delivery, support, satisfaction, spend, retention and a free-text comment.",
    )
    v1 = ds["latest_version"]
    print(f"  dataset {ds['id']} v1 rows={v1['row_count']} warnings={len(v1['ingest_warnings'])}")
    job = await s.call(
        "POST",
        f"/datasets/{ds['id']}/versions",
        json={
            "parent_version_id": v1["id"],
            "label": "Cleaned: duplicates removed, region/plan normalised",
            "operations": [
                {"op": "drop_duplicates"},
                {"op": "normalize_categories", "column": "region", "strip": True, "case": "title"},
                {"op": "normalize_categories", "column": "plan", "strip": True, "case": "title"},
            ],
        },
    )
    vid = job["result_ref"]["version_id"]
    print("  cleaned version", vid)
    a = lambda *x, **k: s.analysis(pid, vid, *x, **k)  # noqa: E731
    await a(
        "descriptive",
        {"columns": ["satisfaction_score", "delivery_time", "monthly_spend"]},
        "Key measures: distributions",
        save=True,
    )
    await a(
        "correlation",
        {
            "variables": [
                "delivery_time",
                "support_rating",
                "satisfaction_score",
                "purchase_frequency",
                "monthly_spend",
                "age",
            ],
            "method": "pearson",
        },
        "Correlation matrix of customer measures",
        save=True,
    )
    await a(
        "correlation",
        {"variables": ["delivery_time", "satisfaction_score"], "method": "pearson"},
        "Delivery time vs satisfaction",
        save=True,
    )
    await a(
        "group_comparison",
        {"outcome": "satisfaction_score", "group": "region", "test": "auto"},
        "Satisfaction by region",
        save=True,
    )
    await a(
        "group_comparison",
        {"outcome": "satisfaction_score", "group": "plan", "test": "auto"},
        "Satisfaction by plan",
    )
    await a(
        "group_comparison",
        {"outcome": "delivery_time", "group": "region", "test": "auto"},
        "Delivery time by region",
    )
    await a("crosstab", {"row": "region", "column": "plan"}, "Region × plan mix")
    await a("frequency", {"column": "channel"}, "Channel mix")
    await a(
        "linear_regression",
        {
            "outcome": "satisfaction_score",
            "predictors": ["delivery_time", "support_rating", "plan", "region"],
            "robust_se": True,
        },
        "What drives satisfaction? (OLS)",
        save=True,
    )
    await a(
        "logistic_regression",
        {"outcome": "retained", "predictors": ["satisfaction_score", "monthly_spend", "purchase_frequency"]},
        "What predicts retention?",
        save=True,
    )
    await a(
        "time_series",
        {
            "date_column": "survey_date",
            "value_column": "satisfaction_score",
            "frequency": "M",
            "aggregation": "mean",
            "window": 3,
        },
        "Satisfaction over 2025",
        save=True,
    )
    for name, req in [
        ("Satisfaction distribution", {"kind": "histogram", "x": "satisfaction_score"}),
        ("Satisfaction by region", {"kind": "box", "x": "region", "y": "satisfaction_score"}),
        (
            "Delivery time vs satisfaction",
            {"kind": "scatter", "x": "delivery_time", "y": "satisfaction_score"},
        ),
        ("Plan mix by region", {"kind": "stacked_bar", "x": "region", "group": "plan"}),
    ]:
        await s.call(
            "POST",
            f"/projects/{pid}/visualizations",
            json={"dataset_version_id": vid, "name": name, "request": req},
        )
    # qualitative
    await s.call(
        "POST", f"/projects/{pid}/qualitative/prepare", json={"dataset_version_id": vid, "column": "comment"}
    )
    await s.call(
        "POST",
        f"/projects/{pid}/qualitative/themes/detect",
        json={"dataset_version_id": vid, "column": "comment"},
    )
    themes = (
        await s.call(
            "GET",
            f"/projects/{pid}/qualitative/themes",
            params={"dataset_version_id": vid, "column": "comment"},
        )
    )["themes"]
    print("  themes:", [(t["name"], t["response_count"]) for t in themes])
    codebook = {
        "Delivery": (
            "#1d4ed8",
            ["deliver*", "shipping", "parcel", "package", "courier", "tracking", "late", "slow"],
        ),
        "Support": (
            "#b45309",
            ["support", "helpline", "agent", "refund", "customer service", "call back", "chat bot", "ticket"],
        ),
        "Product quality": (
            "#7c3aed",
            [
                "quality",
                "broke",
                "stitching",
                "scratched",
                "flimsy",
                "battery",
                "missing from the box",
                "cheap",
            ],
        ),
        "Pricing": (
            "#be123c",
            ["price*", "pricey", "expensive", "cost", "fee*", "charges", "discount*", "value for money"],
        ),
        "Usability": (
            "#0f766e",
            [
                "app",
                "website",
                "checkout",
                "interface",
                "navigation",
                "search",
                "password",
                "crash*",
                "filters",
            ],
        ),
    }
    for name, (color, kws) in codebook.items():
        await s.call(
            "POST",
            f"/projects/{pid}/codes",
            json={
                "name": name,
                "color": color,
                "keywords": kws,
                "description": f"Responses about {name.lower()}.",
            },
        )
    await s.call(
        "POST",
        f"/projects/{pid}/qualitative/suggest-codes",
        json={"dataset_version_id": vid, "column": "comment", "use_semantic": False},
    )
    # the researcher reviews the keyword suggestions: accept them (the demo researcher agrees with whole-word keyword hits)
    while True:  # accepted suggestions leave the review queue, so keep taking page 1 until it is empty
        seg = await s.call(
            "GET",
            f"/projects/{pid}/qualitative/segments",
            params={"dataset_version_id": vid, "column": "comment", "review": True, "page_size": 100},
        )
        ids = [a["id"] for it in seg["items"] for a in it["annotations"] if a["status"] == "suggested"]
        if not ids:
            break
        await s.call(
            "POST",
            f"/projects/{pid}/qualitative/annotations/review",
            json={"annotation_ids": ids, "status": "accepted"},
        )
    # mixed methods: themes AND (multi-label) codes
    await s.call(
        "POST",
        f"/projects/{pid}/mixed",
        json={
            "dataset_version_id": vid,
            "text_column": "comment",
            "outcome": "satisfaction_score",
            "source": "themes",
        },
    )
    await s.call(
        "POST",
        f"/projects/{pid}/mixed",
        json={
            "dataset_version_id": vid,
            "text_column": "comment",
            "outcome": "satisfaction_score",
            "group": "region",
            "source": "codes",
        },
    )
    for m in await s.call("GET", f"/projects/{pid}/mixed"):
        await s.call("POST", f"/mixed/{m['id']}/synthesis")
        print(f"  mixed ({m['config']['source']}): {len(m['result']['findings'])} findings")
    # AI assistant
    conv = await s.call("POST", f"/projects/{pid}/ai/conversations", json={"dataset_version_id": vid})
    for q in [
        "Which factors appear most strongly associated with satisfaction?",
        "What are the main themes in the comments?",
        "Summarize the key findings",
    ]:
        await s.call("POST", f"/ai/conversations/{conv['id']}/messages", json={"content": q})
    await s.call("POST", f"/projects/{pid}/insights/generate", json={})
    job = await s.call(
        "POST",
        f"/projects/{pid}/reports/generate",
        json={"title": "Customer Experience Study 2026 — findings report", "dataset_version_id": vid},
    )
    print("  report", job["status"], job.get("result_ref"))
    ins = await s.call("GET", f"/projects/{pid}/insights")
    print(f"  insights: {len(ins)}")
    return pid


async def seed_employee_study(s: Seeder) -> str:
    d = demo_dir()
    p = await s.call(
        "POST",
        "/projects",
        json={
            "name": "Employee Engagement Pulse",
            "description": "Open-ended responses from a pulse survey (qualitative-only project).",
            "objective": "Understand what employees say about workload, management, growth, tooling, pay and culture.",
        },
    )
    pid = p["id"]
    ds = await s.upload(
        pid,
        d / "employee_engagement_comments.csv",
        "Engagement comments",
        "160 free-text responses with department and tenure.",
    )
    vid = ds["latest_version"]["id"]
    await s.call(
        "POST", f"/projects/{pid}/qualitative/prepare", json={"dataset_version_id": vid, "column": "comment"}
    )
    await s.call(
        "POST",
        f"/projects/{pid}/qualitative/themes/detect",
        json={"dataset_version_id": vid, "column": "comment"},
    )
    themes = (
        await s.call(
            "GET",
            f"/projects/{pid}/qualitative/themes",
            params={"dataset_version_id": vid, "column": "comment"},
        )
    )["themes"]
    print("  employee themes:", [(t["name"], t["response_count"]) for t in themes])
    await s.analysis(pid, vid, "frequency", {"column": "department"}, "Respondents by department")
    return pid


async def main() -> None:
    s = get_settings()
    configure_logging("WARNING", False)
    from app.main import create_app

    email = s.demo_user_email
    password = s.demo_user_password.get_secret_value() if s.demo_user_password else None
    if not password:
        raise SystemExit(
            "Set DEMO_USER_PASSWORD (min 10 chars, mixed case + digit) to seed the demo workspace."
        )
    app = create_app()
    async with httpx.AsyncClient(
        transport=httpx.ASGITransport(app=app), base_url="http://seed", timeout=300
    ) as client:
        seeder = Seeder(client)
        await seeder.login(email, password)
        existing = await seeder.call("GET", "/projects")
        if any(p["name"] == "Customer Experience Study 2026" for p in existing):
            print("demo workspace already present — nothing to do")
            return
        await seed_customer_study(seeder)
        await seed_employee_study(seeder)
    print(f"\nDemo ready. Sign in as {email}")


if __name__ == "__main__":
    asyncio.run(main())
    sys.exit(0)
