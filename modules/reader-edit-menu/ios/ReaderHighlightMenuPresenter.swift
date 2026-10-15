import UIKit

/// A transparent UITextView hosts a UIEditMenuInteraction over the EPUB.
/// The highlight menu is built explicitly in the interaction delegate (the
/// responder-chain suggestedActions path never produced a presenting menu).
/// No WebKit internals or private selectors are involved, and the regular
/// selection menu is untouched.
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
    // Presenting synchronously from the tap's bridge delivery races WebKit
    // reclaiming first responder as it finishes the tap: the menu flashed
    // for 1-3 frames then vanished, and only the textView's selection UI
    // (at the top-left, where its invisible text starts) ever rendered.
    // Defer first-responder + presentation by 100ms so the tap's responder
    // churn settles first. The generation guard drops this block if a
    // dismiss or a newer request superseded it during the delay.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
      guard let self, self.request?.id == requestID else { return }
      self.textView.becomeFirstResponder()
      self.textView.selectedRange = NSRange(location: 0, length: (next.text as NSString).length)
      self.interaction.presentEditMenu(with: configuration)
    }
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
    // Build the highlight menu explicitly instead of trusting
    // `suggestedActions`: the responder-chain buildMenu path never produced
    // a presenting menu here (the menu silently failed to appear). These are
    // the same four actions ReaderEditMenuCoordinator defines for highlight
    // mode, with the same titles, symbols, and identifiers.
    guard let requestID = (configuration.identifier as? NSNumber)?.intValue else { return nil }
    let copy = UIAction(
      title: "复制",
      image: UIImage(systemName: "doc.on.doc"),
      identifier: UIAction.Identifier("com.readerapp.highlight.copy")
    ) { [weak self] _ in
      UIPasteboard.general.string = self?.textView.text
      self?.perform("copy", requestID: requestID)
    }
    let excerpt = UIAction(
      title: ReaderEditMenuStrings.localized("reader.editMenu.excerpt", fallback: "摘录"),
      image: UIImage(systemName: "text.quote"),
      identifier: UIAction.Identifier("com.readerapp.selection.excerpt")
    ) { [weak self] _ in
      self?.perform("excerpt", requestID: requestID)
    }
    let delete = UIAction(
      title: ReaderEditMenuStrings.localized("reader.editMenu.deleteHighlight", fallback: "删除"),
      image: UIImage(systemName: "highlighter"),
      identifier: UIAction.Identifier("com.readerapp.selection.highlight"),
      attributes: .destructive
    ) { [weak self] _ in
      self?.perform("deleteHighlight", requestID: requestID)
    }
    let note = UIAction(
      title: ReaderEditMenuStrings.localized("reader.editMenu.note", fallback: "添加笔记"),
      image: UIImage(systemName: "square.and.pencil"),
      identifier: UIAction.Identifier("com.readerapp.selection.note")
    ) { [weak self] _ in
      self?.perform("note", requestID: requestID)
    }
    return UIMenu(children: [copy, excerpt, delete, note])
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
