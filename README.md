# 阅读

一个用 Expo 构建的 iOS EPUB 阅读器。本地书库管理、流畅的阅读体验、原生质感的交互细节。

## 功能

- **本地书库** — 导入 EPUB、SHA-256 去重、书名/作者/标签搜索、标签和阅读状态筛选；普通浏览使用虚拟列表，手动排序保留拖动布局
- **EPUB 阅读** — 基于 foliate-js，支持分页、阅读进度记忆、系统/宋体/黑体字体选择、返回目录/搜索/书签跳转前的位置；正文脚本和远程资源被限制
- **原生选中菜单** — 选中文字弹出系统菜单：拷贝、摘录、高亮、在本书中搜索。笔记入口暂为占位，本轮不实现笔记
- **脚注弹窗** — 点击脚注弹出原生 Liquid Glass popover，带箭头、自动避让屏幕边缘
- **摘录本** — 按时间/图书整理摘录，支持复制、分享、编辑、删除及当前筛选结果的 Markdown 导出；纯高亮不进入摘录列表
- **数据统计** — 数据页继续使用模拟数据（`USE_DEMO_DATA = true`），待 UI 完成后再接真实统计；底层阅读记录继续采集
- **阅读外观** — 跟随系统，或手动选择浅色/深色
- **记录保留** — 可只移除本地文件，保留摘录、书签和阅读记录；再次导入同一 EPUB 恢复原图书身份。永久删除需二次确认
- **本地备份** — 流式 ZIP 导出、进度提示；导入先校验并准备候选数据，再提交替换。暂不实现 iCloud 同步

## 技术栈

- Expo SDK 57 / React Native 0.86 / React 19 / expo-router
- EPUB 解析与排版：foliate-js（DOM 渲染）
- 本地存储：expo-sqlite（书库、进度、摘录）+ expo-file-system（EPUB 文件）
- 自研原生模块（`modules/`）：
  - `reader-edit-menu` — 把摘录/高亮/笔记接进 iOS 原生选中菜单
  - `reader-popover` — 脚注用的原生 `UIPopoverPresentationController`，iOS 26 上自动获得 Liquid Glass 效果

## 本地开发

```bash
npm ci
npx expo start --dev-client --tunnel   # 用包含本地原生模块的 development build 打开
```

本项目包含自研 iOS 模块，Expo Go 不能提供完整阅读交互。新增 `expo-clipboard` 或改动原生配置后，需要更新 development build。

Windows 上双击 `启动 Metro（Tunnel）.cmd` 即可（局域网连不上时用 tunnel）。

数据层回归检查（Node.js 24）：

```bash
npm test
npm run typecheck
npx playwright install chromium
npm run test:browser
npm run export:ios
```

测试覆盖迁移中断和旧版修复、移除/恢复记录、备份失败回退与资源校验、ZIP 解压边界、阅读计数/速度、摘录编辑、设置持久化、缓存及原生插件补丁。浏览器使用真实 Foliate 阅读引擎，检查 EPUB 2/3、本地资源、内容限制、字体切换和 CFI 恢复。

CI 运行类型检查、回归测试、浏览器测试及 iOS JS/DOM 导出。iOS 原生编译和触摸交互仍需新 development build 的真机验收，详见 [验收说明](docs/reliability-validation.md)。

## 打包

```bash
npx eas-cli build --platform ios --profile development
```

`eas.json` 保留现有 `credentialsSource: local`，构建时需要对应的本地签名材料；若你的签名实际托管在 EAS，按已有签名方案选择 remote，不必为这轮 JS 改动切换。

Expo SDK 57 的 DOM 分包导出存在公共资源文件名丢失问题（原 main 同样复现）。`export:ios` 脚本和 development 构建配置设置 `EXPO_NO_BUNDLE_SPLITTING=1`，使用 Expo 提供的单包导出路径；新增其他 EAS profile 时也应保留该设置，待 SDK 修复后再移除。

当前文件边界：EPUB ≤ 256 MiB、单资源 ≤ 64 MiB、展开总量 ≤ 512 MiB；备份 ZIP ≤ 512 MiB、单资源 ≤ 256 MiB。超限、加密、多磁盘及 ZIP64 文件会提示拒绝。备份导出按 256 KiB 文件块写入，SQLite 快照仍需要内存。

## 项目结构

```
app/                    # expo-router 路由（书库 / 摘录 / 数据 / 阅读器）
src/
  features/
    library/            # 书库：导入、去重、封面、进度圆环
    reader/             # 阅读器：排版引擎、选区菜单、脚注、设置
    excerpts/           # 摘录本
    data/               # 数据统计
  design-system/        # 设计 token 与通用组件
  localization/         # 中文本地化
modules/
  reader-edit-menu/     # 原生选中菜单模块
  reader-popover/       # 原生脚注 popover 模块
  excerpt-search-bar/   # 原生摘录搜索框
plugins/                # Expo config plugin
```

## License

MIT
