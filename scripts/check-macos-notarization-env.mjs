const hasValue = (name) => Boolean(process.env[name]?.trim())

const credentialSets = [
  {
    label: 'App Store Connect API Key',
    variables: ['APPLE_API_KEY', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'],
  },
  {
    label: 'Apple ID',
    variables: ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD'],
  },
  {
    label: 'notarytool 钥匙串配置',
    variables: ['APPLE_KEYCHAIN_PROFILE'],
  },
]

const configuredSet = credentialSets.find(({ variables }) => variables.every(hasValue))

if (!configuredSet) {
  console.error([
    '无法执行 macOS 正式发布构建：未配置 Apple 公证凭据。',
    '请配置以下任意一组环境变量：',
    '  1. APPLE_API_KEY、APPLE_API_KEY_ID、APPLE_API_ISSUER',
    '  2. APPLE_ID、APPLE_APP_SPECIFIC_PASSWORD',
    '  3. APPLE_KEYCHAIN_PROFILE（可选搭配 APPLE_KEYCHAIN）',
    '凭据必须保存在环境变量或 macOS 钥匙串中，请勿写入仓库。',
  ].join('\n'))
  process.exit(1)
}

console.log(`已检测到 ${configuredSet.label} 公证凭据，将执行签名和 Apple 公证。`)
