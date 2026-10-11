from datetime import datetime, timezone

from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required

from .extensions import db, socketio
from .models import User, ChatGroup, GroupMember, GroupMessage


groups_bp = Blueprint(
    "groups",
    __name__,
    url_prefix="/groups"
)



@groups_bp.route("/", methods=["GET"])
@login_required
def list_groups():
    memberships = (
        GroupMember.query
        .filter_by(user_id=current_user.id)
        .order_by(GroupMember.joined_at.desc())
        .all()
    )

    groups = []

    for membership in memberships:
        group = ChatGroup.query.get(membership.group_id)

        if group is None:
            continue

        member_count = GroupMember.query.filter_by(
            group_id=group.id
        ).count()

        groups.append({
            "id": group.id,
            "name": group.name,
            "created_by": group.created_by,
            "member_count": member_count,
            "role": membership.role,
            "created_at": group.created_at.isoformat()
        })

    return jsonify({"groups": groups}), 200


@groups_bp.route("/create", methods=["POST"])
@login_required
def create_group():
    data = request.get_json(silent=True) or {}

    name = data.get("name")
    member_ids = data.get("member_ids", [])

    if not isinstance(name, str) or not name.strip():
        return jsonify({
            "error": "Group name is required."
        }), 400

    name = name.strip()

    if len(name) > 100:
        return jsonify({
            "error": "Group name cannot exceed 100 characters."
        }), 400

    if not isinstance(member_ids, list):
        return jsonify({
            "error": "member_ids must be a list."
        }), 400

    try:
        member_ids = [int(user_id) for user_id in member_ids]
    except (TypeError, ValueError):
        return jsonify({
            "error": "All member IDs must be valid integers."
        }), 400

    member_ids = list(set(member_ids))
    member_ids = [
        user_id for user_id in member_ids
        if user_id != current_user.id
    ]

    if member_ids:
        existing_users = User.query.filter(
            User.id.in_(member_ids)
        ).all()

        if len(existing_users) != len(member_ids):
            return jsonify({
                "error": "One or more selected users do not exist."
            }), 404

    group = ChatGroup(
        name=name,
        created_by=current_user.id
    )

    db.session.add(group)
    db.session.flush()

    creator_membership = GroupMember(
        group_id=group.id,
        user_id=current_user.id,
        role="admin"
    )

    db.session.add(creator_membership)

    for user_id in member_ids:
        membership = GroupMember(
            group_id=group.id,
            user_id=user_id,
            role="member"
        )
        db.session.add(membership)

    db.session.commit()

    return jsonify({
        "message": "Group created successfully.",
        "group": {
            "id": group.id,
            "name": group.name,
            "created_by": group.created_by,
            "member_count": len(member_ids) + 1,
            "created_at": group.created_at.isoformat()
        }
    }), 201


@groups_bp.route("/<int:group_id>/messages", methods=["GET"])
@login_required
def get_group_messages(group_id):
    group = db.session.get(ChatGroup, group_id)

    if group is None:
        return jsonify({
            "error": "Group not found."
        }), 404

    membership = GroupMember.query.filter_by(
        group_id=group_id,
        user_id=current_user.id
    ).first()

    if membership is None:
        return jsonify({
            "error": "You are not a member of this group."
        }), 403

    messages = (
        GroupMessage.query
        .filter_by(group_id=group_id)
        .order_by(
            GroupMessage.created_at.asc(),
            GroupMessage.id.asc()
        )
        .limit(100)
        .all()
    )

    return jsonify({
        "group_id": group.id,
        "group_name": group.name,
        "messages": [
            {
                "id": message.id,
                "sender_id": message.sender_id,
                "sender_username": message.sender.username,
                "content": message.content,
                "message_type": message.message_type,
                "created_at": message.created_at.isoformat()
            }
            for message in messages
        ]
    }), 200


@groups_bp.route("/<int:group_id>/send", methods=["POST"])
@login_required
def send_group_message(group_id):
    group = db.session.get(ChatGroup, group_id)

    if group is None:
        return jsonify({
            "error": "Group not found."
        }), 404

    membership = GroupMember.query.filter_by(
        group_id=group_id,
        user_id=current_user.id
    ).first()

    if membership is None:
        return jsonify({
            "error": "You are not a member of this group."
        }), 403

    data = request.get_json(silent=True) or {}
    content = data.get("content")

    if not isinstance(content, str) or not content.strip():
        return jsonify({
            "error": "Message content is required."
        }), 400

    content = content.strip()

    if len(content) > 10000:
        return jsonify({
            "error": "Message cannot exceed 10000 characters."
        }), 400

    message = GroupMessage(
        group_id=group_id,
        sender_id=current_user.id,
        content=content,
        message_type="text"
    )

    db.session.add(message)
    db.session.commit()

    message_data = {
        "id": message.id,
        "group_id": message.group_id,
        "sender_id": message.sender_id,
        "sender_username": current_user.username,
        "content": message.content,
        "message_type": message.message_type,
        "created_at": message.created_at.isoformat()
    }

    socketio.emit(
        "new_group_message",
        message_data,
        to=f"group_{group_id}"
    )

    return jsonify({
        "message": "Group message sent successfully.",
        "data": message_data
    }), 201


# ---------------------------------------------------------
# Socket.IO group chat rooms
# ---------------------------------------------------------

from flask_socketio import join_room, leave_room, emit


@socketio.on("join_group")
def socket_join_group(data):
    if not current_user.is_authenticated:
        return {"error": "Authentication required."}

    data = data if isinstance(data, dict) else {}

    try:
        group_id = int(data.get("group_id"))
    except (TypeError, ValueError):
        return {"error": "Invalid group ID."}

    group = db.session.get(ChatGroup, group_id)

    if group is None:
        return {"error": "Group not found."}

    membership = GroupMember.query.filter_by(
        group_id=group_id,
        user_id=current_user.id
    ).first()

    if membership is None:
        return {"error": "You are not a member of this group."}

    room = f"group_{group_id}"

    join_room(room)

    emit("group_joined", {
        "group_id": group_id,
        "group_name": group.name
    })

    return {
        "success": True,
        "group_id": group_id
    }


@socketio.on("leave_group")
def socket_leave_group(data):
    if not current_user.is_authenticated:
        return {"error": "Authentication required."}

    data = data if isinstance(data, dict) else {}

    try:
        group_id = int(data.get("group_id"))
    except (TypeError, ValueError):
        return {"error": "Invalid group ID."}

    room = f"group_{group_id}"

    leave_room(room)

    emit("group_left", {
        "group_id": group_id
    })

    return {
        "success": True,
        "group_id": group_id
    }
