import argparse
import json
from generate_fake import get_real_political_news, get_fake_political_news


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true", dest="json_output")
    parser.add_argument("--mode", choices=["real", "fake"], default="real")
    args = parser.parse_args()

    if args.mode == "fake":
        result = get_fake_political_news()
    else:
        result = get_real_political_news()

    if args.json_output:
        print(json.dumps(result))
        return

    print("Headline:", result["headline"])
    print("Description:", result["description"])
    print("Answer:", result["answer"])


if __name__ == "__main__":
    main()
