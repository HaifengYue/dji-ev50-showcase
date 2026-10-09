"""Compatibility for the original PYTHONPATH=models/transwing/python."""
from pathlib import Path
import sys
_root = Path(__file__).resolve().parents[3] / "skytrans" / "python"
sys.path.insert(0, str(_root))
__path__ = [str(_root / "transwing_sim")]
from skytrans_sim import *
from skytrans_sim import __all__
