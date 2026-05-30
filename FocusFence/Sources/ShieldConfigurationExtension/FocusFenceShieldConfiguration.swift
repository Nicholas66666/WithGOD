import ManagedSettings
import ManagedSettingsUI
import UIKit

final class FocusFenceShieldConfiguration: ShieldConfigurationDataSource {
    override func configuration(shielding application: Application) -> ShieldConfiguration {
        configuration()
    }

    override func configuration(shielding application: Application, in category: ActivityCategory) -> ShieldConfiguration {
        configuration()
    }

    override func configuration(shielding webDomain: WebDomain) -> ShieldConfiguration {
        configuration()
    }

    private func configuration() -> ShieldConfiguration {
        ShieldConfiguration(
            backgroundBlurStyle: .systemMaterial,
            backgroundColor: .systemBackground,
            icon: UIImage(systemName: "lock.circle"),
            title: ShieldConfiguration.Label(text: "今天先停在这里", color: .label),
            subtitle: ShieldConfiguration.Label(text: "你已经用完为这个 App 预留的时间。先离开屏幕，给大脑一个断点。", color: .secondaryLabel),
            primaryButtonLabel: ShieldConfiguration.Label(text: "好的，关闭", color: .white),
            primaryButtonBackgroundColor: .systemBlue,
            secondaryButtonLabel: ShieldConfiguration.Label(text: "再给我 5 分钟", color: .systemBlue)
        )
    }
}
