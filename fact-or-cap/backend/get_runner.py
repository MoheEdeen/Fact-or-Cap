import pandas as pd

df = pd.read_json("News_Category_Dataset_v3.json", lines=True)

df_politics = df[df["category"] == "POLITICS"]

random_article = df_politics.sample(1).iloc[0]

headline = random_article["headline"]
description = random_article["short_description"]

print("Headline:", headline)
print("Description:", description)
