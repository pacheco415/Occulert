#!/bin/sh
# Review by running this script. Only --delete applies the reviewed deletions.
set -eu
case ${1-} in ''|--delete) ;; *) echo 'Usage: clean-merged-branches.sh [--delete]' >&2; exit 2 ;; esac
[ "$#" -le 1 ] || exit 2
repo=pacheco415/Occulert
url="https://github.com/$repo.git"
owner=${repo%/*}

while read -r branch expected pr; do
  current=$(git ls-remote --heads "$url" "refs/heads/$branch")
  [ "${current%%[[:space:]]*}" = "$expected" ] || continue
  if [ "$pr" -eq 0 ]; then
    ancestor=$(gh api "repos/$repo/compare/$expected...main?per_page=1" --jq '.merge_base_commit.sha')
    [ "$ancestor" = "$expected" ] || continue
  else
    proof=$(gh api "repos/$repo/pulls/$pr" --jq '[.merged, .base.ref, .head.repo.full_name, .head.ref, .head.sha] | @tsv')
    expected_proof=$(printf 'true\tmain\t%s\t%s\t%s' "$repo" "$branch" "$expected")
    [ "$proof" = "$expected_proof" ] || continue
  fi
  escaped=$(printf '%s' "$branch" | sed 's#/#%2F#g')
  protected=$(gh api "repos/$repo/branches/$escaped" --jq '.protected')
  [ "$protected" = false ] || continue
  open=$(gh api --method GET "repos/$repo/pulls" -f state=open -f head="$owner:$branch" -F per_page=1 --jq 'length')
  [ "$open" = 0 ] || continue
  if [ "${1-}" = --delete ]; then
    git push --force-with-lease="refs/heads/$branch:$expected" "$url" ":refs/heads/$branch"
  else
    printf '%s  %s\n' "$expected" "$branch"
  fi
done <<'REVIEWED_BRANCHES'
agent/account-role-authority-20260824 7a399f61ffd7a66b20ce24e0a43743c4293d6c3e 100
agent/auth-confirmation-resend-20260816 1726c4e4f75c487d66a9fbf2b41788ad5c6bb383 95
agent/build30-improvements-20260824 2b920d5cca04c478ceaa1e8e2355bb59a6cb26c5 98
agent/cloud-sync-recovery-20260815 80a744d9cf0564e6aa4cf37c42a651758d9a2e97 83
agent/display-installed-build-20260815 40e7bad64b2119c94d8775555c7e2d8357381042 79
agent/eas-npm10-lockfile aa3204a2dfbaacf3404bf430c1aa0c98df2750b4 76
agent/eas-npm10-lockfile-repair-20260815 4f5fe63605dbcc758d237835067c402ae14069ed 78
agent/fleet-dashboard-data-states-20260815 a3b93995e4e6177423d9f27ac1ace373518c7f97 85
agent/fleet-dashboard-performance-20260824 ba2338f573859c19652d28dc38d8c9b9a000e633 102
agent/fleet-gps-copy-20260815 124fa0c8cc6de9fa99943ecfc83c25cdb2588cec 87
agent/fleet-journey-cleanup-20260824 c664816b231a2f6303c473152a492bdc0fee33ad 101
agent/fleet-web-simplification-20260824 efd788a2812c4d20b7eb67c6257e3a907d6be3d7 99
agent/history-edit-race-20260815 f236b7ae8031fe4ec76856ae70a8f63ee14a194d 84
agent/homepage-3d-journey-nav-repair-20260815 32ae96ae02c3d4acb0c702ddb993b10da13abdbf 94
agent/homepage-journey-recovery-20260815 f1b859a920c2d1e326f8926e57048ef7627206e3 92
agent/login-recovery-20260815 3bdc460bad7e798b00c3643906f7f360dce0e080 86
agent/manager-role-display-repair-20260816 05e9daee7005b68ca9a3f4bedc051974275a69b7 97
agent/native-alert-brand-refresh ae27bbfecb4c89ed99ce333cc5ce4f56da0a59ef 74
agent/navigation-auth-state-repair-20260816 acf82d28510d92ea0a77359b796c4d03b67cc788 96
agent/passkey-auth-20260815 7c8f6b12ed730f7b7ac972487082022f881703f3 89
agent/passkey-mobile-repair-20260815 f88c1f259407b6763d87c938552257729d10ef80 90
agent/production-stylesheet-cache-repair-20260815 b49af561e5a5636577d97efcf8be07491811b9b7 93
agent/race-safe-watch-preference-20260815 b9cef90780a57f16ecdfb226ad401ca2372b2932 80
agent/reliability-improvements-20260815 240f751458d2ace0cfb98acb4bcdb7d7b1a1efbb 77
agent/replace-unsourced-homepage-stats 0cb649907e7a88c7c75ef412f1a3bc753f8646c8 75
agent/safari-passkey-loader-repair-20260815 8cbcb9ea1665393bde709330099dc3440a524318 91
agent/safe-stop-finder 5b3995cb9a1853fcfbd3f0c1e646f53e0d61dd7a 72
agent/sensitivity-persistence-20260815 55c3cc9050faf7a53bbd2db55c8422e694194d72 82
agent/settings-persistence-20260815 9ce5c35339aeb39fca5f7d21ce972f7c17192cc7 81
agent/site-liquid-glass-20260815 cc1eb71181c51ac43b84ff14b48d14f88a1e1b7b 88
audit/github-bug-fixes f50559ccfc54600a1bc0c57af444749152952a77 144
codex/account-deletion-release-20260912 acc7a8cd9fbd00738a8b3e46fda416e58b7e90c4 117
codex/agent-development-rules 590579131f0c23cd74d239bad43da1cb26d28cfd 163
codex/android-camera-minimum 49f0c1c8b78f2f6a6706bdb607277aaaeedfa824 215
codex/android-watch-linking 1b5272e61114f626adbd7dfe1bb9df82c19c53be 204
codex/approved-upgrades-2026-09-27 3f5bc589564540ed890552f81063531215ac017f 154
codex/automate-asset-releases d23ee9288593b049e36575feb7556715a5c0c17e 180
codex/billing-customer-idempotency 87820dd8aebfe127044d5dadb937c49819fe6cad 157
codex/billing-webhook-permanent-errors 74c429561e0d6ef08166f101a0c2e178548675eb 155
codex/bounded-fatigue-summary 64c30a7646255939e4d0dec60c69b86b34221bf8 175
codex/bounded-pinned-ci 40b113711fdb6bb630723070994718eb0f30edf4 174
codex/build-30-performance-20260830 9ac85d1a7530bd2ac492a23d435033b7b37b9519 110
codex/complete-ci-skip-guard bae5efa30615901a212fc3ee4ca47b8c3a22b111 166
codex/controlled-startup-evidence a9c92b421795c17378fd68d9780191b86f00fdbc 233
codex/current-development-docs f7451a75a9982da54539b896e4140bb034c48c5f 171
codex/current-source-race-tests 07e9577d8efb4f75780a2540116d51903d02f400 161
codex/dependency-audit-reports 977114d76e9ddd66c0cc6272c107a259e94ebd6f 189
codex/dependency-monitoring 4dc033df3fadb7d153f4d5f500e2d6af3b10e3fa 168
codex/durable-native-session-summary 97b5ad99d1dd3272ce169b38a3831a2800edac6a 181
codex/durable-web-session-summary 7c04f235294b83c3998560e8b7a12718d444eb03 186
codex/dynamic-asset-tests-20260929 2e100a27ac15f575abbfb314a8bb07cc0789ca3c 159
codex/exclude-development-files 70263555de1f7ddb608a9f143216c929e49b8b80 167
codex/extract-driver-app-script-20260829 e6ed4b65d29ef943251c49de86f815c91b7d4518 106
codex/fix-watch-transfer-crash-20260901 6d156099d3e5649ca23f484bf033c0b56b0cc022 114
codex/fleet-dashboard-commercial-value-20260828 beeeda78413ba6eef0cc4df307002f8a07c904ee 105
codex/full-bug-fix-20260830 3b56c85cf67ec118b2374ad74142851f0b179264 108
codex/full-migration-replay 343f07800b89836b304c0baa35a486bf5ebeec8d 179
codex/history-record-identity a48f44c627abc20e3cf823856e6fb29de76bc9df 172
codex/immutable-site-assets 32bc010822e83ff2ba667fd7937932e21fa7f3d2 120
codex/isolate-browser-server f5b0dc17981b6bedeeb204247aae664b8a52bf14 214
codex/isolated-release-fixtures 042536d48eb28bd1fc73df3d31580342c6f5f3a4 193
codex/migration-readiness-report 84e0342b217f51bdf29b292c977662b5dd22e02f 190
codex/monitor-runtime-performance-20260828 c6b91b576576813f84aa1f233a64f9c8fe1e4ddb 104
codex/native-parked-baseline 746df43e52aeb7c373d9e6556deb37a047a00adb 219
codex/native-session-completion 912663e1d08a13a1ff7a3b9b56dfb736a1c56075 227
codex/native-setup-reliability-upgrade-20260901 6f7995e18a6fbb825d6284a9855a5715db3f738f 112
codex/passkey-profile-signup 7e1557f17d63155e0be1306c19a1a8ba66da5aa8 122
codex/preserve-driver-profile 9fbfd34f018f1a8ab0984f54df81660662090c6a 164
codex/private-static-files 73cf51737b6a28111786c45a15885330c161d753 165
codex/release-process-guide 5dd7a39422745f563726a0852e2dc39a5c2d0aca 158
codex/reserve-asset-history 4db2aad17952e32514b2c8a4ad4401537fd83783 211
codex/retire-stale-assets-2026-09-29 d3063c1ce87af1aa022c5a5c823def3199f7bc64 160
codex/review-and-bug-templates cc89cf5703fd7a349f192a085a764695e0e962ac 184
codex/safety-alert-improvements-20260901 6ecdf875c4e10ff80318c6b476e14ad7856f20c4 113
codex/security-reporting-guidance ff97a110d24bbdb1c9669aef78d8df172d36fc9e 183
codex/self-host-mediapipe a5849d6203a882a311bf652191b08828a1121879 121
codex/session-cloud-outcomes c1c86f91ac19d1a9fdbe7ef6307beaf340705db1 230
codex/session-finalization-integrity db95f12441b8051848f25ae0aa20c92b38b49fd4 170
codex/stable-local-session-ids 18b47f217d4ca94a8d7a99d89605127deb430bfa 217
codex/stale-branch-inventory 9945eb231d04c8a6ec92ae3320e23041c60bea46 176
codex/static-asset-size-budgets aeef38671bdfa0e684aeddaaeb87e3eae6b0e180 185
codex/tasks-blink-replay-prepared 9ebf994135062dd3d507049e250d3b2fc164ea49 0
codex/truthful-native-summaries e5bd74b25a26e5e1912018c47be6a0e02e80cbe7 226
codex/unobserved-native-telemetry 4dd6b6d9746da6fcbb9addfed3b4bbd11d7b0b52 236
codex/unskippable-ci-2026-09-29 d73ddaae81efb283ee88688b58b06bafafe537bf 156
codex/validate-session-event-input 42efc3d3356ea2a11b5ac2230b44fb398a13beec 173
codex/validate-session-recovery 439b512542de81777e72cab57efcef036cd7e199 169
codex/verification-evidence-timeouts 9e126e9cd7068f33fe7f131021092296696c04bd 231
codex/verification-receipts 0043f21e329aac50dddd5904417303fd28605712 207
codex/verified-native-cloud-ack 0afa2f912cb21a95d0ccf382ebf2ea362bd7c5a2 237
codex/version-native-history 59540e61cabdf9ce803a9efc23e623e0745b8278 225
codex/watch-alert-ios-fleet-20260825 70bd960054d846ce2ad4491600d3a6a7d7ce70b0 103
codex/web-detector-release-20260914 e335eb40f90945f6630881ecb54de669358dec18 118
codex/web-fleet-affordability-20260830 829b3665df05511caabf96f6c77b59d40320aaf4 109
development-readiness-2026-10-03 1dd2a2b403d58e26148d8e0a0e972975ec7aa19d 162
development/fleet-history-export 40ecf21dc016c1474110564d96836c0f4ef7104b 150
development/fleet-history-filters 2f7891d367628c498a778689ff33a43f2bc16076 149
development/history-alert-feedback 432f1c7940d6e7511861ee8d79d9acb7dc9864b2 151
development/history-summary-values 570933cfd683868cc54597d8fbb642867d643799 152
development/independent-feature-work 0e2876315d4f77fed6efac0c4a194aa525801667 147
development/native-release-readiness f16730b985b2cc1eedea4b1fed00297fc658476f 145
development/pilot-readiness d647586fe84ea31af9a5289d4963289c64dc01d7 146
development/support-and-release-preparation 753dea7bdedc9c356bb2b5d072bbab0419668528 148
feat/driver-startup-recovery 030391b02ff73402360e5f35695f4897e12562c3 143
feat/fleet-follow-up-outcomes 61e7c4a15da1221eb3a92e170ef0b48d9a8b25de 125
feat/fleet-query-indexes a4ff3d19233f8f1ffb1dc551fc27688c1cb0f0a8 126
feat/fleet-refresh-recovery d3af4085eb13ac58ab0bd2ed3e5c0d5cd704bc95 141
feat/fusion-validation-session-planner 42b8f341d29c412c1a7ea97ac5e060e83043376f 135
feat/local-fusion-validation-dashboard 3fd6562dd753df7f24e4f0914b06fedd2b5c8fea 134
feat/native-validation-lockfile 9cc2656bc0b2736ebf22bcb8a467f3df667f63f3 139
feat/observation-only-sensor-fusion 7b6d57c8a9c0f980a171b237803a81fd0e458c2d 133
feat/parked-device-readiness f2356608e3e4a88fe3cbd0f69617912afa200807 124
feat/pilot-launch-checklist e0fd230619f2b6e4b13a05e08cc1f3cb9ebf3fde 137
feat/pilot-quick-start-center 391a14f18f8f8febac1265ff88e51e2cd4f34023 138
feat/privacy-safe-fleet-tv-mode 9d3d4846d13442357f0253e00bc863f7b6b644ba 136
feat/source-only-ux-improvements 2b2a8d7caad79f5c2fc4116f9268f0e4b9e705c8 132
feat/web-pilot-reliability 287f332f2c0e716b3f86bb21e2ba754ee6d98721 140
fix/benchmark-input-validation 416948e983c173e8bd8f88c59cf75baf90c50c76 123
fix/offline-response-body-recovery cffcf5b9c97dfb63d4f094b10d5ed3757a08a066 142
improve/approved-upgrades-sept26 97a4bafb59aad1faf33393a855d5259a7569b96d 153
REVIEWED_BRANCHES
