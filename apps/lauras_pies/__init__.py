# Laura's Pies — Alicia's pie shop game.
#
# The game is one self-contained HTML file (index.html), so this serves it
# as-is rather than as a template.

from pathlib import Path
from flask import Blueprint, send_from_directory

lauras_pies = Blueprint("lauras_pies", __name__)

HERE = Path(__file__).parent


@lauras_pies.route("/lauras-pies")
def index():
    return send_from_directory(HERE, "index.html")
