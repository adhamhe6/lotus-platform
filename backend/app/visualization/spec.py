"""Declarative chart specification shared by the React UI and the server-side SVG report renderer."""

from __future__ import annotations

from typing import Any, Literal

from pydantic import BaseModel, Field

ChartKind = Literal[
    "bar", "hbar", "stacked_bar", "line", "scatter", "histogram", "box", "heatmap", "donut", "coef", "roc"
]


class ChartSpec(BaseModel):
    kind: ChartKind
    title: str
    subtitle: str | None = None
    x_label: str | None = None
    y_label: str | None = None
    data: dict[str, Any] = Field(default_factory=dict)
    description: str = ""  # text alternative, generated from the data
    notes: list[str] = Field(default_factory=list)
