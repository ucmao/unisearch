# 桌面端发布打包

正式安装包必须在目标操作系统构建。两个发布命令都会拒绝在错误的平台运行，并在找不到有效签名时失败。

## macOS

在安装了 `Developer ID Application` 证书的 macOS 构建机上配置 Apple 公证凭据，然后运行：

```bash
npm ci
npm run electron:build:mac:release
```

该命令生成 arm64 DMG，完成 Hardened Runtime 签名、Apple 公证和票据装订。公证凭据只能通过环境变量或 macOS 钥匙串提供，不得提交到仓库。如以后需要支持 Intel Mac，应在 Intel macOS 构建机上单独生成 x64 包。

## Windows

在配置了 Authenticode 代码签名证书的 64 位 Windows 构建机上运行：

```powershell
npm ci
npm run electron:build:win:release
```

普通 `npm run electron:build` 会关闭 Windows EXE 的资源编辑与签名，以绕过 electron-builder 24.13.3 的 `winCodeSign` 符号链接权限问题。Windows 正式发布命令会显式恢复资源编辑并强制要求签名成功，因此必须先解决构建机的 `winCodeSign` 权限并配置 Authenticode 证书。建议通过 `WIN_CSC_LINK` 和 `WIN_CSC_KEY_PASSWORD` 注入证书，或者使用构建机证书存储和 electron-builder 的证书配置。

## 安装包检查

先检查安装包内部的 worker、原生模块和只读资源：

```bash
npm run verify:package -- <解包后的平台目录>
```

再启动解包后的应用执行冒烟检查：

```bash
npm run smoke:package -- <UniSearch.app、UniSearch.exe 或其父目录>
```

冒烟检查使用临时用户数据目录，验证应用启动、本地 API、Playwright、worker 文件和 Electron 内置 Chromium，完成后自动退出并删除临时数据。
