import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { spawn } from 'node:child_process'

const root = path.resolve(process.argv[2] || 'dist')
const timeoutMs = 45_000

function findExecutables(target) {
  if (!fs.existsSync(target)) return []
  const stat = fs.statSync(target)
  if (stat.isFile()) return [target]

  const matches = []
  const pending = [target]
  while (pending.length) {
    const current = pending.shift()
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const absolute = path.join(current, entry.name)
      if (entry.isDirectory()) {
        pending.push(absolute)
        continue
      }
      const isMacExecutable = absolute.includes(`${path.sep}Contents${path.sep}MacOS${path.sep}`)
        && entry.name === 'UniSearch'
      const isWindowsExecutable = entry.name === 'UniSearch.exe'
      if (isMacExecutable || isWindowsExecutable) matches.push(absolute)
    }
  }
  return matches.sort()
}

function runSmokeTest(executable) {
  return new Promise((resolve, reject) => {
    const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'unisearch-smoke-'))
    let output = ''
    let settled = false
    const child = spawn(executable, [], {
      env: {
        ...process.env,
        UNISEARCH_SMOKE_TEST: '1',
        UNISEARCH_SMOKE_USER_DATA_DIR: userDataDir,
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    })

    const finish = (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      fs.rmSync(userDataDir, { recursive: true, force: true })
      if (error) reject(error)
      else resolve()
    }

    child.stdout.on('data', (chunk) => { output += chunk.toString() })
    child.stderr.on('data', (chunk) => { output += chunk.toString() })
    child.on('error', (error) => finish(error))
    child.on('exit', (code, signal) => {
      if (code === 0 && output.includes('[UniSearch Smoke] PASS')) {
        console.log(`安装后冒烟检查通过: ${executable}`)
        finish()
      } else {
        finish(new Error(`安装后冒烟检查失败 (${executable}, exit=${code}, signal=${signal || 'none'})\n${output}`))
      }
    })

    const timer = setTimeout(() => {
      child.kill('SIGKILL')
      finish(new Error(`安装后冒烟检查超时 (${executable})\n${output}`))
    }, timeoutMs)
  })
}

const executables = findExecutables(root)
if (!executables.length) {
  throw new Error(`在 ${root} 中未找到 UniSearch.app 或 UniSearch.exe，请传入解包后的应用或其父目录。`)
}

for (const executable of executables) {
  await runSmokeTest(executable)
}
