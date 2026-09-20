import UIKit

// SPIKE-ONLY: native popover presenter for the Liquid Glass feasibility spike.
//
// Design decisions under test:
// - System draws the popover chrome (background + arrow). No custom blur,
//   material, border, shadow, or corner radius is applied anywhere: on iOS 26
//   the system popover background is Liquid Glass automatically, and the
//   arrow is part of that same chrome.
// - iPhone compact size class: UIAdaptivePresentationControllerDelegate
//   returns `.none` so the popover stays a popover instead of adapting to a
//   sheet. This is public API available since iOS 8.
// - Sizing: fixed content width (280pt), adaptive height up to 300pt, long
//   content scrolls inside a UIScrollView.

@MainActor
final class ReaderPopoverSpikePresenter: NSObject {

  static let shared = ReaderPopoverSpikePresenter()

  private weak var presentedPopover: UIViewController?

  private override init() {
    super.init()
  }

  /// Presents the spike popover anchored at `anchorRect`.
  ///
  /// - Parameter anchorRect: Rect in **window points** (the same space as RN
  ///   `Dimensions.get('window')`). Converted into the source view's
  ///   coordinates before being assigned to `sourceRect`.
  func present(from presentingVC: UIViewController, anchorRect: CGRect, text: String) {
    dismiss(animated: false)

    let content = ReaderPopoverSpikeContentViewController(text: text)
    content.modalPresentationStyle = .popover

    guard let popover = content.popoverPresentationController else {
      return
    }
    popover.delegate = self

    let sourceView = presentingVC.view
    var sourceRect = anchorRect
    if let window = sourceView.window {
      sourceRect = sourceView.convert(anchorRect, from: window)
    }
    popover.sourceView = sourceView
    popover.sourceRect = sourceRect
    // Explicitly .any: the system picks up/down/left/right automatically and
    // keeps the popover inside the screen edges.
    popover.permittedArrowDirections = .any

    // NOTE: deliberately no backgroundView / custom chrome here. The goal of
    // the spike is to verify that the *system default* popover is Liquid Glass
    // with a matching arrow.

    presentingVC.present(content, animated: true)
    presentedPopover = content
  }

  func dismiss(animated: Bool = true) {
    if let presentedPopover, presentedPopover.presentingViewController != nil {
      presentedPopover.dismiss(animated: animated)
    }
    self.presentedPopover = nil
  }
}

// MARK: - UIPopoverPresentationControllerDelegate

extension ReaderPopoverSpikePresenter: UIPopoverPresentationControllerDelegate {

  /// Keeps the popover as a popover on iPhone (compact size classes) instead
  /// of the default adaptation to a fullscreen sheet.
  func adaptivePresentationStyle(
    for controller: UIPresentationController,
    traitCollection: UITraitCollection
  ) -> UIModalPresentationStyle {
    return .none
  }

  func popoverPresentationControllerDidDismissPopover(
    _ popoverPresentationController: UIPopoverPresentationController
  ) {
    // Outside-tap dismiss: drop our reference so the next present() starts clean.
    presentedPopover = nil
  }
}

// MARK: - Content view controller

/// Plain-text footnote body for the spike.
///
/// - Width: fixed 280pt (inside the 260-300pt target band).
/// - Height: fitted to the text, capped at 300pt; longer text scrolls inside.
/// - Font: system 16pt; color: `.label` (semantic, auto light/dark).
/// - Background: untouched so the system popover chrome (Liquid Glass on
///   iOS 26) shows through.
final class ReaderPopoverSpikeContentViewController: UIViewController {

  private static let contentWidth: CGFloat = 280
  private static let maxContentHeight: CGFloat = 300
  private static let inset: CGFloat = 16

  private let text: String

  init(text: String) {
    self.text = text
    super.init(nibName: nil, bundle: nil)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func viewDidLoad() {
    super.viewDidLoad()

    let scrollView = UIScrollView()
    scrollView.translatesAutoresizingMaskIntoConstraints = false
    // VoiceOver: the scroll view exposes the label; no extra work needed for
    // the spike, but keep scrolling available to accessibility.
    view.addSubview(scrollView)

    let label = UILabel()
    label.translatesAutoresizingMaskIntoConstraints = false
    label.text = text
    label.font = .systemFont(ofSize: 16)
    label.textColor = .label
    label.numberOfLines = 0
    label.lineBreakMode = .byWordWrapping
    scrollView.addSubview(label)

    let inset = Self.inset
    NSLayoutConstraint.activate([
      scrollView.topAnchor.constraint(equalTo: view.topAnchor),
      scrollView.leadingAnchor.constraint(equalTo: view.leadingAnchor),
      scrollView.trailingAnchor.constraint(equalTo: view.trailingAnchor),
      scrollView.bottomAnchor.constraint(equalTo: view.bottomAnchor),

      label.topAnchor.constraint(equalTo: scrollView.contentLayoutGuide.topAnchor, constant: inset),
      label.leadingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.leadingAnchor, constant: inset),
      label.trailingAnchor.constraint(equalTo: scrollView.contentLayoutGuide.trailingAnchor, constant: -inset),
      label.bottomAnchor.constraint(equalTo: scrollView.contentLayoutGuide.bottomAnchor, constant: -inset),
      // Pin the label width to the scroll view's visible width so long text
      // wraps instead of scrolling horizontally.
      label.widthAnchor.constraint(
        equalTo: scrollView.frameLayoutGuide.widthAnchor,
        constant: -(inset * 2)
      ),
    ])

    let fittingWidth = Self.contentWidth - inset * 2
    let textHeight = label.sizeThatFits(
      CGSize(width: fittingWidth, height: .greatestFiniteMagnitude)
    ).height
    let contentHeight = min(textHeight + inset * 2, Self.maxContentHeight)
    preferredContentSize = CGSize(width: Self.contentWidth, height: contentHeight)
  }
}
