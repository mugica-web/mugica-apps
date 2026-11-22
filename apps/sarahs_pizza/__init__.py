# Sarah's Pizza Shop — Isabel's pizza game.
#
# The game is one self-contained HTML file (index.html), so this serves it
# as-is rather than as a template.

from pathlib import Path
from flask import Blueprint, send_from_directory

sarahs_pizza = Blueprint("sarahs_pizza", __name__)

HERE = Path(__file__).parent


@sarahs_pizza.route("/sarahs-pizza")
def index():
    return send_from_directory(HERE, "index.html")
