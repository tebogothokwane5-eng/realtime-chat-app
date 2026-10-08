from datetime import datetime, timezone
from sqlalchemy import or_, and_
from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user

from .extensions import db
from .models import User, Message


chat_bp = Blueprint("chat", __name__, url_prefix="/chat")


def serialize_reply_for_viewer(reply_message, viewer_id):
    if reply_message is None:
        return None

    hidden_for_viewer = (
        reply_message.deleted_for_everyone_at is not None
        or (
            reply_message.sender_id == viewer_id
            and
            reply_message.deleted_for_sender_at is not None
        )
        or (
            reply_message.receiver_id == viewer_id
            and
            reply_message.deleted_for_receiver_at is not None
        )
    )

    if hidden_for_viewer:
        return {
            "id": reply_message.id,
            "sender_id": reply_message.sender_id,
            "sender_username": reply_message.sender.username,
            "content": None,
            "deleted": True
        }

    return {
        "id": reply_message.id,
        "sender_id": reply_message.sender_id,
        "sender_username": reply_message.sender.username,
        "content": reply_message.content,
        "deleted": False
    }


@chat_bp.route("/users", methods=["GET"])
@login_required
def users():
    users = (
        User.query
        .filter(User.id != current_user.id)
        .order_by(User.username.asc())
        .all()
    )

    users_data = []

    for user in users:
        last_message = (
            Message.query
            .filter(
                or_(
                    and_(
                        Message.sender_id == current_user.id,
                        Message.receiver_id == user.id,
                        Message.deleted_for_sender_at.is_(None)
                    ),
                    and_(
                        Message.sender_id == user.id,
                        Message.receiver_id == current_user.id,
                        Message.deleted_for_receiver_at.is_(None)
                    )
                ),
                Message.deleted_for_everyone_at.is_(None)
            )
            .order_by(Message.created_at.desc(), Message.id.desc())
            .first()
        )

        unread_count = (
            Message.query
            .filter(
                Message.sender_id == user.id,
                Message.receiver_id == current_user.id,
                Message.read_at.is_(None),
                Message.deleted_for_receiver_at.is_(None),
                Message.deleted_for_everyone_at.is_(None)
            )
            .count()
        )

        users_data.append({
            "id": user.id,
            "username": user.username,
            "email": user.email,
            "unread_count": unread_count,
            "last_message": (
                last_message.content
                if last_message
                else None
            ),
            "last_message_at": (
                last_message.created_at.isoformat()
                if last_message
                else None
            ),
            "last_message_sender_id": (
                last_message.sender_id
                if last_message
                else None
            )
        })

    return jsonify({
        "users": users_data
    }), 200


@chat_bp.route("/send", methods=["POST"])
@login_required
def send_message():
    data = request.get_json(silent=True) or {}

    receiver_id = data.get("receiver_id")
    content = data.get("content", "").strip()
    reply_to_message_id = data.get("reply_to_message_id")

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

    reply_to_message = None

    if reply_to_message_id is not None:
        try:
            reply_to_message_id = int(reply_to_message_id)
        except (TypeError, ValueError):
            return jsonify({
                "error": "Invalid reply message ID."
            }), 400

        reply_to_message = db.session.get(
            Message,
            reply_to_message_id
        )

        if reply_to_message is None:
            return jsonify({
                "error": "Reply message not found."
            }), 404

        same_conversation = (
            (
                reply_to_message.sender_id == current_user.id
                and
                reply_to_message.receiver_id == receiver.id
            )
            or
            (
                reply_to_message.sender_id == receiver.id
                and
                reply_to_message.receiver_id == current_user.id
            )
        )

        if not same_conversation:
            return jsonify({
                "error": "You cannot reply to that message."
            }), 403

        if reply_to_message.deleted_for_everyone_at is not None:
            return jsonify({
                "error": "You cannot reply to a deleted message."
            }), 400

        if (
            reply_to_message.sender_id == current_user.id
            and
            reply_to_message.deleted_for_sender_at is not None
        ):
            return jsonify({
                "error": "You cannot reply to a deleted message."
            }), 400

        if (
            reply_to_message.receiver_id == current_user.id
            and
            reply_to_message.deleted_for_receiver_at is not None
        ):
            return jsonify({
                "error": "You cannot reply to a deleted message."
            }), 400

    message = Message(
        sender_id=current_user.id,
        receiver_id=receiver.id,
        content=content,
        reply_to_message_id=(
            reply_to_message.id
            if reply_to_message
            else None
        )
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
            "created_at": message.created_at.isoformat(),
            "reply_to": (
                {
                    "id": reply_to_message.id,
                    "sender_id": reply_to_message.sender_id,
                    "sender_username": (
                        reply_to_message.sender.username
                    ),
                    "content": reply_to_message.content
                }
                if reply_to_message
                else None
            )
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
                    Message.receiver_id == user_id,
                    Message.deleted_for_sender_at.is_(None)
                ),
                and_(
                    Message.sender_id == user_id,
                    Message.receiver_id == current_user.id,
                    Message.deleted_for_receiver_at.is_(None)
                )
            ),
            Message.deleted_for_everyone_at.is_(None)
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
                "created_at": message.created_at.isoformat(),
                "read_at": (
                    message.read_at.isoformat()
                    if message.read_at
                    else None
                ),
                "edited_at": (
                    message.edited_at.isoformat()
                    if message.edited_at
                    else None
                ),
                "reply_to": serialize_reply_for_viewer(
                    message.reply_to_message,
                    current_user.id
                )
            }
            for message in messages
        ]
    }), 200


# ---------------------------------------------------------
# Socket.IO real-time chat
# ---------------------------------------------------------

from flask_socketio import join_room, emit
from .extensions import socketio


# Number of active Socket.IO connections for each user.
# This prevents a user with multiple browser tabs from being
# marked offline when only one tab disconnects.
online_users = {}


@socketio.on("connect")
def socket_connect():
    if not current_user.is_authenticated:
        return False

    user_id = current_user.id

    # Every authenticated user gets a private room.
    room = f"user_{user_id}"
    join_room(room)

    online_users[user_id] = online_users.get(user_id, 0) + 1

    # Tell connected clients that this user is online.
    emit(
        "user_status",
        {
            "user_id": user_id,
            "status": "online"
        },
        broadcast=True
    )

    # Give this newly connected client the current online-user list.
    emit(
        "online_users",
        {
            "user_ids": list(online_users.keys())
        }
    )

    print(
        f"Socket connected: {current_user.username} "
        f"(user {user_id})"
    )


@socketio.on("mark_read")
def socket_mark_read(data):
    if not current_user.is_authenticated:
        return

    data = data or {}

    try:
        sender_id = int(data.get("sender_id"))
    except (TypeError, ValueError):
        return

    if sender_id == current_user.id:
        return

    # Mark unread messages sent by this user to the current user.
    messages = db.session.execute(
        db.select(Message).where(
            Message.sender_id == sender_id,
            Message.receiver_id == current_user.id,
            Message.read_at.is_(None)
        )
    ).scalars().all()

    if not messages:
        return

    read_at = datetime.now(timezone.utc)

    message_ids = []

    for message in messages:
        message.read_at = read_at
        message_ids.append(message.id)

    db.session.commit()

    receipt_data = {
        "reader_id": current_user.id,
        "message_ids": message_ids,
        "read_at": read_at.isoformat()
    }

    # Tell the original sender that these messages were read.
    emit(
        "messages_read",
        receipt_data,
        to=f"user_{sender_id}"
    )

    # Also confirm to the reader's own connection.
    emit(
        "messages_read",
        receipt_data
    )


@socketio.on("typing")
def socket_typing(data):
    if not current_user.is_authenticated:
        return

    data = data or {}

    try:
        receiver_id = int(data.get("receiver_id"))
    except (TypeError, ValueError):
        return

    if receiver_id == current_user.id:
        return

    is_typing = bool(data.get("is_typing"))

    emit(
        "typing_status",
        {
            "user_id": current_user.id,
            "username": current_user.username,
            "is_typing": is_typing
        },
        to=f"user_{receiver_id}"
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
    reply_to_message_id = data.get("reply_to_message_id")

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

    reply_to_message = None

    if reply_to_message_id is not None:
        try:
            reply_to_message_id = int(reply_to_message_id)
        except (TypeError, ValueError):
            emit("error", {
                "error": "Invalid reply message ID."
            })
            return

        reply_to_message = db.session.get(
            Message,
            reply_to_message_id
        )

        if reply_to_message is None:
            emit("error", {
                "error": "Reply message not found."
            })
            return

        same_conversation = (
            (
                reply_to_message.sender_id == current_user.id
                and
                reply_to_message.receiver_id == receiver.id
            )
            or
            (
                reply_to_message.sender_id == receiver.id
                and
                reply_to_message.receiver_id == current_user.id
            )
        )

        if not same_conversation:
            emit("error", {
                "error": "You cannot reply to that message."
            })
            return

        if reply_to_message.deleted_for_everyone_at is not None:
            emit("error", {
                "error": "You cannot reply to a deleted message."
            })
            return

        if (
            reply_to_message.sender_id == current_user.id
            and
            reply_to_message.deleted_for_sender_at is not None
        ):
            emit("error", {
                "error": "You cannot reply to a deleted message."
            })
            return

        if (
            reply_to_message.receiver_id == current_user.id
            and
            reply_to_message.deleted_for_receiver_at is not None
        ):
            emit("error", {
                "error": "You cannot reply to a deleted message."
            })
            return

    message = Message(
        sender_id=current_user.id,
        receiver_id=receiver.id,
        content=content,
        reply_to_message_id=(
            reply_to_message.id
            if reply_to_message
            else None
        )
    )

    db.session.add(message)
    db.session.commit()

    message_data = {
        "id": message.id,
        "sender_id": message.sender_id,
        "sender_username": current_user.username,
        "receiver_id": message.receiver_id,
        "content": message.content,
        "created_at": message.created_at.isoformat(),
        "read_at": (
            message.read_at.isoformat()
            if message.read_at
            else None
        ),
        "edited_at": (
            message.edited_at.isoformat()
            if message.edited_at
            else None
        ),
    }

    receiver_message_data = {
        **message_data,
        "reply_to": serialize_reply_for_viewer(
            reply_to_message,
            receiver.id
        )
    }

    sender_message_data = {
        **message_data,
        "reply_to": serialize_reply_for_viewer(
            reply_to_message,
            current_user.id
        )
    }

    # Deliver immediately to the recipient's private room.
    emit(
        "new_message",
        receiver_message_data,
        to=f"user_{receiver.id}"
    )

    # Confirm the saved message back to the sender.
    emit(
        "message_sent",
        sender_message_data
    )


@socketio.on("delete_message")
def socket_delete_message(data):
    if not current_user.is_authenticated:
        emit("delete_message_error", {
            "error": "Authentication required."
        })
        return

    data = data or {}

    try:
        message_id = int(data.get("message_id"))
    except (TypeError, ValueError):
        emit("delete_message_error", {
            "error": "Invalid message ID."
        })
        return

    delete_type = data.get("delete_type")

    if delete_type not in ("me", "everyone"):
        emit("delete_message_error", {
            "error": "Invalid deletion type."
        })
        return

    message = db.session.get(Message, message_id)

    if message is None:
        emit("delete_message_error", {
            "error": "Message not found."
        })
        return

    is_sender = message.sender_id == current_user.id
    is_receiver = message.receiver_id == current_user.id

    # A user outside this conversation cannot delete the message.
    if not is_sender and not is_receiver:
        emit("delete_message_error", {
            "error": "You cannot delete this message."
        })
        return

    deleted_at = datetime.now(timezone.utc)

    if delete_type == "everyone":
        # Only the original sender may delete for everyone.
        if not is_sender:
            emit("delete_message_error", {
                "error": "Only the sender can delete for everyone."
            })
            return

        message.deleted_for_everyone_at = deleted_at
        db.session.commit()

        deletion_data = {
            "message_id": message.id,
            "delete_type": "everyone"
        }

        # Remove it immediately for the receiver.
        emit(
            "message_deleted",
            deletion_data,
            to=f"user_{message.receiver_id}"
        )

        # Remove it immediately for the sender.
        emit(
            "message_deleted",
            deletion_data
        )

        return

    # Delete only from the current user's view.
    if is_sender:
        message.deleted_for_sender_at = deleted_at
    else:
        message.deleted_for_receiver_at = deleted_at

    db.session.commit()

    emit(
        "message_deleted",
        {
            "message_id": message.id,
            "delete_type": "me"
        }
    )


@socketio.on("edit_message")
def socket_edit_message(data):
    if not current_user.is_authenticated:
        emit("edit_message_error", {
            "error": "Authentication required."
        })
        return

    data = data or {}

    try:
        message_id = int(data.get("message_id"))
    except (TypeError, ValueError):
        emit("edit_message_error", {
            "error": "Invalid message ID."
        })
        return

    content = str(data.get("content", "")).strip()

    if not content:
        emit("edit_message_error", {
            "error": "Message cannot be empty."
        })
        return

    message = db.session.get(Message, message_id)

    if message is None:
        emit("edit_message_error", {
            "error": "Message not found."
        })
        return

    # Only the original sender may edit a message.
    if message.sender_id != current_user.id:
        emit("edit_message_error", {
            "error": "You can only edit your own messages."
        })
        return

    # A message deleted for everyone can no longer be edited.
    if message.deleted_for_everyone_at is not None:
        emit("edit_message_error", {
            "error": "A deleted message cannot be edited."
        })
        return

    # A sender who deleted the message from their own view
    # should not be able to edit it afterward.
    if message.deleted_for_sender_at is not None:
        emit("edit_message_error", {
            "error": "A deleted message cannot be edited."
        })
        return

    message.content = content
    message.edited_at = datetime.now(timezone.utc)

    db.session.commit()

    edit_data = {
        "message_id": message.id,
        "sender_id": message.sender_id,
        "receiver_id": message.receiver_id,
        "content": message.content,
        "edited_at": message.edited_at.isoformat()
    }

    # Update the receiver immediately.
    emit(
        "message_edited",
        edit_data,
        to=f"user_{message.receiver_id}"
    )

    # Update the sender immediately.
    emit(
        "message_edited",
        edit_data
    )


@socketio.on("disconnect")
def socket_disconnect():
    if not current_user.is_authenticated:
        return

    user_id = current_user.id

    if user_id in online_users:
        online_users[user_id] -= 1

        if online_users[user_id] <= 0:
            del online_users[user_id]

            emit(
                "user_status",
                {
                    "user_id": user_id,
                    "status": "offline"
                },
                broadcast=True
            )

    print(
        f"Socket disconnected: {current_user.username} "
        f"(user {user_id})"
    )
