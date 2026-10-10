# Analysis engine

`backend/app/analysis/` is a registry of pure functions `run(DataFrame, Config) -> AnalysisResult`. It never imports FastAPI, SQLAlchemy or an AI client, so every method is unit-tested with known answers (`tests/unit/test_analysis_engine.py`).

**Pipeline per run:** load only the referenced columns → validate variable *roles and types* (also checked up-front against the stored schema, so impossible configurations are a 422 before any work is queued) → listwise/pairwise deletion with the number dropped reported → minimum-n and zero-variance guards → assumption checks surfaced next to the result → computation with fixed seeds → result object with `metrics`, `tables`, `charts` (`ChartSpec`), `assumptions`, `warnings`, `decisions` (choices the engine made and why) and `methodology`.

The engine returns **no interpretive prose**. Strength words such as "moderate" are explicit computed labels with documented thresholds; narration lives in `app/ai`.

## Methods and methodological decisions

| Analysis | What is computed | Decisions / guards |
|---|---|---|
| **Descriptive** | n, missing, mean (+95% t-CI), median, mode (only if repeated), sample variance/SD (n−1), quartiles, IQR, skewness, excess kurtosis, SEM, CV, normality test | available-case per variable; n < 30 warning; Shapiro–Wilk (n ≤ 5000) else D'Agostino–Pearson |
| **Frequency** | counts, % of valid responses, cumulative % | refuses free text / continuous / dates (suggests the right tool); donut only for ≤ 6 categories; sparse-category warning |
| **Correlation** | Pearson r or Spearman ρ, two-sided p, Fisher-z CI (Bonett–Wright for ρ), r², scatter + OLS line; matrix with **Holm-adjusted** p | pairwise-complete; `ZERO_VARIANCE` / `INSUFFICIENT_OBSERVATIONS` errors instead of the legacy "r = 0"; linearity/outlier diagnostic compares Pearson vs Spearman; Cohen's strength labels |
| **Cross-tab** | χ² (Yates for 2×2), dof, Cramér's V (Bergsma bias-corrected), expected counts, standardised residuals | expected-count rule (≤ 20% cells < 5); Fisher's exact for 2×2 with small expected counts; max 30 levels |
| **Group comparison** | 2 groups: Welch t + Hedges' g + CI, or Mann–Whitney U + rank-biserial + P(superiority); ≥ 3: Welch ANOVA (η², ω²) or Kruskal–Wallis (ε²); Holm-adjusted pairwise post-hoc | **auto** picks parametric if every group n ≥ 30 or not clearly non-normal, else rank-based; Levene/Brown–Forsythe and per-group normality reported; groups with < 2 rows dropped with a warning; Welch variants because equal variances are rarely safe |
| **Linear regression** | OLS coefficients, t, p, CI, standardised β, R², adj-R², F, RMSE, AIC | dummies vs most-frequent reference; listwise; collinearity (rank + VIF), Breusch–Pagan, Shapiro on residuals, Durbin–Watson, Cook's D; optional HC3 robust SE; n < 10 per term warning; perfect collinearity is an error naming the problem |
| **Logistic regression** | odds ratios + Wald CI, McFadden R², LR test, AUC, accuracy/sensitivity/specificity, confusion matrix, ROC | exactly two outcome values; events-per-variable check; (quasi-)separation detected → error; in-sample metrics labelled optimistic and a **seeded 5-fold cross-validated AUC** is added |
| **Time series** | period aggregation, OLS slope (+CI), Mann–Kendall τ, moving average, period-over-period change | auto frequency from span; gaps stay gaps; incomplete last period warning; lag-1 autocorrelation caveat; no seasonality/forecasting claims |

## Reproducibility and determinism

Every run stores: dataset version id **and content hash**, full config, `config_hash`, seed (`20260101`), library versions (numpy, pandas, scipy, statsmodels, scikit-learn, engine), compute time, creator and timestamp. Identical `(version, type, config)` requests are idempotent (partial unique index) and return the stored run. Results are deterministic: stochastic steps (cross-validation folds, k-means) use a fixed seed — `test_results_are_deterministic_and_json_safe` asserts byte-equal results. Things that are *not* deterministic: LLM text (model/prompt version stored with it) and the optional transformer embedding model (version-pinned by name).

## Insights (`analysis/insights.py`)

Rules turn a completed result into a statement + evidence only when thresholds clear: n ≥ 30, p < 0.05 (Holm-adjusted for matrices), |r| ≥ 0.3, |g| ≥ 0.2 or η² ≥ 0.01, Cramér's V ≥ 0.1, R² ≥ 0.1, CV-AUC ≥ 0.65. Strong/moderate/tentative qualification is computed from p, effect size and n. Noise produces **no** insight (tested).
