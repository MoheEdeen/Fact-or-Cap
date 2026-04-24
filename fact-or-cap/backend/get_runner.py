import argparse
import json

import pandas as pd


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", dest="json_output")
    args = parser.parse_args()

    df = pd.read_json("News_Category_Dataset_v3.json", lines=True)
    df_politics = df[df["category"] == "POLITICS"]

    random_article = df_politics.sample(1).iloc[0]

    headline = str(random_article["headline"])
    description = str(random_article["short_description"])

    if args.json_output:
        print(
            json.dumps(
                {
                    "headline": headline,
                    "description": description,
                    "answer": "real",
                }
            )
        )
        return

    print("Headline:", headline)
    print("Description:", description)


if __name__ == "__main__":
    main()
