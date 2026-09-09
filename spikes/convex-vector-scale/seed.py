import argparse

from benchmark import client, seed_rows


def main():
    parser = argparse.ArgumentParser(description="Append deterministic vectors, resuming from the server checkpoint.")
    parser.add_argument("--target", type=int, required=True)
    parser.add_argument("--version", choices=["v1", "v2"], default="v1")
    parser.add_argument("--seed", type=int, default=20260908)
    parser.add_argument("--batch-size", type=int, choices=range(1, 1001), default=250, metavar="1..1000")
    parser.add_argument("--output", required=True)
    args = parser.parse_args()
    seed_rows(client(), args.target, args.version, args.seed, args.batch_size, args.output)


if __name__ == "__main__":
    main()
