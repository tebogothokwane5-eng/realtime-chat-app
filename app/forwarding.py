from flask import Blueprint, request, jsonify
from flask_login import login_required, current_user

from .extensions import db, socketio
from .models import (
    User,
    Message,
    ChatGroup,
    GroupMember,
    GroupMessage,
)

forwarding_bp = Blueprint(
    "forwarding",
    __name__,
    url_prefix="/forward"
)


@forwarding_bp.route("/message", methods=["POST"])
@login_required
def forward_message():
    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({"error": "JSON object required."}), 400

    source_type = data.get("source_type")
    destination_type = data.get("destination_type")

    if source_type not in ("private", "group"):
        return jsonify({"error": "Invalid source type."}), 400

    if destination_type not in ("private", "group"):
        return jsonify({"error": "Invalid destination type."}), 400

    try:
        message_id = int(data.get("message_id"))
        destination_id = int(data.get("destination_id"))

        if message_id <= 0 or destination_id <= 0:
            raise ValueError

    except (TypeError, ValueError):
        return jsonify({"error": "Invalid message or destination ID."}), 400

    # Verify access to the original message.
    if source_type == "private":
        original = db.session.get(Message, message_id)

        if original is None:
            return jsonify({"error": "Message not found."}), 404

        if current_user.id not in (
            original.sender_id,
            original.receiver_id
        ):
            return jsonify({"error": "Access denied."}), 403

        if original.deleted_for_everyone_at is not None:
            return jsonify({"error": "Message unavailable."}), 403

        if (
            original.sender_id == current_user.id
            and original.deleted_for_sender_at is not None
        ):
            return jsonify({"error": "Message unavailable."}), 403

        if (
            original.receiver_id == current_user.id
            and original.deleted_for_receiver_at is not None
        ):
            return jsonify({"error": "Message unavailable."}), 403

    else:
        original = db.session.get(GroupMessage, message_id)

        if original is None:
            return jsonify({"error": "Message not found."}), 404

        source_membership = GroupMember.query.filter_by(
            group_id=original.group_id,
            user_id=current_user.id
        ).first()

        if source_membership is None:
            return jsonify({"error": "Access denied."}), 403

    # First version supports text messages.
    if original.message_type != "text":
        return jsonify({
            "error": "Media forwarding will be added next."
        }), 400

    if not original.content or not original.content.strip():
        return jsonify({"error": "Cannot forward an empty message."}), 400

    # Verify destination and construct the forwarded message.
    if destination_type == "private":
        receiver = db.session.get(User, destination_id)

        if receiver is None:
            return jsonify({"error": "Recipient not found."}), 404

        if receiver.id == current_user.id:
            return jsonify({
                "error": "Cannot forward to yourself."
            }), 400

        forwarded = Message(
            sender_id=current_user.id,
            receiver_id=receiver.id,
            content=original.content,
            message_type="text",
            is_forwarded=True
        )

    else:
        group = db.session.get(ChatGroup, destination_id)

        if group is None:
            return jsonify({"error": "Group not found."}), 404

        destination_membership = GroupMember.query.filter_by(
            group_id=group.id,
            user_id=current_user.id
        ).first()

        if destination_membership is None:
            return jsonify({
                "error": "You are not a member of the destination group."
            }), 403

        forwarded = GroupMessage(
            group_id=group.id,
            sender_id=current_user.id,
            content=original.content,
            message_type="text",
            is_forwarded=True
        )

    try:
        db.session.add(forwarded)
        db.session.commit()
    except Exception:
        db.session.rollback()
        return jsonify({"error": "Could not forward message."}), 500

    # Match the existing chat event payload structure.
    message_data = {
        "id": forwarded.id,
        "sender_id": current_user.id,
        "sender_username": current_user.username,
        "content": forwarded.content,
        "message_type": forwarded.message_type,
        "is_forwarded": True,
        "created_at": forwarded.created_at.isoformat(),
        "reply_to": None,
        "reactions": []
    }

    if destination_type == "private":
        message_data.update({
            "receiver_id": destination_id,
            "image_url": None,
            "image_original_name": None,
            "audio_url": None,
            "video_url": None,
            "read_at": None,
            "edited_at": None
        })

        socketio.emit(
            "new_message",
            message_data,
            to=f"user_{destination_id}"
        )

        socketio.emit(
            "message_sent",
            message_data,
            to=f"user_{current_user.id}"
        )

    else:
        message_data["group_id"] = destination_id

        socketio.emit(
            "new_group_message",
            message_data,
            to=f"group_{destination_id}"
        )

        # Notify group members about forwarded messages.
        socketio.emit(
            "group_message_notification",
            {
                "group_id": destination_id,
                "message_id": message_data["id"],
                "sender_id": current_user.id
            },
            to=f"group_notify_{destination_id}"
        )

    return jsonify({
        "message": "Message forwarded successfully.",
        "data": message_data
    }), 201
