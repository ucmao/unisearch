import subprocess
import sys
import os
import shutil

def build():
    # 1. Build React frontend first
    print("Building React frontend...")
    webui_dir = os.path.join(os.getcwd(), "webui")
    
    # Run npm install if node_modules doesn't exist
    use_shell = os.name == 'nt'
    if not os.path.exists(os.path.join(webui_dir, "node_modules")):
        print("Installing WebUI dependencies...")
        subprocess.run(["npm", "install"], cwd=webui_dir, shell=use_shell, check=True)
        
    subprocess.run(["npm", "run", "build"], cwd=webui_dir, shell=use_shell, check=True)

    # 2. Run PyInstaller
    print("Running PyInstaller to compile Python backend...")
    hidden_imports = [
        "uvicorn.logging",
        "uvicorn.loops",
        "uvicorn.loops.auto",
        "uvicorn.loops.asyncio",
        "uvicorn.protocols",
        "uvicorn.protocols.http",
        "uvicorn.protocols.http.auto",
        "uvicorn.protocols.http.h11_impl",
        "uvicorn.protocols.websockets",
        "uvicorn.protocols.websockets.auto",
        "uvicorn.protocols.websockets.wsproto_impl",
        "uvicorn.lifespan",
        "uvicorn.lifespan.on",
        "uvicorn.lifespan.off",
        "sqlalchemy.dialects.sqlite",
        "sqlalchemy.dialects.sqlite.aiosqlite",
        "aiosqlite",
        "playwright",
        "playwright.async_api",
        "asyncio",
    ]

    # Handle path separator differences (colon on unix, semicolon on windows)
    sep = os.pathsep
    
    # Check if pyinstaller is installed in the current venv, if not try to install it
    try:
        subprocess.run([sys.executable, "-m", "PyInstaller", "--version"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=True)
    except (subprocess.CalledProcessError, FileNotFoundError):
        print("PyInstaller not found in current environment. Installing PyInstaller...")
        try:
            # Since the project contains uv.lock, uv is likely installed
            print("Attempting install via 'uv'...")
            subprocess.run(["uv", "pip", "install", "pyinstaller"], check=True)
        except Exception as e:
            print(f"uv install failed: {e}. Trying ensurepip + pip...")
            try:
                subprocess.run([sys.executable, "-m", "ensurepip", "--default-pip"], check=True)
                subprocess.run([sys.executable, "-m", "pip", "install", "pyinstaller"], check=True)
            except Exception as e2:
                print(f"Failed to bootstrap pip: {e2}. Please install pyinstaller manually in your venv.")
                sys.exit(1)

    cmd = [
        sys.executable,
        "-m",
        "PyInstaller",
        "--clean",
        "--noconfirm",
        "--name=unisearch-backend",
        "--distpath=dist",
        "--workpath=build",
        "--onedir",
        # Copy webui build folder
        "--add-data", f"api/webui{sep}api/webui",
    ]

    for imp in hidden_imports:
        cmd.extend(["--hidden-import", imp])

    cmd.append("api/main.py")

    print(f"Executing: {' '.join(cmd)}")
    subprocess.run(cmd, check=True)
    print("Backend build finished successfully!")

if __name__ == "__main__":
    build()
