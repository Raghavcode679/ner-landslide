"""
Combined server - serves both frontend (built React) and backend API on one port.
This allows a single public URL via ngrok/localhost.run.

Usage:
    python serve.py
    
Then tunnel port 8000:
    ssh -o StrictHostKeyChecking=no -R 80:localhost:8000 nokey@localhost.run
"""
import os
import sys
import subprocess
import shutil
import uvicorn

# Paths
FRONTEND_DIR = os.path.join(os.path.dirname(__file__), '..', 'frontend')
DIST_DIR = os.path.join(FRONTEND_DIR, 'dist')
BACKEND_DIR = os.path.dirname(__file__)

def build_frontend():
    """Build React frontend if not already built."""
    if os.path.exists(DIST_DIR):
        print("[serve] Frontend dist/ already exists, skipping build.")
        return True
    
    print("[serve] Building React frontend...")
    try:
        subprocess.run(
            ["npm", "run", "build"],
            cwd=FRONTEND_DIR,
            check=True,
            capture_output=True,
            text=True,
        )
        print("[serve] Frontend built successfully!")
        return True
    except (subprocess.CalledProcessError, FileNotFoundError) as e:
        print(f"[serve] Frontend build failed: {e}")
        print("[serve] Make sure npm is installed and run 'cd frontend && npm install' first.")
        return False

def setup_static_serving():
    """Mount the built frontend as static files in FastAPI."""
    if not os.path.exists(DIST_DIR):
        print("[serve] dist/ not found. Running build first...")
        if not build_frontend():
            return False
    
    # Import the app
    sys.path.insert(0, BACKEND_DIR)
    from main import app
    from fastapi.staticfiles import StaticFiles
    from fastapi.responses import FileResponse
    
    # Mount built frontend assets
    app.mount("/assets", StaticFiles(directory=os.path.join(DIST_DIR, "assets")), name="static-assets")
    
    # Serve index.html for all non-API routes (SPA fallback)
    @app.get("/{full_path:path}")
    async def serve_frontend(full_path: str):
        # Don't serve frontend for API or WebSocket routes
        if full_path.startswith("api/") or full_path.startswith("ws/"):
            return {"error": "Not found"}
        
        # Try to serve the specific file
        file_path = os.path.join(DIST_DIR, full_path)
        if os.path.isfile(file_path):
            return FileResponse(file_path)
        
        # Fallback to index.html (SPA routing)
        index_path = os.path.join(DIST_DIR, "index.html")
        if os.path.isfile(index_path):
            return FileResponse(index_path)
        
        return {"error": "Frontend not built"}
    
    return app

if __name__ == "__main__":
    print("=" * 60)
    print("  NER Landslide Early Warning System")
    print("  Combined Server (API + Frontend)")
    print("=" * 60)
    
    app = setup_static_serving()
    if not app:
        print("Failed to set up server.")
        sys.exit(1)
    
    print("\n[serve] Starting combined server on http://0.0.0.0:8000")
    print("[serve] API docs: http://localhost:8000/docs")
    print("[serve] Frontend: http://localhost:8000")
    print()
    print("[serve] To share publicly, run in another terminal:")
    print("  ssh -o StrictHostKeyChecking=no -R 80:localhost:8000 nokey@localhost.run")
    print()
    
    uvicorn.run(app, host="0.0.0.0", port=8000, log_level="info")
