# app.py — The Flask web server for mugica-apps, the family app site.
#
# Flask is a "micro web framework" — it lets us create a website
# with just a few lines of Python. It handles turning our Python code
# into something a web browser can display.
#
# This file only handles the site itself: the sign-in page and the
# dashboard. Each app lives in its own folder under apps/ and plugs in
# here as a "blueprint" (a bundle of routes, pages and styles).

import os
from flask import Flask, render_template
from dotenv import load_dotenv

from apps.cook_timer import cook_timer
from apps.taboo_jr import taboo_jr

# Load environment variables from .env file.
# This reads the .env file and makes its values available via os.environ.
# In production (e.g. Vercel), the env vars are set directly in the dashboard,
# so load_dotenv() simply finds nothing extra to load — no .env file needed there.
load_dotenv()

# Create our Flask application.
# __name__ tells Flask where to find our files (templates, static, etc.)
app = Flask(__name__)

# Plug in each app. To add a new one, create apps/<name>/, register it
# here, and add a tile to templates/dashboard.html.
app.register_blueprint(cook_timer)
app.register_blueprint(taboo_jr)


# Every page that signs in needs the Firebase API key. This makes it
# available to all templates as {{ firebase_api_key }}, so no route has
# to pass it along by hand.
@app.context_processor
def inject_firebase_api_key():
    return {"firebase_api_key": os.environ.get("FIREBASE_API_KEY")}


@app.route("/")
def login():
    return render_template("login.html")


@app.route("/dashboard")
def dashboard():
    return render_template("dashboard.html")


# This block runs only when you execute "python app.py" directly.
# It starts the development server on port 5000.
# debug=True means the server auto-restarts when you change code.
if __name__ == "__main__":
    app.run(debug=True)
