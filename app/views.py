from flask import Blueprint, render_template, redirect, url_for
from flask_login import current_user


views_bp = Blueprint("views", __name__)


@views_bp.route("/login")
def login_page():
    if current_user.is_authenticated:
        return redirect(url_for("views.chat_page"))

    return render_template("login.html")


@views_bp.route("/register")
def register_page():
    if current_user.is_authenticated:
        return redirect(url_for("views.chat_page"))

    return render_template("register.html")


@views_bp.route("/chat")
def chat_page():
    if not current_user.is_authenticated:
        return redirect(url_for("views.login_page"))

    return render_template("chat.html")
