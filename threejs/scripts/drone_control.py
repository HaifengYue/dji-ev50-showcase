#!/usr/bin/env python3
"""Small command-line client for the local EV50 HTTP control bridge."""
import argparse
import json
import sys
import time
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


def call(base, method, path, body=None):
    data = None if body is None else json.dumps(body).encode("utf-8")
    request = Request(base + path, data=data, method=method, headers={"Content-Type": "application/json"})
    try:
        with urlopen(request, timeout=5) as response:
            return response.status, json.load(response)
    except HTTPError as error:
        return error.code, json.load(error)
    except URLError as error:
        raise SystemExit(f"无法连接控制服务：{error.reason}")


def queued(base, method, path, body, wait_for_result):
    status, result = call(base, method, path, body)
    print(json.dumps(result, ensure_ascii=False, indent=2))
    if not wait_for_result or status != 202 or not result.get("ok"):
        return 0 if result.get("ok") else 1
    request_id = result["data"]["id"]
    for _ in range(100):
        time.sleep(0.1)
        _, current = call(base, "GET", f"/api/v1/requests/{request_id}")
        if current.get("data", {}).get("status") == "completed":
            print(json.dumps(current["data"]["response"], ensure_ascii=False, indent=2))
            return 0
    print("指令已入队，但页面尚未在 10 秒内确认。", file=sys.stderr)
    return 2


def main():
    parser = argparse.ArgumentParser(description="实时驱动 EV50 页面中的无人机")
    parser.add_argument("--base-url", default="http://127.0.0.1:8787")
    parser.add_argument("--wait", action="store_true", help="等待页面执行并返回结果")
    commands = parser.add_subparsers(dest="command", required=True)
    for name in ("health", "state", "missions", "settings", "capabilities"):
        commands.add_parser(name)
    for name in ("play", "pause", "resume", "reset"):
        commands.add_parser(name)
    motor = commands.add_parser("motor"); motor.add_argument("lift", type=float); motor.add_argument("cruise", type=float)
    position = commands.add_parser("position"); position.add_argument("xyz", nargs=3, type=float)
    velocity = commands.add_parser("velocity"); velocity.add_argument("xyz", nargs=3, type=float)
    attitude = commands.add_parser("attitude"); attitude.add_argument("xyzw", nargs=4, type=float)
    seek = commands.add_parser("seek"); seek.add_argument("seconds", type=float)
    speed = commands.add_parser("speed"); speed.add_argument("value", type=float)
    route = commands.add_parser("route"); route.add_argument("id", choices=["valley", "plateau", "ridge"])
    settings = commands.add_parser("configure"); settings.add_argument("--loop", choices=["true", "false"]); settings.add_argument("--speed", type=float); settings.add_argument("--camera", choices=["free", "ground", "follow", "side", "wide"]); settings.add_argument("--quality", choices=["Low", "Medium", "High"]); settings.add_argument("--annotations", choices=["true", "false"])
    args = parser.parse_args(); base = args.base_url.rstrip("/")
    reads={"health":"/api/v1/health","state":"/api/v1/flight/state","missions":"/api/v1/missions","settings":"/api/v1/settings","capabilities":"/api/v1/capabilities"}
    if args.command in reads:
        _, result = call(base, "GET", reads[args.command]); print(json.dumps(result, ensure_ascii=False, indent=2)); return 0 if result.get("ok") else 1
    if args.command in {"play", "pause", "resume", "reset"}:
        return queued(base, "POST", f"/api/v1/flight/{args.command}", {}, args.wait)
    if args.command == "motor": body={"type":"motor","lift":args.lift,"cruise":args.cruise}; return queued(base, "POST", "/api/v1/flight/commands", body, args.wait)
    if args.command in {"position", "velocity"}: return queued(base, "POST", "/api/v1/flight/commands", {"type":args.command,args.command:args.xyz}, args.wait)
    if args.command == "attitude": return queued(base, "POST", "/api/v1/flight/commands", {"type":"attitude","quaternion":args.xyzw}, args.wait)
    if args.command == "seek": return queued(base, "PUT", "/api/v1/flight/time", {"seconds":args.seconds}, args.wait)
    if args.command == "speed": return queued(base, "PUT", "/api/v1/flight/speed", {"speed":args.value}, args.wait)
    if args.command == "route": return queued(base, "PUT", "/api/v1/missions/current", {"route":args.id}, args.wait)
    body={key:value for key,value in {"loop":None if args.loop is None else args.loop == "true","playbackSpeed":args.speed,"camera":args.camera,"quality":args.quality,"annotations":None if args.annotations is None else args.annotations == "true"}.items() if value is not None}
    if not body: raise SystemExit("configure 至少需要一个设置项")
    return queued(base, "PATCH", "/api/v1/settings", body, args.wait)


if __name__ == "__main__":
    sys.exit(main())
