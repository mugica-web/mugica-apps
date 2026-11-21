# Hoops Rotation — basketball playing-time and position planner.
#
# A Blueprint is a self-contained piece of a Flask site: its own routes,
# templates and static files. app.py registers it to put it on the site.

from flask import Blueprint, render_template

hoops_rotation = Blueprint(
    "hoops_rotation",
    __name__,
    template_folder="templates",
    static_folder="static",
    static_url_path="/hoops-rotation/static",
)


@hoops_rotation.route("/hoops-rotation")
def index():
    return render_template("hoops_rotation/index.html")
