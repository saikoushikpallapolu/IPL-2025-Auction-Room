import pandas as pd

from .train_predictor import ROOT


def generate_perfect_2025_assets():
    raw_dir = ROOT / "data/raw/ipl_auctions"
    # The auction registry is sourced separately from the official IPL list.
    official_retentions = [
        # Mumbai Indians
        {"team_name": "MUMBAI INDIANS", "player_name": "Jasprit Bumrah", "role": "BOWL", "nationality": "Indian", "cost": 18.0},
        {"team_name": "MUMBAI INDIANS", "player_name": "Suryakumar Yadav", "role": "BAT", "nationality": "Indian", "cost": 16.35},
        {"team_name": "MUMBAI INDIANS", "player_name": "Hardik Pandya", "role": "AR", "nationality": "Indian", "cost": 16.35},
        {"team_name": "MUMBAI INDIANS", "player_name": "Rohit Sharma", "role": "BAT", "nationality": "Indian", "cost": 16.30},
        {"team_name": "MUMBAI INDIANS", "player_name": "Tilak Varma", "role": "BAT", "nationality": "Indian", "cost": 8.00},
        
        # Royal Challengers Bengaluru
        {"team_name": "ROYAL CHALLENGERS BENGALURU", "player_name": "Virat Kohli", "role": "BAT", "nationality": "Indian", "cost": 21.0},
        {"team_name": "ROYAL CHALLENGERS BENGALURU", "player_name": "Rajat Patidar", "role": "BAT", "nationality": "Indian", "cost": 11.0},
        {"team_name": "ROYAL CHALLENGERS BENGALURU", "player_name": "Yash Dayal", "role": "BOWL", "nationality": "Indian", "cost": 5.0},
        
        # Chennai Super Kings
        {"team_name": "CHENNAI SUPER KINGS", "player_name": "Ruturaj Gaikwad", "role": "BAT", "nationality": "Indian", "cost": 18.0},
        {"team_name": "CHENNAI SUPER KINGS", "player_name": "Ravindra Jadeja", "role": "AR", "nationality": "Indian", "cost": 18.0},
        {"team_name": "CHENNAI SUPER KINGS", "player_name": "Matheesha Pathirana", "role": "BOWL", "nationality": "Overseas", "cost": 13.0},
        {"team_name": "CHENNAI SUPER KINGS", "player_name": "Shivam Dube", "role": "AR", "nationality": "Indian", "cost": 12.0},
        {"team_name": "CHENNAI SUPER KINGS", "player_name": "MS Dhoni", "role": "WK", "nationality": "Indian", "cost": 4.0},

        # Kolkata Knight Riders
        {"team_name": "KOLKATA KNIGHT RIDERS", "player_name": "Rinku Singh", "role": "BAT", "nationality": "Indian", "cost": 13.0},
        {"team_name": "KOLKATA KNIGHT RIDERS", "player_name": "Varun Chakaravarthy", "role": "BOWL", "nationality": "Indian", "cost": 12.0},
        {"team_name": "KOLKATA KNIGHT RIDERS", "player_name": "Sunil Narine", "role": "AR", "nationality": "Overseas", "cost": 12.0},
        {"team_name": "KOLKATA KNIGHT RIDERS", "player_name": "Andre Russell", "role": "AR", "nationality": "Overseas", "cost": 12.0},
        {"team_name": "KOLKATA KNIGHT RIDERS", "player_name": "Harshit Rana", "role": "BOWL", "nationality": "Indian", "cost": 4.0},
        {"team_name": "KOLKATA KNIGHT RIDERS", "player_name": "Ramandeep Singh", "role": "AR", "nationality": "Indian", "cost": 4.0},

        # Rajasthan Royals
        {"team_name": "RAJASTHAN ROYALS", "player_name": "Sanju Samson", "role": "WK", "nationality": "Indian", "cost": 18.0},
        {"team_name": "RAJASTHAN ROYALS", "player_name": "Yashasvi Jaiswal", "role": "BAT", "nationality": "Indian", "cost": 18.0},
        {"team_name": "RAJASTHAN ROYALS", "player_name": "Riyan Parag", "role": "AR", "nationality": "Indian", "cost": 14.0},
        {"team_name": "RAJASTHAN ROYALS", "player_name": "Dhruv Jurel", "role": "WK", "nationality": "Indian", "cost": 14.0},
        {"team_name": "RAJASTHAN ROYALS", "player_name": "Shimron Hetmyer", "role": "BAT", "nationality": "Overseas", "cost": 11.0},
        {"team_name": "RAJASTHAN ROYALS", "player_name": "Sandeep Sharma", "role": "BOWL", "nationality": "Indian", "cost": 4.0},

        # Sunrisers Hyderabad
        {"team_name": "SUNRISERS HYDERABAD", "player_name": "Heinrich Klaasen", "role": "WK", "nationality": "Overseas", "cost": 23.0},
        {"team_name": "SUNRISERS HYDERABAD", "player_name": "Pat Cummins", "role": "AR", "nationality": "Overseas", "cost": 18.0},
        {"team_name": "SUNRISERS HYDERABAD", "player_name": "Abhishek Sharma", "role": "AR", "nationality": "Indian", "cost": 14.0},
        {"team_name": "SUNRISERS HYDERABAD", "player_name": "Travis Head", "role": "BAT", "nationality": "Overseas", "cost": 14.0},
        {"team_name": "SUNRISERS HYDERABAD", "player_name": "Nitish Kumar Reddy", "role": "AR", "nationality": "Indian", "cost": 6.0},

        # Gujarat Titans
        {"team_name": "GUJARAT TITANS", "player_name": "Rashid Khan", "role": "BOWL", "nationality": "Overseas", "cost": 18.0},
        {"team_name": "GUJARAT TITANS", "player_name": "Shubman Gill", "role": "BAT", "nationality": "Indian", "cost": 16.5},
        {"team_name": "GUJARAT TITANS", "player_name": "Sai Sudharsan", "role": "BAT", "nationality": "Indian", "cost": 8.5},
        {"team_name": "GUJARAT TITANS", "player_name": "Rahul Tewatia", "role": "AR", "nationality": "Indian", "cost": 4.0},
        {"team_name": "GUJARAT TITANS", "player_name": "Shahrukh Khan", "role": "BAT", "nationality": "Indian", "cost": 4.0},

        # Delhi Capitals
        {"team_name": "DELHI CAPITALS", "player_name": "Axar Patel", "role": "AR", "nationality": "Indian", "cost": 16.50},
        {"team_name": "DELHI CAPITALS", "player_name": "Kuldeep Yadav", "role": "BOWL", "nationality": "Indian", "cost": 13.25},
        {"team_name": "DELHI CAPITALS", "player_name": "Tristan Stubbs", "role": "WK", "nationality": "Overseas", "cost": 10.00},
        {"team_name": "DELHI CAPITALS", "player_name": "Abishek Porel", "role": "WK", "nationality": "Indian", "cost": 4.00},

        # Lucknow Super Giants
        {"team_name": "LUCKNOW SUPER GIANTS", "player_name": "Nicholas Pooran", "role": "WK", "nationality": "Overseas", "cost": 21.0},
        {"team_name": "LUCKNOW SUPER GIANTS", "player_name": "Ravi Bishnoi", "role": "BOWL", "nationality": "Indian", "cost": 11.0},
        {"team_name": "LUCKNOW SUPER GIANTS", "player_name": "Mayank Yadav", "role": "BOWL", "nationality": "Indian", "cost": 11.0},
        {"team_name": "LUCKNOW SUPER GIANTS", "player_name": "Mohsin Khan", "role": "BOWL", "nationality": "Indian", "cost": 4.0},
        {"team_name": "LUCKNOW SUPER GIANTS", "player_name": "Ayush Badoni", "role": "BAT", "nationality": "Indian", "cost": 4.0},

        # Punjab Kings
        {"team_name": "PUNJAB KINGS", "player_name": "Shashank Singh", "role": "BAT", "nationality": "Indian", "cost": 5.5},
        {"team_name": "PUNJAB KINGS", "player_name": "Prabhsimran Singh", "role": "WK", "nationality": "Indian", "cost": 4.0}
    ]
    
    squads_df = pd.DataFrame(official_retentions)
    squads_df.to_csv(raw_dir / "squads_2024.csv", index=False)
    print(f"[OK] Generated strict official 'squads_2024.csv' with locked core values.")

if __name__ == "__main__":
    generate_perfect_2025_assets()