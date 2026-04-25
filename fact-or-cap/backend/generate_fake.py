import os
import json
import random
import argparse
import pandas as pd
from dotenv import load_dotenv
from openai import OpenAI

load_dotenv()

client = OpenAI(api_key=os.getenv("GPT_API_KEY"))

DATASET_PATH = "News_Category_Dataset_v3.json"


def get_real_political_news():
    df = pd.read_json(DATASET_PATH, lines=True)
    df_politics = df[df["category"] == "POLITICS"]

    row = df_politics.sample(1).iloc[0]

    return {
        "headline": str(row["headline"]),
        "description": str(row["short_description"]),
        "answer": "real",
    }


def get_fake_political_news():
    df = pd.read_json(DATASET_PATH, lines=True)
    df_politics = df[df["category"] == "POLITICS"]

    examples = df_politics.sample(5)[["headline", "short_description"]].to_dict(
        orient="records"
    )

    prompt = f"""
Here are examples of real political news headlines and descriptions:

{json.dumps(examples, indent=2)}

Generate ONE fictional political news headline and short description in a similar style.
Do not copy the examples.
Do not use real quotes.
Do not claim a real person said something unless it is fictionalized.

Return only JSON in this format:
{{
  "headline": "...",
  "description": "..."
}}
"""

    response = client.responses.create(
        model="gpt-4o-mini",
        input=prompt,
    )

    fake = json.loads(response.output_text)

    return {
        "headline": fake["headline"],
        "description": fake["description"],
        "answer": "fake",
    }


def get_random_news():
    if random.choice(["real", "fake"]) == "real":
        return get_real_political_news()

    return get_fake_political_news()


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    result = get_random_news()

    if args.json:
        print(json.dumps(result))
    else:
        print(result)
