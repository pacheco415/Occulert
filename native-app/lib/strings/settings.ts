// Reviewed English copy for native Settings, pre-drive preparation, and their display helpers.
// Keep protocol values, persisted keys, timing thresholds, and URLs at their call sites.

export const settingsStrings = {
  saveError: {
    title: "Could not save setting",
    detail: "Your previous setting is still active. Please try again."
  },
  headphoneMotion: {
    description: {
      active: "Receiving compatible-headphone motion during monitoring",
      starting: "Starting compatible-headphone motion…",
      permissionPending: "Available — iOS may request Motion access when monitoring starts",
      available: "Available — starts automatically with monitoring",
      denied: "Motion access is denied in iPhone Settings",
      notConnected: "Connect compatible AirPods or Beats to enable motion observations",
      error: "Motion status could not be confirmed",
      unavailable: "Headphone motion support is unavailable in this build"
    },
    status: {
      active: "ACTIVE",
      starting: "STARTING",
      ready: "READY",
      denied: "DENIED",
      notConnected: "NOT CONNECTED",
      check: "CHECK",
      unavailable: "UNAVAILABLE"
    },
    title: "Compatible headphone motion"
  },
  feedback: {
    mailUnavailableTitle: "Mail is unavailable",
    mailUnavailableDetail: "Your feedback draft is ready. Share it with an app you choose, then review it before sending to hello@occulert.com. Nothing is sent automatically.",
    shareDraft: "Share draft",
    draftUnavailableTitle: "Feedback draft unavailable",
    draftUnavailableDetail: "The share sheet could not open. Try again, or email hello@occulert.com from your preferred email app.",
    unavailableTitle: "Feedback unavailable",
    unavailableDetail: "Try again, or email hello@occulert.com from your preferred email app.",
    preparingAccessibility: "Preparing pilot feedback draft",
    accessibility: "Prepare pilot feedback",
    hint: "Opens an email draft; if Mail is unavailable, offers a separate choice to share the draft",
    preparing: "Preparing feedback…",
    action: "Prepare feedback",
    detail: "Review the draft before choosing whether to send it",
    privacyDetail: "Feedback opens as a draft in Mail, or you can choose another app if Mail is unavailable. Nothing is sent automatically. No camera video, audio, raw motion readings, or location is attached."
  },
  watch: {
    description: {
      unavailable: "Watch support is unavailable in this build",
      openCompanion: "Open Occulert on your Watch, then refresh connections",
      confirmInstallation: "Open the Watch companion to confirm installation",
      enableBackground: "Connected — enable background alerts in the Watch app",
      finishSetup: "Companion installed — open it to finish wrist alert setup"
    },
    test: {
      unavailableTitle: "Watch unavailable",
      openCompanion: "Open Occulert on your Apple Watch, then try again.",
      receivedTitle: "Watch test received",
      sentTitle: "Watch test sent",
      sentDetail: "The Watch was reachable but did not acknowledge the live message. Treat the iPhone as the primary alert.",
      backupTitle: "Watch backup saved",
      backupDetail: "Background delivery may be delayed. Open Occulert on your Apple Watch for live wrist alerts; the iPhone remains primary.",
      errorTitle: "Watch test unavailable",
      errorDetail: "Check the Watch connection, then try again while safely parked.",
      hint: "Sends one urgent-pattern test to the paired Apple Watch",
      sending: "SENDING WATCH TEST…",
      action: "Test Watch alert · urgent pattern",
      roundTrip: " in {milliseconds} ms",
      receivedDetail: "Your Apple Watch acknowledged the live alert{timing}. The iPhone remains the primary safety alert."
    },
    title: "Apple Watch alerts",
    toggleHint: "Controls optional alert delivery to the paired Apple Watch"
  },
  connections: {
    summary: {
      watchEnabled: "Phone alert tests available · Watch alerts enabled",
      watchDisabled: "Phone alert tests available · Watch available but disabled",
      openWatch: "Phone alert tests available · Open Watch app, then refresh"
    },
    refreshErrorTitle: "Connections could not refresh",
    refreshErrorDetail: "Check the optional devices and try again while parked.",
    title: "CONNECTED DEVICES",
    readinessTitle: "Parked readiness check",
    refreshHint: "Refreshes Apple Watch and compatible headphone connection status",
    refreshing: "REFRESHING CONNECTIONS…",
    refreshAction: "REFRESH CONNECTIONS"
  },
  audioTest: {
    unavailableTitle: "Audio test unavailable",
    unavailableDetail: "Check the iPhone volume and selected audio output, then try again while safely parked.",
    hint: "Plays the three-tone urgent alert sequence through the iPhone's current audio output",
    preparingAccessibility: "Preparing audio test",
    accessibility: "Test current audio output",
    preparing: "PREPARING AUDIO TEST…",
    action: "TEST CURRENT AUDIO OUTPUT",
    parkedDetail: "Use only while parked. This plays the selected sound as the centered three-tone critical sequence and does not change your alert setting."
  },
  hapticTest: {
    sentTitle: "Vibration check sent",
    sentDetail: "Confirm you felt it while parked. If you did not, check your iPhone haptic settings and keep an audible alert enabled.",
    unavailableTitle: "Vibration test unavailable",
    unavailableDetail: "Check iPhone haptic settings and keep an audible alert enabled.",
    hint: "Sends a test vibration on this iPhone without changing a session",
    accessibility: "Test iPhone vibration",
    action: "TEST IPHONE VIBRATION",
    parkedDetail: "Use only while parked. The app cannot confirm you felt the vibration; keep an audible alert enabled if it is hard to notice."
  },
  localData: {
    delete: {
      successTitle: "Local history deleted",
      successDetail: "Session summaries were removed from this iPhone. Any separately synced cloud records were not changed.",
      errorTitle: "Could not delete local history",
      errorDetail: "Your local session summaries remain saved. Please try again.",
      confirmTitle: "Delete all local session history?",
      confirmDetail: "This permanently removes every local session summary, review, and diagnostic from this iPhone. You can review or share a privacy-limited text copy first. Cloud records are not changed. This cannot be undone.",
      reviewFirst: "Review First",
      deleteAll: "Delete All",
      accessibility: "Delete all local session history",
      hint: "Permanently removes local session summaries after confirmation without changing cloud records",
      detail: "Removes summaries, reviews, test conditions, and diagnostics from this iPhone."
    },
    recovery: {
      successTitle: "Recovery data cleared",
      successDetail: "The interrupted-drive checkpoint was removed from this iPhone.",
      errorTitle: "Could not clear recovery data",
      errorDetail: "The checkpoint may have changed. Refresh its status before trying again.",
      discardTitle: "Discard unreadable recovery data?",
      clearTitle: "Clear interrupted-drive recovery data?",
      discardDetail: "Occulert cannot read this checkpoint. Clearing it permanently removes the stored data, which may still be useful to support, and allows a new drive to start. Existing session history is not changed. Consider contacting pilot support first.",
      clearDetail: "This removes the temporary local checkpoint used to recover an interrupted monitoring session. Existing session history is not changed.",
      clearAction: "Clear",
      checking: "Checking recovery data…",
      unreadable: "Unreadable recovery checkpoint saved",
      unavailable: "Recovery status unavailable",
      saved: "Recovery checkpoint saved",
      none: "No recovery checkpoint",
      unreadableDetail: "The unreadable checkpoint is preserved. You can retry, contact pilot support, or explicitly discard only that checkpoint below.",
      accessibility: "Clear interrupted-drive recovery data",
      hint: "Removes the temporary local recovery checkpoint after confirmation",
      unreadableActionDetail: "Permanently discard an unreadable checkpoint after confirmation. Consider contacting pilot support first.",
      actionDetail: "Keeps existing session history and removes only the temporary checkpoint."
    },
    title: "PRIVACY & LOCAL DATA",
    storedTitle: "Stored on this iPhone",
    storedDetail: "Session summaries, your reviews and test conditions, bounded performance diagnostics, preferences, and a temporary interrupted-drive checkpoint.",
    privacyDetail: "Occulert does not save camera video, photos, microphone audio, or a location route. Optional Apple Health context is a small local summary managed from the pre-drive screen.",
    cloudDetail: "Cloud session summaries are separate and sync only when you enable cloud sync while signed in. Deleting local data here does not delete cloud records.",
    retentionDetail: "Local history keeps up to 50 recent summaries. New saves can remove the oldest local records. Share selected summaries from History if you want to keep a text copy elsewhere. Local reviews and test conditions are not included in automatic cloud sync.",
    historyChecking: "Checking local history…",
    historyUnavailable: "Local history count unavailable",
    unconfirmedDetail: "Destructive controls stay unavailable until Occulert confirms what is stored on this iPhone.",
    retryAccessibility: "Retry local data status check",
    retryHint: "Checks local session history and interrupted-drive recovery data again",
    retryAction: "TRY AGAIN",
    review: {
      accessibility: "Review or export local session history",
      hint: "Opens Session History, where privacy-limited summaries can be shared before local deletion",
      title: "Review or export local history",
      detail: "Open saved summaries and share a privacy-limited text copy before deleting anything."
    },
    sessionCountOne: "{count} local session",
    sessionCountMany: "{count} local sessions"
  },
  common: {
    cancel: "Cancel"
  },
  support: {
    unavailableTitle: "Help page unavailable",
    unavailableDetail: "Open occulert.com/support.html in Safari, or email hello@occulert.com for support.",
    title: "PILOT SUPPORT",
    helpTitle: "Help and support",
    helpHint: "Opens Occulert setup, troubleshooting, and contact guidance in your browser",
    helpDetail: "Setup, troubleshooting, and contact guidance"
  },
  screen: {
    brand: "OCCULERT",
    title: "Settings",
    priorityTitle: "Keep the core setup simple",
    priorityDetail: "The iPhone camera and at least one phone alert are the primary setup. Watch, headphones, Health, and cloud sync are optional additions."
  },
  buildInfo: {
    buildOnly: "Build {buildNumber}",
    versionUnavailable: "Version unavailable"
  },
  baseline: {
    title: "PARKED BASELINE EXPERIMENT",
    detail: "Local sessions only. While parked, look forward with eyes open during the three-second Setup check. Insufficient samples use current presets.",
    resetAccessibility: "Recalibrate parked eye baseline",
    errorTitle: "Could not reset baseline",
    errorDetail: "The saved baseline remains unchanged. Try again.",
    resetting: "Resetting…",
    resetAction: "Recalibrate while parked"
  },
  alerts: {
    title: "ALERTS",
    hapticLabel: "Haptic vibration",
    hapticDetail: "Vibrate on alert",
    hapticAccessibility: "Haptic vibration alerts",
    hapticHint: "Controls vibration from the iPhone during alerts",
    audioLabel: "Audio tone",
    audioDetail: "Sound on alert",
    audioAccessibility: "Audio tone alerts",
    audioHint: "Controls alert sounds from the iPhone's current audio output",
    soundTitle: "Alert sound",
    soundDetail: "Choose the tone profile used for phone alerts",
    soundLimits: "This changes the tone profile only. Alert timing, severity, and centered critical delivery stay the same.",
    safetyLimits: "A continuous closed-eye reading reaches the prominent alert at about 0.6 seconds and, after the startup warmup, the stronger stage at 1.2 seconds. Standard alerts repeat twice and critical alerts repeat three times on each enabled output. Audio and haptic choices also control the foreground-loss warning; keep at least one enabled. Alerts cannot make drowsy driving safe—pull over and rest.",
    soundAccessibility: "{sound} alert sound"
  },
  headphones: {
    audioTitle: "AirPods / Bluetooth audio",
    audioDetail: "Uses the iPhone's current audio output automatically",
    audioStatus: "AUTOMATIC",
    patternTitle: "Headphone alert pattern",
    patternDetail: "Balanced is clearest; optional stereo emphasis is available for early alerts",
    pattern: {
      centered: "Centered",
      alternating: "Alternate L/R"
    },
    patternHint: "Changes stereo emphasis for early alerts only",
    patternLimits: "Both ears remain audible. Critical and tracking-loss alerts stay centered.",
    patternAccessibility: "{pattern} headphone alert pattern"
  },
  footer: {
    accessibility: "Occulert {build}",
    text: "Occulert™ · {build} · San Francisco, CA"
  },
  cloud: {
    unavailableTitle: "Cloud sync unavailable",
    unavailableDetail: "Occulert could not complete or confirm that change. Please check your connection and try again.",
    signedInTitle: "Signed in",
    signInUnavailableTitle: "Sign-in unavailable",
    signOutIncompleteTitle: "Sign-out incomplete",
    signOutIncompleteDetail: "Sharing is off in this open app, but saved sign-in or sharing settings could not be fully cleared. They may return after restarting. Retry sign-out before closing the app.",
    retrySignInDetail: "Sign in again or check your connection, then try once more.",
    consent: {
      title: "Share session summaries?",
      detail: "Occulert will send timestamps, fatigue scores, and alert counts to your protected account. Camera images, video, audio, location, and alert ratings stay off the server.",
      cancel: "Cancel",
      enable: "Enable"
    },
    accountPageUnavailableTitle: "Account page unavailable",
    title: "CLOUD SESSION SYNC",
    checkingAccessibility: "Checking cloud sync status",
    status: {
      signOutIncomplete: "SIGN-OUT INCOMPLETE",
      signedIn: "SIGNED IN",
      optional: "OPTIONAL",
      unconfirmed: "UNCONFIRMED"
    },
    readState: {
      errorTitle: "Account status could not be confirmed",
      checkingTitle: "Checking saved cloud settings…",
      errorDetail: "This status check does not clear saved sign-in or change sharing. Retry to read the current choices before making changes. Monitoring and local history remain available.",
      checkingDetail: "Reading the sign-in and sharing choice saved on this iPhone. Monitoring and local history do not require cloud sync.",
      retryAccessibility: "Retry saved cloud account status",
      retryHint: "Reads local sign-in and sharing settings without changing them",
      retryAction: "Retry account status"
    },
    incomplete: {
      title: "Finish signing out",
      detail: "Sharing is off in this open app. Saved sign-in or sharing settings could not be fully cleared and may return after restarting. Retry before closing the app.",
      retryAccessibility: "Retry incomplete cloud sign-out",
      retryHint: "Retries removing saved sign-in and sharing settings from this device",
      retryAction: "Retry sign-out"
    },
    signIn: {
      detail: "Sign in with an existing Occulert driver account and its password. Monitoring and local history work without an account.",
      emailAccessibility: "Cloud account email",
      emailHint: "Enter the email for your existing Occulert driver account",
      emailPlaceholder: "Driver email",
      passwordAccessibility: "Cloud account password",
      passwordHint: "Enter your Occulert account password",
      passwordPlaceholder: "Password",
      busyAccessibility: "Signing in to cloud account",
      accessibility: "Sign in to cloud account",
      hint: "Signs in without enabling session sharing",
      action: "SIGN IN"
    },
    accountTitle: "Protected account",
    signOut: {
      busyAccessibility: "Signing out of cloud account",
      accessibility: "Sign out of cloud account",
      hint: "Signs out on this device without deleting local history",
      action: "Sign Out"
    },
    sharing: {
      title: "Share session summaries",
      detail: "Off by default · local history remains available",
      hint: "Controls protected cloud syncing; local history remains available when off"
    },
    links: {
      forgotPasswordAccessibility: "Forgot Occulert account password",
      forgotPasswordHint: "Opens password reset in your browser without sending your email or password in the link",
      forgotPassword: "Forgot password?",
      createAccountAccessibility: "Create an Occulert account on the website",
      createAccountHint: "Opens browser sign-in and account creation",
      createAccount: "Create an account on occulert.com",
      manageAccountAccessibility: "Manage Occulert cloud account",
      manageAccountHint: "Opens website account settings for password, email, and account deletion; browser sign-in is separate",
      manageAccount: "Manage account on occulert.com",
      signInDetail: "Browser sign-in is separate from this iPhone. If you created your account with a passkey or email link, sign in on the website, open Account, and choose Change Password to set a password for native sign-in. Sharing stays off after a new native sign-in until you enable it here."
    },
    alertRetry: {
      title: "Alert delivery attempts",
      unavailable: "Alert retries are paused because local delivery state could not be confirmed.",
      limits: "This local snapshot does not confirm cloud synchronization. Monitoring and local alerts continue independently.",
      counts: "{pending} pending; {capacityRejected} rejected at capacity; {expired} expired; {permanentRejected} rejected; {exhausted} exhausted; {stopped} discarded at Stop."
    },
    privacyDetail: "Sign-in tokens use protected device storage. No camera images, video, audio, GPS location, or alert ratings are uploaded.",
    accountPageUnavailableDetail: "Open {address} in your browser. Browser sign-in is separate from this iPhone.",
    auth: {
      invalidCredentials: "Email or password is incorrect.",
      emailUnconfirmed: "Confirm your email, then return and sign in.",
      unconfigured: "Cloud sign-in is not configured yet. Monitoring still works locally.",
      networkError: "Occulert could not reach the sign-in service. Check your connection and try again.",
      failed: "Sign-in failed. Check your email and password, then try again.",
      secureStorageUnavailable: "Secure sign-in storage is unavailable on this device.",
      invalidInput: "Enter a valid email and password.",
      accountChanged: "Sign-in was cancelled because the account changed. Please sign in again.",
      disableSharingFailed: "Cloud sharing could not be switched off. Sign-in was not saved. Please try again.",
      signedIn: "Signed in. Cloud sync stays off until you enable it.",
      profileRetry: "Signed in. Driver profile setup will retry when you start a synced session.",
      signOutIncomplete: "Sign-out could not be fully saved. Retry before closing the app."
    }
  },
  sensitivity: {
    errorTitle: "Could not save sensitivity",
    errorDetail: "Your previous sensitivity setting is still active. Please try again.",
    title: "Alert sensitivity",
    hint: "Choose when fatigue warnings begin",
    limits: "Changes when warnings begin. It does not make driving while tired safe.",
    optionAccessibility: "{level} sensitivity",
    presets: {
      low: {
        label: "Low",
        description: "Triggers only on sustained eye closure. Fewer false alerts, may miss brief events."
      },
      medium: {
        label: "Medium",
        description: "Balanced detection. Recommended for most drivers. (Default)"
      },
      high: {
        label: "High",
        description: "Triggers earlier. More sensitive. May produce more false alerts in some conditions."
      }
    }
  },
  alertSounds: {
    classic: {
      label: "Classic",
      description: "Current Occulert tone"
    },
    lower: {
      label: "Lower",
      description: "Deeper alert tone"
    },
    higher: {
      label: "Higher",
      description: "Brighter alert tone"
    }
  },
  emergency: {
    copy: {
      title: "Emergency readiness",
      parked: "Review these Apple guides only while safely parked.",
      limits: "Occulert does not check or change these Apple settings, activate Emergency SOS, Crash Detection or Siren, contact emergency services, or guarantee help.",
      availability: "Apple feature support varies by device, software, region and connectivity.",
      privacy: "Show When Locked makes your Medical ID viewable without a passcode. Emergency-call sharing is a separate, optional feature where available. Review both choices in Apple Health."
    },
    guides: {
      medicalId: {
        title: "Medical ID and emergency contacts",
        detail: "Review your Medical ID, emergency contacts and sharing choices in Apple Health."
      },
      emergencySos: {
        title: "Emergency SOS on iPhone",
        detail: "Review Apple’s setup guidance and connection requirements for your iPhone and region."
      },
      crashDetection: {
        title: "Crash Detection on supported devices",
        detail: "Review supported models and software requirements. Crash Detection cannot detect every crash."
      },
      watchSiren: {
        title: "Siren on Apple Watch Ultra",
        detail: "Ultra models only: a manually started sound to attract nearby attention. Siren does not contact emergency services."
      },
      watchHaptics: {
        title: "Apple Watch haptic settings",
        detail: "Review Apple’s haptic settings and fit guidance. A setting does not guarantee that you will feel an alert."
      }
    },
    card: {
      collapse: "Hide Apple setup guides",
      expand: "Review Apple setup guides",
      collapseHint: "Collapses the optional Apple setup guides",
      expandHint: "Expands optional guidance to review while safely parked",
      guideHint: "Opens official Apple guidance in your browser. Review only while safely parked.",
      guideOpening: "Opening Apple guide…",
      guideOpen: "Open Apple guide ↗",
      guideError: "Could not open Apple's guide. Copy this address into your browser while parked:",
      guideAccessibility: "Open Apple guide: {title}. {detail}"
    }
  }
} as const;

export const preDriveStrings = {
  confirmations: {
    parked: {
      title: "I am safely parked",
      detail: "I will mount and position the phone before the vehicle moves."
    },
    limits: {
      title: "I understand the limits",
      detail: "Occulert is a supplemental prototype. It can miss drowsiness or issue false alerts and is not a certified safety, medical, emergency, or compliance device."
    },
    foreground: {
      title: "I will not touch the app while driving",
      detail: "I will keep the screen on and Occulert in the foreground, and will only make changes after pulling over safely."
    },
    rest: {
      title: "I will stop if I feel drowsy or unsafe",
      detail: "An Occulert alert never makes it safe to continue driving. I will pull over and rest or arrange other transportation."
    },
    eyebrow: "FINAL SAFETY CONFIRMATION",
    title: "Confirm all four before continuing",
    progress: "{checked} / {total}"
  },
  health: {
    noRecentSample: "No recent sample",
    unknownUpdated: "Unknown",
    noDataNotice: "Apple Health returned no recent sleep or HRV samples. This can mean no data or limited access.",
    updatedNotice: "Apple Health context updated on this iPhone.",
    readError: "Apple Health could not be read. Check Health access for Occulert and try again.",
    removedNotice: "The local Apple Health summary was removed. Manage future access in iOS Health settings.",
    removeError: "The local Apple Health summary could not be removed. Try again.",
    eyebrow: "APPLE HEALTH · OPTIONAL",
    title: "Pre-drive context",
    description: "Optional context from recent sleep and heart rate variability. Only a small summary is kept in this iPhone's protected storage; it never decides whether you are safe to drive.",
    sleepLabel: "SLEEP · PAST 24H",
    hrvLabel: "HRV (SDNN) · PAST 7D",
    unavailable: "Apple Health is unavailable on this device or build.",
    refreshAccessibility: "Refresh Apple Health context",
    connectAccessibility: "Connect Apple Health context",
    readHint: "Reads optional recent sleep and heart rate variability while you are parked",
    refreshAction: "REFRESH APPLE HEALTH",
    connectAction: "CONNECT APPLE HEALTH",
    removeAccessibility: "Remove local Apple Health summary",
    removeHint: "Removes the saved summary from this iPhone but does not change Apple Health permissions",
    removeAction: "REMOVE LOCAL HEALTH SUMMARY",
    limits: "Informational only. These values do not calculate medical or driving fitness, change fatigue scoring, or affect alerts.",
    sleepHoursMinutes: "{hours}h {minutes}m",
    sleepMinutes: "{minutes}m",
    hrvMilliseconds: "{milliseconds} ms",
    updated: "Updated {time}"
  },
  screen: {
    title: "Confirm your safe setup",
    subtitle: "Complete this check while parked before every monitoring session.",
    warning: "Never begin or configure Occulert while operating a vehicle."
  },
  emergency: {
    accessibility: "Review Apple emergency-readiness guidance",
    hint: "Opens optional setup guides in Settings. Review only while safely parked.",
    title: "Apple emergency setup guides",
    detail: "Optional reference to review while parked in Settings."
  },
  continueAction: {
    accessibility: "Continue to monitoring",
    readyHint: "Opens the parked camera setup before monitoring starts",
    incompleteHint: "Complete all four safety confirmations first",
    label: "CONTINUE TO MONITORING"
  },
  safety: {
    fullInformationHint: "Opens the full Occulert safety information in your browser",
    fullInformation: "Read full safety information",
    limit: "This confirmation is required before each monitoring session and is not a substitute for attentive driving or adequate rest."
  },
  readiness: {
    stability: {
      passedStatus: "Live streams passed",
      driverProtectedStatus: "Driver camera protected",
      driverFailedStatus: "Driver stream failed",
      blockedStatus: "Test blocked",
      blockedDetail: "Apple’s resource budget was exceeded before live capture. Road monitoring remains disabled.",
      accessNeededStatus: "Camera access needed",
      accessNeededDetail: "Grant camera access before running the parked stability test.",
      unsupportedStatus: "Not supported",
      unsupportedDetail: "This phone does not expose a supported front-and-rear camera pair.",
      errorStatus: "Test could not finish",
      errorDetail: "Both camera streams were stopped. Close other camera apps and try again while parked.",
      title: "Live dual-camera test · parked",
      detail: "Runs both cameras for five seconds, counts frames, then stops. No images or video are saved.",
      testing: "Testing both camera streams…",
      busyAccessibility: "Testing both camera streams",
      accessibility: "Run parked dual-camera test",
      hint: "Starts both cameras for five seconds and stops automatically",
      busyAction: "Testing for 5 seconds…",
      action: "Run parked camera test",
      measurements: "{driverFrames} driver frames and {roadFrames} road frames in {seconds}s. Peak camera pressure {pressure}; phone heat {thermalState}.",
      driverProtectedDetail: "Occulert disabled or withheld the road stream while preserving driver frames. {measurements}",
      driverFailedDetail: "The protected driver stream produced no frames. Road monitoring remains disabled. {measurements}"
    },
    title: "Your devices before this drive",
    detail: "Check while parked. Optional accessories are not required for camera monitoring.",
    checking: "Checking saved settings and connections…",
    empty: "Refresh while parked to check your devices.",
    snapshotLimit: "Snapshot only; refresh if you change devices or settings.",
    refreshBusyAccessibility: "Checking connected devices",
    refreshAccessibility: "Refresh connected device check",
    refreshHint: "Checks saved settings and current optional device connections while parked",
    refreshBusy: "Checking…",
    refreshAction: "Refresh device check",
    alertCheckAccessibility: "Check phone and Watch alerts while parked",
    alertCheckHint: "Opens settings where you can play a phone alert and send an optional Watch alert",
    alertCheckAction: "Check alert sound, vibration, and Watch",
    alertCheckLimits: "While parked, confirm you actually hear or feel a phone alert through your current audio setup. A Watch delivery acknowledgment does not prove an alert was noticed. This check does not test fatigue or confirm it is safe to drive."
  },
  devices: {
    title: {
      camera: "Front camera",
      roadCamera: "Road camera · planned",
      outputs: "Phone alerts",
      watch: "Apple Watch · optional",
      motion: "Headphone motion · optional"
    },
    stale: {
      status: "Check again",
      detail: "Connections or settings may have changed. Refresh while parked."
    },
    status: {
      unconfirmed: "Not confirmed",
      unavailable: "Unavailable"
    },
    camera: {
      unconfirmed: "Camera status could not be read. Refresh or check camera setup.",
      notFoundStatus: "Not found",
      notFoundDetail: "A front camera is required. Check again on a supported phone.",
      accessNeededStatus: "Access needed",
      accessNeededDetail: "Camera access is not granted. Continue to camera setup to review access.",
      accessGrantedStatus: "Access granted",
      accessGrantedDetail: "Check framing and eye visibility in the camera preview before starting."
    },
    roadCamera: {
      unconfirmed: "Road-camera compatibility could not be read. Driver monitoring remains independent.",
      unavailable: "No rear camera was reported. Front-camera driver monitoring remains available.",
      passedStatus: "Load check passed",
      overBudgetStatus: "Over budget",
      overBudgetDetail: "The front-and-rear configuration exceeded Apple’s current camera resource budget. Driver monitoring keeps priority.",
      failedStatus: "Load check failed",
      failedDetail: "Apple reports compatible cameras, but a front-and-rear configuration could not be prepared. Driver monitoring remains available.",
      hardwareCapableStatus: "Hardware capable",
      singleCameraStatus: "Single camera only",
      singleCameraDetail: "This iPhone does not report Apple simultaneous multi-camera support. Driver monitoring keeps priority.",
      unknownStatus: "Support unknown",
      unknownDetail: "A rear camera is available, but simultaneous Apple multi-camera support was not confirmed.",
      costDetail: " Hardware {hardwarePercent}%; pressure {pressurePercent}%.",
      passedDetail: "Apple accepted a front-and-rear configuration within its resource budgets.{costDetail} Road monitoring is still planned and was not activated.",
      hardwareCapableOne: "{count} rear camera type reported. A parked load result is not available yet; road monitoring is not active.",
      hardwareCapableMany: "{count} rear camera types reported. A parked load result is not available yet; road monitoring is not active."
    },
    outputs: {
      unconfirmed: "Saved alert settings could not be read. Check Settings before starting.",
      offStatus: "Both off",
      offDetail: "Phone sound and vibration are disabled. Review alert settings; the Watch is optional.",
      soundAndVibration: "Sound + vibration",
      soundOnly: "Sound only",
      vibrationOnly: "Vibration only",
      testDetail: "Saved settings only. Test the current audio output in Settings while parked."
    },
    watch: {
      settingUnconfirmed: "The saved Watch alert setting could not be read.",
      offStatus: "Alerts off",
      offDetail: "Optional wrist alerts are off. You can enable and test them in Settings.",
      connectionUnconfirmed: "The Watch connection could not be checked in this build. Phone alerts remain available.",
      openStatus: "Open Watch app",
      openDetail: "Open Occulert on your Watch, then refresh this check. If it is still not found, verify the companion installation.",
      unreachableStatus: "Not reachable",
      unreachableDetail: "Open Occulert on your Watch and test it. Background delivery can be delayed.",
      reachableStatus: "Reachable",
      reachableDetail: "Wrist alerts are enabled. A connection does not confirm that you felt an alert; test while parked."
    },
    motion: {
      unconfirmed: "Motion status could not be read. Phone camera monitoring remains independent.",
      accessOffStatus: "Access off",
      accessOffDetail: "Motion access is unavailable. Headphone audio can still work independently.",
      unavailable: "Compatible motion support is not available here. This does not test the audio connection.",
      permissionPendingStatus: "Permission pending",
      permissionPendingDetail: "Motion access may be requested when monitoring starts. This check does not request it.",
      availableStatus: "Available",
      availableDetail: "Experimental head-motion observations only; they do not change fatigue scores or alerts."
    }
  }
} as const;
