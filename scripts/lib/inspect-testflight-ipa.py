"""Inspect one private IPA with Apple's supported signing tools; emit no raw metadata.

Only the bounded report is public. The IPA, decoded profiles, entitlements and
signing certificates remain in a private temporary directory on the macOS runner.
Unit fixtures inject the command boundary; production never substitutes a parser
for codesign's signature verification or entitlement extraction.
"""
import datetime as dt
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import re
import shutil
import stat
import subprocess
import sys
import tempfile
import zipfile

MAX_IPA = 1024 * 1024 * 1024
MAX_EXPANDED = 4 * MAX_IPA
MAX_PLIST = 2 * 1024 * 1024
PROMPTS = (
    "NSCameraUsageDescription", "NSMotionUsageDescription",
    "NSHealthShareUsageDescription", "NSHealthUpdateUsageDescription",
    "NSFaceIDUsageDescription", "NSLocalNetworkUsageDescription",
)
TARGET_CHECKS = (
    "bundleMatchesSource", "versionMatchesSource", "buildMatchesRemote",
    "devicePlatformMatches", "signatureIntegrityVerified",
    "storeProfileShapeMatched", "profileCurrentAtInspection",
    "signerCertificateAllowedByProfile", "entitlementsAllowedByProfile",
    "sourceEntitlementsMatched", "debuggingDisabled",
    "locationAndMicrophoneAbsent", "healthBackgroundDisabled",
    "multitaskingCameraDisabled",
)
API_CATEGORIES = {
    "NSPrivacyAccessedAPICategoryFileTimestamp", "NSPrivacyAccessedAPICategorySystemBootTime",
    "NSPrivacyAccessedAPICategoryDiskSpace", "NSPrivacyAccessedAPICategoryActiveKeyboards",
    "NSPrivacyAccessedAPICategoryUserDefaults",
}


def require(condition, code):
    if not condition:
        raise ValueError(code)


def object_plist(data):
    require(0 < len(data) <= MAX_PLIST, "plist-size")
    value = plistlib.loads(data)
    require(isinstance(value, dict), "plist-object")
    return value


def read_plist(path):
    require(path.is_file() and path.stat().st_size <= MAX_PLIST, "plist-file")
    return object_plist(path.read_bytes())


def native_command(args):
    result = subprocess.run(args, stdin=subprocess.DEVNULL, stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE, timeout=120, check=False)
    require(result.returncode == 0, "apple-tool-failed")
    require(len(result.stdout) + len(result.stderr) <= MAX_PLIST, "apple-tool-output")
    return result.stdout


def extract_ipa(ipa, destination):
    require(ipa.is_file() and 0 < ipa.stat().st_size <= MAX_IPA, "ipa-size")
    with zipfile.ZipFile(ipa) as archive:
        entries = archive.infolist()
        require(0 < len(entries) <= 30000, "zip-entry-count")
        seen, expanded = set(), 0
        for item in entries:
            name = item.filename
            parts = PurePosixPath(name).parts
            require(name and len(name) <= 1024 and not name.startswith("/")
                    and "\\" not in name and all(p not in ("..", ".", "") for p in parts)
                    and all(ord(c) >= 32 and ord(c) != 127 for c in name), "zip-path")
            normalized = str(PurePosixPath(name)).casefold()
            require(normalized not in seen, "zip-duplicate")
            seen.add(normalized)
            require(not item.flag_bits & 1, "zip-encrypted")
            mode = item.external_attr >> 16
            require(stat.S_IFMT(mode) in (0, stat.S_IFREG, stat.S_IFDIR), "zip-special-file")
            require(item.file_size <= MAX_IPA, "zip-file-size")
            expanded += item.file_size
            require(expanded <= MAX_EXPANDED, "zip-expanded-size")
            target = destination.joinpath(*parts)
            require(target.resolve().is_relative_to(destination.resolve()), "zip-escape")
            if item.is_dir():
                target.mkdir(parents=True, exist_ok=True)
                continue
            target.parent.mkdir(parents=True, exist_ok=True)
            with archive.open(item) as source, target.open("xb") as output:
                shutil.copyfileobj(source, output, 1024 * 1024)
            require(target.stat().st_size == item.file_size, "zip-truncated")
            target.chmod(0o700 if mode & 0o111 else 0o600)
    return len(entries)


def allowed(claimed, profile):
    """Profile values are an allowlist, including profile-only wildcard strings."""
    if type(claimed) is not type(profile):
        return False
    if isinstance(claimed, str):
        if "*" in claimed:
            return False
        return re.fullmatch(re.escape(profile).replace(r"\*", ".*"), claimed) is not None
    if isinstance(claimed, list):
        return all(any(allowed(value, candidate) for candidate in profile) for value in claimed)
    if isinstance(claimed, dict):
        return all(key in profile and allowed(value, profile[key]) for key, value in claimed.items())
    return isinstance(claimed, (bool, int, bytes)) and claimed == profile


def profile_checks(profile, entitlements, signer, bundle, team, now):
    permitted = profile.get("Entitlements")
    require(isinstance(permitted, dict) and isinstance(entitlements, dict), "entitlements-object")
    require(profile.get("TeamIdentifier") == [team]
            and permitted.get("com.apple.developer.team-identifier") == team
            and entitlements.get("com.apple.developer.team-identifier") == team, "signing-team")
    prefixes = profile.get("ApplicationIdentifierPrefix")
    require(isinstance(prefixes, list) and 1 <= len(prefixes) <= 8
            and all(isinstance(p, str) and re.fullmatch(r"[A-Z0-9]{10}", p) for p in prefixes), "application-prefix")
    require(entitlements.get("application-identifier") in [p + "." + bundle for p in prefixes], "application-identifier")
    require(entitlements.get("get-task-allow") is False
            and permitted.get("get-task-allow") is False, "debug-entitlement")
    require("ProvisionedDevices" not in profile and profile.get("ProvisionsAllDevices", False) is False,
            "store-profile")
    for field in ("CreationDate", "ExpirationDate"):
        require(isinstance(profile.get(field), dt.datetime), "profile-date")
    created = profile["CreationDate"].replace(tzinfo=dt.timezone.utc)
    expires = profile["ExpirationDate"].replace(tzinfo=dt.timezone.utc)
    require(created <= now < expires, "profile-expired-or-future")
    certificates = profile.get("DeveloperCertificates")
    require(isinstance(certificates, list) and 1 <= len(certificates) <= 100
            and all(isinstance(c, bytes) and 0 < len(c) <= 65536 for c in certificates), "profile-certificates")
    require(signer in certificates, "profile-signer-mismatch")
    require(all(key in permitted and allowed(value, permitted[key]) for key, value in entitlements.items()),
            "entitlement-not-permitted")


def privacy_manifests(phone, watch):
    paths = sorted(phone.rglob("PrivacyInfo.xcprivacy"))
    require(1 <= len(paths) <= 2000 and (phone / "PrivacyInfo.xcprivacy") in paths, "phone-privacy-manifest")
    require((watch / "PrivacyInfo.xcprivacy") in paths, "watch-privacy-manifest")
    watch_apis = read_plist(watch / "PrivacyInfo.xcprivacy").get("NSPrivacyAccessedAPITypes", [])
    # AlertReceiver's known process-uptime use measures local notification
    # freshness. Each executable needs its own required-reason declaration.
    require(isinstance(watch_apis, list) and any(isinstance(entry, dict)
            and entry.get("NSPrivacyAccessedAPIType") == "NSPrivacyAccessedAPICategorySystemBootTime"
            and isinstance(entry.get("NSPrivacyAccessedAPITypeReasons"), list)
            and "35F9.1" in entry["NSPrivacyAccessedAPITypeReasons"] for entry in watch_apis),
            "watch-timer-reason")
    digest = hashlib.sha256()
    counts = {"manifests": len(paths), "phoneManifests": 0, "watchManifests": 0,
              "collectedDataEntries": 0, "linkedDataEntries": 0, "requiredReasonEntries": 0}
    reasons = {}
    for path in paths:
        value = read_plist(path)
        require(set(value) <= {"NSPrivacyTracking", "NSPrivacyTrackingDomains",
                               "NSPrivacyCollectedDataTypes", "NSPrivacyAccessedAPITypes"}, "privacy-keys")
        require(value.get("NSPrivacyTracking", False) is False, "privacy-tracking")
        require(value.get("NSPrivacyTrackingDomains", []) == [], "privacy-tracking-domains")
        data = value.get("NSPrivacyCollectedDataTypes", [])
        require(isinstance(data, list) and len(data) <= 100, "privacy-data-list")
        for entry in data:
            require(isinstance(entry, dict) and set(entry) == {"NSPrivacyCollectedDataType",
                    "NSPrivacyCollectedDataTypeLinked", "NSPrivacyCollectedDataTypeTracking",
                    "NSPrivacyCollectedDataTypePurposes"}, "privacy-data-entry")
            require(isinstance(entry["NSPrivacyCollectedDataType"], str)
                    and re.fullmatch(r"NSPrivacyCollectedDataType[A-Za-z]{1,80}", entry["NSPrivacyCollectedDataType"]), "privacy-data-type")
            require(type(entry["NSPrivacyCollectedDataTypeLinked"]) is bool
                    and entry["NSPrivacyCollectedDataTypeTracking"] is False, "privacy-data-tracking")
            purposes = entry["NSPrivacyCollectedDataTypePurposes"]
            require(isinstance(purposes, list) and 1 <= len(purposes) <= 10
                    and all(isinstance(p, str) and re.fullmatch(r"NSPrivacyCollectedDataTypePurpose[A-Za-z]{1,80}", p) for p in purposes), "privacy-data-purposes")
            counts["collectedDataEntries"] += 1
            counts["linkedDataEntries"] += int(entry["NSPrivacyCollectedDataTypeLinked"])
        api = value.get("NSPrivacyAccessedAPITypes", [])
        require(isinstance(api, list) and len(api) <= 100, "privacy-api-list")
        for entry in api:
            require(isinstance(entry, dict) and set(entry) == {"NSPrivacyAccessedAPIType", "NSPrivacyAccessedAPITypeReasons"}, "privacy-api-entry")
            category, codes = entry["NSPrivacyAccessedAPIType"], entry["NSPrivacyAccessedAPITypeReasons"]
            require(isinstance(category, str) and category in API_CATEGORIES, "privacy-api-category")
            require(isinstance(codes, list) and 1 <= len(codes) <= 30
                    and all(isinstance(c, str) and re.fullmatch(r"[A-F0-9]{4}\.[0-9]{1,3}", c) for c in codes), "privacy-api-reasons")
            reasons.setdefault(category, set()).update(codes)
            counts["requiredReasonEntries"] += 1
        counts["watchManifests" if path.is_relative_to(watch) else "phoneManifests"] += 1
        digest.update(str(path.relative_to(phone)).encode() + b"\0" + path.read_bytes() + b"\0")
    return {**counts, "phoneRootManifestPresent": True,
            "watchRootManifestPresent": (watch / "PrivacyInfo.xcprivacy").is_file(),
            "watchTimerReasonDeclared": True,
            "schemasChecked": True, "trackingDeclared": False, "manifestSetSha256": digest.hexdigest(),
            "requiredReasons": {k: sorted(v) for k, v in sorted(reasons.items())}}


def inspect_target(path, role, contract, temporary, run, now):
    info = read_plist(path / "Info.plist")
    expected = contract[role]
    require(info.get("CFBundleIdentifier") == expected["bundleIdentifier"], "bundle-identity")
    require(info.get("CFBundleShortVersionString") == contract["appVersion"], "app-version")
    require(info.get("CFBundleVersion") == contract["appBuildVersion"], "build-number")
    require(info.get("CFBundleSupportedPlatforms") == (["iPhoneOS"] if role == "phone" else ["WatchOS"])
            and info.get("UIDeviceFamily") == ([1] if role == "phone" else [4])
            and info.get("CFBundlePackageType") == "APPL", "device-platform")
    require(not info.get("OcculertSimulatorTrace"), "simulator-plist")
    if role == "watch":
        require(info.get("WKCompanionAppBundleIdentifier") == contract["phone"]["bundleIdentifier"], "watch-companion")
    else:
        require(info.get("UIBackgroundModes") == ["audio"], "phone-background-modes")
    require(not any(key.startswith("NSLocation") or key == "NSMicrophoneUsageDescription" for key in info), "forbidden-permission")
    permissions = {key: value for key, value in info.items() if key.startswith("NS") and "UsageDescription" in key}
    require(set(permissions) <= set(expected["permissions"]), "unexpected-permission")
    require(set(permissions) <= set(PROMPTS), "unsupported-permission-report")
    for key, value in permissions.items():
        require(isinstance(value, str) and value == expected["permissions"][key], "permission-prompt")
    require(set(expected["requiredPermissions"]) <= set(permissions), "missing-permission")
    run(["/usr/bin/codesign", "--verify", "--deep", "--strict", str(path)])
    entitlements = object_plist(run(["/usr/bin/codesign", "--display", "--entitlements", "-", "--xml", str(path)]))
    profile = object_plist(run(["/usr/bin/security", "cms", "-D", "-i", str(path / "embedded.mobileprovision")]))
    prefix = temporary / (role + "-signer-")
    run(["/usr/bin/codesign", "--display", "--extract-certificates=" + str(prefix), str(path)])
    certificate = Path(str(prefix) + "0")
    require(certificate.is_file() and 0 < certificate.stat().st_size <= 65536, "signer-certificate")
    profile_checks(profile, entitlements, certificate.read_bytes(), expected["bundleIdentifier"], contract["appleTeamId"], now)
    for key, value in expected["entitlements"].items():
        require(key in entitlements and entitlements[key] == value, "source-entitlement")
    require(entitlements.get("com.apple.developer.healthkit.background-delivery", False) is False, "health-background")
    require(entitlements.get("com.apple.developer.avfoundation.multitasking-camera-access", False) is False, "multitasking-camera")
    # Distribution and identity keys come from signing; feature capabilities
    # must be the exact source-generated set, not merely permitted by a profile.
    signing_keys = {"application-identifier", "com.apple.developer.team-identifier",
                    "get-task-allow", "keychain-access-groups", "beta-reports-active"}
    require(set(entitlements) <= set(expected["entitlements"]) | signing_keys, "unexpected-feature-entitlement")
    if "keychain-access-groups" not in expected["entitlements"]:
        require("keychain-access-groups" not in entitlements
                or entitlements["keychain-access-groups"] == [entitlements["application-identifier"]],
                "unexpected-keychain-group")
    return {**{key: True for key in TARGET_CHECKS}, "permissionPrompts": permissions}


def inspect(ipa, contract, run=native_command, now=None):
    now = now or dt.datetime.now(dt.timezone.utc)
    require(contract.get("schema") == 1, "contract-schema")
    for key in ("sourceSha", "nativeTree"):
        require(re.fullmatch(r"[a-f0-9]{40}", contract.get(key, "")), "contract-source")
    for key in ("buildIdSha256", "artifactSha256"):
        require(re.fullmatch(r"[a-f0-9]{64}", contract.get(key, "")), "contract-digest")
    require(re.fullmatch(r"[0-9]+\.[0-9]+\.[0-9]+", contract.get("appVersion", "")), "contract-version")
    require(re.fullmatch(r"[1-9][0-9]{0,8}", contract.get("appBuildVersion", "")), "contract-build")
    require(contract.get("productionEnvironmentVerified") is True, "contract-environment")
    digest = hashlib.sha256()
    with ipa.open("rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            digest.update(chunk)
    require(digest.hexdigest() == contract["artifactSha256"], "ipa-digest")
    with tempfile.TemporaryDirectory(prefix="ipa-inspection-", dir=ipa.parent) as name:
        temporary = Path(name)
        entries = extract_ipa(ipa, temporary / "extracted")
        payload = temporary / "extracted" / "Payload"
        phones = list(payload.glob("*.app"))
        require(len(phones) == 1, "phone-count")
        phone = phones[0]
        watches = list((phone / "Watch").glob("*.app"))
        require(len(watches) == 1, "watch-count")
        watch = watches[0]
        require(set(payload.rglob("*.app")) == {phone, watch} and not list(payload.rglob("*.appex")), "unexpected-target")
        targets = {role: inspect_target(path, role, contract, temporary, run, now)
                   for role, path in (("phone", phone), ("watch", watch))}
        manifests = privacy_manifests(phone, watch)
    return {"schema": 1, "reviewable": True,
            **{key: contract[key] for key in ("sourceSha", "nativeTree", "buildIdSha256", "artifactSha256", "appVersion", "appBuildVersion")},
            "inspectedAt": now.isoformat(timespec="milliseconds").replace("+00:00", "Z"), "archiveEntries": entries,
            "phone": targets["phone"], "watch": targets["watch"],
            "watchCompanionMatches": True, "privacy": manifests,
            "productionEnvironmentVerified": True, "simulatorPlistDisabled": True,
            "javascriptCompileFlagsVerifiedFromBinary": False,
            "appleProcessingAndDeviceAcceptanceVerified": False,
            "appleCertificateTrustIndependentlyVerified": False,
            "resolvedNativeDependencyLockAvailableInIpa": False}


def main():
    require(sys.platform == "darwin" and len(sys.argv) == 4, "macos-inspector-required")
    ipa, contract_path, output = map(Path, sys.argv[1:])
    require(contract_path.stat().st_size <= 32768, "contract-size")
    result = inspect(ipa, json.loads(contract_path.read_text()))
    encoded = json.dumps(result, sort_keys=True, indent=2) + "\n"
    require(len(encoded.encode()) <= 16384, "report-size")
    descriptor = os.open(output, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, "w") as stream:
        stream.write(encoded)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Neither external-tool diagnostics nor file/provider identifiers leave
        # private runner storage, including failures and malformed archives.
        print("IPA inspection failed; raw signing and provider data are withheld.", file=sys.stderr)
        sys.exit(1)
