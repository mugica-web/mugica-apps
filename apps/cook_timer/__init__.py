# Cook Timer — multi-dish step-by-step cooking timer.
#
# A Blueprint is a self-contained piece of a Flask site: its own routes,
# templates and static files. app.py registers it to put it on the site.

from flask import Blueprint, render_template

cook_timer = Blueprint(
    "cook_timer",
    __name__,
    template_folder="templates",
    static_folder="static",
    static_url_path="/cook-timer/static",
)


@cook_timer.route("/cook-timer")
def index():
    return render_template("cook_timer/index.html")
