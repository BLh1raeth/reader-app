import ExpoModulesCore

/// 摘录 Tab 原生搜索框模块：只暴露一个 inline UIView（内含 UISearchBar）。
/// 不新增 dependency / entitlement / capability / provisioning profile 变化，
/// 但需要包含本模块的新 Development Build 才能运行（EAS，未经批准不执行）。
public final class ExcerptSearchBarModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ExcerptSearchBar")

    View(ExcerptSearchBarView.self) {
      Prop("placeholder") { (view: ExcerptSearchBarView, value: String?) in
        view.setPlaceholder(value)
      }
      Prop("text") { (view: ExcerptSearchBarView, value: String?) in
        view.setText(value)
      }
      Events("onTextChange", "onFocusChange", "onSubmitEditing")
    }
  }
}
