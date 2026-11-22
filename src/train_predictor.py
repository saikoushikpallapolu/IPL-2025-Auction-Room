from pathlib import Path

import numpy as np
import pandas as pd
import xgboost as xgb


ROOT = Path(__file__).resolve().parents[1]
MODEL_PATH = ROOT / "models/auction_price.ubj"
FEATURE_PATH = ROOT / "data/processed/player_auction_features.csv"
METRICS = [
    "career_runs", "career_wickets", "career_strike_rate", "career_economy",
    "recent_runs", "recent_wickets", "recent_strike_rate", "recent_economy",
    "peak_season_wickets", "peak_season_runs", "injury_gap_years",
    "international_prestige_score",
]
ROLE_COLUMNS = ["role_BAT", "role_BOWL", "role_AR", "role_WK"]
FEATURE_COLUMNS = [*METRICS, "is_overseas", *ROLE_COLUMNS]


def train_price_model():
    data = pd.read_csv(FEATURE_PATH)
    # Keep the 2025 auction outcomes outside training and model selection.
    history = data.loc[(data.auction_year < 2025) & (data.sold_price_crore > 0)]
    history = history.drop_duplicates(["auction_year", "canonical_id"], keep=False)
    cutoff = int(history.auction_year.max())
    train = history.loc[history.auction_year < cutoff]
    test = history.loc[history.auction_year == cutoff]
    model = xgb.XGBRegressor(
        n_estimators=200, max_depth=3, learning_rate=0.04, min_child_weight=5,
        subsample=0.85, colsample_bytree=0.85, random_state=42, n_jobs=2,
    )

    def fit(frame):
        model.fit(frame[FEATURE_COLUMNS], np.log1p(frame.sold_price_crore))

    fit(train)
    predicted = np.maximum(0, np.expm1(model.predict(test[FEATURE_COLUMNS])))
    mae = np.abs(test.sold_price_crore - predicted).mean()
    baseline = np.abs(test.sold_price_crore - train.sold_price_crore.median()).mean()
    print(f"{cutoff} holdout ({len(test)} rows): MAE {mae:.2f} Cr; median baseline {baseline:.2f} Cr")
    fit(history)
    model.save_model(MODEL_PATH)
    print(f"Refit on {len(history)} historical sales and saved {MODEL_PATH.name}")


if __name__ == "__main__":
    train_price_model()
