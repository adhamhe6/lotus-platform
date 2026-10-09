"""Container bootstrap (runs after `alembic upgrade head`): optional demo seed."""

from __future__ import annotations

import asyncio

from app.core.config import get_settings


async def main() -> None:
    s = get_settings()
    s.storage_dir.mkdir(parents=True, exist_ok=True)
    if s.seed_demo_data:
        from app.scripts import seed_demo

        await seed_demo.main()


if __name__ == "__main__":
    asyncio.run(main())
