# IPL Auction Room

Play the 2025 IPL mega auction in your browser. Manage one of ten franchises, choose which players to retain, and bid against nine AI teams. The room shows model valuations where available, live purses, squads, bidding activity and results.

## Run locally

```bash
python -m pip install -r requirements.txt
python main.py
```

Open [the auction room](http://127.0.0.1:8000). Use `python main.py --port 8001` if port 8000 is occupied. The terminal mode is available with `python -m src.auction_simulator`.

Each set opens with an animated pouch and its player list. Open bidding to watch the franchises raise their paddles. Raise your paddle using the **Bid** button on your table until the auctioneer closes the lot. **Skip player** lets the AI finish the lot immediately and advances to the next player. A Right to Match offer has its own 30-second window.

The statistics below the floor open the player's available performance data, franchise purses and squads, the set list, results, and bid history. Click an opponent's table to inspect its squad directly.

The browser resumes the current auction on refresh while the server process is running. Restarting the server clears active auctions.

The simulation enforces purses, 25-player squad limits and eight overseas slots. AI teams prioritize marquee lots and keep part of their purse and squad capacity available for later sets. For other lots, interest depends on valuation, team needs, and squad depth, so a player can go unsold even with eligible teams still on the floor. Franchise preferences, bidding ceilings and Right to Match are simplified game rules. The retentions screen uses the repository's saved baseline roster and costs.

## Price model and data

```bash
python -m src.train_predictor
```

The trainer reads the checked-in feature CSV, excludes ambiguous player-year duplicates, and reports MAE on the latest historical season before refitting on all available pre-2025 sales. The checked-in model scored ₹2.04 Cr MAE on 195 sales in the 2022 holdout. A median-price baseline scored ₹2.37 Cr. The 2025 outcomes are excluded from training and model selection.

The app loads the native XGBoost model at `models/auction_price.ubj`. The original Joblib file remains in the repository. Player roles, overseas status, reserve prices and previous franchises come from the [official 2025 auction list published November 15, 2024](https://documents.iplt20.com/bcci/documents/1731674068078_TATA%20IPL%202025-%20Auction%20List%20-15.11.24.pdf). Players without an unambiguous match in the committed 2025 feature data use their reserve price as the AI's starting valuation.

The raw delivery and historical auction files are needed to regenerate the feature CSV. Those files are excluded by Git and are not required to launch the app or retrain from the committed features. The existing 2025 feature rows have not been rebuilt from raw pre-auction match data.
