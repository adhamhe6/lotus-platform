#!/usr/bin/env python
"""Generate the Lotus demo datasets (deterministic, seed 42).

Customer feedback study (mixed methods): the data encode *known, discoverable* structure:
  * longer delivery time lowers satisfaction (r ≈ -0.5)
  * better support rating raises satisfaction
  * West is slower to deliver, East has weaker support
  * satisfaction dipped in Q3 (delivery incident)
  * Premium plan > Standard > Basic
  * higher satisfaction → more orders, higher spend, higher retention
  * free-text comments follow the same drivers (delivery complaints when delivery is slow, etc.)
Nothing here is shipped as a result — Lotus has to rediscover all of it from the raw files.
"""
from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd

OUT = Path(__file__).resolve().parent.parent / "data" / "demo"

DELIVERY = [
    "My order arrived {d} days late and nobody told me why.",
    "Delivery took far too long, the parcel sat in a depot for almost a week.",
    "The shipping was really slow compared with what was promised at checkout.",
    "I waited {d} days for my package and the tracking page never updated.",
    "Late delivery again. This is the second time this quarter.",
    "The courier missed the delivery window twice and I had to stay home for nothing.",
    "Package arrived damaged and a week after the promised date.",
    "Delivery estimates are unreliable; what they say and what happens are very different.",
    "Shipping delays have made me think twice about ordering again.",
    "The parcel was delivered to the wrong address and it took days to get it sorted out.",
    "Tracking information was missing for most of the journey, so I had no idea when it would come.",
    "Express delivery was supposed to be 2 days, it took {d}.",
]
SUPPORT = [
    "Customer support took days to reply to my email and never solved the problem.",
    "I was transferred between three agents and had to explain my issue every time.",
    "The support team was polite but could not actually fix anything.",
    "Nobody answered the phone line, and the chat bot just kept repeating itself.",
    "Support promised a call back and never called.",
    "Waiting time on the helpline is unacceptable, over 40 minutes.",
    "The agent did not seem to understand my complaint and closed the ticket.",
    "It was impossible to reach a real person about my refund.",
    "Slow responses from support, I had to chase them repeatedly.",
    "My refund request was ignored until I complained on social media.",
]
QUALITY = [
    "The product quality is lower than I expected, it broke after two weeks.",
    "Item looked nothing like the photos and the material feels cheap.",
    "Stitching came apart after the first wash, poor build quality.",
    "One of the parts was missing from the box and the finish was scratched.",
    "I had to return the product because it stopped working within a month.",
    "Quality control seems to have slipped; earlier orders were much better.",
    "The device overheats and the battery barely lasts a day.",
    "Packaging was fine but the item itself felt flimsy.",
]
PRICING = [
    "Prices keep going up and the value for money is not there anymore.",
    "Competitors offer the same thing for less, hard to justify the cost.",
    "The subscription fee is too high for what is included in the Basic plan.",
    "Shipping fees are expensive, they should be free over a reasonable amount.",
    "I felt misled by the discounts, the regular price seems inflated.",
    "Too many hidden charges at checkout.",
    "Premium is pricey, but at least you get faster delivery.",
]
USABILITY = [
    "The mobile app keeps crashing when I try to check out.",
    "The website is confusing, I could not find where to change my address.",
    "Search results are poor and the filters do not work properly.",
    "The app logs me out all the time and the password reset email is slow.",
    "Navigation is cluttered, I need too many taps just to reorder something.",
    "Checkout page froze twice and I was charged once without a confirmation.",
    "Great idea but the interface is clumsy on small screens.",
]
POSITIVE = [
    "Everything arrived on time and the packaging was neat, very happy.",
    "Great service, the support agent solved my issue in minutes.",
    "Excellent quality for the price, I will order again.",
    "Fast delivery and easy to track, no complaints at all.",
    "The app is simple and checkout takes seconds.",
    "Really friendly support team, they went out of their way to help.",
    "Good value for money and a smooth experience overall.",
    "Reliable as always, I have recommended it to friends.",
    "Product exactly as described and it came a day early.",
    "Loyalty discounts make this worth it. Very satisfied.",
]
OPENERS = ["", "", "", "Honestly, ", "To be fair, ", "In my experience, ", "Overall, ", "Just to say: "]
CLOSERS = ["", "", "", " Hope this improves.", " Thanks for asking.", " Please fix this.", " That is my feedback.", " Not sure I will keep my account."]


def sigmoid(x):
    return 1 / (1 + np.exp(-x))


def customers(n: int = 600, seed: int = 42) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    region = rng.choice(["North", "South", "East", "West", "Central"], n, p=[0.22, 0.18, 0.20, 0.25, 0.15])
    plan = rng.choice(["Basic", "Standard", "Premium"], n, p=[0.5, 0.35, 0.15])
    channel = rng.choice(["Web", "Mobile", "Store"], n, p=[0.4, 0.4, 0.2])
    dates = pd.to_datetime("2025-01-01") + pd.to_timedelta(rng.integers(0, 365, n), unit="D")
    q3 = np.asarray((dates.month >= 7) & (dates.month <= 9))
    age = np.clip(rng.normal(41, 12, n), 18, 75).round().astype(int)

    delivery = 3.2 + 2.0 * (region == "West") + 0.5 * (region == "South") + 2.0 * q3 + rng.gamma(2.0, 0.8, n)
    delivery = np.clip(delivery.round(1), 1, 21)
    support = np.clip(np.round(3.4 - 0.9 * (region == "East") + 0.5 * (plan == "Premium") + rng.normal(0, 0.9, n)), 1, 5).astype(int)
    quality_issue = rng.random(n) < 0.12
    usability_issue = rng.random(n) < np.where(channel == "Mobile", 0.20, 0.07)
    price_sensitive = rng.random(n) < np.where(plan == "Basic", 0.18, 0.06)

    sat = (79 - 3.0 * (delivery - 4.5) + 4.5 * (support - 3) + 3.0 * (plan == "Premium") + 1.2 * (plan == "Standard")
           - 8 * quality_issue - 4 * usability_issue - 3 * price_sensitive + rng.normal(0, 6.5, n))
    sat = np.clip(sat, 0, 100).round(1)
    orders = rng.poisson(np.clip(4 + 0.09 * (sat - 70), 0.5, None))
    spend = np.clip(rng.lognormal(np.log(95 + 1.4 * (sat - 70) + 30 * (plan == "Premium") + 12 * (plan == "Standard")), 0.28), 10, None).round(2)
    retained = (rng.random(n) < sigmoid(-0.4 + 0.07 * (sat - 70))).astype(int)

    # comments follow the same drivers
    comments = []
    for i in range(n):
        if rng.random() < 0.15:
            comments.append("")
            continue
        weights = {
            "delivery": sigmoid((delivery[i] - 6.0) * 0.9) * 1.4,
            "support": sigmoid((2.6 - support[i]) * 1.6),
            "quality": 0.85 * quality_issue[i],
            "pricing": 0.75 * price_sensitive[i],
            "usability": 0.8 * usability_issue[i],
            "positive": sigmoid((sat[i] - 78) / 5) * 1.2,
        }
        keys = list(weights)
        w = np.array([weights[k] for k in keys]) + 0.02
        primary = rng.choice(keys, p=w / w.sum())
        bank = {"delivery": DELIVERY, "support": SUPPORT, "quality": QUALITY, "pricing": PRICING, "usability": USABILITY, "positive": POSITIVE}
        parts = [rng.choice(bank[primary])]
        if rng.random() < 0.28:
            sec = rng.choice([k for k in keys if k != primary], p=(w[[k != primary for k in keys]] / w[[k != primary for k in keys]].sum()))
            parts.append(rng.choice(bank[sec]))
        opener = str(rng.choice(OPENERS))
        first = parts[0].format(d=int(round(delivery[i])))
        if opener:
            first = first[0].lower() + first[1:]
        text = opener + first + (" " + parts[1].format(d=int(round(delivery[i]))) if len(parts) > 1 else "") + str(rng.choice(CLOSERS))
        comments.append(text.strip())

    df = pd.DataFrame({
        "customer_id": [f"C{i + 1:04d}" for i in range(n)], "survey_date": dates.strftime("%Y-%m-%d"), "age": age, "region": region, "plan": plan, "channel": channel,
        "delivery_time": delivery, "support_rating": support, "satisfaction_score": sat, "purchase_frequency": orders, "monthly_spend": spend,
        "retained": retained, "comment": comments,
    })
    # realistic mess: missing values + a few exact duplicate rows
    for col, rate in [("satisfaction_score", 0.02), ("delivery_time", 0.03), ("support_rating", 0.04), ("age", 0.02)]:
        idx = rng.choice(n, int(n * rate), replace=False)
        df.loc[idx, col] = np.nan
    df["support_rating"] = df["support_rating"].astype("Int64")
    df["age"] = df["age"].astype("Int64")
    dup = df.sample(8, random_state=seed)
    return pd.concat([df, dup], ignore_index=True)


EMP = {
    "workload": ["The workload is unsustainable, I regularly work evenings to keep up.", "Deadlines are unrealistic and the team is understaffed.",
                 "Too many meetings leave no time for focused work.", "I feel burned out, there is always another urgent request.",
                 "Overtime has become the norm rather than the exception."],
    "management": ["My manager rarely gives feedback and decisions change without explanation.", "Leadership communicates poorly about the direction of the company.",
                   "I appreciate my manager, who supports the team and listens.", "There is a lack of transparency from senior management.",
                   "Good manager, clear goals and fair treatment."],
    "growth": ["There are few opportunities for promotion or learning new skills.", "I would like a clear career path and training budget.",
               "The mentoring programme helped me grow a lot this year.", "No development plan was ever discussed in my reviews.",
               "Opportunities to move between teams are limited."],
    "tools": ["Our internal tools are slow and outdated, they waste hours each week.", "The ticketing system keeps crashing and nobody owns the fix.",
              "Laptops are old and the VPN disconnects constantly.", "New software rollout was smooth and saved me time."],
    "compensation": ["Salary is below market and raises do not reflect performance.", "Benefits are good, especially the health insurance and flexible leave.",
                     "Pay has not kept up with inflation.", "Bonuses are unclear and feel arbitrary."],
    "culture": ["Great team spirit, colleagues genuinely help each other.", "The culture is friendly, but silos between departments slow things down.",
                "I value the flexibility to work from home.", "Inclusive and respectful environment, I feel I belong."],
}


def employees(n: int = 160, seed: int = 7) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    dept = rng.choice(["Engineering", "Operations", "Sales", "Support"], n, p=[0.3, 0.25, 0.2, 0.25])
    tenure = np.round(rng.gamma(2.0, 2.0, n), 1)
    rows = []
    for i in range(n):
        w = {"workload": 1.4 if dept[i] in ("Operations", "Support") else 0.7, "management": 1.0, "growth": 1.3 if tenure[i] > 4 else 0.8,
             "tools": 1.4 if dept[i] == "Engineering" else 0.6, "compensation": 0.9, "culture": 1.0}
        keys = list(w)
        p = np.array([w[k] for k in keys]); p = p / p.sum()
        k1 = rng.choice(keys, p=p)
        text = rng.choice(EMP[k1])
        if rng.random() < 0.3:
            k2 = rng.choice([k for k in keys if k != k1])
            text += " " + rng.choice(EMP[k2])
        rows.append((f"E{i + 1:03d}", dept[i], tenure[i], text))
    return pd.DataFrame(rows, columns=["respondent_id", "department", "tenure_years", "comment"])


if __name__ == "__main__":
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", type=Path, default=OUT)
    a = ap.parse_args()
    a.out.mkdir(parents=True, exist_ok=True)
    customers().to_csv(a.out / "customer_feedback.csv", index=False)
    employees().to_csv(a.out / "employee_engagement_comments.csv", index=False)
    print("wrote", sorted(p.name for p in a.out.glob("*.csv")))
