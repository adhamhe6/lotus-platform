/* Realistic payloads captured from the seeded demo project ("Customer Experience Study 2026"). Typed loosely on purpose: tests post them through MSW. */
export const PID = "53c7011b-f419-4319-bfd1-98c82e8aefc9";
export const DID = "5a51b190-af5a-466a-b7ca-d1667a14ad43";
export const VID = "b03f5498-6313-42e4-8c07-95f48fdcd157";
export const VID1 = "267e4994-f384-406f-8d05-a5c9513b80f1";
export const PROJECT = {
 "id": "53c7011b-f419-4319-bfd1-98c82e8aefc9",
 "name": "Customer Experience Study 2026",
 "description": "Quarterly study of delivery, support and satisfaction across five regions, combining survey scores with open-ended comments.",
 "objective": "Identify what drives customer satisfaction and retention, where the experience is weakest, and whether what customers say in their own words agrees with the measured data.",
 "owner_id": "ad94f04a-7e28-4a45-9d4a-5db57eeb5b4a",
 "created_at": "2026-10-09T23:45:23.553510Z",
 "updated_at": "2026-10-10T00:07:29.536090Z",
 "role": "OWNER",
 "counts": {
  "datasets": 1,
  "analyses": 13,
  "insights": 15,
  "reports": 1,
  "themes": 6
 }
} as any; // eslint-disable-line @typescript-eslint/no-explicit-any
export const DATASET = {
 "id": "5a51b190-af5a-466a-b7ca-d1667a14ad43",
 "project_id": "53c7011b-f419-4319-bfd1-98c82e8aefc9",
 "name": "Customer feedback (survey + comments)",
 "description": "600 customers: delivery, support, satisfaction, spend, retention and a free-text comment.",
 "original_filename": "customer_feedback.csv",
 "file_type": "csv",
 "status": "READY",
 "error": null,
 "raw_size": 91594,
 "created_at": "2026-10-09T23:45:23.590196Z",
 "latest_version": {
  "id": "b03f5498-6313-42e4-8c07-95f48fdcd157",
  "dataset_id": "5a51b190-af5a-466a-b7ca-d1667a14ad43",
  "version_number": 2,
  "parent_version_id": "267e4994-f384-406f-8d05-a5c9513b80f1",
  "kind": "transformed",
  "label": "Cleaned: duplicates removed, region/plan normalised",
  "transformation": null,
  "row_count": 600,
  "column_count": 13,
  "content_hash": "e1a604acaacf3dfbfcdb0e3db4faaa662e7615314a68aeb2a4a6ab66afaee92d",
  "ingest_warnings": [],
  "quality": {},
  "created_by": "ad94f04a-7e28-4a45-9d4a-5db57eeb5b4a",
  "created_at": "2026-10-09T23:45:23.869024Z"
 },
 "version_count": 2
} as any; // eslint-disable-line @typescript-eslint/no-explicit-any
export const VERSIONS = [
 {
  "id": "267e4994-f384-406f-8d05-a5c9513b80f1",
  "dataset_id": "5a51b190-af5a-466a-b7ca-d1667a14ad43",
  "version_number": 1,
  "parent_version_id": null,
  "kind": "original",
  "label": "Original upload",
  "transformation": null,
  "row_count": 608,
  "column_count": 13,
  "content_hash": "126da92130c61aeaa10837fa6d966449d81371b59787ba0b2959763f4a60541b",
  "ingest_warnings": [],
  "quality": {},
  "created_by": "ad94f04a-7e28-4a45-9d4a-5db57eeb5b4a",
  "created_at": "2026-10-09T23:45:23.619449Z"
 },
 {
  "id": "b03f5498-6313-42e4-8c07-95f48fdcd157",
  "dataset_id": "5a51b190-af5a-466a-b7ca-d1667a14ad43",
  "version_number": 2,
  "parent_version_id": "267e4994-f384-406f-8d05-a5c9513b80f1",
  "kind": "transformed",
  "label": "Cleaned: duplicates removed, region/plan normalised",
  "transformation": null,
  "row_count": 600,
  "column_count": 13,
  "content_hash": "e1a604acaacf3dfbfcdb0e3db4faaa662e7615314a68aeb2a4a6ab66afaee92d",
  "ingest_warnings": [],
  "quality": {},
  "created_by": "ad94f04a-7e28-4a45-9d4a-5db57eeb5b4a",
  "created_at": "2026-10-09T23:45:23.869024Z"
 }
] as any; // eslint-disable-line @typescript-eslint/no-explicit-any
export const PROFILE = {
 "version": {
  "id": "b03f5498-6313-42e4-8c07-95f48fdcd157",
  "dataset_id": "5a51b190-af5a-466a-b7ca-d1667a14ad43",
  "version_number": 2,
  "parent_version_id": "267e4994-f384-406f-8d05-a5c9513b80f1",
  "kind": "transformed",
  "label": "Cleaned: duplicates removed, region/plan normalised",
  "transformation": null,
  "row_count": 600,
  "column_count": 13,
  "content_hash": "e1a604acaacf3dfbfcdb0e3db4faaa662e7615314a68aeb2a4a6ab66afaee92d",
  "ingest_warnings": [],
  "quality": {},
  "created_by": "ad94f04a-7e28-4a45-9d4a-5db57eeb5b4a",
  "created_at": "2026-10-09T23:45:23.869024Z"
 },
 "columns": [
  {
   "position": 0,
   "name": "customer_id",
   "dtype": "string",
   "semantic_type": "identifier",
   "missing_count": 0,
   "missing_pct": 0.0,
   "unique_count": 600,
   "profile": {
    "top_values": [
     {
      "pct": 0.167,
      "count": 1,
      "value": "C0001"
     },
     {
      "pct": 0.167,
      "count": 1,
      "value": "C0002"
     },
     {
      "pct": 0.167,
      "count": 1,
      "value": "C0003"
     }
    ]
   }
  },
  {
   "position": 1,
   "name": "survey_date",
   "dtype": "datetime64[ns]",
   "semantic_type": "datetime",
   "missing_count": 0,
   "missing_pct": 0.0,
   "unique_count": 294,
   "profile": {}
  },
  {
   "position": 2,
   "name": "age",
   "dtype": "Int64",
   "semantic_type": "numeric_continuous",
   "missing_count": 12,
   "missing_pct": 2.0,
   "unique_count": 58,
   "profile": {}
  },
  {
   "position": 3,
   "name": "region",
   "dtype": "string",
   "semantic_type": "categorical",
   "missing_count": 0,
   "missing_pct": 0.0,
   "unique_count": 5,
   "profile": {
    "top_values": [
     {
      "pct": 26.5,
      "count": 159,
      "value": "West"
     },
     {
      "pct": 23.333,
      "count": 140,
      "value": "North"
     },
     {
      "pct": 20.5,
      "count": 123,
      "value": "East"
     }
    ]
   }
  },
  {
   "position": 4,
   "name": "plan",
   "dtype": "string",
   "semantic_type": "categorical",
   "missing_count": 0,
   "missing_pct": 0.0,
   "unique_count": 3,
   "profile": {
    "top_values": [
     {
      "pct": 50.333,
      "count": 302,
      "value": "Basic"
     },
     {
      "pct": 32.667,
      "count": 196,
      "value": "Standard"
     },
     {
      "pct": 17.0,
      "count": 102,
      "value": "Premium"
     }
    ]
   }
  },
  {
   "position": 5,
   "name": "channel",
   "dtype": "string",
   "semantic_type": "categorical",
   "missing_count": 0,
   "missing_pct": 0.0,
   "unique_count": 3,
   "profile": {
    "top_values": [
     {
      "pct": 39.833,
      "count": 239,
      "value": "Web"
     },
     {
      "pct": 38.0,
      "count": 228,
      "value": "Mobile"
     },
     {
      "pct": 22.167,
      "count": 133,
      "value": "Store"
     }
    ]
   }
  },
  {
   "position": 6,
   "name": "delivery_time",
   "dtype": "float64",
   "semantic_type": "numeric_continuous",
   "missing_count": 18,
   "missing_pct": 3.0,
   "unique_count": 79,
   "profile": {}
  },
  {
   "position": 7,
   "name": "support_rating",
   "dtype": "Int64",
   "semantic_type": "numeric_discrete",
   "missing_count": 24,
   "missing_pct": 4.0,
   "unique_count": 5,
   "profile": {}
  },
  {
   "position": 8,
   "name": "satisfaction_score",
   "dtype": "float64",
   "semantic_type": "numeric_continuous",
   "missing_count": 12,
   "missing_pct": 2.0,
   "unique_count": 291,
   "profile": {}
  },
  {
   "position": 9,
   "name": "purchase_frequency",
   "dtype": "Int64",
   "semantic_type": "numeric_continuous",
   "missing_count": 0,
   "missing_pct": 0.0,
   "unique_count": 13,
   "profile": {}
  },
  {
   "position": 10,
   "name": "monthly_spend",
   "dtype": "float64",
   "semantic_type": "numeric_continuous",
   "missing_count": 0,
   "missing_pct": 0.0,
   "unique_count": 585,
   "profile": {}
  },
  {
   "position": 11,
   "name": "retained",
   "dtype": "Int64",
   "semantic_type": "binary",
   "missing_count": 0,
   "missing_pct": 0.0,
   "unique_count": 2,
   "profile": {}
  },
  {
   "position": 12,
   "name": "comment",
   "dtype": "string",
   "semantic_type": "text",
   "missing_count": 81,
   "missing_pct": 13.5,
   "unique_count": 455,
   "profile": {}
  }
 ]
} as any; // eslint-disable-line @typescript-eslint/no-explicit-any
export const TYPES = [
 {
  "type": "descriptive",
  "label": "Descriptive statistics",
  "description": "Mean, median, spread, shape and distribution of one or more numeric variables.",
  "category": "quantitative",
  "roles": [
   {
    "key": "columns",
    "label": "Variables",
    "accepts": [
     "numeric_continuous",
     "numeric_discrete",
     "binary"
    ],
    "multiple": true,
    "required": true,
    "min_count": 1,
    "help": "Numeric variables to summarise."
   }
  ],
  "parameters": []
 },
 {
  "type": "frequency",
  "label": "Frequency analysis",
  "description": "Counts and percentages of each category.",
  "category": "quantitative",
  "roles": [
   {
    "key": "column",
    "label": "Variable",
    "accepts": [
     "categorical",
     "boolean",
     "binary",
     "numeric_discrete"
    ],
    "multiple": false,
    "required": true,
    "min_count": 1,
    "help": ""
   }
  ],
  "parameters": [
   {
    "key": "top_n",
    "label": "Categories shown",
    "type": "integer",
    "default": 20,
    "min": 2,
    "max": 100
   }
  ]
 },
 {
  "type": "correlation",
  "label": "Correlation",
  "description": "Strength and direction of association between numeric variables (pair or matrix).",
  "category": "quantitative",
  "roles": [
   {
    "key": "variables",
    "label": "Numeric variables",
    "accepts": [
     "numeric_continuous",
     "numeric_discrete",
     "binary"
    ],
    "multiple": true,
    "required": true,
    "min_count": 2,
    "help": "Pick two for a scatter plot with fit line, or several for a correlation matrix."
   }
  ],
  "parameters": [
   {
    "key": "method",
    "label": "Method",
    "type": "select",
    "default": "pearson",
    "options": [
     {
      "value": "pearson",
      "label": "Pearson (linear)"
     },
     {
      "value": "spearman",
      "label": "Spearman (rank / monotone)"
     }
    ]
   }
  ]
 },
 {
  "type": "crosstab",
  "label": "Cross-tabulation (χ²)",
  "description": "Test whether two categorical variables are associated.",
  "category": "quantitative",
  "roles": [
   {
    "key": "row",
    "label": "Row variable",
    "accepts": [
     "categorical",
     "boolean",
     "binary",
     "numeric_discrete"
    ],
    "multiple": false,
    "required": true,
    "min_count": 1,
    "help": ""
   },
   {
    "key": "column",
    "label": "Column variable",
    "accepts": [
     "categorical",
     "boolean",
     "binary",
     "numeric_discrete"
    ],
    "multiple": false,
    "required": true,
    "min_count": 1,
    "help": ""
   }
  ],
  "parameters": []
 },
 {
  "type": "group_comparison",
  "label": "Group comparison",
  "description": "Compare a numeric outcome across groups (t-test / ANOVA / non-parametric alternatives).",
  "category": "quantitative",
  "roles": [
   {
    "key": "outcome",
    "label": "Outcome (numeric)",
    "accepts": [
     "numeric_continuous",
     "numeric_discrete",
     "binary"
    ],
    "multiple": false,
    "required": true,
    "min_count": 1,
    "help": ""
   },
   {
    "key": "group",
    "label": "Grouping variable",
    "accepts": [
     "categorical",
     "boolean",
     "binary",
     "numeric_discrete"
    ],
    "multiple": false,
    "required": true,
    "min_count": 1,
    "help": ""
   }
  ],
  "parameters": [
   {
    "key": "test",
    "label": "Test",
    "type": "select",
    "default": "auto",
    "options": [
     {
      "value": "auto",
      "label": "Automatic (recommended)"
     },
     {
      "value": "welch_t",
      "label": "Welch's t-test (2 groups)"
     },
     {
      "value": "mann_whitney",
      "label": "Mann–Whitney U (2 groups)"
     },
     {
      "value": "anova",
      "label": "Welch's ANOVA (3+ groups)"
     },
     {
      "value": "kruskal",
      "label": "Kruskal–Wallis (3+ groups)"
     }
    ]
   }
  ]
 },
 {
  "type": "linear_regression",
  "label": "Linear regression",
  "description": "Model a numeric outcome from numeric and categorical predictors (OLS).",
  "category": "quantitative",
  "roles": [
   {
    "key": "outcome",
    "label": "Outcome (numeric)",
    "accepts": [
     "numeric_continuous",
     "numeric_discrete"
    ],
    "multiple": false,
    "required": true,
    "min_count": 1,
    "help": ""
   },
   {
    "key": "predictors",
    "label": "Predictors",
    "accepts": [
     "numeric_continuous",
     "numeric_discrete",
     "binary",
     "categorical",
     "boolean"
    ],
    "multiple": true,
    "required": true,
    "min_count": 1,
    "help": ""
   }
  ],
  "parameters": [
   {
    "key": "robust_se",
    "label": "Robust (HC3) standard errors",
    "type": "boolean",
    "default": false
   }
  ]
 },
 {
  "type": "logistic_regression",
  "label": "Logistic regression",
  "description": "Model the odds of a binary outcome from predictors.",
  "category": "quantitative",
  "roles": [
   {
    "key": "outcome",
    "label": "Binary outcome",
    "accepts": [
     "binary",
     "boolean",
     "categorical"
    ],
    "multiple": false,
    "required": true,
    "min_count": 1,
    "help": "Must have exactly two distinct values."
   },
   {
    "key": "predictors",
    "label": "Predictors",
    "accepts": [
     "numeric_continuous",
     "numeric_discrete",
     "binary",
     "categorical",
     "boolean"
    ],
    "multiple": true,
    "required": true,
    "min_count": 1,
    "help": ""
   }
  ],
  "parameters": [
   {
    "key": "positive_class",
    "label": "Event (positive) value",
    "type": "text",
    "default": null,
    "help": "Defaults to 1/True, else the alphabetically last value."
   }
  ]
 },
 {
  "type": "time_series",
  "label": "Time series & trend",
  "description": "Trend, moving average and period-over-period change of a numeric measure over time.",
  "category": "quantitative",
  "roles": [
   {
    "key": "date_column",
    "label": "Date column",
    "accepts": [
     "datetime"
    ],
    "multiple": false,
    "required": true,
    "min_count": 1,
    "help": ""
   },
   {
    "key": "value_column",
    "label": "Value",
    "accepts": [
     "numeric_continuous",
     "numeric_discrete",
     "binary"
    ],
    "multiple": false,
    "required": true,
    "min_count": 1,
    "help": ""
   }
  ],
  "parameters": [
   {
    "key": "frequency",
    "label": "Period",
    "type": "select",
    "default": "auto",
    "options": [
     {
      "value": "auto",
      "label": "Automatic"
     },
     {
      "value": "D",
      "label": "Day"
     },
     {
      "value": "W",
      "label": "Week"
     },
     {
      "value": "M",
      "label": "Month"
     },
     {
      "value": "Q",
      "label": "Quarter"
     },
     {
      "value": "Y",
      "label": "Year"
     }
    ]
   },
   {
    "key": "aggregation",
    "label": "Aggregate by",
    "type": "select",
    "default": "mean",
    "options": [
     {
      "value": "mean",
      "label": "Mean"
     },
     {
      "value": "sum",
      "label": "Sum"
     },
     {
      "value": "median",
      "label": "Median"
     },
     {
      "value": "count",
      "label": "Count"
     }
    ]
   },
   {
    "key": "window",
    "label": "Moving-average window",
    "type": "integer",
    "default": 3,
    "min": 2,
    "max": 24
   }
  ]
 }
] as any; // eslint-disable-line @typescript-eslint/no-explicit-any
export const SUGGESTIONS = [
 {
  "title": "Analyze the correlation between delivery_time and satisfaction_score",
  "analysis_type": "correlation",
  "config": {
   "variables": [
    "delivery_time",
    "satisfaction_score"
   ],
   "method": "pearson"
  },
  "reason": "Preliminary scan: |r| ≈ 0.51 between these variables on the data as loaded. Run the analysis for the tested result.",
  "score": 0.5140940068711041
 },
 {
  "title": "Analyze the correlation between support_rating and satisfaction_score",
  "analysis_type": "correlation",
  "config": {
   "variables": [
    "support_rating",
    "satisfaction_score"
   ],
   "method": "pearson"
  },
  "reason": "Preliminary scan: |r| ≈ 0.46 between these variables on the data as loaded. Run the analysis for the tested result.",
  "score": 0.4619012303627348
 },
 {
  "title": "Analyze the correlation between satisfaction_score and monthly_spend",
  "analysis_type": "correlation",
  "config": {
   "variables": [
    "satisfaction_score",
    "monthly_spend"
   ],
   "method": "pearson"
  },
  "reason": "Preliminary scan: |r| ≈ 0.41 between these variables on the data as loaded. Run the analysis for the tested result.",
  "score": 0.40720169687190144
 },
 {
  "title": "Find recurring themes in 'comment'",
  "analysis_type": "qualitative_themes",
  "config": {
   "column": "comment"
  },
  "reason": "'comment' contains free text (avg 18 words). Prepare it and detect themes in the Qualitative workspace.",
  "score": 0.3
 },
 {
  "title": "Compare delivery_time across region",
  "analysis_type": "group_comparison",
  "config": {
   "outcome": "delivery_time",
   "group": "region",
   "test": "auto"
  },
  "reason": "Preliminary scan: region accounts for about 29% of the variance in delivery_time.",
  "score": 0.292744434196126
 },
 {
  "title": "Examine the trend of age over survey_date",
  "analysis_type": "time_series",
  "config": {
   "date_column": "survey_date",
   "value_column": "age",
   "frequency": "auto",
   "aggregation": "mean"
  },
  "reason": "'survey_date' is a date column with 294 distinct values.",
  "score": 0.25
 },
 {
  "title": "Model what predicts retained",
  "analysis_type": "logistic_regression",
  "config": {
   "outcome": "retained",
   "predictors": [
    "age",
    "delivery_time",
    "support_rating",
    "satisfaction_score"
   ]
  },
  "reason": "'retained' is a two-level outcome; logistic regression estimates how the numeric variables relate to it.",
  "score": 0.2
 },
 {
  "title": "Compare monthly_spend across plan",
  "analysis_type": "group_comparison",
  "config": {
   "outcome": "monthly_spend",
   "group": "plan",
   "test": "auto"
  },
  "reason": "Preliminary scan: plan accounts for about 19% of the variance in monthly_spend.",
  "score": 0.19190763539468633
 }
] as any; // eslint-disable-line @typescript-eslint/no-explicit-any
export const ANALYSIS_LIST = [
 {
  "id": "6da3d9ed-9fde-47e0-9ed6-9c484d054748",
  "project_id": "53c7011b-f419-4319-bfd1-98c82e8aefc9",
  "dataset_version_id": "b03f5498-6313-42e4-8c07-95f48fdcd157",
  "analysis_type": "group_comparison",
  "title": "Group comparison — satisfaction_score by channel",
  "config": {
   "test": "auto",
   "alpha": 0.05,
   "group": "channel",
   "outcome": "satisfaction_score"
  },
  "status": "COMPLETED",
  "error": null,
  "duration_ms": 14,
  "saved": false,
  "created_by": "ad94f04a-7e28-4a45-9d4a-5db57eeb5b4a",
  "created_at": "2026-10-09T23:45:27.485238Z",
  "completed_at": "2026-10-09T23:45:27.511493Z",
  "headline": {
   "label": "Welch F",
   "value": 1.6661447007650445,
   "p_value": 0.1905787513946966,
   "n": 588
  }
 },
 {
  "id": "614f423e-25cd-4dea-a259-d56988d1bf74",
  "project_id": "53c7011b-f419-4319-bfd1-98c82e8aefc9",
  "dataset_version_id": "b03f5498-6313-42e4-8c07-95f48fdcd157",
  "analysis_type": "correlation",
  "title": "Correlation matrix — 7 variables",
  "config": {
   "method": "pearson",
   "variables": [
    "satisfaction_score",
    "age",
    "delivery_time",
    "support_rating",
    "purchase_frequency",
    "monthly_spend",
    "retained"
   ]
  },
  "status": "COMPLETED",
  "error": null,
  "duration_ms": 44,
  "saved": false,
  "created_by": "ad94f04a-7e28-4a45-9d4a-5db57eeb5b4a",
  "created_at": "2026-10-09T23:45:27.395167Z",
  "completed_at": "2026-10-09T23:45:27.454183Z",
  "headline": {
   "label": "Variable pairs",
   "value": 21,
   "p_value": null,
   "n": 537
  }
 },
 {
  "id": "db6cc529-3665-4759-bf90-656a025f61b6",
  "project_id": "53c7011b-f419-4319-bfd1-98c82e8aefc9",
  "dataset_version_id": "b03f5498-6313-42e4-8c07-95f48fdcd157",
  "analysis_type": "time_series",
  "title": "Satisfaction over 2025",
  "config": {
   "window": 3,
   "frequency": "M",
   "aggregation": "mean",
   "date_column": "survey_date",
   "value_column": "satisfaction_score"
  },
  "status": "COMPLETED",
  "error": null,
  "duration_ms": 11,
  "saved": true,
  "created_by": "ad94f04a-7e28-4a45-9d4a-5db57eeb5b4a",
  "created_at": "2026-10-09T23:45:24.999992Z",
  "completed_at": "2026-10-09T23:45:25.047769Z",
  "headline": {
   "label": "Trend (change per month)",
   "value": -0.33279481705052877,
   "p_value": null,
   "n": 588
  }
 }
] as any; // eslint-disable-line @typescript-eslint/no-explicit-any
export const ANALYSIS_GC = {
 "id": "6da3d9ed-9fde-47e0-9ed6-9c484d054748",
 "project_id": "53c7011b-f419-4319-bfd1-98c82e8aefc9",
 "dataset_version_id": "b03f5498-6313-42e4-8c07-95f48fdcd157",
 "analysis_type": "group_comparison",
 "title": "Group comparison — satisfaction_score by channel",
 "config": {
  "test": "auto",
  "alpha": 0.05,
  "group": "channel",
  "outcome": "satisfaction_score"
 },
 "status": "COMPLETED",
 "error": null,
 "duration_ms": 14,
 "saved": false,
 "created_by": "ad94f04a-7e28-4a45-9d4a-5db57eeb5b4a",
 "created_at": "2026-10-09T23:45:27.485238Z",
 "completed_at": "2026-10-09T23:45:27.511493Z",
 "headline": {
  "label": "Welch F",
  "value": 1.6661447007650445,
  "p_value": 0.1905787513946966,
  "n": 588
 },
 "result": {
  "type": "group_comparison",
  "title": "Group comparison — satisfaction_score by channel",
  "charts": [
   {
    "data": {
     "groups": [
      {
       "n": 234,
       "q1": 68.6,
       "q3": 81.475,
       "mean": 74.558547008547,
       "name": "Web",
       "median": 74.7,
       "outliers": [],
       "n_outliers": 0,
       "whisker_low": 50.9,
       "whisker_high": 98.6
      },
      {
       "n": 226,
       "q1": 68.9,
       "q3": 82.02499999999999,
       "mean": 74.80309734513273,
       "name": "Mobile",
       "median": 73.95,
       "outliers": [
        48.6
       ],
       "n_outliers": 1,
       "whisker_low": 49.7,
       "whisker_high": 98.3
      },
      {
       "n": 128,
       "q1": 69.275,
       "q3": 83.7,
       "mean": 76.53125,
       "name": "Store",
       "median": 75.6,
       "outliers": [],
       "n_outliers": 0,
       "whisker_low": 56.0,
       "whisker_high": 100.0
      }
     ]
    },
    "kind": "box",
    "notes": [],
    "title": "satisfaction_score by channel",
    "x_label": "channel",
    "y_label": "satisfaction_score",
    "subtitle": null,
    "description": "Box plot of satisfaction_score for 3 group(s) of channel; boxes show the interquartile range and median."
   }
  ],
  "n_used": 588,
  "tables": [
   {
    "name": "groups",
    "note": null,
    "rows": [
     {
      "n": 234,
      "max": 98.6,
      "min": 50.9,
      "sem": 0.6479035035338775,
      "std": 9.91101782233312,
      "mean": 74.558547008547,
      "group": "Web",
      "ci_low": 73.28204908151866,
      "median": 74.7,
      "ci_high": 75.83504493557533
     },
     {
      "n": 226,
      "max": 98.3,
      "min": 48.6,
      "sem": 0.6505625405080281,
      "std": 9.780099484124417,
      "mean": 74.80309734513273,
      "group": "Mobile",
      "ci_low": 73.52112261971179,
      "median": 73.95,
      "ci_high": 76.08507207055366
     },
     {
      "n": 128,
      "max": 100.0,
      "min": 56.0,
      "sem": 0.9151655531461803,
      "std": 10.35391629660803,
      "mean": 76.53125,
      "group": "Store",
      "ci_low": 74.72030252594719,
      "median": 75.6,
      "ci_high": 78.34219747405281
     },
     {
      "n": 588,
      "max": 100.0,
      "min": 48.6,
      "sem": 0.41124598824547937,
      "std": 9.97218524470061,
      "mean": 75.08197278911564,
      "group": "All",
      "ci_low": null,
      "median": 74.65,
      "ci_high": null
     }
    ],
    "title": "satisfaction_score by channel",
    "columns": [
     {
      "key": "group",
      "kind": "text",
      "label": "channel"
     },
     {
      "key": "n",
      "kind": "integer",
      "label": "n"
     },
     {
      "key": "mean",
      "kind": "number",
      "label": "Mean"
     },
     {
      "key": "std",
      "kind": "number",
      "label": "Std. dev."
     },
     {
      "key": "median",
      "kind": "number",
      "label": "Median"
     },
     {
      "key": "sem",
      "kind": "number",
      "label": "Std. error"
     },
     {
      "key": "ci_low",
      "kind": "number",
      "label": "95% CI low"
     },
     {
      "key": "ci_high",
      "kind": "number",
      "label": "95% CI high"
     },
     {
      "key": "min",
      "kind": "number",
      "label": "Min"
     },
     {
      "key": "max",
      "kind": "number",
      "label": "Max"
     }
    ]
   },
   {
    "name": "pairwise",
    "note": "Post-hoc: pairwise Welch t tests with Holm–Bonferroni correction. Effect size is Hedges' g (rank-biserial r for Kruskal). Interpret only if the omnibus test is significant.",
    "rows": [
     {
      "a": "Web",
      "b": "Store",
      "p": 0.07974053173514002,
      "p_adj": 0.23922159520542008,
      "effect": -0.19550056366235044,
      "mean_diff": -1.972702991453005
     },
     {
      "a": "Mobile",
      "b": "Store",
      "p": 0.12503767063760057,
      "p_adj": 0.25007534127520115,
      "effect": -0.17260332427668135,
      "mean_diff": -1.728152654867273
     },
     {
      "a": "Web",
      "b": "Mobile",
      "p": 0.7900900390878791,
      "p_adj": 0.7900900390878791,
      "effect": -0.024794520960856648,
      "mean_diff": -0.244550336585732
     }
    ],
    "title": "Pairwise comparisons (Holm-adjusted)",
    "columns": [
     {
      "key": "a",
      "kind": "text",
      "label": "Group A"
     },
     {
      "key": "b",
      "kind": "text",
      "label": "Group B"
     },
     {
      "key": "mean_diff",
      "kind": "number",
      "label": "Mean diff (A−B)"
     },
     {
      "key": "effect",
      "kind": "number",
      "label": "Effect size"
     },
     {
      "key": "p",
      "kind": "p_value",
      "label": "p"
     },
     {
      "key": "p_adj",
      "kind": "p_value",
      "label": "Holm-adj. p"
     }
    ]
   }
  ],
  "metrics": [
   {
    "ci": null,
    "key": "statistic",
    "note": null,
    "unit": null,
    "label": "Welch F",
    "value": 1.6661447007650445,
    "primary": true
   },
   {
    "ci": null,
    "key": "df",
    "note": null,
    "unit": null,
    "label": "df (between, within)",
    "value": "2, 326.1",
    "primary": false
   },
   {
    "ci": null,
    "key": "p_value",
    "note": null,
    "unit": null,
    "label": "p-value",
    "value": 0.1905787513946966,
    "primary": false
   },
   {
    "ci": null,
    "key": "effect_size",
    "note": "negligible effect",
    "unit": null,
    "label": "η² (eta squared)",
    "value": 0.0060050488353345826,
    "primary": false
   },
   {
    "ci": null,
    "key": "omega_squared",
    "note": null,
    "unit": null,
    "label": "ω² (less biased)",
    "value": 0.002602353743349344,
    "primary": false
   },
   {
    "ci": null,
    "key": "n",
    "note": null,
    "unit": null,
    "label": "Observations (n)",
    "value": 588,
    "primary": false
   },
   {
    "ci": null,
    "key": "significant",
    "note": null,
    "unit": null,
    "label": "Significant at α = 0.05",
    "value": false,
    "primary": false
   }
  ],
  "n_total": 600,
  "warnings": [
   "12 of 600 rows (2.0%) were excluded because of missing values in the selected variables."
  ],
  "decisions": [
   "Automatic test selection: normality is acceptable (or groups are large, n ≥ 30) → Welch's one-way ANOVA."
  ],
  "variables": {
   "test": "welch_anova",
   "group": "channel",
   "outcome": "satisfaction_score"
  },
  "assumptions": [
   {
    "name": "Normality of satisfaction_score in 'Web'",
    "test": "Shapiro–Wilk",
    "detail": "Shapiro–Wilk p = 0.339 (n = 234). No evidence against normality.",
    "status": "met",
    "p_value": 0.33894656486272545,
    "statistic": 0.9930101604790544
   },
   {
    "name": "Normality of satisfaction_score in 'Mobile'",
    "test": "Shapiro–Wilk",
    "detail": "Shapiro–Wilk p = 0.25 (n = 226). No evidence against normality.",
    "status": "met",
    "p_value": 0.24977241149076346,
    "statistic": 0.9919352005455014
   },
   {
    "name": "Normality of satisfaction_score in 'Store'",
    "test": "Shapiro–Wilk",
    "detail": "Shapiro–Wilk p = 0.26 (n = 128). No evidence against normality.",
    "status": "met",
    "p_value": 0.2601366038196261,
    "statistic": 0.9869033076390966
   },
   {
    "name": "Homogeneity of variance",
    "test": "Brown–Forsythe (Levene, median-centred)",
    "detail": "p = 0.676. Variances look similar.",
    "status": "met",
    "p_value": 0.6763968836722449,
    "statistic": 0.3912366876428265
   },
   {
    "name": "Independent observations",
    "test": null,
    "detail": "Cannot be verified from the data: each row must be an independent unit (not repeated measures).",
    "status": "unknown",
    "p_value": null,
    "statistic": null
   }
  ],
  "methodology": "Compares a numeric outcome across the levels of a categorical variable. Two groups: Welch's t-test (unequal variances) with Hedges' g, or the Mann–Whitney U test with the rank-biserial correlation. Three or more groups: Welch's ANOVA (η², ω²) or the Kruskal–Wallis test (ε²), followed by Holm-adjusted pairwise tests. 'Auto' uses parametric tests when every group is large (n ≥ 30) or not clearly non-normal, otherwise rank-based tests. Groups with fewer than two observations are dropped. A significant difference does not establish a causal effect."
 },
 "provenance": {
  "seed": 20260101,
  "config": {
   "test": "auto",
   "alpha": 0.05,
   "group": "channel",
   "outcome": "satisfaction_score"
  },
  "libraries": {
   "numpy": "2.5.3",
   "scipy": "1.18.1",
   "engine": "1.0.0",
   "pandas": "3.0.6",
   "statsmodels": "0.15.0",
   "scikit-learn": "1.9.1"
  },
  "compute_ms": 14,
  "deterministic": true,
  "rows_in_version": 600,
  "dataset_version_id": "b03f5498-6313-42e4-8c07-95f48fdcd157",
  "dataset_content_hash": "e1a604acaacf3dfbfcdb0e3db4faaa662e7615314a68aeb2a4a6ab66afaee92d"
 },
 "interpretation": null,
 "dataset_name": "Customer feedback (survey + comments)",
 "version_label": "Cleaned: duplicates removed, region/plan normalised",
 "version_number": 2
} as any; // eslint-disable-line @typescript-eslint/no-explicit-any
export const EXPLAIN_RULE = {
 "summary": "Here is what the computed result says.",
 "points": [
  {
   "text": "Group comparison — satisfaction_score by channel: Welch F = 1.666; df (between, within) = 2, 326.1; p-value = 0.191; η² (eta squared) = 0.006; ω² (less biased) = 0.003; Observations (n) = 588; Significant at α = 0.05 = no. Rows used: 588 of 600.",
   "evidence": [
    "E1"
   ]
  },
  {
   "text": "satisfaction_score by channel: Web: mean 74.6, n = 234; Mobile: mean 74.8, n = 226; Store: mean 76.5, n = 128; All: mean 75.1, n = 588",
   "evidence": [
    "E2"
   ]
  },
  {
   "text": "Pairwise comparisons: Web vs Store: diff -1.973, adj. p 0.239; Mobile vs Store: diff -1.728, adj. p 0.25; Web vs Mobile: diff -0.245, adj. p 0.79",
   "evidence": [
    "E3"
   ]
  },
  {
   "text": "Method: Compares a numeric outcome across the levels of a categorical variable. Two groups: Welch's t-test (unequal variances) with Hedges' g, or the Mann–Whitney U test with the rank-biserial correlation. Three or more groups: Welch's ANOVA (η², ω²) or the Kruskal–Wallis test (ε²), followed by Holm-adjusted pairwise tests. 'Auto' uses parametric tests when every group is large (n ≥ 30) or not clearly non-normal, otherwise rank-based tests. Groups with fewer than two observations are dropped. A significant difference does not establish a causal effect.",
   "evidence": [
    "E5"
   ]
  }
 ],
 "caveats": [
  "12 of 600 rows (2.0%) were excluded because of missing values in the selected variables."
 ],
 "next_steps": [],
 "meta": {
  "prompt_version": "lotus-narrate-1.2",
  "task": "explain_analysis",
  "generated_at": "2026-10-10T00:16:50.992966+00:00",
  "origin": "rule",
  "provider": "deterministic",
  "model": null,
  "validation": {
   "status": "skipped",
   "problems": []
  },
  "fallback_reason": null,
  "latency_ms": 0
 },
 "evidence": [
  {
   "id": "E1",
   "kind": "computed",
   "label": "Group comparison — satisfaction_score by channel",
   "text": "Welch F = 1.666; df (between, within) = 2, 326.1; p-value = 0.191; η² (eta squared) = 0.006; ω² (less biased) = 0.003; Observations (n) = 588; Significant at α = 0.05 = no. Rows used: 588 of 600.",
   "source": {
    "type": "analysis",
    "analysis_run_id": "6da3d9ed-9fde-47e0-9ed6-9c484d054748",
    "analysis_type": "group_comparison",
    "title": "Group comparison — satisfaction_score by channel"
   }
  },
  {
   "id": "E2",
   "kind": "computed",
   "label": "satisfaction_score by channel",
   "text": "Web: mean 74.6, n = 234; Mobile: mean 74.8, n = 226; Store: mean 76.5, n = 128; All: mean 75.1, n = 588",
   "source": {
    "type": "analysis",
    "analysis_run_id": "6da3d9ed-9fde-47e0-9ed6-9c484d054748",
    "analysis_type": "group_comparison",
    "title": "Group comparison — satisfaction_score by channel",
    "table": "groups"
   }
  },
  {
   "id": "E3",
   "kind": "computed",
   "label": "Pairwise comparisons",
   "text": "Web vs Store: diff -1.973, adj. p 0.239; Mobile vs Store: diff -1.728, adj. p 0.25; Web vs Mobile: diff -0.245, adj. p 0.79",
   "source": {
    "type": "analysis",
    "analysis_run_id": "6da3d9ed-9fde-47e0-9ed6-9c484d054748",
    "analysis_type": "group_comparison",
    "title": "Group comparison — satisfaction_score by channel",
    "table": "pairwise"
   }
  },
  {
   "id": "E4",
   "kind": "caveat",
   "label": "Data note",
   "text": "12 of 600 rows (2.0%) were excluded because of missing values in the selected variables.",
   "source": {
    "type": "analysis",
    "analysis_run_id": "6da3d9ed-9fde-47e0-9ed6-9c484d054748",
    "analysis_type": "group_comparison",
    "title": "Group comparison — satisfaction_score by channel"
   }
  },
  {
   "id": "E5",
   "kind": "dataset",
   "label": "Method",
   "text": "Compares a numeric outcome across the levels of a categorical variable. Two groups: Welch's t-test (unequal variances) with Hedges' g, or the Mann–Whitney U test with the rank-biserial correlation. Three or more groups: Welch's ANOVA (η², ω²) or the Kruskal–Wallis test (ε²), followed by Holm-adjusted pairwise tests. 'Auto' uses parametric tests when every group is large (n ≥ 30) or not clearly non-normal, otherwise rank-based tests. Groups with fewer than two observations are dropped. A significant difference does not establish a causal effect.",
   "source": {
    "type": "methodology"
   }
  }
 ]
} as any; // eslint-disable-line @typescript-eslint/no-explicit-any
export const INSIGHTS = [
 {
  "id": "41ce41f1-193d-4c90-b1e7-60e837066812",
  "project_id": "53c7011b-f419-4319-bfd1-98c82e8aefc9",
  "analysis_run_id": "614f423e-25cd-4dea-a259-d56988d1bf74",
  "mixed_run_id": null,
  "kind": "association",
  "title": "satisfaction_score × delivery_time: strong negative association",
  "statement": "satisfaction_score and delivery_time are strongly negatively correlated (Pearson r = -0.51, Holm-adjusted p < 0.001, n = 571).",
  "evidence": [
   {
    "unit": null,
    "label": "r",
    "table": "pairs",
    "value": -0.5140940068711037,
    "metric": null
   },
   {
    "unit": null,
    "label": "Holm-adjusted p",
    "table": "pairs",
    "value": 1.6250905777973246e-38,
    "metric": null
   },
   {
    "unit": null,
    "label": "n",
    "table": "pairs",
    "value": 571,
    "metric": null
   }
  ],
  "variables": [
   "satisfaction_score",
   "delivery_time"
  ],
  "qualification": "strong",
  "origin": "rule",
  "narrative": null,
  "pinned": false,
  "created_at": "2026-10-09T23:45:27.456699Z",
  "source": {
   "analysis_run_id": "614f423e-25cd-4dea-a259-d56988d1bf74",
   "analysis_type": "correlation",
   "title": "Correlation matrix — 7 variables",
   "dataset_version_id": "b03f5498-6313-42e4-8c07-95f48fdcd157",
   "config": {
    "method": "pearson",
    "variables": [
     "satisfaction_score",
     "age",
     "delivery_time",
     "support_rating",
     "purchase_frequency",
     "monthly_spend",
     "retained"
    ]
   }
  }
 },
 {
  "id": "11e733bd-41c0-4c66-afb0-eed015e559fc",
  "project_id": "53c7011b-f419-4319-bfd1-98c82e8aefc9",
  "analysis_run_id": null,
  "mixed_run_id": "2f25ab6a-e8fc-498b-ac31-f4e7254cff95",
  "kind": "mixed",
  "title": "Tracking / Missing / Idea: convergence",
  "statement": "Convergent evidence: respondents voicing “Tracking / Missing / Idea” also record higher delivery_time (6.83 vs 5.86; g = 0.58; Holm-adjusted p < 0.001), so the comments and the measured variable point the same way.",
  "evidence": [
   {
    "unit": null,
    "label": "mean with",
    "table": "mixed_findings",
    "value": 6.834545454545453,
    "metric": null
   },
   {
    "unit": null,
    "label": "mean without",
    "table": "mixed_findings",
    "value": 5.85625,
    "metric": null
   },
   {
    "unit": null,
    "label": "g",
    "table": "mixed_findings",
    "value": 0.5843998432842648,
    "metric": null
   },
   {
    "unit": null,
    "label": "p adj",
    "table": "mixed_findings",
    "value": 0.0008288273127506597,
    "metric": null
   },
   {
    "unit": null,
    "label": "n with",
    "table": "mixed_findings",
    "value": 55,
    "metric": null
   },
   {
    "unit": null,
    "label": "n without",
    "table": "mixed_findings",
    "value": 448,
    "metric": null
   }
  ],
  "variables": [
   "satisfaction_score",
   "delivery_time"
  ],
  "qualification": "strong",
  "origin": "rule",
  "narrative": null,
  "pinned": false,
  "created_at": "2026-10-09T23:45:27.147390Z",
  "source": null
 },
 {
  "id": "2958173e-9772-456f-8154-a5ab91e8905a",
  "project_id": "53c7011b-f419-4319-bfd1-98c82e8aefc9",
  "analysis_run_id": "3e956f77-8a76-445c-81ce-baa4a720d2d6",
  "mixed_run_id": null,
  "kind": "group_difference",
  "title": "delivery_time differs by region: lowest in Central",
  "statement": "Mean delivery_time is lowest for region = Central (5.29, n = 77) and highest for West (7.53, n = 153), a gap of 2.25; the groups differ overall (Welch ANOVA p < 0.001; η² (eta squared) = 0.29, large effect).",
  "evidence": [
   {
    "unit": null,
    "label": "Mean delivery_time in West",
    "table": "groups",
    "value": 7.531372549019609,
    "metric": null
   },
   {
    "unit": null,
    "label": "Mean delivery_time in Central",
    "table": "groups",
    "value": 5.2857142857142865,
    "metric": null
   },
   {
    "unit": null,
    "label": "Welch ANOVA p-value",
    "table": null,
    "value": 1.5038629191654766e-35,
    "metric": "p_value"
   },
   {
    "unit": null,
    "label": "η² (eta squared)",
    "table": null,
    "value": 0.2927444341961261,
    "metric": "effect_size"
   },
   {
    "unit": null,
    "label": "n",
    "table": null,
    "value": 582,
    "metric": "n"
   }
  ],
  "variables": [
   "delivery_time",
   "region"
  ],
  "qualification": "strong",
  "origin": "rule",
  "narrative": null,
  "pinned": false,
  "created_at": "2026-10-09T23:45:24.514447Z",
  "source": {
   "analysis_run_id": "3e956f77-8a76-445c-81ce-baa4a720d2d6",
   "analysis_type": "group_comparison",
   "title": "Delivery time by region",
   "dataset_version_id": "b03f5498-6313-42e4-8c07-95f48fdcd157",
   "config": {
    "test": "auto",
    "alpha": 0.05,
    "group": "region",
    "outcome": "delivery_time"
   }
  }
 }
] as any; // eslint-disable-line @typescript-eslint/no-explicit-any
