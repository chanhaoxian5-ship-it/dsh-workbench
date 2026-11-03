"""Stable launch path for MCP clients. No dependencies, no network listener."""
import sys
from pathlib import Path
sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "backend"))
from workbench.mcp import main
raise SystemExit(main())
