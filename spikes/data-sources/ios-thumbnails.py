import json
import platform
import plistlib
import shutil
import subprocess
import time
from pathlib import Path

from probe import ROOT


def command(*args):
    return subprocess.check_output(args, text=True).strip()


def run():
    devices = json.loads(command("xcrun", "simctl", "list", "devices", "booted", "--json"))
    booted = [device for group in devices["devices"].values() for device in group if device["state"] == "Booted"]
    if len(booted) != 1:
        raise SystemExit("Boot exactly one iOS simulator before running this probe.")
    device = booted[0]["udid"]
    app = ROOT.parents[1] / ".context/data-sources/ThumbnailProbe.app"
    app.mkdir(parents=True, exist_ok=True)
    identifier = "app.artlog.spike005"
    (app / "Info.plist").write_bytes(plistlib.dumps({
        "CFBundleIdentifier": identifier, "CFBundleName": "ThumbnailProbe",
        "CFBundleExecutable": "ThumbnailProbe", "CFBundlePackageType": "APPL",
        "CFBundleVersion": "1", "CFBundleShortVersionString": "1.0",
        "MinimumOSVersion": "16.4", "UIDeviceFamily": [1],
        "UIUserInterfaceStyle": "Light", "UILaunchScreen": {},
        "UISupportedInterfaceOrientations": ["UIInterfaceOrientationPortrait"],
    }))
    shutil.copyfile(ROOT / "results/thumbnails.json", app / "thumbnails.json")
    sdk = command("xcrun", "--sdk", "iphonesimulator", "--show-sdk-path")
    command("xcrun", "--sdk", "iphonesimulator", "swiftc", "-parse-as-library", "-target", f"{platform.machine()}-apple-ios16.4-simulator", "-sdk", sdk, "-framework", "UIKit", str(ROOT / "thumbnail-probe.swift"), "-o", str(app / "ThumbnailProbe"))
    command("codesign", "--force", "--sign", "-", str(app))
    command("xcrun", "simctl", "install", device, str(app))
    container = Path(command("xcrun", "simctl", "get_app_container", device, identifier, "data"))
    result = container / "Documents/ios-thumbnails.json"
    result.unlink(missing_ok=True)
    command("xcrun", "simctl", "launch", "--terminate-running-process", device, identifier)
    for _ in range(150):
        if result.exists():
            shutil.copyfile(result, ROOT / "results/ios-thumbnails.json")
            command("xcrun", "simctl", "io", device, "screenshot", str(app.parent / "ios-thumbnails.png"))
            print((ROOT / "results/ios-thumbnails.json").read_text())
            return
        time.sleep(1)
    raise SystemExit("Probe timed out; no completed result was copied.")


if __name__ == "__main__":
    run()
