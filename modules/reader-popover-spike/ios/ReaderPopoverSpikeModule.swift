import ExpoModulesCore

// SPIKE-ONLY: feasibility test for a native anchored popover with system
// Liquid Glass. Presents a UIPopoverPresentationController from the current
// top view controller. Not connected to the real reader footnote flow.

public final class ReaderPopoverSpikeModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ReaderPopoverSpike")

    Constant("isAvailable") {
      true
    }

    AsyncFunction("presentSpikePopover") {
      (x: Double, y: Double, width: Double, height: Double, text: String) async -> Void in
      let anchorRect = CGRect(x: x, y: y, width: width, height: height)
      await MainActor.run {
        guard let presentingVC = self.appContext?.utilities?.currentViewController() else {
          return
        }
        ReaderPopoverSpikePresenter.shared.present(
          from: presentingVC,
          anchorRect: anchorRect,
          text: text
        )
      }
    }

    AsyncFunction("dismissSpikePopover") { () async -> Void in
      await MainActor.run {
        ReaderPopoverSpikePresenter.shared.dismiss()
      }
    }
  }
}
