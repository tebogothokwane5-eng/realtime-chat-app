const currentUserElement = document.getElementById("current-user");
const usersListElement = document.getElementById("users-list");
const conversationNameElement = document.getElementById("conversation-name");
const conversationStatusElement = document.getElementById("conversation-status");
const messagesElement = document.getElementById("messages");

const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");
const emojiButton = document.getElementById("emoji-button");
const emojiPicker = document.getElementById("emoji-picker");
const imageButton = document.getElementById("image-button");
const imageInput = document.getElementById("image-input");
const videoButton = document.getElementById("video-button");
const videoInput = document.getElementById("video-input");
const voiceButton = document.getElementById("voice-button");
const voiceTimer = document.getElementById("voice-timer");

const startVoiceCallButton =
    document.getElementById("start-voice-call");

const startVideoCallButton =
    document.getElementById("start-video-call");

const imageViewer = document.getElementById("image-viewer");
const imageViewerImage =
    document.getElementById("image-viewer-image");
const imageViewerName =
    document.getElementById("image-viewer-name");
const imageViewerClose =
    document.getElementById("image-viewer-close");

const logoutButton = document.getElementById("logout-button");

const replyPreviewElement =
    document.getElementById("reply-preview");
const replyPreviewNameElement =
    document.getElementById("reply-preview-name");
const replyPreviewContentElement =
    document.getElementById("reply-preview-content");
const cancelReplyButton =
    document.getElementById("cancel-reply-button");

let currentUser = null;
let selectedUser = null;
let onlineUserIds = new Set();
let unreadCounts = new Map();
let typingTimeout = null;
let typingSent = false;
let replyingToMessage = null;

let mediaRecorder = null;
let microphoneStream = null;
let audioChunks = [];
let recordingStartTime = null;
let recordingTimerInterval = null;
let recordingTimeout = null;
let recordingReceiverId = null;

const MAX_RECORDING_DURATION_MS = 5 * 60 * 1000;

const socket = io();


async function loadCurrentUser() {
    const response = await fetch("/auth/me");

    if (!response.ok) {
        window.location.href = "/login";
        return false;
    }

    const data = await response.json();
    currentUser = data.user;

    currentUserElement.textContent = `@${currentUser.username}`;

    return true;
}



// Group chat sidebar
const groupsListElement = document.getElementById("groups-list");
const createGroupButton = document.getElementById("create-group-button");

let selectedGroup = null;

async function loadGroups() {
    if (!groupsListElement) {
        return;
    }

    try {
        const response = await fetch("/groups/");

        if (!response.ok) {
            throw new Error("Failed to load groups");
        }

        const data = await response.json();

        groupsListElement.innerHTML = "";

        if (!data.groups || data.groups.length === 0) {
            groupsListElement.innerHTML =
                '<p class="empty-text">No groups yet.</p>';
            return;
        }

        data.groups.forEach((group) => {
            const groupElement = document.createElement("div");

            groupElement.className = "user-item group-item";
            groupElement.dataset.groupId = group.id;

            const nameElement = document.createElement("div");
            nameElement.className = "user-name";
            nameElement.textContent = "👥 " + group.name;

            const detailsElement = document.createElement("div");
            detailsElement.className = "user-status";
            detailsElement.textContent =
                group.member_count + " members";

            groupElement.appendChild(nameElement);
            groupElement.appendChild(detailsElement);

            groupElement.addEventListener("click", () => {
                selectGroup(group, groupElement);
            });

            groupsListElement.appendChild(groupElement);
        });

    } catch (error) {
        console.error("Error loading groups:", error);

        groupsListElement.innerHTML =
            '<p class="empty-text">Could not load groups.</p>';
    }
}



// Open a group conversation
async function selectGroup(group, groupElement) {
    cancelReply();

    selectedUser = null;
    selectedGroup = group;

    updateCallButtons();

    document.querySelectorAll(".user-item").forEach((element) => {
        element.classList.remove("active");
    });

    groupElement.classList.add("active");

    conversationNameElement.textContent = group.name;
    conversationStatusElement.textContent =
        group.member_count + " members";

    messageInput.disabled = false;
    sendButton.disabled = false;
    emojiButton.disabled = false;

    // Group media messaging will be implemented separately.
    imageButton.disabled = true;
    videoButton.disabled = true;
    voiceButton.disabled = true;

    messagesElement.innerHTML =
        '<p class="empty-text">Loading group messages...</p>';

    try {
        const response = await fetch(
            `/groups/${group.id}/messages`
        );

        if (!response.ok) {
            throw new Error("Could not load group messages.");
        }

        const data = await response.json();

        messagesElement.innerHTML = "";

        if (!data.messages || data.messages.length === 0) {
            messagesElement.innerHTML =
                '<p class="empty-text">No messages yet. Say hello!</p>';
        } else {
            data.messages.forEach((message) => {
                const row = document.createElement("div");
                row.className = "message-row";

                const bubble = document.createElement("div");
                bubble.className = "message-bubble";

                const sender = document.createElement("strong");
                sender.textContent = message.sender_username;

                const content = document.createElement("div");
                content.textContent = message.content;

                bubble.appendChild(sender);
                bubble.appendChild(content);
                row.appendChild(bubble);

                messagesElement.appendChild(row);
            });
        }

        messagesElement.scrollTop = messagesElement.scrollHeight;

        if (socket.connected) {
            socket.emit("join_group", {
                group_id: group.id
            });
        }

        messageInput.focus();

    } catch (error) {
        console.error("Group conversation error:", error);

        messagesElement.innerHTML =
            '<p class="empty-text">Could not load group conversation.</p>';
    }
}



// Create a group using a single dialog.
createGroupButton.addEventListener("click", async () => {
    try {
        const usersResponse = await fetch("/chat/users");

        if (!usersResponse.ok) {
            throw new Error("Could not load available users.");
        }

        const usersData = await usersResponse.json();
        const users = usersData.users || [];

        if (users.length === 0) {
            alert("No other users are available.");
            return;
        }

        const overlay = document.createElement("div");
        overlay.style.cssText = `
            position: fixed;
            inset: 0;
            background: rgba(0, 0, 0, 0.65);
            display: flex;
            align-items: center;
            justify-content: center;
            z-index: 10000;
        `;

        const dialog = document.createElement("div");
        dialog.style.cssText = `
            background: white;
            color: #222;
            padding: 24px;
            border-radius: 14px;
            width: 380px;
            max-width: 90%;
            max-height: 85vh;
            overflow-y: auto;
            box-sizing: border-box;
        `;

        const heading = document.createElement("h3");
        heading.textContent = "Create New Group";
        heading.style.marginTop = "0";

        const nameLabel = document.createElement("label");
        nameLabel.textContent = "Group Name";
        nameLabel.style.display = "block";
        nameLabel.style.marginBottom = "8px";

        const nameInput = document.createElement("input");
        nameInput.type = "text";
        nameInput.placeholder = "Enter group name";
        nameInput.maxLength = 100;
        nameInput.style.cssText = `
            width: 100%;
            padding: 12px;
            margin-bottom: 20px;
            border: 1px solid #ccc;
            border-radius: 8px;
            box-sizing: border-box;
        `;

        const membersHeading = document.createElement("h4");
        membersHeading.textContent = "Select Members";

        const checkboxes = [];

        const membersContainer = document.createElement("div");
        membersContainer.style.cssText = `
            max-height: 220px;
            overflow-y: auto;
            border: 1px solid #ddd;
            border-radius: 8px;
        `;

        users.forEach(user => {
            const label = document.createElement("label");
            label.style.cssText = `
                display: flex;
                align-items: center;
                gap: 12px;
                padding: 12px;
                cursor: pointer;
                border-bottom: 1px solid #eee;
            `;

            const checkbox = document.createElement("input");
            checkbox.type = "checkbox";
            checkbox.value = user.id;

            const username = document.createElement("span");
            username.textContent = user.username || user.email;

            label.appendChild(checkbox);
            label.appendChild(username);
            membersContainer.appendChild(label);

            checkboxes.push(checkbox);
        });

        const buttonContainer = document.createElement("div");
        buttonContainer.style.cssText = `
            display: flex;
            gap: 10px;
            margin-top: 20px;
        `;

        const cancelButton = document.createElement("button");
        cancelButton.textContent = "Cancel";
        cancelButton.style.cssText = `
            flex: 1;
            padding: 12px;
            border: 1px solid #ccc;
            border-radius: 8px;
            background: #eee;
            cursor: pointer;
        `;

        const createButton = document.createElement("button");
        createButton.textContent = "Create Group";
        createButton.style.cssText = `
            flex: 1;
            padding: 12px;
            border: none;
            border-radius: 8px;
            background: #2563eb;
            color: white;
            cursor: pointer;
        `;

        buttonContainer.appendChild(cancelButton);
        buttonContainer.appendChild(createButton);

        dialog.appendChild(heading);
        dialog.appendChild(nameLabel);
        dialog.appendChild(nameInput);
        dialog.appendChild(membersHeading);
        dialog.appendChild(membersContainer);
        dialog.appendChild(buttonContainer);

        overlay.appendChild(dialog);
        document.body.appendChild(overlay);

        nameInput.focus();

        let submitting = false;

        const closeDialog = () => {
            if (!submitting) {
                overlay.remove();
            }
        };

        cancelButton.addEventListener("click", closeDialog);

        overlay.addEventListener("click", event => {
            if (event.target === overlay) {
                closeDialog();
            }
        });

        createButton.addEventListener("click", async () => {
            if (submitting) return;

            const groupName = nameInput.value.trim();

            if (!groupName || groupName.length > 100) {
                alert("Enter a group name (1 to 100 characters).");
                return;
            }

            const memberIds = checkboxes
                .filter(checkbox => checkbox.checked)
                .map(checkbox => Number(checkbox.value));

            if (memberIds.length === 0) {
                alert("Select at least one group member.");
                return;
            }

            submitting = true;
            createButton.disabled = true;
            createButton.textContent = "Creating...";

            try {
                const response = await fetch("/groups/create", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({
                        name: groupName,
                        member_ids: memberIds
                    })
                });

                const data = await response.json();

                if (!response.ok) {
                    throw new Error(
                        data.error || "Could not create group."
                    );
                }

                overlay.remove();
                await loadGroups();
                alert("Group created successfully!");

            } catch (error) {
                console.error("Create Group error:", error);
                alert(error.message);

            } finally {
                submitting = false;
                createButton.disabled = false;
                createButton.textContent = "Create Group";
            }
        });

    } catch (error) {
        console.error("Create Group error:", error);
        alert(error.message);
    }
});


async function loadUsers() {
    const response = await fetch("/chat/users");

    if (!response.ok) {
        usersListElement.innerHTML =
            '<p class="empty-text">Could not load users.</p>';
        return;
    }

    const data = await response.json();

    usersListElement.innerHTML = "";

    if (data.users.length === 0) {
        usersListElement.innerHTML =
            '<p class="empty-text">No other users yet.</p>';
        return;
    }

    data.users.forEach((user) => {
        const unreadCount = Number(user.unread_count) || 0;

        if (unreadCount > 0) {
            unreadCounts.set(Number(user.id), unreadCount);
        } else {
            unreadCounts.delete(Number(user.id));
        }

        const userElement = document.createElement("div");

        userElement.className = "user-item";
        userElement.dataset.userId = user.id;

        const nameRow = document.createElement("div");
        nameRow.className = "user-item-name-row";

        const nameElement = document.createElement("div");
        nameElement.className = "user-item-name";
        nameElement.textContent = user.username;

        const unreadBadge = document.createElement("span");
        unreadBadge.className = "unread-badge";
        unreadBadge.dataset.unreadUserId = user.id;
        unreadBadge.hidden = true;

        nameRow.appendChild(nameElement);
        nameRow.appendChild(unreadBadge);

        const previewRow = document.createElement("div");
        previewRow.className = "user-preview-row";

        const previewElement = document.createElement("div");
        previewElement.className = "user-message-preview";
        previewElement.dataset.previewUserId = user.id;

        if (user.last_message) {
            const prefix =
                Number(user.last_message_sender_id) === Number(currentUser.id)
                    ? "You: "
                    : "";

            previewElement.textContent =
                `${prefix}${user.last_message}`;
        } else {
            previewElement.textContent = "No messages yet";
        }

        const timeElement = document.createElement("span");
        timeElement.className = "user-message-time";
        timeElement.dataset.previewTimeUserId = user.id;

        if (user.last_message_at) {
            timeElement.textContent =
                formatSidebarTime(user.last_message_at);
        }

        previewRow.appendChild(previewElement);
        previewRow.appendChild(timeElement);

        const statusElement = document.createElement("div");
        statusElement.className = "user-item-status";
        statusElement.dataset.statusUserId = user.id;

        userElement.appendChild(nameRow);
        userElement.appendChild(previewRow);
        userElement.appendChild(statusElement);

        updateUserStatus(user.id);

        userElement.addEventListener("click", () => {
            selectUser(user, userElement);
        });

        usersListElement.appendChild(userElement);
        updateUnreadBadge(user.id);
    });
}


async function selectUser(user, userElement) {
    cancelReply();

    // Leave the previous group when opening a private chat.
    if (selectedGroup && socket.connected) {
        socket.emit("leave_group", {
            group_id: selectedGroup.id
        });
    }

    selectedGroup = null;
    selectedUser = user;

    updateCallButtons();

    clearUnread(user.id);

    document.querySelectorAll(".user-item").forEach((element) => {
        element.classList.remove("active");
    });

    userElement.classList.add("active");

    conversationNameElement.textContent = user.username;
    updateConversationStatus();

    messageInput.disabled = false;
    sendButton.disabled = false;
    emojiButton.disabled = false;
    imageButton.disabled = false;
    videoButton.disabled = false;
    voiceButton.disabled = false;

    messageInput.focus();

    await loadConversation(user.id);

    markConversationRead(user.id);
}


async function loadConversation(userId) {
    messagesElement.innerHTML =
        '<p class="empty-text">Loading conversation...</p>';

    const response = await fetch(`/chat/conversation/${userId}`);

    if (!response.ok) {
        messagesElement.innerHTML =
            '<p class="empty-text">Could not load conversation.</p>';
        return;
    }

    const data = await response.json();

    messagesElement.innerHTML = "";

    if (data.messages.length === 0) {
        messagesElement.innerHTML =
            '<p class="empty-text">No messages yet. Say hello!</p>';
        return;
    }

    data.messages.forEach((message) => {
        renderMessage(message);
    });

    scrollToBottom();
}


function renderMessageReactions(messageId, reactions = []) {
    const row = document.querySelector(
        `[data-message-id="${messageId}"]`
    );

    if (!row) {
        return;
    }

    let container = row.querySelector(".message-reactions");

    if (!container) {
        container = document.createElement("div");
        container.className = "message-reactions";

        const bubble = row.querySelector(".message-bubble");

        if (!bubble) {
            return;
        }

        bubble.appendChild(container);
    }

    container.innerHTML = "";

    if (!reactions.length) {
        container.hidden = true;
        return;
    }

    const grouped = new Map();

    reactions.forEach((reaction) => {
        const emoji = reaction.emoji;

        if (!grouped.has(emoji)) {
            grouped.set(emoji, {
                count: 0,
                users: [],
                reactedByCurrentUser: false
            });
        }

        const group = grouped.get(emoji);

        group.count += 1;
        group.users.push(reaction.username);

        if (
            Number(reaction.user_id) ===
            Number(currentUser.id)
        ) {
            group.reactedByCurrentUser = true;
        }
    });

    grouped.forEach((group, emoji) => {
        const chip = document.createElement("button");

        chip.type = "button";
        chip.className = "message-reaction-chip";

        if (group.reactedByCurrentUser) {
            chip.classList.add("mine");
        }

        chip.textContent =
            group.count > 1
                ? `${emoji} ${group.count}`
                : emoji;

        chip.title = group.users.join(", ");

        chip.addEventListener("click", () => {
            reactToMessage(messageId, emoji);
        });

        container.appendChild(chip);
    });

    container.hidden = false;
}


function renderMessage(message) {
    const existingMessage =
        document.querySelector(`[data-message-id="${message.id}"]`);

    if (existingMessage) {
        return;
    }

    const emptyMessage = messagesElement.querySelector(".empty-text");

    if (emptyMessage) {
        emptyMessage.remove();
    }

    const row = document.createElement("div");

    row.className =
        message.sender_id === currentUser.id
            ? "message-row sent"
            : "message-row received";

    row.dataset.messageId = message.id;

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    if (message.reply_to) {
        const replyQuote = document.createElement("div");
        replyQuote.className = "message-reply-quote";

        const replyName = document.createElement("div");
        replyName.className = "message-reply-name";

        const replyIsCurrentUser =
            Number(message.reply_to.sender_id) ===
            Number(currentUser.id);

        replyName.textContent = replyIsCurrentUser
            ? "You"
            : message.reply_to.sender_username;

        const replyContent = document.createElement("div");
        replyContent.className = "message-reply-content";

        replyContent.textContent = message.reply_to.deleted
            ? "Original message deleted"
            : message.reply_to.content;

        if (message.reply_to.deleted) {
            replyQuote.classList.add("deleted-reply");
        }

        replyQuote.dataset.replyToMessageId =
            message.reply_to.id;

        replyQuote.appendChild(replyName);
        replyQuote.appendChild(replyContent);
        bubble.appendChild(replyQuote);
    }

    const content = document.createElement("div");
    content.className = "message-content";
    content.dataset.contentMessageId = message.id;

    if (
        message.message_type === "image"
        && message.image_url
    ) {
        content.classList.add("image-message-content");

        const image = document.createElement("img");
        image.className = "chat-message-image";
        image.src = message.image_url;
        image.alt =
            message.image_original_name || "Shared image";
        image.loading = "lazy";

        image.addEventListener("click", () => {
            imageViewerImage.src = message.image_url;
            imageViewerImage.alt =
                message.image_original_name || "Shared image";

            imageViewerName.textContent =
                message.image_original_name || "";

            imageViewer.hidden = false;
            imageViewer.setAttribute(
                "aria-hidden",
                "false"
            );

            document.body.classList.add(
                "image-viewer-open"
            );
        });

        content.appendChild(image);

        if (message.image_original_name) {
            const imageName = document.createElement("div");
            imageName.className = "chat-image-name";
            imageName.textContent =
                message.image_original_name;

            content.appendChild(imageName);
        }
    } else if (
        message.message_type === "audio"
        && message.audio_url
    ) {
        content.classList.add("audio-message-content");

        const audio = document.createElement("audio");
        audio.className = "chat-message-audio";
        audio.controls = true;
        audio.preload = "metadata";
        audio.src = message.audio_url;

        audio.setAttribute(
            "aria-label",
            "Play voice note"
        );

        content.appendChild(audio);

        if (message.audio_duration_ms) {
            const duration = document.createElement("div");
            duration.className = "chat-audio-duration";

            const totalSeconds = Math.ceil(
                message.audio_duration_ms / 1000
            );

            const minutes = Math.floor(totalSeconds / 60);
            const seconds = totalSeconds % 60;

            duration.textContent =
                `${minutes}:${String(seconds).padStart(2, "0")}`;

            content.appendChild(duration);
        }
    } else if (
        message.message_type === "video"
        && message.video_url
    ) {
        content.classList.add("video-message-content");

        const video = document.createElement("video");
        video.className = "chat-message-video";
        video.src = message.video_url;
        video.controls = true;
        video.preload = "metadata";
        video.playsInline = true;

        video.setAttribute(
            "aria-label",
            "Play shared video"
        );

        content.appendChild(video);

        if (message.video_original_name) {
            const videoName = document.createElement("div");
            videoName.className = "chat-video-name";
            videoName.textContent = message.video_original_name;

            content.appendChild(videoName);
        }
    } else {
        content.textContent = message.content;
    }

    const meta = document.createElement("div");
    meta.className = "message-meta";

    const time = document.createElement("span");
    time.className = "message-time";
    time.textContent = formatTime(message.created_at);

    meta.appendChild(time);

    if (message.edited_at) {
        const edited = document.createElement("span");
        edited.className = "message-edited";
        edited.dataset.editedMessageId = message.id;
        edited.textContent = "Edited";
        meta.appendChild(edited);
    }

    if (Number(message.sender_id) === Number(currentUser.id)) {
        const receipt = document.createElement("span");
        receipt.className = "message-receipt";
        receipt.dataset.receiptMessageId = message.id;

        if (message.read_at) {
            receipt.textContent = "✓✓ Read";
            receipt.classList.add("read");
        } else {
            receipt.textContent = "✓ Sent";
        }

        meta.appendChild(receipt);
    }

    bubble.appendChild(content);
    bubble.appendChild(meta);
    row.appendChild(bubble);

    bubble.addEventListener("contextmenu", (event) => {
        event.preventDefault();

        showMessageContextMenu(
            message,
            event.clientX,
            event.clientY
        );
    });

    let longPressTimer = null;

    const cancelLongPress = () => {
        if (longPressTimer) {
            clearTimeout(longPressTimer);
            longPressTimer = null;
        }
    };

    bubble.addEventListener("touchstart", (event) => {
        const touch = event.touches[0];

        if (!touch) {
            return;
        }

        const x = touch.clientX;
        const y = touch.clientY;

        longPressTimer = setTimeout(() => {
            longPressTimer = null;
            showMessageContextMenu(message, x, y);
        }, 600);
    }, { passive: true });

    bubble.addEventListener("touchend", cancelLongPress);
    bubble.addEventListener("touchcancel", cancelLongPress);
    bubble.addEventListener("touchmove", cancelLongPress);

    messagesElement.appendChild(row);

    renderMessageReactions(
        message.id,
        message.reactions || []
    );

    scrollToBottom();
}


function startReply(message) {
    replyingToMessage = message;

    const isOwnMessage =
        Number(message.sender_id) === Number(currentUser.id);

    replyPreviewNameElement.textContent =
        isOwnMessage
            ? "Replying to yourself"
            : `Replying to ${selectedUser.username}`;

    replyPreviewContentElement.textContent =
        message.content;

    replyPreviewElement.hidden = false;

    messageInput.focus();
}


function cancelReply() {
    replyingToMessage = null;

    replyPreviewNameElement.textContent = "";
    replyPreviewContentElement.textContent = "";
    replyPreviewElement.hidden = true;
}


cancelReplyButton.addEventListener("click", () => {
    cancelReply();
    messageInput.focus();
});


function closeMessageContextMenu() {
    const existingMenu = document.querySelector(
        ".message-context-menu"
    );

    if (existingMenu) {
        existingMenu.remove();
    }
}


function reactToMessage(messageId, emoji) {
    socket.emit("react_message", {
        message_id: messageId,
        emoji: emoji
    });
}


function showMessageContextMenu(message, x, y) {
    closeMessageContextMenu();

    const menu = document.createElement("div");
    menu.className = "message-context-menu";

    const reactionPicker = document.createElement("div");
    reactionPicker.className = "message-reaction-picker";

    ["👍", "❤️", "😂", "😮", "😢", "🔥"].forEach((emoji) => {
        const reactionButton = document.createElement("button");

        reactionButton.type = "button";
        reactionButton.className = "message-reaction-option";
        reactionButton.textContent = emoji;
        reactionButton.title = `React with ${emoji}`;

        reactionButton.addEventListener("click", () => {
            reactToMessage(message.id, emoji);
            closeMessageContextMenu();
        });

        reactionPicker.appendChild(reactionButton);
    });

    menu.appendChild(reactionPicker);

    const replyMessage = document.createElement("button");
    replyMessage.type = "button";
    replyMessage.textContent = "Reply";

    replyMessage.addEventListener("click", () => {
        startReply(message);
        closeMessageContextMenu();
    });

    menu.appendChild(replyMessage);

    const deleteForMe = document.createElement("button");
    deleteForMe.type = "button";
    deleteForMe.textContent = "Delete for me";

    deleteForMe.addEventListener("click", () => {
        socket.emit("delete_message", {
            message_id: message.id,
            delete_type: "me"
        });

        closeMessageContextMenu();
    });

    menu.appendChild(deleteForMe);

    const isSender =
        Number(message.sender_id) === Number(currentUser.id);

    if (isSender) {
        if (message.message_type === "text") {
            const editMessage =
                document.createElement("button");

            editMessage.type = "button";
            editMessage.textContent = "Edit";

            editMessage.addEventListener("click", () => {
                closeMessageContextMenu();

                const newContent = window.prompt(
                    "Edit message:",
                    message.content
                );

                if (newContent === null) {
                    return;
                }

                const trimmedContent =
                    newContent.trim();

                if (!trimmedContent) {
                    window.alert(
                        "Message cannot be empty."
                    );
                    return;
                }

                if (
                    trimmedContent === message.content
                ) {
                    return;
                }

                socket.emit("edit_message", {
                    message_id: message.id,
                    content: trimmedContent
                });
            });

            menu.appendChild(editMessage);
        }

        const deleteForEveryone =
            document.createElement("button");

        deleteForEveryone.type = "button";
        deleteForEveryone.textContent =
            "Delete for everyone";
        deleteForEveryone.className =
            "delete-for-everyone";

        deleteForEveryone.addEventListener("click", () => {
            socket.emit("delete_message", {
                message_id: message.id,
                delete_type: "everyone"
            });

            closeMessageContextMenu();
        });

        menu.appendChild(deleteForEveryone);
    }

    document.body.appendChild(menu);

    const menuRect = menu.getBoundingClientRect();

    const left = Math.min(
        x,
        window.innerWidth - menuRect.width - 8
    );

    const top = Math.min(
        y,
        window.innerHeight - menuRect.height - 8
    );

    menu.style.left = `${Math.max(8, left)}px`;
    menu.style.top = `${Math.max(8, top)}px`;
}


document.addEventListener("click", (event) => {
    if (!event.target.closest(".message-context-menu")) {
        closeMessageContextMenu();
    }
});


window.addEventListener("resize", closeMessageContextMenu);
window.addEventListener("scroll", closeMessageContextMenu, true);


function markConversationRead(userId) {
    if (!userId) {
        return;
    }

    if (!socket.connected) {
        return;
    }

    socket.emit("mark_read", {
        sender_id: Number(userId)
    });
}


function updateReadReceipts(messageIds) {
    (messageIds || []).forEach((messageId) => {
        const receipt = document.querySelector(
            `[data-receipt-message-id="${messageId}"]`
        );

        if (!receipt) {
            return;
        }

        receipt.textContent = "✓✓ Read";
        receipt.classList.add("read");
    });
}


function updateConversationPreview(message) {
    if (!currentUser || !message) {
        return;
    }

    const isOutgoing =
        Number(message.sender_id) === Number(currentUser.id);

    const otherUserId = isOutgoing
        ? Number(message.receiver_id)
        : Number(message.sender_id);

    const previewElement = document.querySelector(
        `[data-preview-user-id="${otherUserId}"]`
    );

    const timeElement = document.querySelector(
        `[data-preview-time-user-id="${otherUserId}"]`
    );

    if (previewElement) {
        const prefix = isOutgoing ? "You: " : "";
        previewElement.textContent =
            `${prefix}${message.content}`;
    }

    if (timeElement && message.created_at) {
        timeElement.textContent =
            formatSidebarTime(message.created_at);
    }
}


function formatSidebarTime(timestamp) {
    const date = new Date(timestamp);

    return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });
}


function formatTime(timestamp) {
    const date = new Date(timestamp);

    return date.toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit"
    });
}


function scrollToBottom() {
    messagesElement.scrollTop = messagesElement.scrollHeight;
}


function incrementUnread(userId) {
    userId = Number(userId);

    const count = (unreadCounts.get(userId) || 0) + 1;
    unreadCounts.set(userId, count);

    updateUnreadBadge(userId);
}


function clearUnread(userId) {
    userId = Number(userId);

    unreadCounts.delete(userId);
    updateUnreadBadge(userId);
}


function updateUnreadBadge(userId) {
    const badge = document.querySelector(
        `[data-unread-user-id="${userId}"]`
    );

    if (!badge) {
        return;
    }

    const count = unreadCounts.get(Number(userId)) || 0;

    if (count > 0) {
        badge.textContent = count > 99 ? "99+" : String(count);
        badge.hidden = false;
    } else {
        badge.textContent = "";
        badge.hidden = true;
    }
}


function updateUserStatus(userId) {
    const statusElement = document.querySelector(
        `[data-status-user-id="${userId}"]`
    );

    if (!statusElement) {
        return;
    }

    if (onlineUserIds.has(Number(userId))) {
        statusElement.textContent = "● Online";
        statusElement.classList.add("online");
    } else {
        statusElement.textContent = "○ Offline";
        statusElement.classList.remove("online");
    }
}


function updateConversationStatus() {
    if (!selectedUser) {
        return;
    }

    if (onlineUserIds.has(Number(selectedUser.id))) {
        conversationStatusElement.textContent = "● Online";
        conversationStatusElement.classList.add("online");
    } else {
        conversationStatusElement.textContent = "○ Offline";
        conversationStatusElement.classList.remove("online");
    }
}


function refreshPresenceDisplay() {
    document.querySelectorAll("[data-status-user-id]").forEach((element) => {
        updateUserStatus(Number(element.dataset.statusUserId));
    });

    updateConversationStatus();
}


function closeEmojiPicker() {
    emojiPicker.hidden = true;
}


emojiButton.addEventListener("click", (event) => {
    event.stopPropagation();

    if (emojiButton.disabled) {
        return;
    }

    emojiPicker.hidden = !emojiPicker.hidden;
});


emojiPicker.addEventListener("click", (event) => {
    const emojiOption = event.target.closest("[data-emoji]");

    if (!emojiOption) {
        return;
    }

    const emoji = emojiOption.dataset.emoji;

    const start =
        messageInput.selectionStart ?? messageInput.value.length;

    const end =
        messageInput.selectionEnd ?? start;

    messageInput.setRangeText(
        emoji,
        start,
        end,
        "end"
    );

    messageInput.dispatchEvent(
        new Event("input", {
            bubbles: true
        })
    );

    closeEmojiPicker();
    messageInput.focus();
});


document.addEventListener("click", (event) => {
    if (!event.target.closest(".emoji-picker-wrapper")) {
        closeEmojiPicker();
    }
});


videoButton.addEventListener("click", () => {
    if (!selectedUser || videoButton.disabled) {
        return;
    }

    videoInput.click();
});


imageButton.addEventListener("click", () => {
    if (!selectedUser || imageButton.disabled) {
        return;
    }

    imageInput.click();
});


imageInput.addEventListener("change", async () => {
    const imageFile = imageInput.files[0];

    if (!imageFile) {
        return;
    }

    if (!selectedUser) {
        imageInput.value = "";
        return;
    }

    const allowedTypes = new Set([
        "image/png",
        "image/jpeg",
        "image/gif",
        "image/webp"
    ]);

    if (!allowedTypes.has(imageFile.type)) {
        alert(
            "Unsupported image type. " +
            "Use PNG, JPG, JPEG, GIF, or WebP."
        );

        imageInput.value = "";
        return;
    }

    const maxImageSize = 10 * 1024 * 1024;

    if (imageFile.size > maxImageSize) {
        alert("Image must be 10 MB or smaller.");
        imageInput.value = "";
        return;
    }

    const receiverId = selectedUser.id;
    const formData = new FormData();

    formData.append("receiver_id", receiverId);
    formData.append("image", imageFile);

    imageButton.disabled = true;

    try {
        const response = await fetch("/chat/send-image", {
            method: "POST",
            body: formData
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || "Could not send image."
            );
        }

        if (
            selectedUser
            && Number(selectedUser.id) === Number(receiverId)
            && data.data
        ) {
            renderMessage(data.data);
        }
    } catch (error) {
        console.error("Image upload failed:", error);
        alert(error.message || "Could not send image.");
    } finally {
        imageInput.value = "";

        if (selectedUser) {
            imageButton.disabled = false;
        }
    }
});


videoInput.addEventListener("change", async () => {
    const videoFile = videoInput.files[0];

    if (!videoFile) {
        return;
    }

    if (!selectedUser) {
        videoInput.value = "";
        return;
    }

    const allowedTypes = new Set([
        "video/mp4",
        "video/webm"
    ]);

    const extension = videoFile.name.split(".").pop().toLowerCase();

    if (
        !allowedTypes.has(videoFile.type) ||
        !["mp4", "webm"].includes(extension)
    ) {
        alert("Unsupported video type. Use MP4 or WebM.");
        videoInput.value = "";
        return;
    }

    const maxVideoSize = 50 * 1024 * 1024;

    if (videoFile.size === 0 || videoFile.size > maxVideoSize) {
        alert("Video must be larger than 0 bytes and no more than 50 MB.");
        videoInput.value = "";
        return;
    }

    const receiverId = selectedUser.id;
    const formData = new FormData();

    formData.append("receiver_id", receiverId);
    formData.append("video", videoFile);

    videoButton.disabled = true;

    try {
        const response = await fetch("/chat/send-video", {
            method: "POST",
            body: formData
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || "Could not send video."
            );
        }

        if (
            selectedUser
            && Number(selectedUser.id) === Number(receiverId)
            && data.data
        ) {
            renderMessage(data.data);
        }
    } catch (error) {
        console.error("Video upload failed:", error);
        alert(error.message || "Could not send video.");
    } finally {
        videoInput.value = "";

        if (selectedUser) {
            videoButton.disabled = false;
        }
    }
});


function sendTypingStatus(isTyping) {
    console.log("Sending typing event:", isTyping, "to:", selectedUser?.id);
    if (!selectedUser || !socket.connected) {
        return;
    }

    socket.emit("typing", {
        receiver_id: selectedUser.id,
        is_typing: isTyping
    });
}


messageInput.addEventListener("input", () => {
    if (!selectedUser) {
        return;
    }

    const hasText = messageInput.value.trim().length > 0;

    if (hasText && !typingSent) {
        typingSent = true;
        sendTypingStatus(true);
    }

    clearTimeout(typingTimeout);

    if (!hasText) {
        if (typingSent) {
            typingSent = false;
            sendTypingStatus(false);
        }

        return;
    }

    typingTimeout = setTimeout(() => {
        if (typingSent) {
            typingSent = false;
            sendTypingStatus(false);
        }
    }, 3000);
});


messageForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    if (!selectedUser && !selectedGroup) {
        return;
    }

    const content = messageInput.value.trim();

    if (!content) {
        return;
    }

    // Send a group message through Flask.
    if (selectedGroup) {
        const groupId = selectedGroup.id;

        try {
            const response = await fetch(
                `/groups/${groupId}/send`,
                {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    body: JSON.stringify({ content: content })
                }
            );

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.error || "Could not send group message."
                );
            }

            messageInput.value = "";
            messageInput.focus();

        } catch (error) {
            console.error("Group message error:", error);
            alert(error.message);
        }

        return;
    }

    if (typingSent) {
        typingSent = false;
        clearTimeout(typingTimeout);
        sendTypingStatus(false);
    }

    socket.emit("send_message", {
        receiver_id: selectedUser.id,
        content: content,
        reply_to_message_id: replyingToMessage
            ? replyingToMessage.id
            : null
    });

    messageInput.value = "";
    cancelReply();
    messageInput.focus();
});


socket.on("connect", () => {
    console.log("Socket.IO connected.");

    updateCallButtons();

    // Restore the selected group room after reconnection.
    if (selectedGroup) {
        socket.emit("join_group", {
            group_id: selectedGroup.id
        }, (response) => {
            if (!response || !response.success) {
                console.error("Could not rejoin group:", response);
            }
        });
    }

    // Restore private conversation read receipts.
    if (selectedUser) {
        markConversationRead(selectedUser.id);
    }
});



// Display group messages immediately through Socket.IO.
socket.on("new_group_message", (message) => {
    if (!selectedGroup) {
        return;
    }

    if (Number(message.group_id) !== Number(selectedGroup.id)) {
        return;
    }

    const emptyMessage = messagesElement.querySelector(".empty-text");

    if (emptyMessage) {
        emptyMessage.remove();
    }

    // Prevent displaying the same message twice.
    if (messagesElement.querySelector(
        `[data-group-message-id="${message.id}"]`
    )) {
        return;
    }

    const row = document.createElement("div");
    row.className = "message-row";
    row.dataset.groupMessageId = message.id;

    const isOwnMessage =
        currentUser &&
        Number(message.sender_id) === Number(currentUser.id);

    if (isOwnMessage) {
        row.classList.add("sent");
    }

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    const sender = document.createElement("strong");
    sender.textContent = message.sender_username;

    const content = document.createElement("div");
    content.textContent = message.content;

    bubble.appendChild(sender);
    bubble.appendChild(content);
    row.appendChild(bubble);

    messagesElement.appendChild(row);
    messagesElement.scrollTop = messagesElement.scrollHeight;
});


socket.on("online_users", (data) => {
    onlineUserIds = new Set(
        (data.user_ids || []).map(Number)
    );

    refreshPresenceDisplay();
});


socket.on("user_status", (data) => {
    const userId = Number(data.user_id);

    if (data.status === "online") {
        onlineUserIds.add(userId);
    } else {
        onlineUserIds.delete(userId);
    }

    updateUserStatus(userId);

    if (
        selectedUser &&
        Number(selectedUser.id) === userId
    ) {
        updateConversationStatus();
    }
});


socket.on("typing_status", (data) => {
    console.log("Received typing status:", data);
    if (
        !selectedUser ||
        Number(data.user_id) !== Number(selectedUser.id)
    ) {
        return;
    }

    if (data.is_typing) {
        conversationStatusElement.textContent =
            `${data.username} is typing...`;

        conversationStatusElement.classList.remove("online");
    } else {
        updateConversationStatus();
    }
});


socket.on("message_sent", (message) => {
    updateConversationPreview(message);

    if (
        selectedUser &&
        message.receiver_id === selectedUser.id
    ) {
        renderMessage(message);
    }
});


socket.on("new_message", (message) => {
    updateConversationPreview(message);

    if (
        selectedUser &&
        Number(message.sender_id) === Number(selectedUser.id)
    ) {
        renderMessage(message);
        markConversationRead(message.sender_id);
        return;
    }

    incrementUnread(message.sender_id);
});


socket.on("messages_read", (data) => {
    updateReadReceipts(data.message_ids);
});


socket.on("message_reaction", (data) => {
    renderMessageReactions(
        data.message_id,
        data.reactions || []
    );
});


socket.on("reaction_error", (data) => {
    window.alert(
        data.error || "Could not react to the message."
    );
});


socket.on("message_edited", (data) => {
    const content = document.querySelector(
        `[data-content-message-id="${data.message_id}"]`
    );

    if (content) {
        content.textContent = data.content;

        const row = content.closest(".message-row");
        const meta = row?.querySelector(".message-meta");

        if (
            meta &&
            !meta.querySelector(
                `[data-edited-message-id="${data.message_id}"]`
            )
        ) {
            const edited = document.createElement("span");
            edited.className = "message-edited";
            edited.dataset.editedMessageId = data.message_id;
            edited.textContent = "Edited";

            const receipt = meta.querySelector(".message-receipt");

            if (receipt) {
                meta.insertBefore(edited, receipt);
            } else {
                meta.appendChild(edited);
            }
        }
    }

    const replyQuotes = document.querySelectorAll(
        `[data-reply-to-message-id="${data.message_id}"]`
    );

    replyQuotes.forEach((replyQuote) => {
        if (replyQuote.classList.contains("deleted-reply")) {
            return;
        }

        const replyContent = replyQuote.querySelector(
            ".message-reply-content"
        );

        if (replyContent) {
            replyContent.textContent = data.content;
        }
    });

    // Refresh the latest conversation preview.
    loadUsers();
});


socket.on("edit_message_error", (data) => {
    window.alert(
        data.error || "Could not edit the message."
    );
});


socket.on("message_deleted", (data) => {
    const messageElement = document.querySelector(
        `[data-message-id="${data.message_id}"]`
    );

    if (messageElement) {
        messageElement.remove();
    }

    const replyQuotes = document.querySelectorAll(
        `[data-reply-to-message-id="${data.message_id}"]`
    );

    replyQuotes.forEach((replyQuote) => {
        const replyContent = replyQuote.querySelector(
            ".message-reply-content"
        );

        if (replyContent) {
            replyContent.textContent =
                "Original message deleted";
        }

        replyQuote.classList.add("deleted-reply");
    });

    if (messagesElement.children.length === 0) {
        messagesElement.innerHTML =
            '<p class="empty-text">No messages yet.</p>';
    }

    // Refresh sidebar previews and persistent unread counts.
    loadUsers();
});


socket.on("delete_message_error", (data) => {
    window.alert(
        data.error || "Could not delete the message."
    );
});


socket.on("error", (data) => {
    console.error("Socket error:", data);

    alert(data.error || "A chat error occurred.");
});


logoutButton.addEventListener("click", async () => {
    try {
        await fetch("/auth/logout", {
            method: "POST"
        });
    } finally {
        socket.disconnect();
        window.location.href = "/login";
    }
});


async function initializeChat() {
    try {
        const authenticated = await loadCurrentUser();

        if (!authenticated) {
            return;
        }

        await loadUsers();
        await loadGroups();

    } catch (error) {
        console.error("Chat initialization error:", error);

        window.location.href = "/login";
    }
}


initializeChat();


function closeImageViewer() {
    imageViewer.hidden = true;
    imageViewer.setAttribute("aria-hidden", "true");

    imageViewerImage.src = "";
    imageViewerName.textContent = "";

    document.body.classList.remove(
        "image-viewer-open"
    );
}


imageViewerClose.addEventListener("click", () => {
    closeImageViewer();
});


imageViewer.addEventListener("click", (event) => {
    if (event.target === imageViewer) {
        closeImageViewer();
    }
});


document.addEventListener("keydown", (event) => {
    if (
        event.key === "Escape"
        && !imageViewer.hidden
    ) {
        closeImageViewer();
    }
});


async function startVoiceRecording() {
    if (!selectedUser || mediaRecorder) {
        return;
    }

    if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia ||
        typeof MediaRecorder === "undefined"
    ) {
        alert("Your browser does not support microphone recording.");
        return;
    }

    const formats = [
        { mime: "audio/webm;codecs=opus", extension: "webm" },
        { mime: "audio/ogg;codecs=opus", extension: "ogg" },
        { mime: "audio/mp4", extension: "mp4" }
    ];

    const supportedFormat = formats.find(
        format => MediaRecorder.isTypeSupported(format.mime)
    );

    if (!supportedFormat) {
        alert("No supported audio recording format was found.");
        return;
    }

    voiceButton.disabled = true;

    try {
        microphoneStream = await navigator.mediaDevices.getUserMedia({
            audio: {
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: false
            }
        });

        recordingReceiverId = selectedUser.id;
        audioChunks = [];

        mediaRecorder = new MediaRecorder(
            microphoneStream,
            { mimeType: supportedFormat.mime }
        );

        mediaRecorder.audioExtension = supportedFormat.extension;

        mediaRecorder.addEventListener("dataavailable", event => {
            if (event.data.size > 0) {
                audioChunks.push(event.data);
            }
        });

        mediaRecorder.start();

        recordingStartTime = Date.now();

        voiceButton.textContent = "⏹";
        voiceButton.classList.add("recording");
        voiceButton.title = "Stop and send voice note";
        voiceButton.setAttribute(
            "aria-label",
            "Stop and send voice note"
        );
        voiceButton.disabled = false;

        voiceTimer.hidden = false;
        voiceTimer.textContent = "0:00";

        recordingTimerInterval = setInterval(() => {
            const elapsed = Date.now() - recordingStartTime;
            const seconds = Math.floor(elapsed / 1000);

            const minutes = Math.floor(seconds / 60);
            const remainingSeconds = seconds % 60;

            voiceTimer.textContent =
                `${minutes}:${String(remainingSeconds).padStart(2, "0")}`;
        }, 250);

        recordingTimeout = setTimeout(() => {
            if (mediaRecorder && mediaRecorder.state === "recording") {
                stopVoiceRecording();
            }
        }, MAX_RECORDING_DURATION_MS);

    } catch (error) {
        console.error("Microphone recording failed:", error);

        if (microphoneStream) {
            microphoneStream.getTracks().forEach(track => track.stop());
            microphoneStream = null;
        }

        mediaRecorder = null;
        recordingReceiverId = null;
        voiceButton.disabled = !selectedUser;

        alert(
            "Could not access your microphone. " +
            "Check your browser microphone permissions."
        );
    }
}


function stopVoiceRecording() {
    if (!mediaRecorder || mediaRecorder.state !== "recording") {
        return;
    }

    const recorder = mediaRecorder;
    const receiverId = recordingReceiverId;
    const durationMs = Math.max(
        1,
        Date.now() - recordingStartTime
    );

    clearInterval(recordingTimerInterval);
    clearTimeout(recordingTimeout);

    recordingTimerInterval = null;
    recordingTimeout = null;

    voiceButton.disabled = true;
    voiceButton.textContent = "🎤";
    voiceButton.classList.remove("recording");
    voiceButton.title = "Record voice note";
    voiceButton.setAttribute(
        "aria-label",
        "Record voice note"
    );

    voiceTimer.hidden = true;

    recorder.addEventListener("stop", async () => {
        const chunks = audioChunks;
        audioChunks = [];

        const audioBlob = new Blob(chunks, {
            type: recorder.mimeType
        });

        if (microphoneStream) {
            microphoneStream.getTracks().forEach(track => track.stop());
            microphoneStream = null;
        }

        mediaRecorder = null;
        recordingReceiverId = null;
        recordingStartTime = null;

        if (audioBlob.size === 0) {
            alert("No audio was recorded.");
            voiceButton.disabled = !selectedUser;
            return;
        }

        const extension = recorder.audioExtension || "webm";

        const audioFile = new File(
            [audioBlob],
            `voice-note.${extension}`,
            { type: recorder.mimeType }
        );

        const formData = new FormData();
        formData.append("receiver_id", receiverId);
        formData.append("audio", audioFile);
        formData.append("duration_ms", durationMs);

        try {
            const response = await fetch("/chat/send-audio", {
                method: "POST",
                body: formData
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.error || "Could not send voice note."
                );
            }

            if (
                selectedUser
                && Number(selectedUser.id) === Number(receiverId)
                && data.data
            ) {
                renderMessage(data.data);
            }

            console.log("Voice note sent successfully.");

        } catch (error) {
            console.error("Voice-note upload failed:", error);

            alert(
                error.message || "Could not send voice note."
            );

        } finally {
            voiceButton.disabled = !selectedUser;
        }
    }, { once: true });

    recorder.stop();
}


voiceButton.addEventListener("click", async () => {
    if (voiceButton.disabled || !selectedUser) {
        return;
    }

    if (mediaRecorder && mediaRecorder.state === "recording") {
        stopVoiceRecording();
    } else if (!mediaRecorder) {
        await startVoiceRecording();
    }
});


// ========================================
// Private voice and video call requests
// ========================================

let activeCallId = null;
let activeCallType = null;

function startPrivateCall(callType) {
    if (!selectedUser || selectedGroup) {
        alert("Select a private conversation first.");
        return;
    }

    if (!socket.connected) {
        alert("Connection lost. Please reconnect.");
        return;
    }

    if (activeCallId) {
        alert("You already have an active call.");
        return;
    }

    const recipientId = Number(selectedUser.id);

    startVoiceCallButton.disabled = true;
    startVideoCallButton.disabled = true;

    socket.emit(
        "call_user",
        {
            recipient_id: recipientId,
            call_type: callType
        },
        (response) => {
            if (!response || !response.success) {
                alert(
                    response?.error || "Could not start call."
                );

                startVoiceCallButton.disabled = !selectedUser;
                startVideoCallButton.disabled = !selectedUser;
                return;
            }

            activeCallId = response.call_id;
            activeCallType = callType;
            updateCallButtons();

            console.log(
                "Call request sent:",
                activeCallId,
                callType
            );

            alert(
                `${callType === "video" ? "Video" : "Voice"} `
                + `call request sent to ${selectedUser.username}.`
            );
        }
    );
}

startVoiceCallButton.addEventListener("click", () => {
    startPrivateCall("voice");
});

startVideoCallButton.addEventListener("click", () => {
    startPrivateCall("video");
});


// ========================================
// Incoming voice and video calls
// ========================================

socket.on("incoming_call", (data) => {
    console.log("Incoming call:", data);

    if (activeCallId) {
        socket.emit("reject_call", {
            call_id: data.call_id
        });
        return;
    }

    const callType = data.call_type === "video"
        ? "video"
        : "voice";

    const accepted = confirm(
        `${data.caller_username} is calling you.\n\n`
        + `Call type: ${callType}\n\n`
        + "Press OK to accept or Cancel to reject."
    );

    if (accepted) {
        activeCallId = data.call_id;
        activeCallType = callType;
        updateCallButtons();

        socket.emit(
            "accept_call",
            { call_id: data.call_id },
            (response) => {
                if (!response || !response.success) {
                    if (activeCallId === data.call_id) {
                        activeCallId = null;
                        cleanupWebRTCCall();
                        updateCallButtons();
                    }

                    alert(
                        response?.error || "Could not accept call."
                    );
                    return;
                }

                console.log(
                    "Incoming call accepted:",
                    activeCallId
                );
            }
        );
    } else {
        socket.emit(
            "reject_call",
            { call_id: data.call_id },
            (response) => {
                if (!response || !response.success) {
                    console.error(
                        "Could not reject call:",
                        response
                    );
                }
            }
        );
    }
});


// ========================================
// Handle rejected calls
// ========================================

socket.on("call_rejected", (data) => {
    if (data.call_id !== activeCallId) {
        return;
    }

    console.log("Call rejected:", data.call_id);

    activeCallId = null;
    cleanupWebRTCCall();
    updateCallButtons();

    startVoiceCallButton.disabled = !selectedUser;
    startVideoCallButton.disabled = !selectedUser;

    alert("Your call was rejected.");
});


// ========================================
// Handle accepted calls
// ========================================

socket.on("call_accepted", async (data) => {
    if (data.call_id !== activeCallId) {
        return;
    }

    console.log("Call accepted:", data.call_id);

    try {
        await createAndSendWebRTCOffer(
            data.call_id,
            activeCallType
        );

        console.log("WebRTC offer negotiation started.");

    } catch (error) {
        console.error(
            "Could not start WebRTC call:",
            error
        );

        alert(
            "WebRTC connection failed:\n"
            + (error?.name || "Error")
            + ": "
            + (error?.message || String(error))
        );

        socket.emit("end_call", {
            call_id: data.call_id
        });

        if (activeCallId === data.call_id) {
            activeCallId = null;
            cleanupWebRTCCall();
            updateCallButtons();
        }
    }
});


// ========================================
// Handle ended calls
// ========================================

socket.on("call_ended", (data) => {
    if (data.call_id !== activeCallId) {
        return;
    }

    console.log("Call ended:", data);

    activeCallId = null;
    cleanupWebRTCCall();
    updateCallButtons();

    startVoiceCallButton.disabled = !selectedUser || !!selectedGroup;
    startVideoCallButton.disabled = !selectedUser || !!selectedGroup;

    if (data.reason === "disconnected") {
        alert("Call ended because the other user disconnected.");
    } else {
        alert("Call ended.");
    }
});


// ========================================
// Hang Up button
// ========================================

const endCallButton =
    document.getElementById("end-call-button");

function updateCallButtons() {
    const inCall = !!activeCallId;
    const privateChat = !!selectedUser && !selectedGroup;

    startVoiceCallButton.disabled = !privateChat || inCall;
    startVideoCallButton.disabled = !privateChat || inCall;

    endCallButton.hidden = !inCall;
}

endCallButton.addEventListener("click", () => {
    if (!activeCallId) {
        return;
    }

    const callId = activeCallId;

    // Notify the other participant.
    socket.timeout(5000).emit(
        "end_call",
        { call_id: callId },
        (error, response) => {
            if (error || !response?.success) {
                console.warn(
                    "Could not confirm call ended on server:",
                    error || response?.error
                );
            }
        }
    );

    // End the local call immediately.
    activeCallId = null;
    cleanupWebRTCCall();
    endCallButton.disabled = false;
    updateCallButtons();

    console.log("Local call ended.");
});


// ========================================
// WebRTC configuration
// ========================================

const callMediaPanel =
    document.getElementById("call-media-panel");

const remoteVideo =
    document.getElementById("remote-video");

const localVideo =
    document.getElementById("local-video");

const remoteAudio =
    document.getElementById("remote-audio");

const rtcConfiguration = {
    iceServers: [
        {
            urls: "stun:stun.l.google.com:19302"
        }
    ]
};

let peerConnection = null;
let localCallStream = null;
let remoteCallStream = null;

function createPeerConnection() {
    if (peerConnection) {
        return peerConnection;
    }

    peerConnection = new RTCPeerConnection(
        rtcConfiguration
    );

    remoteCallStream = new MediaStream();

    remoteVideo.srcObject = remoteCallStream;
    remoteAudio.srcObject = remoteCallStream;

    peerConnection.onicecandidate = (event) => {
        if (!event.candidate || !activeCallId) {
            return;
        }

        socket.emit("webrtc_ice_candidate", {
            call_id: activeCallId,
            candidate: event.candidate.toJSON()
        });

        console.log("WebRTC ICE candidate sent.");
    };

    peerConnection.ontrack = (event) => {
        console.log("Remote media track received.");

        if (!remoteCallStream.getTracks().some(
            track => track.id === event.track.id
        )) {
            remoteCallStream.addTrack(event.track);
        }
    };

    const connection = peerConnection;

    connection.onconnectionstatechange = () => {
        const state = connection.connectionState;

        console.log("WebRTC connection state:", state);

        const status = document.getElementById("webrtc-status");

        if (status) {
            status.textContent = "WebRTC: " + state;
        }
    };

    console.log("WebRTC peer connection initialized.");

    return peerConnection;
}


// ========================================
// WebRTC microphone and camera access
// ========================================

async function startLocalCallMedia(callType) {
    if (localCallStream) {
        return localCallStream;
    }

    if (!navigator.mediaDevices?.getUserMedia) {
        throw new Error(
            "Microphone and camera access requires HTTPS or localhost."
        );
    }

    const constraints = {
        audio: {
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true
        },
        video: callType === "video"
    };

    const stream = await navigator.mediaDevices.getUserMedia(
        constraints
    );

    localCallStream = stream;

    localVideo.srcObject = stream;

    localVideo.hidden = callType !== "video";
    remoteVideo.hidden = callType !== "video";
    remoteAudio.hidden = callType === "video";

    // Only one remote media element should produce sound.
    remoteVideo.muted = callType !== "video";
    remoteAudio.muted = callType === "video";

    // Never play our own microphone through the preview.
    localVideo.muted = true;

    callMediaPanel.hidden = false;

    console.log(
        "Local microphone/camera activated:",
        callType
    );

    return stream;
}


// ========================================
// Attach local media to WebRTC
// ========================================

async function prepareWebRTCCall(callType) {
    if (peerConnection) {
        throw new Error(
            "A WebRTC connection is already active."
        );
    }

    const stream = await startLocalCallMedia(callType);

    const connection = createPeerConnection();

    stream.getTracks().forEach((track) => {
        connection.addTrack(track, stream);

        console.log(
            "Added WebRTC track:",
            track.kind
        );
    });

    console.log(
        "WebRTC media preparation completed:",
        callType
    );

    return connection;
}


// ========================================
// WebRTC media cleanup
// ========================================

function cleanupWebRTCCall() {
    if (peerConnection) {
        peerConnection.ontrack = null;
        peerConnection.onicecandidate = null;
        peerConnection.onconnectionstatechange = null;

        peerConnection.close();
        peerConnection = null;
    }

    if (localCallStream) {
        localCallStream.getTracks().forEach((track) => {
            track.stop();
        });

        localCallStream = null;
    }

    if (remoteCallStream) {
        remoteCallStream.getTracks().forEach((track) => {
            track.stop();
        });

        remoteCallStream = null;
    }

    localVideo.pause();
    remoteVideo.pause();
    remoteAudio.pause();

    localVideo.srcObject = null;
    remoteVideo.srcObject = null;
    remoteAudio.srcObject = null;

    callMediaPanel.hidden = true;

    pendingIceCandidates = [];
    activeCallType = null;

    console.log("WebRTC media cleaned up.");
}


// ========================================
// Receive WebRTC ICE candidates
// ========================================

let pendingIceCandidates = [];

async function flushPendingIceCandidates() {
    if (!peerConnection?.remoteDescription) {
        return;
    }

    while (pendingIceCandidates.length > 0) {
        const candidate = pendingIceCandidates.shift();

        try {
            await peerConnection.addIceCandidate(candidate);
        } catch (error) {
            console.error(
                "Failed to add queued ICE candidate:",
                error
            );
        }
    }
}

socket.on("webrtc_ice_candidate", async (data) => {
    if (!activeCallId || data.call_id !== activeCallId) {
        return;
    }

    if (!data.candidate) {
        return;
    }

    if (!peerConnection?.remoteDescription) {
        pendingIceCandidates.push(data.candidate);

        console.log("WebRTC ICE candidate queued.");
        return;
    }

    try {
        await peerConnection.addIceCandidate(
            data.candidate
        );

        console.log("WebRTC ICE candidate received.");
    } catch (error) {
        console.error(
            "Failed to add WebRTC ICE candidate:",
            error
        );
    }
});


// ========================================
// Create and send WebRTC offer
// ========================================

async function createAndSendWebRTCOffer(callId, callType) {
    if (!callId || activeCallId !== callId) {
        throw new Error("Call is no longer active.");
    }

    try {
        const connection = await prepareWebRTCCall(
            callType
        );

        if (activeCallId !== callId) {
            cleanupWebRTCCall();
            return;
        }

        const offer = await connection.createOffer();

        await connection.setLocalDescription(offer);

        if (activeCallId !== callId) {
            cleanupWebRTCCall();
            return;
        }

        socket.emit("webrtc_offer", {
            call_id: callId,
            offer: connection.localDescription.toJSON()
        }, (response) => {
            if (!response || !response.success) {
                console.error(
                    "WebRTC offer rejected:",
                    response?.error
                );
            } else {
                console.log("WebRTC offer sent successfully.");
            }
        });

    } catch (error) {
        console.error(
            "Failed to create WebRTC offer:",
            error
        );

        cleanupWebRTCCall();

        throw error;
    }
}


// ========================================
// Receive and answer WebRTC offers
// ========================================

socket.on("webrtc_offer", async (data) => {
    if (!activeCallId || data.call_id !== activeCallId) {
        return;
    }

    if (!data.offer || data.offer.type !== "offer") {
        console.error("Invalid WebRTC offer received.");
        return;
    }

    try {
        const connection = await prepareWebRTCCall(
            activeCallType
        );

        if (activeCallId !== data.call_id) {
            cleanupWebRTCCall();
            return;
        }

        await connection.setRemoteDescription(
            data.offer
        );

        await flushPendingIceCandidates();

        const answer = await connection.createAnswer();

        await connection.setLocalDescription(answer);

        if (activeCallId !== data.call_id) {
            cleanupWebRTCCall();
            return;
        }

        socket.emit("webrtc_answer", {
            call_id: data.call_id,
            answer: connection.localDescription.toJSON()
        }, (response) => {
            if (!response || !response.success) {
                console.error(
                    "WebRTC answer rejected:",
                    response?.error
                );
            } else {
                console.log("WebRTC answer sent successfully.");
            }
        });

    } catch (error) {
        console.error(
            "Failed to answer WebRTC offer:",
            error
        );

        socket.emit("end_call", {
            call_id: data.call_id
        });

        if (activeCallId === data.call_id) {
            activeCallId = null;
            cleanupWebRTCCall();
            updateCallButtons();
        }

        alert(
            "Could not establish the call. "
            + "Please check microphone and camera permissions."
        );
    }
});


// ========================================
// Receive WebRTC answers
// ========================================

socket.on("webrtc_answer", async (data) => {
    if (!activeCallId || data.call_id !== activeCallId) {
        return;
    }

    if (!data.answer || data.answer.type !== "answer") {
        console.error("Invalid WebRTC answer received.");
        return;
    }

    if (!peerConnection) {
        console.error("No WebRTC peer connection exists.");
        return;
    }

    try {
        if (peerConnection.signalingState !== "have-local-offer") {
            console.warn(
                "Ignoring WebRTC answer in state:",
                peerConnection.signalingState
            );
            return;
        }

        await peerConnection.setRemoteDescription(
            data.answer
        );

        await flushPendingIceCandidates();

        console.log(
            "SUCCESS: WebRTC answer applied.",
            peerConnection.connectionState
        );

    } catch (error) {
        console.error(
            "Failed to apply WebRTC answer:",
            error
        );

        socket.emit("end_call", {
            call_id: data.call_id
        });

        if (activeCallId === data.call_id) {
            activeCallId = null;
            cleanupWebRTCCall();
            updateCallButtons();
        }

        alert("Failed to establish the WebRTC connection.");
    }
});


// ========================================
// Clean up calls when Socket.IO disconnects
// ========================================

socket.on("disconnect", (reason) => {
    console.warn("Socket.IO disconnected:", reason);

    if (activeCallId || peerConnection || localCallStream) {
        activeCallId = null;
        cleanupWebRTCCall();
    }

    updateCallButtons();
});


// Media Sharing Dropdown Functionality

const mediaMenuButton = document.getElementById("media-menu-button");
const mediaDropdown = document.getElementById("media-dropdown");
const mediaImageOption = document.getElementById("media-image-option");
const mediaVideoOption = document.getElementById("media-video-option");

function closeMediaDropdown() {
    mediaDropdown.hidden = true;
    mediaMenuButton.setAttribute("aria-expanded", "false");
}

function updateMediaMenuState() {
    const unavailable = imageButton.disabled && videoButton.disabled;

    mediaMenuButton.disabled = unavailable;

    if (unavailable) {
        closeMediaDropdown();
    }
}

mediaMenuButton.addEventListener("click", () => {
    updateMediaMenuState();

    if (mediaMenuButton.disabled) return;

    mediaDropdown.hidden = !mediaDropdown.hidden;

    mediaMenuButton.setAttribute(
        "aria-expanded",
        String(!mediaDropdown.hidden)
    );
});

mediaImageOption.addEventListener("click", () => {
    closeMediaDropdown();

    if (!imageButton.disabled) {
        imageButton.click();
    }
});

mediaVideoOption.addEventListener("click", () => {
    closeMediaDropdown();

    if (!videoButton.disabled) {
        videoButton.click();
    }
});

document.addEventListener("click", (event) => {
    if (!event.target.closest(".media-sharing-container")) {
        closeMediaDropdown();
    }
});

document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeMediaDropdown();
    }
});

const mediaStateObserver = new MutationObserver(updateMediaMenuState);

mediaStateObserver.observe(imageButton, {
    attributes: true,
    attributeFilter: ["disabled"]
});

mediaStateObserver.observe(videoButton, {
    attributes: true,
    attributeFilter: ["disabled"]
});

updateMediaMenuState();
