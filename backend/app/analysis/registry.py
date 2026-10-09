"""Registry + runner: validate config, execute the pure engine, attach provenance. No HTTP/DB here."""

from __future__ import annotations

import hashlib
import json
import time
from typing import Any

import pandas as pd
from pydantic import ValidationError

from app.analysis import correlation, crosstab, descriptive, frequency, group_comparison, regression, time_series
from app.analysis.base import AnalysisResult, AnalysisSpec, library_versions
from app.core.exceptions import AnalysisConfigurationError
from app.datasets.jsonable import to_jsonable

REGISTRY: dict[str, AnalysisSpec] = {s.type: s for s in [
    descriptive.SPEC, frequency.SPEC, correlation.SPEC, crosstab.SPEC, group_comparison.SPEC, regression.LINEAR_SPEC, regression.LOGISTIC_SPEC, time_series.SPEC,
]}


def get_spec(analysis_type: str) -> AnalysisSpec:
    spec = REGISTRY.get(analysis_type)
    if spec is None:
        raise AnalysisConfigurationError(f"Unknown analysis type '{analysis_type}'.", code="UNKNOWN_ANALYSIS_TYPE")
    return spec


def parse_config(analysis_type: str, raw: dict[str, Any]) -> Any:
    spec = get_spec(analysis_type)
    try:
        return spec.config_model.model_validate(raw)
    except ValidationError as e:
        first = e.errors()[0]
        loc = ".".join(str(p) for p in first["loc"])
        raise AnalysisConfigurationError(f"Invalid configuration ({loc}): {first['msg']}") from e


def config_hash(analysis_type: str, cfg: Any) -> str:
    canonical = json.dumps({"t": analysis_type, "c": cfg.model_dump(mode="json")}, sort_keys=True, separators=(",", ":"))
    return hashlib.sha256(canonical.encode()).hexdigest()


def describe_types() -> list[dict[str, Any]]:
    return [{
        "type": s.type, "label": s.label, "description": s.description, "category": s.category,
        "roles": [{"key": r.key, "label": r.label, "accepts": r.accepts, "multiple": r.multiple, "required": r.required, "min_count": r.min_count, "help": r.help} for r in s.roles],
        "parameters": s.parameters,
    } for s in REGISTRY.values()]


def execute(df: pd.DataFrame, analysis_type: str, raw_config: dict[str, Any]) -> tuple[dict[str, Any], dict[str, Any]]:
    """Run an analysis. Returns (JSON-safe result, provenance)."""
    spec = get_spec(analysis_type)
    cfg = parse_config(analysis_type, raw_config)
    t0 = time.perf_counter()
    result: AnalysisResult = spec.run(df, cfg)
    elapsed = int((time.perf_counter() - t0) * 1000)
    provenance = {"libraries": library_versions(), "seed": 20260101, "config": cfg.model_dump(mode="json"), "compute_ms": elapsed, "deterministic": True}
    return to_jsonable(result.model_dump(mode="json")), provenance
