# 阅读

一个用 Expo 构建的 iOS EPUB 阅读器。本地书库管理、流畅的阅读体验、原生质感的交互细节。

## 功能

- **本地书库** — 从文件导入 EPUB，按 SHA-256 去重，导入时右上角有进度圆环提示
- **EPUB 阅读** — 基于 foliate-js 的排版引擎，支持分页、阅读进度记忆
- **原生选中菜单** — 选中文字弹出系统菜单：拷贝、摘录、高亮、添加笔记、在本书中搜索
- **脚注弹窗** — 点击脚注弹出原生 Liquid Glass popover，带箭头、自动避让屏幕边缘
- **摘录本** — 收集高亮和笔记，按书整理
- **数据统计** — 阅读数据汇总
- **深色模式** — 跟随系统外观

## 技术栈

- Expo SDK 57 / React Native 0.86 / React 19 / expo-router
- EPUB 解析与排版：foliate-js（DOM 渲染）
- 本地存储：expo-sqlite（书库、进度、摘录）+ expo-file-system（EPUB 文件）
- 自研原生模块（`modules/`）：
  - `reader-edit-menu` — 把摘录/高亮/笔记接进 iOS 原生选中菜单
  - `reader-popover` — 脚注用的原生 `UIPopoverPresentationController`，iOS 26 上自动获得 Liquid Glass 效果

## 本地开发

```bash
npm install
npx expo start --tunnel   # 手机用 Expo Go 扫码，或装 dev client
```

Windows 上双击 `启动 Metro（Tunnel）.cmd` 即可（局域网连不上时用 tunnel）。

## 打包

```bash
eas build --platform ios --profile development
```

签名材料保存在 EAS 远端，`eas.json` 里 `credentialsSource` 平时保持 `local`，打包时切到 `remote` 即可。

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
plugins/                # Expo config plugin
```

## License

MIT
