# 桌面端打包与发布指南

UniSearch 打包分为两种场景：**无证书常规打包（适合日常开发、自用与内部分发）** 和 **正式签名发布（适合商业发布与官网分发）**。

---

## 💡 场景一：日常开发 / 无证书打包（推荐 90% 场景）

无需购买或配置任何开发者证书与钥匙串，开箱即用，自动生成本地可运行的安装包或免安装压缩包。

> 💡 **提示**：若本地系统/钥匙串中存在残留证书引发签名错误，可在命令前加 `CSC_IDENTITY_AUTO_DISCOVERY=false`（Windows CMD 使用 `set CSC_IDENTITY_AUTO_DISCOVERY=false && ...`，PowerShell 使用 `$env:CSC_IDENTITY_AUTO_DISCOVERY="false"; ...`）。

### 1. 一键生成默认安装包
在目标操作系统终端中运行：

```bash
npm run electron:build
```
- **macOS**：在 Mac 上执行，生成 `dist/UniSearch-1.0.0-mac-arm64.dmg`
- **Windows**：在 Windows 上执行，生成 `dist/UniSearch-1.0.0-win-x64.exe`（NSIS 安装程序）

---

### 2. 指定打包格式与架构（ZIP 免安装包 / 架构选择）

如果需要免安装绿色包（ZIP）或指定 CPU 架构，可按如下命令打包：

#### 🪟 Windows 平台
- **同时生成 x64 安装包 (.exe) 与免安装包 (.zip)**：
  ```bash
  npm run build:backend && npm run webui:build
  npx electron-builder --win nsis zip --x64
  ```
- **仅生成 x64 免安装 ZIP 压缩包（解压即用）**：
  ```bash
  npm run build:backend && npm run webui:build
  npx electron-builder --win zip --x64
  ```

#### 🍎 macOS 平台
- **一次性生成 Apple Silicon (arm64) 和 Intel (x64) 两个独立 DMG 安装包**：
  ```bash
  npm run build:backend && npm run webui:build
  npx electron-builder --mac --arm64 --x64
  ```
- **仅生成 Intel (x64) 架构 DMG**：
  ```bash
  npm run build:backend && npm run webui:build
  npx electron-builder --mac --x64
  ```
- **生成 ZIP 绿色免安装包**：
  ```bash
  npm run build:backend && npm run webui:build
  npx electron-builder --mac zip
  ```
> ⚠️ **注意**：如需打包 Universal (通用二进制) 包，命令格式为 `npx electron-builder --mac --universal`（必须带 `--` 前缀，不能写成 `electron-builder --mac universal`）。

---

## 🔐 场景二：商业正式发布打包（需要代码签名与公证）

用于官网公开下载分发，规避 macOS “无法打开未知开发者应用” 或 Windows SmartScreen 拦截警告。

### 1. macOS 签名与 Apple 官方公证
需要 Apple 开发者账号的 `Developer ID Application` 证书与 App 专用密码：

```bash
# 环境变量配置：APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID
npm run electron:build:mac:release
```
> 自动完成 Hardened Runtime 开启、代码签名、Apple 线上公证与票据装订。

---

### 2. Windows 代码签名发布
需要购买并配置 Authenticode 代码签名证书（`.pfx`）：

```powershell
# 环境变量配置：WIN_CSC_LINK (证书路径), WIN_CSC_KEY_PASSWORD (密码)
npm run electron:build:win:release
```
> 注意：Windows 下需开启系统的「开发人员模式」以确保 `winCodeSign` 符号链接创建成功。

---

## 🧪 安装包校验与冒烟测试 (可选)

打包完成后，可执行自动化脚本验证原生依赖（如 SQLite / Playwright）与 API 正常启动：

```bash
# 1. 静态资源与文件完整性校验
npm run verify:package -- <解包后的平台目录>

# 2. 自动化全链路冒烟测试
npm run smoke:package -- <UniSearch.app 或 UniSearch.exe 所在路径>
```


