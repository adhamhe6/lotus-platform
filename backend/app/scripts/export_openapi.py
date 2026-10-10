"""Write the OpenAPI document to docs/openapi.json (the frontend generates its TypeScript types from it)."""

from __future__ import annotations

import json
import os
import sys
from pathlib import Path

os.environ.setdefault("SECRET_KEY", "openapi-export-secret-openapi-export-secret")


def main(out: str | None = None) -> None:
    from app.main import create_app

    target = Path(out) if out else Path(__file__).resolve().parents[3] / "docs" / "openapi.json"
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(json.dumps(create_app().openapi(), indent=2, sort_keys=True) + "\n")
    print(f"wrote {target}")


if __name__ == "__main__":
    main(sys.argv[1] if len(sys.argv) > 1 else None)
