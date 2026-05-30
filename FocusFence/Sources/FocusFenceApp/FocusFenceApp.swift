import SwiftUI
import UIKit
import UserNotifications

final class NotificationPresenter: NSObject, UNUserNotificationCenterDelegate {
    static let shared = NotificationPresenter()

    func registerCategories() {
        let openTurnTarget = UNNotificationAction(
            identifier: FocusFenceConstants.openTurnTargetActionIdentifier,
            title: "去转向",
            options: [.foreground]
        )
        let category = UNNotificationCategory(
            identifier: FocusFenceConstants.turnNotificationCategoryIdentifier,
            actions: [openTurnTarget],
            intentIdentifiers: [],
            options: []
        )
        UNUserNotificationCenter.current().setNotificationCategories([category])
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        willPresent notification: UNNotification,
        withCompletionHandler completionHandler: @escaping (UNNotificationPresentationOptions) -> Void
    ) {
        if #available(iOS 14.0, *) {
            completionHandler([.banner, .list, .sound])
        } else {
            completionHandler([.alert, .sound])
        }
    }

    func userNotificationCenter(
        _ center: UNUserNotificationCenter,
        didReceive response: UNNotificationResponse,
        withCompletionHandler completionHandler: @escaping () -> Void
    ) {
        if response.actionIdentifier == FocusFenceConstants.openTurnTargetActionIdentifier ||
            response.notification.request.content.categoryIdentifier == FocusFenceConstants.turnNotificationCategoryIdentifier {
            Self.openTurnTarget()
        }
        completionHandler()
    }

    private static func openTurnTarget() {
        let rawURL = UserDefaults.focusFence.string(forKey: FocusFenceConstants.turnTargetURLKey) ?? ""
        let trimmed = rawURL.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let url = URL(string: trimmed) else {
            return
        }

        DispatchQueue.main.async {
            UIApplication.shared.open(url)
        }
    }
}

@main
struct FocusFenceApp: App {
    init() {
        UNUserNotificationCenter.current().delegate = NotificationPresenter.shared
        NotificationPresenter.shared.registerCategories()
    }

    var body: some Scene {
        WindowGroup {
            ContentView()
        }
    }
}
