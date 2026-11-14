"""Archive and signing-policy fixtures; Apple tool execution is runner-only."""
import copy
import datetime as dt
import hashlib
import importlib.util
import json
from pathlib import Path
import plistlib
import stat
import sys
import tempfile
import unittest
import zipfile

SPEC = importlib.util.spec_from_file_location("ipa_inspector", Path(__file__).parent / "lib" / "inspect-testflight-ipa.py")
INSPECTOR = importlib.util.module_from_spec(SPEC)
sys.dont_write_bytecode = True
SPEC.loader.exec_module(INSPECTOR)
NOW = dt.datetime(2026, 11, 14, 22, tzinfo=dt.timezone.utc)
TEAM = "TEAM123456"
PREFIX = "OLD1234567"  # A valid historical prefix need not equal the Apple team.
CERTIFICATE = b"private fixture leaf certificate"
PHONE = "Payload/Occulert.app"
WATCH = PHONE + "/Watch/OcculertWatch.app"


class Fixture:
    def __init__(self, directory):
        self.path = Path(directory) / "private.ipa"
        self.commands = []
        self.fail_signature = False
        self.contract = {"schema": 1, "sourceSha": "a" * 40, "nativeTree": "b" * 40,
                         "buildIdSha256": "c" * 64, "artifactSha256": "d" * 64,
                         "appVersion": "1.0.0", "appBuildVersion": "61",
                         "appleTeamId": TEAM, "productionEnvironmentVerified": True}
        self.infos, self.profiles, self.entitlements, self.entries = {}, {}, {}, {}
        for role, path, bundle in (("phone", PHONE, "com.occulert.app"), ("watch", WATCH, "com.occulert.app.watch")):
            permissions = {key: "Occulert source-reviewed " + key for key in INSPECTOR.PROMPTS[:4]} if role == "phone" else {}
            capabilities = {"com.apple.developer.healthkit": True} if role == "phone" else {
                "com.apple.developer.usernotifications.time-sensitive": True}
            self.contract[role] = {"bundleIdentifier": bundle, "permissions": permissions,
                                   "requiredPermissions": list(permissions), "entitlements": capabilities}
            self.infos[role] = {"CFBundleIdentifier": bundle, "CFBundleShortVersionString": "1.0.0",
                                "CFBundleVersion": "61", "CFBundlePackageType": "APPL",
                                "CFBundleSupportedPlatforms": ["iPhoneOS" if role == "phone" else "WatchOS"],
                                "UIDeviceFamily": [1 if role == "phone" else 4], **permissions}
            if role == "phone":
                self.infos[role]["UIBackgroundModes"] = ["audio"]
            else:
                self.infos[role]["WKCompanionAppBundleIdentifier"] = "com.occulert.app"
            self.entitlements[role] = {"application-identifier": PREFIX + "." + bundle,
                                       "com.apple.developer.team-identifier": TEAM,
                                       "get-task-allow": False,
                                       "keychain-access-groups": [PREFIX + "." + bundle], **capabilities}
            self.profiles[role] = {"UUID": "private-profile-identifier", "Name": "private-account-profile-name",
                                  "TeamIdentifier": [TEAM], "ApplicationIdentifierPrefix": [PREFIX],
                                  "CreationDate": NOW.replace(tzinfo=None) - dt.timedelta(days=10),
                                  "ExpirationDate": NOW.replace(tzinfo=None) + dt.timedelta(days=100),
                                  "DeveloperCertificates": [CERTIFICATE],
                                  "Entitlements": {**copy.deepcopy(self.entitlements[role]),
                                                   "application-identifier": PREFIX + ".*",
                                                   "keychain-access-groups": [PREFIX + ".*"],
                                                   "extra-profile-only-capability": True}}
            self.entries[path + "/embedded.mobileprovision"] = b"private CMS fixture"
            self.entries[path + "/Executable"] = b"fixture executable, never launched"
        self.manifest = {"NSPrivacyTracking": False, "NSPrivacyTrackingDomains": [],
                         "NSPrivacyCollectedDataTypes": [], "NSPrivacyAccessedAPITypes": [
                             {"NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategoryUserDefaults",
                              "NSPrivacyAccessedAPITypeReasons": ["CA92.1"]}]}
        self.watch_manifest = {"NSPrivacyTracking": False, "NSPrivacyTrackingDomains": [],
                               "NSPrivacyCollectedDataTypes": [], "NSPrivacyAccessedAPITypes": [
                                   {"NSPrivacyAccessedAPIType": "NSPrivacyAccessedAPICategorySystemBootTime",
                                    "NSPrivacyAccessedAPITypeReasons": ["35F9.1"]}]}

    def write(self, extras=None):
        entries = dict(self.entries)
        for role, path in (("phone", PHONE), ("watch", WATCH)):
            entries[path + "/Info.plist"] = plistlib.dumps(self.infos[role], fmt=plistlib.FMT_BINARY)
        entries[PHONE + "/PrivacyInfo.xcprivacy"] = plistlib.dumps(self.manifest)
        if self.watch_manifest is not None:
            entries[WATCH + "/PrivacyInfo.xcprivacy"] = plistlib.dumps(self.watch_manifest)
        with zipfile.ZipFile(self.path, "w", zipfile.ZIP_DEFLATED) as archive:
            for name, data in entries.items():
                archive.writestr(name, data)
            for item, data in extras or []:
                archive.writestr(item, data)
        self.contract["artifactSha256"] = hashlib.sha256(self.path.read_bytes()).hexdigest()

    def run(self, args):
        self.commands.append(args)
        role = "watch" if "OcculertWatch.app" in args[-1] else "phone"
        if args[0] == "/usr/bin/security":
            self.assert_command(args[1:4] == ["cms", "-D", "-i"])
            return plistlib.dumps(self.profiles[role])
        self.assert_command(args[0] == "/usr/bin/codesign")
        if args[1] == "--verify":
            self.assert_command(args[1:4] == ["--verify", "--deep", "--strict"])
            if self.fail_signature:
                raise ValueError("controlled signature failure")
            return b""
        if "--entitlements" in args:
            self.assert_command(args[1:5] == ["--display", "--entitlements", "-", "--xml"])
            return plistlib.dumps(self.entitlements[role])
        option = args[2]
        self.assert_command(option.startswith("--extract-certificates="))
        Path(option.split("=", 1)[1] + "0").write_bytes(CERTIFICATE)
        return b""

    @staticmethod
    def assert_command(condition):
        if not condition:
            raise AssertionError("Unexpected Apple command")

    def inspect(self):
        return INSPECTOR.inspect(self.path, self.contract, run=self.run, now=NOW)


class ArchiveTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory(prefix="testflight-ipa-test-")
        self.addCleanup(self.directory.cleanup)
        self.fixture = Fixture(self.directory.name)

    def check_rejected(self, change):
        fixture = Fixture(self.directory.name)
        change(fixture)
        fixture.write()
        with self.assertRaises((ValueError, TypeError, plistlib.InvalidFileException)):
            fixture.inspect()

    def test_actual_zip_and_binary_plists_produce_bounded_private_safe_report(self):
        self.fixture.write()
        report = self.fixture.inspect()
        self.assertTrue(report["reviewable"])
        self.assertEqual(report["artifactSha256"], self.fixture.contract["artifactSha256"])
        self.assertEqual(report["phone"]["permissionPrompts"], self.fixture.contract["phone"]["permissions"])
        self.assertEqual(report["privacy"]["manifests"], 2)
        self.assertEqual(report["privacy"]["requiredReasons"], {"NSPrivacyAccessedAPICategoryUserDefaults": ["CA92.1"],
                                                               "NSPrivacyAccessedAPICategorySystemBootTime": ["35F9.1"]})
        self.assertTrue(report["privacy"]["watchRootManifestPresent"])
        self.assertTrue(report["privacy"]["watchTimerReasonDeclared"])
        self.assertEqual(len(self.fixture.commands), 8)
        serialized = json.dumps(report)
        for private in [TEAM, PREFIX, CERTIFICATE.decode(), "private-profile-identifier",
                        "private-account-profile-name", "com.occulert.app", str(self.fixture.path)]:
            self.assertNotIn(private, serialized)
        self.assertFalse(report["javascriptCompileFlagsVerifiedFromBinary"])
        self.assertFalse(report["appleCertificateTrustIndependentlyVerified"])
        self.assertFalse(report["appleProcessingAndDeviceAcceptanceVerified"])
        self.assertFalse(report["resolvedNativeDependencyLockAvailableInIpa"])

    def test_phone_and_watch_identity_version_build_platform_and_companion(self):
        for role in ("phone", "watch"):
            for key, value in [("CFBundleIdentifier", "other"), ("CFBundleShortVersionString", "1.0"),
                               ("CFBundleVersion", "60"), ("CFBundleSupportedPlatforms", ["iPhoneSimulator"]),
                               ("UIDeviceFamily", [1, 2]), ("CFBundlePackageType", "BNDL")]:
                with self.subTest(role=role, key=key):
                    self.check_rejected(lambda f: f.infos[role].update({key: value}))
        self.check_rejected(lambda f: f.infos["watch"].update(WKCompanionAppBundleIdentifier="other"))

    def test_required_purposes_and_exact_source_wording(self):
        for key in INSPECTOR.PROMPTS[:4]:
            with self.subTest(key=key):
                self.check_rejected(lambda f: f.infos["phone"].pop(key))
                self.check_rejected(lambda f: f.infos["phone"].update({key: "Different permission scope"}))

    def test_location_microphone_extra_permissions_and_background_modes_rejected(self):
        for key in ("NSLocationWhenInUseUsageDescription", "NSMicrophoneUsageDescription", "NSContactsUsageDescription"):
            for role in ("phone", "watch"):
                with self.subTest(role=role, key=key):
                    self.check_rejected(lambda f: f.infos[role].update({key: "unexpected"}))
        self.check_rejected(lambda f: f.infos["phone"].update(UIBackgroundModes=["audio", "location"]))

    def test_archive_detectable_experiments_and_feature_entitlements_rejected(self):
        self.check_rejected(lambda f: f.infos["phone"].update(OcculertSimulatorTrace=True))
        for key in ("com.apple.developer.healthkit.background-delivery",
                    "com.apple.developer.avfoundation.multitasking-camera-access", "unreviewed-feature"):
            def change(f):
                f.entitlements["phone"][key] = True
                f.profiles["phone"]["Entitlements"][key] = True
            with self.subTest(key=key):
                self.check_rejected(change)
        self.check_rejected(lambda f: f.entitlements["watch"].pop("com.apple.developer.usernotifications.time-sensitive"))

    def test_signature_failure_stops_inspection(self):
        self.fixture.fail_signature = True
        self.fixture.write()
        with self.assertRaises(ValueError):
            self.fixture.inspect()
        self.assertEqual(len(self.fixture.commands), 1)

    def test_profiles_must_be_current_store_shape_non_debugging_and_correct_team(self):
        for role in ("phone", "watch"):
            for key, value in [("ProvisionedDevices", ["private-device"]), ("ProvisionsAllDevices", True),
                               ("TeamIdentifier", ["OTHER12345"]), ("ApplicationIdentifierPrefix", [TEAM]),
                               ("ExpirationDate", NOW.replace(tzinfo=None)),
                               ("CreationDate", NOW.replace(tzinfo=None) + dt.timedelta(days=1)),
                               ("DeveloperCertificates", [b"another signer"])]:
                with self.subTest(role=role, key=key):
                    self.check_rejected(lambda f: f.profiles[role].update({key: value}))
            self.check_rejected(lambda f: f.entitlements[role].update({"get-task-allow": True}))

    def test_profile_allowlist_is_not_whole_dictionary_equality(self):
        self.assertTrue(INSPECTOR.allowed([PREFIX + ".com.occulert.app"], [PREFIX + ".*", "another.group"]))
        self.assertTrue(INSPECTOR.allowed({"needed": True}, {"needed": True, "unused": False}))
        self.assertFalse(INSPECTOR.allowed(["OTHER.com.occulert.app"], [PREFIX + ".*"]))
        self.assertFalse(INSPECTOR.allowed("*", "*"))
        self.assertFalse(INSPECTOR.allowed(True, 1))
        self.assertFalse(INSPECTOR.allowed({"extra": True}, {"needed": True}))
        self.check_rejected(lambda f: f.entitlements["phone"].update({"keychain-access-groups": ["OTHER.private"]}))
        self.check_rejected(lambda f: f.entitlements["phone"].update({"keychain-access-groups": [PREFIX + ".other-app"]}))

    def test_malformed_tracking_or_unknown_privacy_manifests_rejected(self):
        for key, value in [("NSPrivacyTracking", True), ("NSPrivacyTrackingDomains", ["private.example"]),
                           ("NSPrivacyAccessedAPITypes", {}), ("NSPrivacyCollectedDataTypes", ["invalid"]),
                           ("newPrivateKey", "must not escape")]:
            with self.subTest(key=key):
                self.check_rejected(lambda f: f.manifest.update({key: value}))
        self.check_rejected(lambda f: f.manifest["NSPrivacyAccessedAPITypes"][0].update(NSPrivacyAccessedAPITypeReasons=["arbitrary output"]))

    def test_digest_binding_and_production_evidence_are_required(self):
        self.fixture.write()
        self.fixture.contract["artifactSha256"] = "f" * 64
        with self.assertRaises(ValueError):
            self.fixture.inspect()
        self.assertEqual(self.fixture.commands, [])
        self.fixture.write()
        self.fixture.contract["productionEnvironmentVerified"] = False
        with self.assertRaises(ValueError):
            self.fixture.inspect()

    def test_watch_requires_own_root_manifest_with_exact_local_timer_reason(self):
        self.check_rejected(lambda f: setattr(f, "watch_manifest", None))
        self.check_rejected(lambda f: f.watch_manifest.update(NSPrivacyAccessedAPITypes=[]))
        self.check_rejected(lambda f: f.watch_manifest["NSPrivacyAccessedAPITypes"][0].update(NSPrivacyAccessedAPITypeReasons=["8FFB.1"]))
        # A phone declaration cannot satisfy the separately bundled Watch app.
        self.fixture.manifest["NSPrivacyAccessedAPITypes"].append(copy.deepcopy(self.fixture.watch_manifest["NSPrivacyAccessedAPITypes"][0]))
        self.fixture.watch_manifest = None
        self.fixture.write()
        with self.assertRaisesRegex(ValueError, "watch-privacy-manifest"):
            self.fixture.inspect()

    def test_extra_target_traversal_case_collisions_and_symlinks_rejected(self):
        link = zipfile.ZipInfo(PHONE + "/escape")
        link.create_system = 3
        link.external_attr = (stat.S_IFLNK | 0o777) << 16
        for item, value in [("../outside", b"escape"), (PHONE + "/./Info.plist", b"duplicate"),
                            ("payload/occulert.app/info.plist", b"case collision"), (link, b"/etc/passwd"),
                            (PHONE + "/PlugIns/Other.appex/Info.plist", b"extra target")]:
            with self.subTest(item=str(item)):
                self.fixture.write([(item, value)])
                with self.assertRaises(ValueError):
                    self.fixture.inspect()


if __name__ == "__main__":
    result = unittest.TextTestRunner(verbosity=2).run(unittest.defaultTestLoader.loadTestsFromTestCase(ArchiveTests))
    print(json.dumps({"tests": result.testsRun, "failures": len(result.failures), "errors": len(result.errors)}))
    sys.exit(0 if result.wasSuccessful() else 1)
