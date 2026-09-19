import UIKit

/// Customizes the menu that WKWebView builds through the public UIResponder
/// menu-builder hook. WebKit remains responsible for presenting the native
/// UIEditMenuInteraction, selection handles, positioning, and animations.
@MainActor
public final class ReaderEditMenuCoordinator {
  public typealias ActionHandler = (String) -> Void

  private let actionHandler: ActionHandler

  public init(actionHandler: @escaping ActionHandler) {
    self.actionHandler = actionHandler
  }

  public func buildMenu(with builder: UIMenuBuilder) {
    guard builder.system == .context else { return }

    #if DEBUG
    logKnownMenus(builder)
    #endif

    // `learn` and `find` are public UIKit semantic identifiers. Removing them
    // does not depend on localized titles or private WebKit selectors.
    if #available(iOS 26.0, *) {
      builder.remove(menu: .learn)
    }
    builder.remove(menu: .find)

    // Keep the real system Copy command object so UIKit/WebKit continues to
    // own selection copying. Replace the rest of Standard Edit with the four
    // Reader-first actions requested for EPUB text selections.
    let copySelector = #selector(UIResponderStandardEditActions.copy(_:))
    let systemCopy = builder.command(for: copySelector, propertyList: nil)
    builder.replaceChildren(ofMenu: .standardEdit) { [weak self] children in
      guard let self else { return children }
      var primary: [UIMenuElement] = []
      if let systemCopy {
        primary.append(systemCopy)
      }
      primary.append(contentsOf: [
        self.readerAction(
          titleKey: "reader.editMenu.excerpt",
          fallback: "摘录",
          symbol: "text.quote",
          identifier: "com.readerapp.selection.excerpt",
          action: "excerpt"
        ),
        self.readerAction(
          titleKey: "reader.editMenu.highlight",
          fallback: "高亮",
          symbol: "highlighter",
          identifier: "com.readerapp.selection.highlight",
          action: "highlight"
        ),
        self.readerAction(
          titleKey: "reader.editMenu.note",
          fallback: "添加笔记",
          symbol: "square.and.pencil",
          identifier: "com.readerapp.selection.note",
          action: "note"
        )
      ])
      return primary
    }

    let searchGroup = UIMenu(
      title: "",
      options: .displayInline,
      children: [readerAction(
        titleKey: "reader.editMenu.searchInBook",
        fallback: "在本书中搜索",
        symbol: "magnifyingglass",
        identifier: "com.readerapp.selection.searchInBook",
        action: "searchInBook"
      )]
    )

    // Keep Apple's original Lookup/Translate menu objects and handlers. Put
    // the Reader search immediately before that group when UIKit exposes it.
    if builder.menu(for: .lookup) != nil {
      builder.insertSibling(searchGroup, beforeMenu: .lookup)
    } else {
      builder.insertChild(searchGroup, atEndOfMenu: .standardEdit)
    }
  }

  private func readerAction(
    titleKey: String,
    fallback: String,
    symbol: String,
    identifier: String,
    action: String
  ) -> UIAction {
    UIAction(
      title: ReaderEditMenuStrings.localized(titleKey, fallback: fallback),
      image: UIImage(systemName: symbol),
      identifier: UIAction.Identifier(identifier)
    ) { [weak self] _ in
      self?.actionHandler(action)
    }
  }

  #if DEBUG
  private func logKnownMenus(_ builder: UIMenuBuilder) {
    var identifiers: [UIMenu.Identifier] = [
      .standardEdit, .lookup, .share, .find
    ]
    if #available(iOS 26.0, *) {
      identifiers.append(.learn)
    }
    for identifier in identifiers {
      guard let menu = builder.menu(for: identifier) else { continue }
      print("[READER_EDIT_MENU] menu id=\(identifier.rawValue) title=\(menu.title)")
      log(elements: menu.children, depth: 1)
    }
  }

  private func log(elements: [UIMenuElement], depth: Int) {
    let indent = String(repeating: "  ", count: depth)
    for element in elements {
      if let menu = element as? UIMenu {
        print("[READER_EDIT_MENU] \(indent)menu id=\(menu.identifier.rawValue) title=\(menu.title)")
        log(elements: menu.children, depth: depth + 1)
      } else if let command = element as? UICommand {
        print("[READER_EDIT_MENU] \(indent)command selector=\(NSStringFromSelector(command.action)) title=\(command.title)")
      } else if let action = element as? UIAction {
        print("[READER_EDIT_MENU] \(indent)action id=\(action.identifier.rawValue) title=\(action.title)")
      } else {
        print("[READER_EDIT_MENU] \(indent)element type=\(String(describing: type(of: element)))")
      }
    }
  }
  #endif
}
