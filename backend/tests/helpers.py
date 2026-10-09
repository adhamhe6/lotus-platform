from __future__ import annotations

import io

import numpy as np
import pandas as pd


def survey_frame(n: int = 240, seed: int = 5) -> pd.DataFrame:
    """Small synthetic survey with known structure: delivery_time lowers satisfaction; West is slower."""
    rng = np.random.default_rng(seed)
    region = rng.choice(["North", "South", "West"], n)
    delivery = np.round(rng.gamma(3, 1.2, n) + 2 * (region == "West"), 1)
    support = rng.integers(1, 6, n)
    sat = np.clip(80 - 3 * delivery + 4 * (support - 3) + rng.normal(0, 5, n), 0, 100).round(1)

    def pick(opts):
        return np.array(opts)[rng.integers(0, len(opts), n)]

    noun, adj = (
        pick(["parcel", "package", "order", "shipment"]),
        pick(["badly", "really", "very", "extremely"]),
    )
    late = np.char.add(
        np.char.add(np.char.add("The ", noun), np.char.add(" was ", adj)),
        pick(
            [
                " late, the delivery courier never showed up",
                " delayed, shipping and delivery took too long",
                " late and the delivery tracking was useless",
            ]
        ),
    )
    supp = np.char.add(
        np.char.add(
            pick(["Customer support", "The support team", "The support agent"]), np.char.add(" was ", adj)
        ),
        pick(
            [
                " unhelpful, my refund email was never answered",
                " slow, nobody called back about my refund",
                " rude and could not solve my support ticket",
            ]
        ),
    )
    good = np.char.add(
        np.char.add("I am ", pick(["happy", "delighted", "very satisfied"])),
        np.char.add(
            pick([" with the great product", " with the excellent quality", " with this wonderful service"]),
            pick([", good value", ", will buy again", ", highly recommended"]),
        ),
    )
    comment = np.where(delivery > np.quantile(delivery, 0.7), late, np.where(support <= 3, supp, good))
    return pd.DataFrame(
        {
            "customer_id": [f"C{i:04d}" for i in range(n)],
            "survey_date": pd.date_range("2025-01-01", periods=n, freq="D").strftime("%Y-%m-%d"),
            "region": region,
            "delivery_time": delivery,
            "support_rating": support,
            "satisfaction": sat,
            "comment": comment,
        }
    )


def csv_bytes(df: pd.DataFrame) -> bytes:
    return df.to_csv(index=False).encode()


def xlsx_bytes(df: pd.DataFrame) -> bytes:
    buf = io.BytesIO()
    df.to_excel(buf, index=False, engine="openpyxl")
    return buf.getvalue()
