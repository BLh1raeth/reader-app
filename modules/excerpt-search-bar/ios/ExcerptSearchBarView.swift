import ExpoModulesCore

/// 真正的 UIKit 搜索框：内嵌一个 UISearchBar，放大镜 / placeholder /
/// 清空键 / 键盘 / 光标 / 选中 / 语义颜色 / 深浅色 / Dynamic Type /
/// 无障碍全部由 iOS 系统提供，不手画任何元素。
///
/// - `searchBarStyle = .minimal`：只要圆角输入框本体，不要外层 bar 背景，
///   外面不再套 Glass / 圆角 View / 阴影卡片。
/// - 不显示 Cancel 按钮：键盘通过点空白 / 拖动列表 / 系统清空键收起。
/// - 只负责 UI：文本变化 / 焦点 / 搜索键通过事件交给 JS，
///   debounce / 过滤 / 结果管理全部留在 TS。
final class ExcerptSearchBarView: ExpoView, UISearchBarDelegate {
  private let searchBar = UISearchBar()

  let onTextChange = EventDispatcher()
  let onFocusChange = EventDispatcher()
  let onSubmitEditing = EventDispatcher()

  required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)
    searchBar.delegate = self
    searchBar.searchBarStyle = .minimal
    searchBar.showsCancelButton = false
    searchBar.autocapitalizationType = .none
    searchBar.autocorrectionType = .no
    searchBar.spellCheckingType = .no
    addSubview(searchBar)
  }

  @available(*, unavailable)
  required init?(coder: NSCoder) {
    fatalError("init(coder:) has not been implemented")
  }

  override func layoutSubviews() {
    super.layoutSubviews()
    searchBar.frame = bounds
  }

  // MARK: - Props

  func setPlaceholder(_ placeholder: String?) {
    searchBar.placeholder = placeholder
  }

  /// 受控文本：只在真正不同时回写，避免光标跳动与反馈循环。
  ///
  /// 关键：输入法拼写中（marked text，如拼音未选词）时绝不回写。iOS 上任何
  /// programmatic 的 `searchBar.text = ...` 都会强制提交 marked text——
  /// 拼音会立刻变成拉丁字母定稿，中文就打不出来了。RN bridge 是异步的，
  /// 用户连续按键时，一个稍早的旧 prop 值很可能在 native 文本已经往前走
  /// 了一步之后才到达，此时 `searchBar.text != next` 为 true 就会触发写入，
  /// 拼音越长（按键越多）撞上的概率越大。跳过这次写入不会丢数据：选词完成
  /// 时 `textDidChange` 一定会上报最终文本，JS 状态随即收敛，下一次同步
  /// 写的是干净文本。
  func setText(_ text: String?) {
    let next = text ?? ""
    if searchBar.searchTextField.markedTextRange != nil { return }
    if searchBar.text != next {
      searchBar.text = next
    }
  }

  // MARK: - UISearchBarDelegate

  func searchBar(_ searchBar: UISearchBar, textDidChange searchText: String) {
    // 系统清空键同样走这里（searchText == ""），JS 侧 query 清空即退出搜索模式。
    onTextChange(["text": searchText])
  }

  func searchBarTextDidBeginEditing(_ searchBar: UISearchBar) {
    onFocusChange(["focused": true])
  }

  func searchBarTextDidEndEditing(_ searchBar: UISearchBar) {
    onFocusChange(["focused": false])
  }

  func searchBarSearchButtonClicked(_ searchBar: UISearchBar) {
    searchBar.resignFirstResponder()
    onSubmitEditing([:])
  }
}
