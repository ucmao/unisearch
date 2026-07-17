# -*- coding: utf-8 -*-
# Copyright (c) 2025 relakkes@gmail.com
#
# This file is part of MediaRadar project.
# Repository: https://github.com/NanmiCoder/MediaRadar/blob/main/api/services/crawler_manager.py
# GitHub: https://github.com/NanmiCoder
# Licensed under NON-COMMERCIAL LEARNING LICENSE 1.1
#
# 声明：本代码仅供学习和研究目的使用。使用者应遵守以下原则：
# 1. 不得用于任何商业用途。
# 2. 使用时应遵守目标平台的使用条款 and robots.txt规则。
# 3. 不得进行大规模爬取或对平台造成运营干扰。
# 4. 应合理控制请求频率，避免给目标平台带来不必要的负担。
# 5. 不得用于任何非法或不当的用途。
#
# 详细许可条款请参阅项目根目录下的LICENSE文件。
# 使用本代码即表示您同意遵守上述原则和LICENSE中的所有条款。

import asyncio
import subprocess
import signal
import os
import sys
from typing import Optional, List, Dict
from datetime import datetime
from pathlib import Path

from ..schemas import CrawlerStartRequest, LogEntry
from .analytics_repository import analytics_repository
from .data_analytics import load_normalized_contents_from_sqlite


class CrawlerTask:
    """Manages a single crawler run loop for a specific platform"""

    def __init__(self, platform: str, config: CrawlerStartRequest):
        self.platform = platform
        self.config = config
        self.process: Optional[subprocess.Popen] = None
        self.status = "idle"
        self.started_at: Optional[datetime] = None
        self.current_run_id: Optional[str] = None
        self.last_run_id: Optional[str] = None
        self.baseline_fingerprints: dict = {}
        self.logs: List[LogEntry] = []
        self.log_id = 0
        self.should_loop = config.loop_execution
        self.loop_task: Optional[asyncio.Task] = None
        self.read_task: Optional[asyncio.Task] = None

    def _log(self, message: str, level: str, manager: 'CrawlerManager'):
        self.log_id += 1
        entry = LogEntry(
            id=self.log_id,
            timestamp=datetime.now().strftime("%H:%M:%S"),
            level=level,
            message=message,
            platform=self.platform
        )
        self.logs.append(entry)
        if len(self.logs) > 500:
            self.logs = self.logs[-500:]

        # Add to global manager logs
        manager._logs.append(entry)
        if len(manager._logs) > 1000:
            manager._logs = manager._logs[-1000:]
        
        # Push to socket queue
        asyncio.create_task(manager._push_log(entry))

    def _collect_run_contents(self, manager: 'CrawlerManager') -> list[dict]:
        try:
            contents = load_normalized_contents_from_sqlite(analytics_repository.db_path, self.platform)
            current_fingerprints = analytics_repository.content_fingerprints(contents)
            changed_keys = {
                key for key, fingerprint in current_fingerprints.items()
                if self.baseline_fingerprints.get(key) != fingerprint
            }
            platform = self.platform
            keywords = {value.strip() for value in self.config.keywords.split(",") if value.strip()}
            return [
                item for item in contents
                if (item["platform"], item["content_id"], item["keyword"]) in changed_keys
                and item["platform"] == platform
                and (not keywords or item["keyword"] in keywords or self.config.crawler_type.value != "search")
            ]
        except Exception:
            return []

    async def _finalize_run(self, status: str, exit_code: int | None, manager: 'CrawlerManager', error_message: str = "") -> None:
        if not self.current_run_id:
            return
        run_id = self.current_run_id
        try:
            contents = await asyncio.to_thread(self._collect_run_contents, manager)
            await asyncio.to_thread(
                analytics_repository.finish_run,
                run_id,
                status,
                exit_code,
                contents,
                error_message,
            )
            self._log(
                f"Analytics saved: run {run_id[:8]}, {len(contents)} records",
                "success" if status == "completed" else "info",
                manager
            )
        except Exception as error:
            analytics_repository.finish_run(run_id, "failed", exit_code, [], str(error))
            self._log(f"Failed to save analytics: {error}", "error", manager)
        finally:
            self.last_run_id = run_id
            self.current_run_id = None

    async def _read_output(self, manager: 'CrawlerManager'):
        loop = asyncio.get_event_loop()
        try:
            while self.process and self.process.poll() is None:
                line = await loop.run_in_executor(None, self.process.stdout.readline)
                if line:
                    line = line.strip()
                    if line:
                        level = manager._parse_log_level(line)
                        self._log(line, level, manager)

            if self.process and self.process.stdout:
                remaining = await loop.run_in_executor(None, self.process.stdout.read)
                if remaining:
                    for line in remaining.strip().split('\n'):
                        if line.strip():
                            level = manager._parse_log_level(line.strip())
                            self._log(line.strip(), level, manager)

            exit_code = self.process.returncode if self.process else -1
            if exit_code == 0:
                self._log("Crawler cycle completed successfully", "success", manager)
                run_status = "completed"
            else:
                self._log(f"Crawler cycle exited with code: {exit_code}", "warning", manager)
                run_status = "failed"
                
            await self._finalize_run(run_status, exit_code, manager)

        except asyncio.CancelledError:
            if self.process and self.process.poll() is None:
                self.process.kill()
            await self._finalize_run("stopped", -1, manager)
        except Exception as e:
            self._log(f"Error reading output: {str(e)}", "error", manager)
            await self._finalize_run("failed", self.process.returncode if self.process else None, manager, str(e))

    async def run_loop(self, manager: 'CrawlerManager'):
        # A disabled loop means "run once", not "do not run".
        # Re-enter only when loop execution is explicitly enabled.
        while True:
            # Create a run record
            config_data = self.config.model_dump(mode="json")
            # Authentication secrets are runtime-only and must not be persisted
            # in analytics history.
            config_data["cookies"] = ""
            run_id = analytics_repository.create_run(config_data)
            self.current_run_id = run_id
            self.started_at = datetime.now()
            
            # Load baseline fingerprints
            try:
                self.baseline_fingerprints = analytics_repository.content_fingerprints(
                    load_normalized_contents_from_sqlite(analytics_repository.db_path, self.platform)
                )
            except Exception:
                self.baseline_fingerprints = {}

            cmd = manager._build_worker_command()
            self._log(f"Starting crawler cycle (platform: {self.platform}, run_id: {run_id[:8]}): {' '.join(cmd)}", "info", manager)

            try:
                process_env = {
                    **os.environ,
                    "PYTHONUNBUFFERED": "1",
                    "MEDIARADAR_RUN_ID": run_id,
                }
                self.process = subprocess.Popen(
                    cmd,
                    stdin=subprocess.PIPE,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    encoding='utf-8',
                    bufsize=1,
                    cwd=str(manager._project_root),
                    env=process_env,
                )

                if not self.process.stdin:
                    self.process.kill()
                    raise RuntimeError("Crawler worker stdin is unavailable")

                try:
                    self.process.stdin.write(self.config.model_dump_json())
                    self.process.stdin.flush()
                except (BrokenPipeError, OSError) as error:
                    self.process.kill()
                    raise RuntimeError("Failed to send configuration to crawler worker") from error
                finally:
                    try:
                        self.process.stdin.close()
                    except OSError:
                        pass

                self.status = "running"
                self._log(f"Crawler process started for platform: {self.platform}", "success", manager)
                
                self.read_task = asyncio.create_task(self._read_output(manager))
                await self.read_task
                if self.status == "running":
                    self.status = "idle"
                
            except Exception as e:
                self.status = "error"
                analytics_repository.finish_run(run_id, "failed", None, [], str(e))
                self.last_run_id = run_id
                self.current_run_id = None
                self._log(f"Failed to start crawler loop: {str(e)}", "error", manager)

            if not self.should_loop:
                break
                
            self._log(f"Platform {self.platform} cycle finished. Waiting 5 seconds before next loop...", "info", manager)
            self.status = "idle"
            await asyncio.sleep(5.0)

    async def stop(self, manager: 'CrawlerManager'):
        self.should_loop = False
        if self.loop_task:
            self.loop_task.cancel()
        if self.read_task:
            self.read_task.cancel()

        if self.process and self.process.poll() is None:
            self.status = "stopping"
            self._log("Sending SIGTERM to crawler process...", "warning", manager)
            try:
                self.process.send_signal(signal.SIGTERM)
                for _ in range(10):
                    if self.process.poll() is not None:
                        break
                    await asyncio.sleep(0.5)

                if self.process.poll() is None:
                    self._log("Process not responding, sending SIGKILL...", "warning", manager)
                    self.process.kill()

                self._log("Crawler process terminated", "info", manager)
            except Exception as e:
                self._log(f"Error stopping process: {str(e)}", "error", manager)
                
        self.status = "idle"


class CrawlerManager:
    """Crawler process manager supporting concurrent multi-platform execution"""

    def __init__(self):
        self._lock = asyncio.Lock()
        self.tasks: Dict[str, CrawlerTask] = {}
        self._logs: List[LogEntry] = []
        self._project_root = Path(__file__).parent.parent.parent
        self._log_queue: Optional[asyncio.Queue] = None

    @property
    def process(self) -> Optional[subprocess.Popen]:
        # Return first active process (for compatibility)
        for task in self.tasks.values():
            if task.process and task.process.poll() is None:
                return task.process
        return None

    @property
    def status(self) -> str:
        # Return running if any is running (for compatibility)
        if any(t.status == "running" for t in self.tasks.values()):
            return "running"
        if any(t.status == "stopping" for t in self.tasks.values()):
            return "stopping"
        return "idle"

    @property
    def logs(self) -> List[LogEntry]:
        return self._logs

    def get_log_queue(self) -> asyncio.Queue:
        if self._log_queue is None:
            self._log_queue = asyncio.Queue()
        return self._log_queue

    async def _push_log(self, entry: LogEntry):
        if self._log_queue is not None:
            try:
                self._log_queue.put_nowait(entry)
            except asyncio.QueueFull:
                pass

    def _parse_log_level(self, line: str) -> str:
        line_upper = line.upper()
        if "ERROR" in line_upper or "FAILED" in line_upper:
            return "error"
        elif "WARNING" in line_upper or "WARN" in line_upper:
            return "warning"
        elif "SUCCESS" in line_upper or "完成" in line or "成功" in line:
            return "success"
        elif "DEBUG" in line_upper:
            return "debug"
        return "info"

    async def start(self, config: CrawlerStartRequest) -> bool:
        async with self._lock:
            platform = config.platform.value
            
            # Check if task is already running for this platform
            if platform in self.tasks and self.tasks[platform].status in ("running", "stopping"):
                return False

            # Create or get task
            task = CrawlerTask(platform, config)
            self.tasks[platform] = task
            
            # Start loop task
            task.loop_task = asyncio.create_task(task.run_loop(self))
            return True

    async def stop(self, platform: Optional[str] = None) -> bool:
        async with self._lock:
            if platform:
                if platform not in self.tasks:
                    return False
                await self.tasks[platform].stop(self)
                return True
            else:
                # Stop all tasks
                tasks_to_stop = [t for t in self.tasks.values() if t.status in ("running", "stopping")]
                if not tasks_to_stop:
                    return False
                await asyncio.gather(*(t.stop(self) for t in tasks_to_stop))
                return True

    def get_status(self, platform: Optional[str] = None) -> dict:
        if platform:
            task = self.tasks.get(platform)
            if task:
                return {
                    "status": task.status,
                    "platform": task.platform,
                    "crawler_type": task.config.crawler_type.value,
                    "started_at": task.started_at.isoformat() if task.started_at else None,
                    "error_message": None,
                    "run_id": task.current_run_id or task.last_run_id,
                }
            return {
                "status": "idle",
                "platform": platform,
                "crawler_type": None,
                "started_at": None,
                "error_message": None,
                "run_id": None,
            }

        # Bulk status
        return {
            "status": self.status,
            "platform_states": {
                p: {
                    "status": t.status,
                    "platform": t.platform,
                    "crawler_type": t.config.crawler_type.value,
                    "started_at": t.started_at.isoformat() if t.started_at else None,
                    "error_message": None,
                    "run_id": t.current_run_id or t.last_run_id,
                } for p, t in self.tasks.items()
            }
        }

    @staticmethod
    def _build_worker_command() -> list[str]:
        import sys
        if getattr(sys, 'frozen', False):
            return [sys.executable, "--worker"]
        return [sys.executable, "-m", "api.crawler_worker"]


# Global singleton
crawler_manager = CrawlerManager()
