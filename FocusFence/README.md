# FocusFence

FocusFence is an iOS adult self-control MVP for interrupting short-video overuse.

## MVP scope

- Request Screen Time authorization for the device owner.
- Let the user select distracting apps, categories, and web domains.
- Start a daily Device Activity monitor with a configurable limit.
- Shield the selected targets after the threshold is reached.
- Provide a custom shield screen with a close action and one short extension.

## Setup

1. Open `FocusFence.xcodeproj`.
2. Set a real development team on all targets.
3. If needed, change `APP_BUNDLE_PREFIX` and `APP_GROUP_IDENTIFIER` at the top of `project.yml`, then run `xcodegen generate`.
4. Enable Family Controls and App Groups for the app and extensions.
5. Run on a physical iPhone. Screen Time APIs do not behave like a normal app feature in the simulator.

## Current identifiers

- Main app: `com.nicho.FocusFence`
- Monitor extension: `com.nicho.FocusFence.monitor`
- Shield configuration extension: `com.nicho.FocusFence.shield-config`
- Shield action extension: `com.nicho.FocusFence.shield-action`
- App Group: `group.com.nicho.FocusFence`

## Distribution note

Development builds can use the Family Controls development capability. TestFlight and App Store distribution require Apple approval for the Family Controls entitlement.

## Apple Watch Ultra turning recorder

This build includes a first watchOS MVP for one-key turning records:

- Target: `FocusWatch`
- Shortcut intent: `开始回转记录`
- Flow: Apple Watch Ultra Action Button -> Shortcut -> Focus Watch app opens -> recording starts automatically.
- Recording stops automatically after about 2 seconds of quiet, or after 20 seconds.
- The current reflection response uses a local fallback verse/prayer/action unless `TurningReflectionEndpoint` is configured in the Watch app Info.plist settings.

To test on Apple Watch Ultra:

1. Build and install the `Focus` iOS app with the embedded `FocusWatch` app.
2. Open the Shortcuts app and confirm the Focus shortcut action `开始回转记录` is available.
3. On Apple Watch Ultra, set Action Button to run that shortcut.
4. Press the Action Button and speak. The Watch app should open directly and start listening.

The first version intentionally avoids always-on listening. The user explicitly starts a short recording from the Action Button.
