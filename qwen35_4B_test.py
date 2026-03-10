#!/usr/bin/env python3
"""
qwen35_4B_test.py — Benchmark the Qwen3.5-4B control-loop LLM.

Runs a 2D point-to-target navigation task where the LLM must output
directional moves (+1, -1, or 0) on each axis. Outputs are clamped
to sign (so +3 becomes +1, etc.).

Usage:
    python3 qwen35_4B_test.py                    # 10 trials, defaults
    python3 qwen35_4B_test.py -n 50              # 50 trials
    python3 qwen35_4B_test.py -n 20 -d 10        # max initial distance 10
    python3 qwen35_4B_test.py --no-history        # stateless (no chat history)
    python3 qwen35_4B_test.py --max-steps 30      # allow more steps before timeout
    python3 qwen35_4B_test.py --seed 42           # reproducible random scenarios
    python3 qwen35_4B_test.py --api http://127.0.0.1:8001/v1  # custom endpoint
"""

import argparse
import json
import random
import sys
import time
from dataclasses import dataclass, field

import requests


@dataclass
class TrialResult:
    trial: int
    start: list
    target: list
    optimal: int
    steps: int
    reached: bool
    optimal_moves: int
    clamped_moves: int
    parse_errors: int
    total_moves: int
    latencies_ms: list = field(default_factory=list)

    @property
    def ratio(self):
        if self.optimal == 0:
            return 0.0 if self.reached else float("inf")
        return self.steps / self.optimal

    @property
    def avg_ms(self):
        return sum(self.latencies_ms) / len(self.latencies_ms) if self.latencies_ms else 0


def clamp(v):
    if v > 0: return 1
    if v < 0: return -1
    return 0


def optimal_distance(start, target):
    return max(abs(target[0] - start[0]), abs(target[1] - start[1]))


def expected_move(pos, target):
    ex = 1 if pos[0] < target[0] else (-1 if pos[0] > target[0] else 0)
    ey = 1 if pos[1] < target[1] else (-1 if pos[1] > target[1] else 0)
    return ex, ey


def generate_scenario(rng, max_dist):
    """Generate a random start/target pair with Chebyshev distance <= max_dist."""
    cx, cy = rng.randint(-10, 10), rng.randint(-10, 10)
    dist = rng.randint(1, max_dist)  # at least 1 step
    # Random target offset with Chebyshev distance = dist
    dx = rng.randint(-dist, dist)
    max_dy = dist  # ensure Chebyshev = dist
    dy_sign = rng.choice([-1, 1])
    if abs(dx) == dist:
        dy = rng.randint(-dist, dist)
    else:
        # Need at least one axis at dist
        dy = dy_sign * dist if rng.random() < 0.5 else rng.randint(-dist, dist)
        if abs(dx) < dist and abs(dy) < dist:
            # Force one axis to dist
            if rng.random() < 0.5:
                dx = rng.choice([-1, 1]) * dist
            else:
                dy = rng.choice([-1, 1]) * dist
    return [cx, cy], [cx + dx, cy + dy]


SYSTEM_PROMPT = (
    "You control a point on a 2D plane. Your goal: reach the target. "
    "Each step you move by exactly your response added to your current position. "
    "You must respond with ONLY two values separated by a space. "
    "Each value must be exactly +1, -1, or 0. Example response: +1 -1"
)


def run_trial(trial_num, start, target, api_url, model, max_steps, use_history):
    pos = list(start)
    opt = optimal_distance(start, target)
    messages = [{"role": "system", "content": SYSTEM_PROMPT}]
    result = TrialResult(
        trial=trial_num, start=list(start), target=list(target),
        optimal=opt, steps=0, reached=False,
        optimal_moves=0, clamped_moves=0, parse_errors=0, total_moves=0,
    )

    for step in range(1, max_steps + 1):
        if pos == target:
            result.reached = True
            break

        msg = f"You: {pos[0]} {pos[1]} Target: {target[0]} {target[1]}"

        if use_history:
            messages.append({"role": "user", "content": msg})
            send_messages = messages
        else:
            send_messages = [
                {"role": "system", "content": SYSTEM_PROMPT},
                {"role": "user", "content": msg},
            ]

        t0 = time.perf_counter()
        try:
            resp = requests.post(f"{api_url}/chat/completions", json={
                "model": model,
                "messages": send_messages,
                "max_tokens": 10,
                "temperature": 0,
                "chat_template_kwargs": {"enable_thinking": False},
            }, timeout=10).json()
            answer = resp["choices"][0]["message"]["content"].strip()
        except Exception as e:
            answer = ""
            result.parse_errors += 1

        latency_ms = (time.perf_counter() - t0) * 1000
        result.latencies_ms.append(latency_ms)

        if use_history:
            messages.append({"role": "assistant", "content": answer})

        # Parse and clamp
        parts = answer.split()
        dx, dy = 0, 0
        if len(parts) >= 2:
            try:
                raw_dx, raw_dy = int(parts[0]), int(parts[1])
                dx, dy = clamp(raw_dx), clamp(raw_dy)
                if raw_dx != dx or raw_dy != dy:
                    result.clamped_moves += 1
            except ValueError:
                result.parse_errors += 1
        else:
            result.parse_errors += 1

        ex, ey = expected_move(pos, target)
        result.total_moves += 1
        if dx == ex and dy == ey:
            result.optimal_moves += 1

        pos[0] += dx
        pos[1] += dy
        result.steps = step

    if pos == target:
        result.reached = True

    return result


def main():
    parser = argparse.ArgumentParser(description="Benchmark Qwen3.5-4B on 2D navigation")
    parser.add_argument("-n", "--trials", type=int, default=10, help="Number of trials (default: 10)")
    parser.add_argument("-d", "--max-dist", type=int, default=8, help="Max Chebyshev distance start→target (default: 8)")
    parser.add_argument("--max-steps", type=int, default=20, help="Max steps per trial before timeout (default: 20)")
    parser.add_argument("--seed", type=int, default=None, help="Random seed for reproducibility")
    parser.add_argument("--no-history", action="store_true", help="Stateless mode (no chat history)")
    parser.add_argument("--api", type=str, default="http://127.0.0.1:8001/v1", help="vLLM API base URL")
    parser.add_argument("--model", type=str, default="qwen3.5-4b", help="Model name")
    parser.add_argument("-v", "--verbose", action="store_true", help="Print each step")
    args = parser.parse_args()

    seed = args.seed if args.seed is not None else random.randint(0, 999999)
    rng = random.Random(seed)
    use_history = not args.no_history

    # Check API is up
    try:
        r = requests.get(f"{args.api}/models", timeout=5)
        r.raise_for_status()
    except Exception:
        print(f"ERROR: API not reachable at {args.api}")
        sys.exit(1)

    print(f"Qwen3.5-4B Navigation Benchmark")
    print(f"  Trials: {args.trials}, Max distance: {args.max_dist}, Max steps: {args.max_steps}")
    print(f"  History: {'ON' if use_history else 'OFF'}, Seed: {seed}")
    print(f"  API: {args.api}, Model: {args.model}")
    print()

    results = []
    all_latencies = []

    for i in range(args.trials):
        start, target = generate_scenario(rng, args.max_dist)
        result = run_trial(i + 1, start, target, args.api, args.model, args.max_steps, use_history)
        results.append(result)
        all_latencies.extend(result.latencies_ms)

        status = "OK  " if result.reached else "FAIL"
        print(f"  {i+1:3d}/{args.trials}: {str(start):>12s}→{str(target):<12s}  "
              f"{status} {result.steps:2d}/{result.optimal:<2d} ({result.ratio:.1f}x)  "
              f"opt={result.optimal_moves}/{result.total_moves}  "
              f"clamp={result.clamped_moves}  err={result.parse_errors}  "
              f"avg={result.avg_ms:.0f}ms")

    # Summary
    reached = sum(1 for r in results if r.reached)
    total_opt = sum(r.optimal_moves for r in results)
    total_clamp = sum(r.clamped_moves for r in results)
    total_err = sum(r.parse_errors for r in results)
    total_moves = sum(r.total_moves for r in results)
    ratios = [r.ratio for r in results if r.optimal > 0]
    within_1_5x = sum(1 for r in ratios if r <= 1.5)
    within_2x = sum(1 for r in ratios if r <= 2.0)

    print()
    print("=" * 70)
    print("SUMMARY")
    print("=" * 70)
    print(f"  Targets reached:     {reached}/{len(results)} ({100*reached/len(results):.0f}%)")
    if total_moves > 0:
        print(f"  Optimal move rate:   {total_opt}/{total_moves} ({100*total_opt/total_moves:.0f}%)")
        print(f"  Clamped moves:       {total_clamp}/{total_moves} ({100*total_clamp/total_moves:.0f}%)")
        print(f"  Parse errors:        {total_err}/{total_moves} ({100*total_err/total_moves:.0f}%)")
    if ratios:
        print(f"  Mean step ratio:     {sum(ratios)/len(ratios):.2f}x")
        print(f"  Median step ratio:   {sorted(ratios)[len(ratios)//2]:.2f}x")
        print(f"  Worst ratio:         {max(ratios):.1f}x")
        print(f"  Within 1.5x:         {within_1_5x}/{len(ratios)} ({100*within_1_5x/len(ratios):.0f}%)")
        print(f"  Within 2.0x:         {within_2x}/{len(ratios)} ({100*within_2x/len(ratios):.0f}%)")
    if all_latencies:
        print()
        sorted_lat = sorted(all_latencies)
        print(f"  Latency per call:")
        print(f"    Mean:   {sum(all_latencies)/len(all_latencies):.0f} ms")
        print(f"    Median: {sorted_lat[len(sorted_lat)//2]:.0f} ms")
        print(f"    P95:    {sorted_lat[int(len(sorted_lat)*0.95)]:.0f} ms")
        print(f"    Min:    {sorted_lat[0]:.0f} ms")
        print(f"    Max:    {sorted_lat[-1]:.0f} ms")
        print(f"    Total:  {len(all_latencies)} calls in {sum(all_latencies)/1000:.1f}s")


if __name__ == "__main__":
    main()
