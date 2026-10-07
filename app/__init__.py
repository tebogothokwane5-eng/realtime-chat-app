from flask import Flask

from config import Config
from .extensions import db, login_manager, socketio, migrate


def create_app():
    app = Flask(__name__)
    app.config.from_object(Config)

    # Initialize extensions
    db.init_app(app)
    migrate.init_app(app, db)
    login_manager.init_app(app)
    socketio.init_app(app)

    # Flask-Login configuration
    login_manager.login_view = "views.login_page"

    # Import models
    from .models import User

    @login_manager.user_loader
    def load_user(user_id):
        return db.session.get(User, int(user_id))

    # Register blueprints
    from .auth import auth_bp
    from .chat import chat_bp
    from .views import views_bp

    app.register_blueprint(auth_bp)
    app.register_blueprint(chat_bp)
    app.register_blueprint(views_bp)

    @app.route("/")
    def home():
        return {
            "message": "Chat app backend is running!",
            "status": "success"
        }

    return app
