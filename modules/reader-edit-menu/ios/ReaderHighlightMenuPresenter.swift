import UIKit

/// A selectable, read-only native text responder supplies Apple's Copy /
/// Lookup / Translate actions. Its text and selection are transparent; only
/// the system edit menu is presented over the EPUB. No WebKit internals or
/// private selectors are involved, and the regular selection menu is untouched.
@MainActor
public final class ReaderHighlightMenuPresenter: NSObject, UIEditMenuInteractionDelegate {
  private struct Request: Decodable {
    struct Rect: Decodable {
      let x: Double
      let y: Double
      let width: Double
      let height: Double
    }
    let id: Int
    let text: String
    let rect: Rect
  }

  private weak var sourceView: UIView?
  private let actionHandler: (String, Int) -> Void
  private var request: Request?
  private var lastRequestID: Int?
  private var anchorRect = CGRect.zero
  private let textView = ReaderHighlightMenuTextView()
  private lazy var interaction = UIEditMenuInteraction(delegate: self)

  public init(sourceView: UIView, actionHandler: @escaping (String, Int) -> Void) {
    self.sourceView = sourceView
    self.actionHandler = actionHandler
    super.init()
    textView.backgroundColor = .clear
    textView.textColor = .clear
    textView.tintColor = .clear
    textView.isEditable = false
    textView.isSelectable = true
    textView.isScrollEnabled = false
    textView.accessibilityElementsHidden = true
    textView.autoresizingMask = [.flexibleWidth, .flexibleHeight]
    textView.addInteraction(interaction)
  }

  /// The rect is in WKWebView viewport CSS pixels, which map 1:1 to UIKit
  /// points. Hosting the responder in that same view avoids window/safe-area
  /// offsets; neither device scale nor iframe transforms are applied again.
  public func update(requestJSON: String) {
    guard !requestJSON.isEmpty else {
      lastRequestID = nil
      dismiss()
      return
    }
    guard let data = requestJSON.data(using: .utf8),
          let next = try? JSONDecoder().decode(Request.self, from: data),
          next.id != lastRequestID, !next.text.isEmpty,
          [next.rect.x, next.rect.y, next.rect.width, next.rect.height].allSatisfy({ $0.isFinite }),
          next.rect.width > 0, next.rect.height > 0,
          let sourceView, sourceView.window != nil
    else { return }

    dismiss()
    lastRequestID = next.id
    request = next
    let requestID = next.id
    textView.coordinator = ReaderEditMenuCoordinator(isHighlightMenu: true) { [weak self] action in
      self?.perform(action, requestID: requestID)
    }
    textView.onCopy = { [weak self] in self?.perform("copy", requestID: requestID) }
    textView.frame = sourceView.bounds
    sourceView.addSubview(textView)
    textView.text = next.text
    textView.becomeFirstResponder()
    textView.selectedRange = NSRange(location: 0, length: (next.text as NSString).length)
    textView.layoutIfNeeded()
    anchorRect = CGRect(x: next.rect.x, y: next.rect.y, width: next.rect.width, height: next.rect.height)
      .intersection(textView.bounds)
    guard !anchorRect.isNull, !anchorRect.isEmpty else {
      perform("dismissHighlightMenu", requestID: requestID)
      return
    }
    let configuration = UIEditMenuConfiguration(
      identifier: NSNumber(value: next.id),
      sourcePoint: CGPoint(x: anchorRect.midX, y: anchorRect.midY)
    )
    interaction.presentEditMenu(with: configuration)
  }

  public func dismiss() {
    request = nil
    interaction.dismissMenu()
    textView.resignFirstResponder()
    textView.removeFromSuperview()
  }

  private func perform(_ action: String, requestID: Int) {
    guard let current = request, current.id == requestID else { return }
    // Capture the generation before dismissal. A delayed UIKit callback must
    // never delete a highlight from a later tap or a different book.
    actionHandler(action, current.id)
    dismiss()
  }

  public func editMenuInteraction(
    _ interaction: UIEditMenuInteraction,
    menuFor configuration: UIEditMenuConfiguration,
    suggestedActions: [UIMenuElement]
  ) -> UIMenu? {
    // ReaderHighlightMenuTextView.buildMenu uses the SAME coordinator as
    // WKWebView. Preserve UIKit's supplied actions and their handlers intact.
    UIMenu(children: suggestedActions)
  }

  public func editMenuInteraction(
    _ interaction: UIEditMenuInteraction,
    targetRectFor configuration: UIEditMenuConfiguration
  ) -> CGRect {
    anchorRect
  }

  public func editMenuInteraction(
    _ interaction: UIEditMenuInteraction,
    willDismissMenuFor configuration: UIEditMenuConfiguration,
    animator: UIEditMenuInteractionAnimating
  ) {
    guard let id = (configuration.identifier as? NSNumber)?.intValue else { return }
    animator.addCompletion { [weak self] in
      guard let self, self.request?.id == id else { return }
      self.actionHandler("dismissHighlightMenu", id)
      self.request = nil
      self.textView.resignFirstResponder()
      self.textView.removeFromSuperview()
    }
  }
}

@MainActor
private final class ReaderHighlightMenuTextView: UITextView {
  var coordinator: ReaderEditMenuCoordinator?
  var onCopy: (() -> Void)?

  override func buildMenu(with builder: UIMenuBuilder) {
    super.buildMenu(with: builder)
    coordinator?.buildMenu(with: builder)
  }

  override func copy(_ sender: Any?) {
    UIPasteboard.general.string = text
    onCopy?()
  }

  // This responder only supplies the menu, never intercepts book gestures.
  override func point(inside point: CGPoint, with event: UIEvent?) -> Bool { false }
}
