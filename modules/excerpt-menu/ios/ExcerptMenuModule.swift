import ExpoModulesCore

public final class ExcerptMenuModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExcerptMenu")

    Constant("isAvailable") {
      true
    }

    AsyncFunction("presentExcerptMenu") { (x: Double, y: Double) async -> String in
      guard x.isFinite, y.isFinite else { return "dismiss" }
      let point = CGPoint(x: x, y: y)
      return await MainActor.run {
        await withCheckedContinuation { continuation in
          // The presenter resolves exactly once: with the chosen action,
          // or 'dismiss' when the menu goes away without a choice.
          ExcerptMenuPresenter.shared.present(at: point) { action in
            continuation.resume(returning: action)
          }
        }
      }
    }
  }
}
