import ExpoModulesCore
import UIKit

/// The alternate icon set the config plugin adds to the asset catalog
/// (modules/approx-app-icon/app.plugin.js). The primary icon is the light one.
private let darkIconName = "AppIconDark"

public class ApproxAppIconModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ApproxAppIcon")

    AsyncFunction("setIcon") { (name: String, promise: Promise) in
      let app = UIApplication.shared
      guard app.supportsAlternateIcons, name == "light" || name == "dark" else {
        promise.resolve(false)
        return
      }
      let target: String? = name == "dark" ? darkIconName : nil
      if app.alternateIconName == target {
        promise.resolve(true)
        return
      }
      // iOS only changes the icon of an app in the foreground; it answers a
      // background request with an error, so do not ask.
      guard app.applicationState == .active else {
        promise.resolve(false)
        return
      }
      app.setAlternateIconName(target) { error in
        promise.resolve(error == nil)
      }
    }.runOnQueue(.main)

    AsyncFunction("getIcon") { () -> String in
      return UIApplication.shared.alternateIconName == darkIconName ? "dark" : "light"
    }.runOnQueue(.main)
  }
}
