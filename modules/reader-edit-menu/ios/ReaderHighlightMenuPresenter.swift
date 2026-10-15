import UIKit

/// Presents the highlight tap menu over the EPUB.
///
/// Mirrors ExcerptMenuPresenter (verified working): the UIEditMenuInteraction
/// is attached directly to the WKWebView and the menu is built explicitly in
/// the delegate. No UITextView, no first-responder grab — the transparent
/// text responder never produced a presenting menu.
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
  private lazy var interaction = UIEditMenuInteraction(delegate: self)

  public init(sourceView: UIView, actionHandler: @escaping (String, Int) -> Void) {
    self.sourceView = sourceView
    self.actionHandler = actionHandler
    super.init()
    sourceView.addInteraction(interaction)
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
    anchorRect = CGRect(x: next.rect.x, y: next.rect.y, width: next.rect.width, height: next.rect.height)
      .intersection(sourceView.bounds)
    guard !anchorRect.isNull, !anchorRect.isEmpty else {
      perform("dismissHighlightMenu", requestID: requestID)
      return
    }
    let configuration = UIEditMenuConfiguration(
      identifier: NSNumber(value: next.id),
      sourcePoint: CGPoint(x: anchorRect.midX, y: anchorRect.midY)
    )
    // Defer presentation past the tap's gesture churn, mirroring
    // ExcerptMenuPresenter. The generation guard drops this block if a
    // dismiss or a newer request superseded it during the delay.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
      guard let self, self.request?.id == requestID else { return }
      self.interaction.presentEditMenu(with: configuration)
    }
  }

  public func dismiss() {
    request = nil
    interaction.dismissMenu()
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
    let copiedText = request?.text
    let copy = UIAction(
      title: "复制",
      image: UIImage(systemName: "doc.on.doc"),
      identifier: UIAction.Identifier("com.readerapp.highlight.copy")
    ) { [weak self] _ in
      UIPasteboard.general.string = copiedText
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
    }
  }
}
