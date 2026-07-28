const expectedPlatform = process.argv[2]
const labels = {
  darwin: 'macOS',
  win32: 'Windows',
}

if (!(expectedPlatform in labels)) {
  console.error('用法: node scripts/check-release-platform.mjs <darwin|win32>')
  process.exit(2)
}

if (process.platform !== expectedPlatform) {
  console.error(`正式 ${labels[expectedPlatform]} 安装包必须在 ${labels[expectedPlatform]} 构建机上生成；当前平台是 ${process.platform}。`)
  process.exit(1)
}

console.log(`发布平台检查通过: ${labels[expectedPlatform]}`)
