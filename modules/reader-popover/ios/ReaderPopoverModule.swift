import ExpoModulesCore

// ReaderPopover: native anchored popover for transient reader UI (footnotes
// first; citations/glossary later).
//
// Uses UIPopoverPresentationController so the system owns the arrow,
// positioning, edge avoidance, and dismiss behavior. On iOS 26 the system
// popover chrome is Liquid Glass automatically — no custom blur, material,
// UIGlassEffect, border, shadow, or corner radius is applied anywhere.
//
// The presenting app forces `UIUserInterfaceStyle = Light` (app.json
// `userInterfaceStyle: "light"`), while the Reader has its own
// light/dark appearance independent of the system. The footnote content
// controller therefore sets `overrideUserInterfaceStyle` from the
// `appearance` argument so the popover follows the Reader's appearance.

public final class ReaderPopoverModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ReaderPopover")

    Constant("isAvailable") {
      true
    }

    // Fired when the system dismisses the popover on its own (outside tap,
    // swipe, etc.) so JS can drop its "currently shown" bookkeeping.
    // Programmatic dismisses initiated from JS do not need this event.
    Events("onFootnotePopoverDismiss")

    AsyncFunction("presentFootnotePopover") {
      (
        x: Double,
        y: Double,
        width: Double,
        height: Double,
        text: String,
        appearance: String
      ) async throws -> Void in
      // Validate the anchor before touching UIKit: a NaN/infinite or
      // negative-size rect must never reach sourceRect.
      guard x.isFinite, y.isFinite, width.isFinite, height.isFinite,
            width >= 0, height >= 0
      else {
        throw ReaderPopoverError.invalidAnchor(x: x, y: y, width: width, height: height)
      }
      let anchorRect = CGRect(x: x, y: y, width: width, height: height)
      let userInterfaceStyle: UIUserInterfaceStyle = appearance == "dark" ? .dark : .light
      let module = self
      try await MainActor.run {
        guard let presentingVC = module.appContext?.utilities?.currentViewController() else {
          throw ReaderPopoverError.noPresentingViewController
        }
        ReaderPopoverPresenter.shared.onSystemDismiss = { [weak module] in
          module?.sendEvent("onFootnotePopoverDismiss", [:])
        }
        try ReaderPopoverPresenter.shared.present(
          from: presentingVC,
          anchorRect: anchorRect,
          text: text,
          userInterfaceStyle: userInterfaceStyle
        )
      }
    }

    AsyncFunction("dismissFootnotePopover") { () async -> Void in
      await MainActor.run {
        ReaderPopoverPresenter.shared.dismiss()
      }
    }
  }
}

// MARK: - Errors

enum ReaderPopoverError: LocalizedError {
  case invalidAnchor(x: Double, y: Double, width: Double, height: Double)
  case noPresentingViewController
  case presentationFailed(String)

  var errorDescription: String? {
    switch self {
    case .invalidAnchor(let x, let y, let width, let height):
      return "ReaderPopover: invalid anchor rect (x: \(x), y: \(y), w: \(width), h: \(height))"
    case .noPresentingViewController:
      return "ReaderPopover: no presenting view controller available"
    case .presentationFailed(let reason):
      return "ReaderPopover: presentation failed: \(reason)"
    }
  }
}
