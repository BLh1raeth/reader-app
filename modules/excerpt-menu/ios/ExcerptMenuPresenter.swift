import UIKit

/// Native long-press context menu for an excerpt card.
///
/// Fully custom `UIMenu` presented with `UIEditMenuInteraction`. No
/// `UITextView`, no first-responder grab: the highlight menu's synchronous
/// present raced the tap's responder churn and flashed away (see e06172e),
/// so this menu defers presentation by 100ms past the long-press gesture.
///
/// The anchor is the RN long-press point (`pageX`/`pageY`) in window
/// points, which maps 1:1 to the key window root view's coordinates.
/// No scale multiplication, no safe-area offsets.
@MainActor
public final class ExcerptMenuPresenter: NSObject, UIEditMenuInteractionDelegate {

  public static let shared = ExcerptMenuPresenter()

  private weak var hostView: UIView?
  private lazy var interaction = UIEditMenuInteraction(delegate: self)
  private var anchorPoint = CGPoint.zero
  private var actionHandler: ((String) -> Void)?
  private var didChooseAction = false
  private var presentationID = 0

  private override init() {
    super.init()
  }

  /// Present the menu anchored at `point` (window points). Any in-flight
  /// menu is dismissed first and its handler resolves as 'dismiss'.
  /// The handler resolves exactly once: with the chosen action, or
  /// 'dismiss' when the menu goes away without a choice.
  public func present(at point: CGPoint, actionHandler: @escaping (String) -> Void) {
    finish(with: "dismiss")
    interaction.dismissMenu()
    guard point.x.isFinite, point.y.isFinite,
          let hostView = ExcerptMenuPresenter.keyWindowRootView()
    else {
      actionHandler("dismiss")
      return
    }
    presentationID += 1
    let id = presentationID
    self.anchorPoint = point
    self.actionHandler = actionHandler
    self.didChooseAction = false
    if interaction.view !== hostView {
      hostView.addInteraction(interaction)
    }
    self.hostView = hostView
    // Defer presentation past the long-press gesture's responder churn:
    // presenting synchronously from the gesture's bridge delivery is the
    // same race that made the highlight menu flash and vanish.
    DispatchQueue.main.asyncAfter(deadline: .now() + 0.1) { [weak self] in
      guard let self, self.presentationID == id, self.actionHandler != nil else { return }
      let configuration = UIEditMenuConfiguration(
        identifier: NSNumber(value: id),
        sourcePoint: self.anchorPoint
      )
      self.interaction.presentEditMenu(with: configuration)
    }
  }

  public func dismiss() {
    finish(with: "dismiss")
    interaction.dismissMenu()
  }

  private func finish(with action: String) {
    guard let handler = actionHandler else { return }
    actionHandler = nil
    handler(action)
  }

  private func choose(_ action: String) {
    didChooseAction = true
    finish(with: action)
  }

  private static func keyWindowRootView() -> UIView? {
    UIApplication.shared.connectedScenes
      .compactMap { $0 as? UIWindowScene }
      .flatMap { $0.windows }
      .first { $0.isKeyWindow }?.rootViewController?.view
  }

  // MARK: - UIEditMenuInteractionDelegate

  public func editMenuInteraction(
    _ interaction: UIEditMenuInteraction,
    menuFor configuration: UIEditMenuConfiguration,
    suggestedActions: [UIMenuElement]
  ) -> UIMenu? {
    // Fully custom menu. UIKit's suggested actions are ignored: there is
    // no text selection here, so they would be empty anyway.
    UIMenu(children: [
      UIAction(title: "复制", image: UIImage(systemName: "doc.on.doc"), identifier: UIAction.Identifier("com.readerapp.excerpt.copy"), attributes: []) { [weak self] _ in
        self?.choose("copy")
      },
      UIAction(title: "分享", image: UIImage(systemName: "square.and.arrow.up"), identifier: UIAction.Identifier("com.readerapp.excerpt.share"), attributes: []) { [weak self] _ in
        self?.choose("share")
      },
      UIAction(title: "编辑内容", image: UIImage(systemName: "pencil"), identifier: UIAction.Identifier("com.readerapp.excerpt.edit"), attributes: []) { [weak self] _ in
        self?.choose("edit")
      },
      UIAction(
        title: "删除",
        image: UIImage(systemName: "trash"),
        identifier: UIAction.Identifier("com.readerapp.excerpt.delete"),
        attributes: .destructive
      ) { [weak self] _ in
        self?.choose("delete")
      },
    ])
  }

  public func editMenuInteraction(
    _ interaction: UIEditMenuInteraction,
    targetRectFor configuration: UIEditMenuConfiguration
  ) -> CGRect {
    CGRect(x: anchorPoint.x, y: anchorPoint.y, width: 1, height: 1)
  }

  public func editMenuInteraction(
    _ interaction: UIEditMenuInteraction,
    willDismissMenuFor configuration: UIEditMenuConfiguration,
    animator: UIEditMenuInteractionAnimating
  ) {
    // An action tap also dismisses the menu, but the action handler
    // already resolved the promise in that case. Only an outside-tap
    // dismissal reaches here with no choice made.
    guard !didChooseAction else { return }
    finish(with: "dismiss")
  }
}
