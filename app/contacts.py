from flask import Blueprint, jsonify, request
from flask_login import current_user, login_required
from sqlalchemy.exc import IntegrityError

from .extensions import db
from .models import Contact, User


contacts_bp = Blueprint(
    "contacts",
    __name__,
    url_prefix="/contacts"
)


@contacts_bp.route("/add", methods=["POST"])
@login_required
def add_contact():
    data = request.get_json(silent=True)

    if not isinstance(data, dict):
        return jsonify({
            "error": "A JSON object is required."
        }), 400

    username = data.get("username")

    if not isinstance(username, str) or not username.strip():
        return jsonify({
            "error": "Username is required."
        }), 400

    username = username.strip()

    user = User.query.filter_by(username=username).first()

    if user is None:
        return jsonify({
            "error": "User not found."
        }), 404

    if user.id == current_user.id:
        return jsonify({
            "error": "You cannot add yourself."
        }), 400

    existing = Contact.query.filter_by(
        owner_id=current_user.id,
        contact_user_id=user.id
    ).first()

    if existing:
        return jsonify({
            "error": "Contact already exists."
        }), 409

    contact = Contact(
        owner_id=current_user.id,
        contact_user_id=user.id
    )

    db.session.add(contact)

    try:
        db.session.commit()
    except IntegrityError:
        db.session.rollback()
        return jsonify({
            "error": "Contact already exists."
        }), 409

    return jsonify({
        "message": "Contact added successfully.",
        "contact": {
            "id": contact.id,
            "user_id": user.id,
            "username": user.username
        }
    }), 201


@contacts_bp.route("/", methods=["GET"])
@login_required
def list_contacts():
    contacts = (
        db.session.query(Contact, User)
        .join(User, Contact.contact_user_id == User.id)
        .filter(Contact.owner_id == current_user.id)
        .order_by(User.username.asc())
        .all()
    )

    return jsonify({
        "contacts": [
            {
                "id": contact.id,
                "user_id": user.id,
                "username": user.username
            }
            for contact, user in contacts
        ],
        "total": len(contacts)
    }), 200


@contacts_bp.route("/<int:contact_id>", methods=["DELETE"])
@login_required
def remove_contact(contact_id):
    contact = db.session.get(Contact, contact_id)

    if contact is None:
        return jsonify({
            "error": "Contact not found."
        }), 404

    if contact.owner_id != current_user.id:
        return jsonify({
            "error": "You cannot remove another user's contact."
        }), 403

    db.session.delete(contact)
    db.session.commit()

    return jsonify({
        "message": "Contact removed successfully.",
        "contact_id": contact_id
    }), 200
