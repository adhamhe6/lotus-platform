from __future__ import annotations

from enum import StrEnum


class SemanticType(StrEnum):
    NUMERIC_CONTINUOUS = "numeric_continuous"
    NUMERIC_DISCRETE = "numeric_discrete"
    BINARY = "binary"
    BOOLEAN = "boolean"
    CATEGORICAL = "categorical"
    DATETIME = "datetime"
    TEXT = "text"
    IDENTIFIER = "identifier"


NUMERIC_TYPES = {SemanticType.NUMERIC_CONTINUOUS, SemanticType.NUMERIC_DISCRETE, SemanticType.BINARY}
GROUPING_TYPES = {SemanticType.CATEGORICAL, SemanticType.BOOLEAN, SemanticType.BINARY, SemanticType.NUMERIC_DISCRETE}
