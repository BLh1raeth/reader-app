import ExpoModulesCore

public final class ReaderEditMenuModule: Module {
  public func definition() -> ModuleDefinition {
    Name("ReaderEditMenu")

    Constant("isAvailable") {
      true
    }
  }
}
