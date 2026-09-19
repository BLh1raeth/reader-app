import Foundation

enum ReaderEditMenuStrings {
  private static let bundle: Bundle = {
    if let url = Bundle.main.url(forResource: "ReaderEditMenu", withExtension: "bundle"),
       let resourceBundle = Bundle(url: url) {
      return resourceBundle
    }
    return Bundle(for: ReaderEditMenuModule.self)
  }()

  static func localized(_ key: String, fallback: String) -> String {
    bundle.localizedString(forKey: key, value: fallback, table: "Localizable")
  }
}
