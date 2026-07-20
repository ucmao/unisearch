import { envApi, type EnvCheckResult } from '@/lib/api'

const ENV_CHECK_RESULT_KEY = 'unisearch_env_check_result'

export interface StoredEnvironmentCheck extends EnvCheckResult {
  checkedAt: string
}

function storeResult(result: StoredEnvironmentCheck) {
  try {
    localStorage.setItem(ENV_CHECK_RESULT_KEY, JSON.stringify(result))
  } catch {
    // The check is informational and must never block the application UI.
  }
}

export async function checkEnvironmentInBackground(): Promise<StoredEnvironmentCheck> {
  try {
    const response = await envApi.check()
    const result = { ...response.data, checkedAt: new Date().toISOString() }
    storeResult(result)
    return result
  } catch (error) {
    const result: StoredEnvironmentCheck = {
      success: false,
      message: '后台环境检测失败',
      error: error instanceof Error ? error.message : '无法连接本地环境检测服务',
      checkedAt: new Date().toISOString(),
    }
    storeResult(result)
    return result
  }
}

export function getLastEnvironmentCheck(): StoredEnvironmentCheck | null {
  try {
    const value = localStorage.getItem(ENV_CHECK_RESULT_KEY)
    return value ? JSON.parse(value) as StoredEnvironmentCheck : null
  } catch {
    return null
  }
}
