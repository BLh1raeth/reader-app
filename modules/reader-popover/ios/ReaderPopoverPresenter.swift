import UIKit

// ReaderPopoverPresenter: the single owner of the reader's native popover.
//
// Design:
// - System draws the popover chrome (background + arrow). No custom blur,
//   material, border, shadow, or corner radius: on iOS 26 the system popover
//   background is Liquid Glass automatically, and the arrow is part of that
//   same chrome.
// - iPhone compact size class: UIAdaptivePresentationControllerDelegate
//   returns `.none` so the popover stays a popover instead of adapting to a
//   sheet. The presenter is a long-lived singleton, so the delegate
//   outlives every presentation.
// - Sizing: fixed content width 280pt (inside the 260-300pt target band),
//   height fitted to the text and capped at 300pt; longer text scrolls
//   inside a UIScrollView. Short footnotes produce a visibly shorter popover.
// - Outside tap: consumed by the system presentation (it never reaches the
//   underlying reader gestures); `onSystemDismiss` notifies JS so its
//   bookkeeping stays in sync.
// - At most one popover exists at a time: presenting a new one dismisses
//   any current one first, which prevents "already presenting" warnings and
//   view-controller leaks.

@MainActor
final class ReaderPopoverPresenter: NSObject {

  static let shared = ReaderPopoverPresenter()

  private weak var presentedPopover: UIViewController?

  /// Called when the system dismisses the popover on its own (outside tap,
  /// swipe). Set by the module; the module forwards it to JS as an event.
  var onSystemDismiss: (() -> Void)?

  private override init() {
    super.init()
  }

  /// Presents the footnote popover anchored at `anchorRect`.
  ///
  /// - Parameter anchorRect: Rect in **native window points** (identical to
  ///   RN `Dimensions.get('window')` points — no scale multiplication).
  ///   Converted into the source view's coordinates before being assigned
  ///   to `sourceRect`.
  func present(
    from presentingVC: UIViewController,
    anchorRect: CGRect,
    text: String,
    userInterfaceStyle: UIUserInterfaceStyle
  ) throws {
    dismiss(animated: false)

    let content = ReaderPopoverFootnoteViewController(
      text: text,
      userInterfaceStyle: userInterfaceStyle
    )
    content.modalPresentationStyle = .popover

    guard let popover = content.popoverPresentationController else {
      throw ReaderPopoverError.presentationFailed("popoverPresentationController is nil")
    }
    popover.delegate = self

    let sourceView = presentingVC.view
    var sourceRect = anchorRect
    if let window = sourceView.window {
      sourceRect = sourceView.convert(anchorRect, from: window)
    }
    popover.sourceView = sourceView
    popover.sourceRect = sourceRect
    // Explicitly .any: the system picks up/down/left/right automatically
    // and keeps the popover inside the screen edges. Never hard-code a
    // direction here.
    popover.permittedArrowDirections = .any

    // NOTE: deliberately no backgroundView / custom chrome. The system
    // default popover is Liquid Glass on iOS 26 with a matching arrow.

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

extension ReaderPopoverPresenter: UIPopoverPresentationControllerDelegate {

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
    // System-initiated dismiss (outside tap / swipe): drop our reference so
    // the next present() starts clean, and tell JS so it can clear its own
    // "currently shown" state.
    presentedPopover = nil
    onSystemDismiss?()
  }
}

// MARK: - Content view controller

/// Plain-text footnote body.
///
/// - Width: fixed 280pt (inside the 260-300pt target band).
/// - Height: fitted to the text, capped at 300pt; longer text scrolls inside.
/// - Font: system 16pt; color: `.label` (semantic, auto light/dark).
/// - `overrideUserInterfaceStyle` follows the Reader's own appearance
///   (the app forces UIUserInterfaceStyle=Light, so without this the popover
///   could never match Reader dark mode).
/// - Background: untouched so the system popover chrome (Liquid Glass on
///   iOS 26) shows through.
/// - VoiceOver: `accessibilityViewIsModal` keeps focus inside while visible.
final class ReaderPopoverFootnoteViewController: UIViewController {

  private static let contentWidth: CGFloat = 280
  private static let maxContentHeight: CGFloat = 300
  private static let inset: CGFloat = 16

  private let text: String

  init(text: String, userInterfaceStyle: UIUserInterfaceStyle) {
    self.text = text
    super.init(nibName: nil, bundle: nil)
    self.overrideUserInterfaceStyle = userInterfaceStyle
    self.accessibilityViewIsModal = true
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func viewDidLoad() {
    super.viewDidLoad()

    let scrollView = UIScrollView()
    scrollView.translatesAutoresizingMaskIntoConstraints = false
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
