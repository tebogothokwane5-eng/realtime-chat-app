from sqlalchemy import or_, and_
from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user

from .extensions import db
from .models import User, Message


chat_bp = Blueprint("chat", __name__, url_prefix="/chat")


@chat_bp.route("/users", methods=["GET"])
@login_required
def users():
    users = (
        User.query
        .filter(User.id != current_user.id)
        .order_by(User.username.asc())
        .all()
    )

    return jsonify({
        "users": [
            {
                "id": user.id,
                "username": user.username,
                "email": user.email
            }
            for user in users
        ]
    }), 200


@chat_bp.route("/send", methods=["POST"])
@login_required
def send_message():
    data = request.get_json(silent=True) or {}

    receiver_id = data.get("receiver_id")
    content = data.get("content", "").strip()

    if not receiver_id or not content:
        return jsonify({
            "error": "receiver_id and content are required."
        }), 400

    try:
        receiver_id = int(receiver_id)
    except (TypeError, ValueError):
        return jsonify({
            "error": "receiver_id must be a valid integer."
        }), 400

    if receiver_id == current_user.id:
        return jsonify({
            "error": "You cannot send a message to yourself."
        }), 400

    receiver = db.session.get(User, receiver_id)

    if receiver is None:
        return jsonify({
            "error": "Receiver not found."
        }), 404

    message = Message(
        sender_id=current_user.id,
        receiver_id=receiver.id,
        content=content
    )

    db.session.add(message)
    db.session.commit()

    return jsonify({
        "message": "Message sent successfully.",
        "data": {
            "id": message.id,
            "sender_id": message.sender_id,
            "receiver_id": message.receiver_id,
            "content": message.content,
            "created_at": message.created_at.isoformat()
        }
    }), 201


@chat_bp.route("/conversation/<int:user_id>", methods=["GET"])
@login_required
def conversation(user_id):
    other_user = db.session.get(User, user_id)

    if other_user is None:
        return jsonify({
            "error": "User not found."
        }), 404

    messages = (
        Message.query
        .filter(
            or_(
                and_(
                    Message.sender_id == current_user.id,
                    Message.receiver_id == user_id
                ),
                and_(
                    Message.sender_id == user_id,
                    Message.receiver_id == current_user.id
                )
            )
        )
        .order_by(Message.created_at.asc(), Message.id.asc())
        .all()
    )

    return jsonify({
        "user": {
            "id": other_user.id,
            "username": other_user.username
        },
        "messages": [
            {
                "id": message.id,
                "sender_id": message.sender_id,
                "receiver_id": message.receiver_id,
                "content": message.content,
                "created_at": message.created_at.isoformat()
            }
            for message in messages
        ]
    }), 200


# ---------------------------------------------------------
# Socket.IO real-time chat
# ---------------------------------------------------------

from flask_socketio import join_room, emit
from .extensions import socketio


@socketio.on("connect")
def socket_connect():
    if not current_user.is_authenticated:
        return False

    # Every authenticated user gets a private room.
    room = f"user_{current_user.id}"
    join_room(room)

    print(
        f"Socket connected: {current_user.username} "
        f"(user {current_user.id})"
    )


@socketio.on("send_message")
def socket_send_message(data):
    if not current_user.is_authenticated:
        emit("error", {
            "error": "Authentication required."
        })
        return

    data = data or {}

    receiver_id = data.get("receiver_id")
    content = str(data.get("content", "")).strip()

    if not receiver_id or not content:
        emit("error", {
            "error": "receiver_id and content are required."
        })
        return

    try:
        receiver_id = int(receiver_id)
    except (TypeError, ValueError):
        emit("error", {
            "error": "receiver_id must be a valid integer."
        })
        return

    if receiver_id == current_user.id:
        emit("error", {
            "error": "You cannot send a message to yourself."
        })
        return

    receiver = db.session.get(User, receiver_id)

    if receiver is None:
        emit("error", {
            "error": "Receiver not found."
        })
        return

    message = Message(
        sender_id=current_user.id,
        receiver_id=receiver.id,
        content=content
    )

    db.session.add(message)
    db.session.commit()

    message_data = {
        "id": message.id,
        "sender_id": message.sender_id,
        "sender_username": current_user.username,
        "receiver_id": message.receiver_id,
        "content": message.content,
        "created_at": message.created_at.isoformat()
    }

    # Deliver immediately to the recipient's private room.
    emit(
        "new_message",
        message_data,
        to=f"user_{receiver.id}"
    )

    # Confirm the saved message back to the sender.
    emit(
        "message_sent",
        message_data
    )


@socketio.on("disconnect")
def socket_disconnect():
    if current_user.is_authenticated:
        print(
            f"Socket disconnected: {current_user.username} "
            f"(user {current_user.id})"
        )
