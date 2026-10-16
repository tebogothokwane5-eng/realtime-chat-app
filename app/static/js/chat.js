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
let recordingGroupId = null;

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

            // Display persistent unread group message count.
            const unreadBadge = document.createElement("span");
            unreadBadge.className = "unread-badge";
            unreadBadge.dataset.unreadGroupId = group.id;

            const unreadCount = Number(group.unread_count) || 0;
            unreadBadge.dataset.unreadCount = unreadCount;

            if (unreadCount > 0) {
                unreadBadge.textContent =
                    unreadCount > 99 ? "99+" : String(unreadCount);
                unreadBadge.hidden = false;
            } else {
                unreadBadge.hidden = true;
            }

            groupElement.appendChild(unreadBadge);

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



// Display saved and real-time group message reactions.
function renderGroupMessageReactions(messageId, reactions) {
    const row = messagesElement.querySelector(
        `[data-group-message-id="${messageId}"]`
    );

    if (!row) {
        return;
    }

    const reactionBar = row.querySelector(".group-saved-reactions");

    if (!reactionBar) {
        return;
    }

    let container = reactionBar.querySelector(".group-reaction-counts");

    if (!container) {
        container = document.createElement("div");
        container.className = "group-reaction-counts";
        reactionBar.appendChild(container);
    }

    container.innerHTML = "";

    const grouped = new Map();

    (reactions || []).forEach((reaction) => {
        const emoji = reaction.emoji;

        if (!grouped.has(emoji)) {
            grouped.set(emoji, { count: 0, mine: false });
        }

        const item = grouped.get(emoji);
        item.count++;

        if (
            currentUser &&
            Number(reaction.user_id) === Number(currentUser.id)
        ) {
            item.mine = true;
        }
    });

    grouped.forEach((item, emoji) => {
        const chip = document.createElement("button");

        chip.type = "button";
        chip.className = "message-reaction-chip";

        if (item.mine) {
            chip.classList.add("mine");
        }

        chip.textContent = item.count > 1
            ? `${emoji} ${item.count}`
            : emoji;

        chip.addEventListener("click", () => {
            socket.emit("react_group_message", {
                message_id: messageId,
                emoji: emoji
            });
        });

        container.appendChild(chip);
    });
}

// Render text, images, and videos in group conversations.
function renderGroupMessage(message) {
    if (messagesElement.querySelector(
        `[data-group-message-id="${message.id}"]`
    )) {
        return;
    }

    const emptyMessage = messagesElement.querySelector(".empty-text");

    if (emptyMessage) {
        emptyMessage.remove();
    }

    const row = document.createElement("div");
    row.className = "message-row";
    row.dataset.groupMessageId = message.id;

    if (
        currentUser &&
        Number(message.sender_id) === Number(currentUser.id)
    ) {
        row.classList.add("sent");
    }

    const bubble = document.createElement("div");
    bubble.className = "message-bubble";

    const sender = document.createElement("strong");
    sender.textContent = message.sender_username;

    bubble.appendChild(sender);

    // Identify messages forwarded from another conversation.
    if (message.is_forwarded) {
        const forwardedLabel = document.createElement("div");
        forwardedLabel.className = "forwarded-label";
        forwardedLabel.textContent = "↪ Forwarded";
        forwardedLabel.style.cssText = `
            font-size: 12px;
            font-style: italic;
            opacity: 0.75;
            margin-top: 5px;
            margin-bottom: 5px;
        `;

        bubble.appendChild(forwardedLabel);
    }

    // Display the original message when this is a group reply.
    if (message.reply_to) {
        const quotedMessage = document.createElement("div");
        quotedMessage.className = "group-reply-quote";

        quotedMessage.style.borderLeft = "3px solid #4caf50";
        quotedMessage.style.padding = "6px 10px";
        quotedMessage.style.margin = "8px 0";
        quotedMessage.style.borderRadius = "4px";
        quotedMessage.style.background = "rgba(128, 128, 128, 0.15)";

        const quotedSender = document.createElement("strong");
        quotedSender.textContent =
            message.reply_to.sender_username || "Unknown user";

        const quotedContent = document.createElement("div");
        quotedContent.textContent =
            message.reply_to.content || "Media message";

        quotedMessage.appendChild(quotedSender);
        quotedMessage.appendChild(quotedContent);

        bubble.appendChild(quotedMessage);
    }

    if (message.message_type === "image" && message.image_url) {
        const image = document.createElement("img");
        image.src = message.image_url;
        image.alt = "Group image";
        image.loading = "lazy";
        image.style.maxWidth = "250px";
        image.style.maxHeight = "300px";
        image.style.borderRadius = "8px";
        image.style.display = "block";
        image.style.marginTop = "8px";

        bubble.appendChild(image);

    } else if (
        message.message_type === "video" &&
        message.video_url
    ) {
        const video = document.createElement("video");
        video.src = message.video_url;
        video.controls = true;
        video.preload = "metadata";
        video.style.maxWidth = "280px";
        video.style.width = "100%";
        video.style.borderRadius = "8px";
        video.style.display = "block";
        video.style.marginTop = "8px";

        bubble.appendChild(video);

    } else if (
        message.message_type === "audio" &&
        message.audio_url
    ) {
        const audio = document.createElement("audio");
        audio.src = message.audio_url;
        audio.controls = true;
        audio.preload = "metadata";
        audio.style.display = "block";
        audio.style.width = "260px";
        audio.style.maxWidth = "100%";
        audio.style.marginTop = "8px";

        bubble.appendChild(audio);

    } else if (
        message.message_type === "document" &&
        message.document_url
    ) {
        const documentContainer = document.createElement("div");
        documentContainer.style.marginTop = "8px";

        const documentName = document.createElement("div");
        documentName.textContent =
            "📄 " + (message.document_original_name || "Document");

        documentName.style.fontWeight = "bold";
        documentName.style.marginBottom = "8px";
        documentName.style.overflowWrap = "anywhere";

        const downloadLink = document.createElement("a");
        downloadLink.href = message.document_url;
        downloadLink.textContent = "⬇ Download Document";
        downloadLink.setAttribute("download", "");
        downloadLink.style.color = "#2196f3";
        downloadLink.style.textDecoration = "underline";

        documentContainer.appendChild(documentName);
        documentContainer.appendChild(downloadLink);

        bubble.appendChild(documentContainer);

    } else if (message.message_type === "contact") {
        const contactCard = createSharedContactCard(message);
        contactCard.style.marginTop = "8px";
        bubble.appendChild(contactCard);

    } else {
        const content = document.createElement("div");
        content.textContent = message.content || "";

        bubble.appendChild(content);
    }

    row.appendChild(bubble);

    // Group message reaction picker
    const reactionBar = document.createElement("div");
    reactionBar.className = "group-reaction-bar";

    const reactionButton = document.createElement("button");
    reactionButton.type = "button";
    reactionButton.className = "group-reaction-button";
    reactionButton.textContent = "😊";
    reactionButton.title = "React to message";

    const picker = document.createElement("div");
    picker.className = "group-reaction-picker";
    picker.hidden = true;

    ["👍", "❤️", "😂", "😮", "😢", "🔥"].forEach((emoji) => {
        const option = document.createElement("button");
        option.type = "button";
        option.textContent = emoji;
        option.title = emoji;

        option.addEventListener("click", () => {
            socket.emit("react_group_message", {
                message_id: message.id,
                emoji: emoji
            });

            picker.hidden = true;
        });

        picker.appendChild(option);
    });

    reactionButton.addEventListener("click", () => {
        picker.hidden = !picker.hidden;
    });

    // Reply to a group message.
    const replyButton = document.createElement("button");
    replyButton.type = "button";
    replyButton.className = "group-reaction-button";
    replyButton.textContent = "↩ Reply";
    replyButton.title = "Reply to this group message";

    replyButton.addEventListener("click", () => {
        replyingToMessage = message;

        const isOwnMessage =
            Number(message.sender_id) === Number(currentUser.id);

        replyPreviewNameElement.textContent = isOwnMessage
            ? "Replying to yourself"
            : `Replying to ${message.sender_username}`;

        replyPreviewContentElement.textContent =
            message.content ||
            (message.message_type === "image" ? "📷 Image" :
             message.message_type === "video" ? "🎥 Video" :
             message.message_type === "audio" ? "🎤 Voice message" :
             "Message");

        replyPreviewElement.hidden = false;
        messageInput.focus();
    });

    // Floating actions: hidden until the message is tapped.
    reactionBar.classList.add("group-message-actions");
    reactionBar.hidden = true;

    // Show quick reactions directly in the floating menu.
    picker.hidden = false;

    // The old emoji toggle is no longer needed.
    reactionButton.hidden = true;

    reactionBar.appendChild(picker);
    reactionBar.appendChild(replyButton);

    // Forward a group text message.
    if (message.message_type === "text") {
        const forwardGroupButton = document.createElement("button");
        forwardGroupButton.type = "button";
        forwardGroupButton.className = "group-reaction-button";
        forwardGroupButton.textContent = "➤ Forward";
        forwardGroupButton.title = "Forward this group message";

        forwardGroupButton.addEventListener("click", () => {
            reactionBar.hidden = true;
            openForwardDialog("group", message.id);
        });

        reactionBar.appendChild(forwardGroupButton);
    }

    bubble.appendChild(reactionBar);

    // Saved reactions must remain visible outside the floating menu.
    const savedReactionsBar = document.createElement("div");
    savedReactionsBar.className = "group-reaction-bar";
    savedReactionsBar.classList.add("group-saved-reactions");
    bubble.appendChild(savedReactionsBar);

    // Toggle actions when the message bubble is clicked.
    bubble.addEventListener("click", (event) => {
        if (event.target.closest(
            "button, a, video, audio, .group-message-actions"
        )) {
            return;
        }

        const wasOpen = !reactionBar.hidden;

        document.querySelectorAll(
            ".group-message-actions"
        ).forEach((menu) => {
            menu.hidden = true;
        });

        reactionBar.hidden = wasOpen;

        if (!reactionBar.hidden) {
            reactionBar.style.top = "calc(100% + 8px)";
            reactionBar.style.bottom = "auto";

            const bubbleRect = bubble.getBoundingClientRect();
            const menuHeight = reactionBar.offsetHeight;
            const chatRect = messagesElement.getBoundingClientRect();

            const spaceBelow = chatRect.bottom - bubbleRect.bottom;
            const spaceAbove = bubbleRect.top - chatRect.top;

            if (
                spaceBelow < menuHeight + 8 &&
                spaceAbove > spaceBelow
            ) {
                reactionBar.style.top = "auto";
                reactionBar.style.bottom = "calc(100% + 8px)";
            }
        }
    });

    // Close the menu after selecting Reply.
    replyButton.addEventListener("click", () => {
        reactionBar.hidden = true;
    });

    // Close the menu after choosing an emoji.
    picker.querySelectorAll("button").forEach((button) => {
        button.addEventListener("click", () => {
            reactionBar.hidden = true;
        });
    });

    messagesElement.appendChild(row);

    // Restore reactions saved in PostgreSQL.
    renderGroupMessageReactions(message.id, message.reactions || []);

    messagesElement.scrollTop = messagesElement.scrollHeight;
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

    // Enable image and video sharing in group conversations.
    imageButton.disabled = false;
    videoButton.disabled = false;

    // Enable voice notes in group conversations.
    voiceButton.disabled = false;

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

        // Clear the unread badge after messages are loaded.
        const groupBadge = document.querySelector(
            `[data-unread-group-id="${group.id}"]`
        );

        if (groupBadge) {
            groupBadge.dataset.unreadCount = 0;
            groupBadge.textContent = "";
            groupBadge.hidden = true;
        }

        messagesElement.innerHTML = "";

        if (!data.messages || data.messages.length === 0) {
            messagesElement.innerHTML =
                '<p class="empty-text">No messages yet. Say hello!</p>';
        } else {
            data.messages.forEach((message) => {
                renderGroupMessage(message);
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
            blackpillAlert("No other users are available.");
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
                blackpillAlert("Enter a group name (1 to 100 characters).");
                return;
            }

            const memberIds = checkboxes
                .filter(checkbox => checkbox.checked)
                .map(checkbox => Number(checkbox.value));

            if (memberIds.length === 0) {
                blackpillAlert("Select at least one group member.");
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
                blackpillAlert("Group created successfully!");

            } catch (error) {
                console.error("Create Group error:", error);
                blackpillAlert(error.message);

            } finally {
                submitting = false;
                createButton.disabled = false;
                createButton.textContent = "Create Group";
            }
        });

    } catch (error) {
        console.error("Create Group error:", error);
        blackpillAlert(error.message);
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

    // Display forwarded indicator in private messages.
    if (message.is_forwarded) {
        const forwardedLabel = document.createElement("div");
        forwardedLabel.className = "forwarded-label";
        forwardedLabel.textContent = "↪ Forwarded";

        forwardedLabel.style.cssText = `
            font-size: 12px;
            font-style: italic;
            opacity: 0.75;
            margin-bottom: 6px;
        `;

        bubble.appendChild(forwardedLabel);
    }

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
    } else if (
        message.message_type === "document"
        && message.document_url
    ) {
        content.classList.add("document-message-content");

        const documentName = document.createElement("div");
        documentName.className = "chat-document-name";
        documentName.textContent =
            "📄 " + (
                message.document_original_name ||
                "Shared document"
            );

        content.appendChild(documentName);

        const downloadLink = document.createElement("a");
        downloadLink.className = "chat-document-download";
        downloadLink.href = message.document_url;
        downloadLink.textContent = "⬇ Download Document";

        downloadLink.style.cssText = `
            display: inline-block;
            margin-top: 8px;
            padding: 8px 12px;
            border-radius: 8px;
            background: #1976d2;
            color: white;
            text-decoration: none;
            font-weight: 600;
        `;

        content.appendChild(downloadLink);

    } else if (message.message_type === "contact") {
        content.classList.add("contact-message-content");
        content.appendChild(createSharedContactCard(message));
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



// Select a private contact or group when forwarding a message.
async function openForwardDialog(sourceType, messageId) {
    const overlay = document.createElement("div");
    overlay.style.cssText = `
        position: fixed;
        inset: 0;
        background: rgba(0, 0, 0, 0.65);
        z-index: 10000;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 16px;
    `;

    const dialog = document.createElement("div");
    dialog.style.cssText = `
        background: #202c33;
        color: white;
        border-radius: 12px;
        padding: 20px;
        width: 100%;
        max-width: 420px;
        max-height: 80vh;
        overflow-y: auto;
        box-sizing: border-box;
    `;

    const heading = document.createElement("h3");
    heading.textContent = "➤ Forward message";
    heading.style.marginTop = "0";

    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search contacts or groups...";
    search.style.cssText = `
        width: 100%;
        padding: 10px;
        margin-bottom: 12px;
        border-radius: 6px;
        border: 1px solid #54656f;
        box-sizing: border-box;
    `;

    const recipients = document.createElement("div");

    const closeButton = document.createElement("button");
    closeButton.type = "button";
    closeButton.textContent = "Cancel";
    closeButton.style.marginTop = "12px";
    closeButton.addEventListener("click", () => overlay.remove());

    dialog.appendChild(heading);
    dialog.appendChild(search);
    dialog.appendChild(recipients);
    dialog.appendChild(closeButton);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);

    overlay.addEventListener("click", (event) => {
        if (event.target === overlay) {
            overlay.remove();
        }
    });

    recipients.textContent = "Loading contacts and groups...";

    try {
        const [usersResponse, groupsResponse] = await Promise.all([
            fetch("/chat/users"),
            fetch("/groups/")
        ]);

        if (!usersResponse.ok || !groupsResponse.ok) {
            throw new Error("Could not load forwarding destinations.");
        }

        const usersData = await usersResponse.json();
        const groupsData = await groupsResponse.json();

        const destinations = [
            ...(usersData.users || []).map((user) => ({
                type: "private",
                id: user.id,
                name: "👤 " + user.username
            })),
            ...(groupsData.groups || []).map((group) => ({
                type: "group",
                id: group.id,
                name: "👥 " + group.name
            }))
        ];

        const displayDestinations = () => {
            recipients.replaceChildren();

            const query = search.value.trim().toLowerCase();

            const filtered = destinations.filter((destination) =>
                destination.name.toLowerCase().includes(query)
            );

            if (!filtered.length) {
                recipients.textContent = "No matching contacts or groups.";
                return;
            }

            filtered.forEach((destination) => {
                const button = document.createElement("button");
                button.type = "button";
                button.textContent = destination.name;

                button.style.cssText = `
                    display: block;
                    width: 100%;
                    padding: 12px;
                    margin: 5px 0;
                    text-align: left;
                    background: #2a3942;
                    color: white;
                    border: 0;
                    border-radius: 6px;
                    cursor: pointer;
                `;

                button.addEventListener("click", async () => {
                    button.disabled = true;
                    button.textContent = "Forwarding...";

                    try {
                        const response = await fetch("/forward/message", {
                            method: "POST",
                            headers: {
                                "Content-Type": "application/json"
                            },
                            body: JSON.stringify({
                                source_type: sourceType,
                                message_id: messageId,
                                destination_type: destination.type,
                                destination_id: destination.id
                            })
                        });

                        const result = await response.json();

                        if (!response.ok) {
                            throw new Error(
                                result.error || "Forwarding failed."
                            );
                        }

                        overlay.remove();
                        blackpillAlert("Message forwarded successfully!");

                    } catch (error) {
                        blackpillAlert(error.message);
                        button.disabled = false;
                        button.textContent = destination.name;
                    }
                });

                recipients.appendChild(button);
            });
        };

        search.addEventListener("input", displayDestinations);
        displayDestinations();

    } catch (error) {
        recipients.textContent = error.message;
    }
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

    // Forward a private text message.
    if (message.message_type === "text") {
        const forwardButton = document.createElement("button");
        forwardButton.type = "button";
        forwardButton.textContent = "➤ Forward";

        forwardButton.addEventListener("click", () => {
            closeMessageContextMenu();
            openForwardDialog("private", message.id);
        });

        menu.appendChild(forwardButton);
    }

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

            editMessage.addEventListener("click", async () => {
                closeMessageContextMenu();

                const newContent = await blackpillPrompt(
                    "Edit message:",
                    message.content,
                    "Edit Message"
                );

                if (newContent === null) {
                    return;
                }

                const trimmedContent =
                    newContent.trim();

                if (!trimmedContent) {
                    blackpillAlert(
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
    if ((!selectedUser && !selectedGroup) || videoButton.disabled) {
        return;
    }

    videoInput.click();
});


imageButton.addEventListener("click", () => {
    if ((!selectedUser && !selectedGroup) || imageButton.disabled) {
        return;
    }

    imageInput.click();
});


imageInput.addEventListener("change", async () => {
    const imageFile = imageInput.files[0];

    if (!imageFile) {
        return;
    }

    if (!selectedUser && !selectedGroup) {
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
        blackpillAlert(
            "Unsupported image type. " +
            "Use PNG, JPG, JPEG, GIF, or WebP."
        );

        imageInput.value = "";
        return;
    }

    const maxImageSize = 10 * 1024 * 1024;

    if (imageFile.size > maxImageSize) {
        blackpillAlert("Image must be 10 MB or smaller.");
        imageInput.value = "";
        return;
    }

    const groupId = selectedGroup ? selectedGroup.id : null;
    const receiverId = selectedUser ? selectedUser.id : null;
    const formData = new FormData();

    if (groupId !== null) {
        formData.append("media", imageFile);
    } else {
        formData.append("receiver_id", receiverId);
        formData.append("image", imageFile);
    }

    imageButton.disabled = true;

    try {
        const uploadUrl = groupId !== null
            ? `/groups/${groupId}/upload-media`
            : "/chat/send-image";

        const response = await fetch(uploadUrl, {
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
            groupId === null
            && selectedUser
            && Number(selectedUser.id) === Number(receiverId)
            && data.data
        ) {
            renderMessage(data.data);
        }

        // Group messages are displayed by the Socket.IO listener.
    } catch (error) {
        console.error("Image upload failed:", error);
        blackpillAlert(error.message || "Could not send image.");
    } finally {
        imageInput.value = "";

        if (selectedUser || selectedGroup) {
            imageButton.disabled = false;
        }
    }
});


videoInput.addEventListener("change", async () => {
    const videoFile = videoInput.files[0];

    if (!videoFile) {
        return;
    }

    if (!selectedUser && !selectedGroup) {
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
        blackpillAlert("Unsupported video type. Use MP4 or WebM.");
        videoInput.value = "";
        return;
    }

    const maxVideoSize = 50 * 1024 * 1024;

    if (videoFile.size === 0 || videoFile.size > maxVideoSize) {
        blackpillAlert("Video must be larger than 0 bytes and no more than 50 MB.");
        videoInput.value = "";
        return;
    }

    const groupId = selectedGroup ? selectedGroup.id : null;
    const receiverId = selectedUser ? selectedUser.id : null;
    const formData = new FormData();

    if (groupId !== null) {
        formData.append("media", videoFile);
    } else {
        formData.append("receiver_id", receiverId);
        formData.append("video", videoFile);
    }

    videoButton.disabled = true;

    try {
        const uploadUrl = groupId !== null
            ? `/groups/${groupId}/upload-media`
            : "/chat/send-video";

        const response = await fetch(uploadUrl, {
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
            groupId === null
            && selectedUser
            && Number(selectedUser.id) === Number(receiverId)
            && data.data
        ) {
            renderMessage(data.data);
        }

        // Group messages are displayed by the Socket.IO listener.
    } catch (error) {
        console.error("Video upload failed:", error);
        blackpillAlert(error.message || "Could not send video.");
    } finally {
        videoInput.value = "";

        if (selectedUser || selectedGroup) {
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
                    body: JSON.stringify({
                        content: content,
                        reply_to_message_id: replyingToMessage
                            ? replyingToMessage.id
                            : null
                    })
                }
            );

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.error || "Could not send group message."
                );
            }

            messageInput.value = "";
            cancelReply();
            messageInput.focus();

        } catch (error) {
            console.error("Group message error:", error);
            blackpillAlert(error.message);
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

    // Subscribe to notifications from all joined groups.
    socket.emit("subscribe_group_notifications", (response) => {
        if (!response || !response.success) {
            console.error(
                "Could not subscribe to group notifications:",
                response
            );
        }
    });

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
// Update group unread badges in real time.
socket.on("group_message_notification", (notification) => {
    const groupId = Number(notification.group_id);
    const senderId = Number(notification.sender_id);

    // Do not count our own messages.
    if (currentUser && senderId === Number(currentUser.id)) {
        return;
    }

    // The currently selected group is already being viewed.
    if (
        selectedGroup &&
        Number(selectedGroup.id) === groupId
    ) {
        return;
    }

    const badge = document.querySelector(
        `[data-unread-group-id="${groupId}"]`
    );

    if (!badge) {
        return;
    }

    const currentCount =
        Number(badge.dataset.unreadCount) ||
        Number(badge.textContent) ||
        0;

    const newCount = currentCount + 1;

    badge.dataset.unreadCount = newCount;
    badge.textContent = newCount > 99 ? "99+" : String(newCount);
    badge.hidden = false;
});


socket.on("new_group_message", (message) => {
    if (!selectedGroup) {
        return;
    }

    if (Number(message.group_id) !== Number(selectedGroup.id)) {
        return;
    }

    renderGroupMessage(message);

    // Mark incoming messages as read while viewing this group.
    if (
        currentUser &&
        Number(message.sender_id) !== Number(currentUser.id)
    ) {
        fetch(`/groups/${message.group_id}/mark-read`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                message_id: message.id
            })
        }).then((response) => {
            if (!response.ok) {
                console.error("Could not mark group message as read.");
            }
        }).catch((error) => {
            console.error("Group read update failed:", error);
        });
    }
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
        Number(message.receiver_id) === Number(selectedUser.id)
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
    blackpillAlert(
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
    blackpillAlert(
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
    blackpillAlert(
        data.error || "Could not delete the message."
    );
});


socket.on("error", (data) => {
    console.error("Socket error:", data);

    blackpillAlert(data.error || "A chat error occurred.");
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
    if ((!selectedUser && !selectedGroup) || mediaRecorder) {
        return;
    }

    if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia ||
        typeof MediaRecorder === "undefined"
    ) {
        blackpillAlert("Your browser does not support microphone recording.");
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
        blackpillAlert("No supported audio recording format was found.");
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

        recordingReceiverId = selectedUser ? selectedUser.id : null;
        recordingGroupId = selectedGroup ? selectedGroup.id : null;
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
        recordingGroupId = null;
        voiceButton.disabled = !selectedUser && !selectedGroup;

        blackpillAlert(
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
    const groupId = recordingGroupId;
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
        recordingGroupId = null;
        recordingStartTime = null;

        if (audioBlob.size === 0) {
            blackpillAlert("No audio was recorded.");
            voiceButton.disabled = !selectedUser && !selectedGroup;
            return;
        }

        const extension = recorder.audioExtension || "webm";

        const audioFile = new File(
            [audioBlob],
            `voice-note.${extension}`,
            { type: recorder.mimeType }
        );

        const formData = new FormData();

        let uploadUrl;

        if (groupId !== null) {
            uploadUrl = `/groups/${groupId}/upload-media`;
            formData.append("media", audioFile);
        } else {
            uploadUrl = "/chat/send-audio";
            formData.append("receiver_id", receiverId);
            formData.append("audio", audioFile);
        }

        formData.append("duration_ms", durationMs);

        try {
            const response = await fetch(uploadUrl, {
                method: "POST",
                body: formData
            });

            const data = await response.json();

            if (!response.ok) {
                throw new Error(
                    data.error || "Could not send voice note."
                );
            }

            if (data.data) {
                if (
                    groupId !== null
                    && selectedGroup
                    && Number(selectedGroup.id) === Number(groupId)
                ) {
                    renderGroupMessage(data.data);
                } else if (
                    groupId === null
                    && selectedUser
                    && Number(selectedUser.id) === Number(receiverId)
                ) {
                    renderMessage(data.data);
                }
            }

            console.log("Voice note sent successfully.");

        } catch (error) {
            console.error("Voice-note upload failed:", error);

            blackpillAlert(
                error.message || "Could not send voice note."
            );

        } finally {
            voiceButton.disabled = !selectedUser && !selectedGroup;
        }
    }, { once: true });

    recorder.stop();
}


voiceButton.addEventListener("click", async () => {
    if (
        voiceButton.disabled ||
        (!selectedUser && !selectedGroup)
    ) {
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

// ========================================
// Group voice and video call state
// ========================================

let activeGroupCallId = null;
let activeGroupCallType = null;
let activeGroupCallGroupId = null;

// WebRTC connections for group participants.
const groupPeerConnections = new Map();

// Local microphone and camera stream.
let groupLocalStream = null;


// ========================================
// Start a group voice or video call
// ========================================

function startGroupCall(callType) {
    if (!selectedGroup) {
        blackpillAlert("Select a group conversation first.");
        return;
    }

    if (!socket.connected) {
        blackpillAlert("Connection lost. Please reconnect.");
        return;
    }

    if (activeCallId || activeGroupCallId) {
        blackpillAlert("You already have an active call.");
        return;
    }

    const groupId = Number(selectedGroup.id);

    startVoiceCallButton.disabled = true;
    startVideoCallButton.disabled = true;

    socket.timeout(5000).emit(
        "start_group_call",
        {
            group_id: groupId,
            call_type: callType
        },
        (error, response) => {
            if (error || !response?.success) {
                blackpillAlert(
                    response?.error ||
                    "Could not start group call."
                );

                updateCallButtons();
                return;
            }

            activeGroupCallId = response.call_id;
            activeGroupCallType = response.call_type;
            activeGroupCallGroupId = response.group_id;

            updateCallButtons();
            showGroupCallMediaPanel();

            // Initialize microphone and camera.
            initializeGroupMedia().catch((error) => {
                handleGroupMediaFailure(error);
            });

            console.log(
                "Group call started:",
                activeGroupCallId,
                activeGroupCallType
            );

            blackpillAlert(
                `${callType === "video" ? "Video" : "Voice"} ` +
                "group call started. Waiting for participants."
            );
        }
    );
}

function startPrivateCall(callType) {
    if (!selectedUser || selectedGroup) {
        blackpillAlert("Select a private conversation first.");
        return;
    }

    if (!socket.connected) {
        blackpillAlert("Connection lost. Please reconnect.");
        return;
    }

    if (activeCallId) {
        blackpillAlert("You already have an active call.");
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
                blackpillAlert(
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

            blackpillAlert(
                `${callType === "video" ? "Video" : "Voice"} `
                + `call request sent to ${selectedUser.username}.`
            );
        }
    );
}

startVoiceCallButton.addEventListener("click", () => {
    if (selectedGroup) {
        startGroupCall("voice");
    } else {
        startPrivateCall("voice");
    }
});

startVideoCallButton.addEventListener("click", () => {
    if (selectedGroup) {
        startGroupCall("video");
    } else {
        startPrivateCall("video");
    }
});



// ========================================
// Incoming group voice and video calls
// ========================================

let pendingGroupJoinCallId = null;
let pendingGroupJoinGroupId = null;

socket.on("incoming_group_call", async (data) => {
    console.log("Incoming group call:", data);

    if (activeCallId || activeGroupCallId) {
        console.log("Already in a call. Ignoring invitation.");
        return;
    }

    const callType = data.call_type === "video"
        ? "video"
        : "voice";

    const accepted = await blackpillConfirm(
        `${data.caller_username} started a group ${callType} call ` +
        `in ${data.group_name}.\\n\\nJoin this call?`,
        "Incoming Group Call"
    );

    if (!accepted) {
        console.log("Group call invitation declined.");
        return;
    }

    // Track this join attempt so early offers can be queued.
    pendingGroupJoinCallId = data.call_id;
    pendingGroupJoinGroupId = data.group_id;
    pendingGroupOffers.length = 0;

    socket.timeout(5000).emit(
        "join_group_call",
        {
            group_id: data.group_id,
            call_id: data.call_id
        },
        (error, response) => {
            if (error || !response?.success) {
                pendingGroupJoinCallId = null;
                pendingGroupJoinGroupId = null;
                pendingGroupOffers.length = 0;

                blackpillAlert(
                    response?.error ||
                    "Could not join group call."
                );
                return;
            }

            activeGroupCallId = response.call_id;
            activeGroupCallType = response.call_type;
            activeGroupCallGroupId = data.group_id;

            // The join acknowledgement has arrived.
            pendingGroupJoinCallId = null;
            pendingGroupJoinGroupId = null;

            // Process offers that arrived while joining.
            const queuedOffers = pendingGroupOffers.splice(0);

            for (const offer of queuedOffers) {
                if (
                    offer.call_id === activeGroupCallId &&
                    Number(offer.group_id) ===
                        Number(activeGroupCallGroupId)
                ) {
                    socket.listeners("group_webrtc_offer").forEach(
                        (handler) => handler(offer)
                    );
                }
            }

            updateCallButtons();
            showGroupCallMediaPanel();

            // Initialize microphone and camera after joining.
            initializeGroupMedia().catch((error) => {
                handleGroupMediaFailure(error);
            });

            console.log(
                "Joined group call:",
                activeGroupCallId,
                "Participants:",
                response.participants
            );

            blackpillAlert("Joined group call successfully.");
        }
    );
});

// ========================================
// BLACK PILL CUSTOM INCOMING CALL HANDLER
// ========================================

const incomingCallScreen =
    document.getElementById("incoming-call-screen");

const incomingCallerName =
    document.getElementById("incoming-caller-name");

const incomingCallType =
    document.getElementById("incoming-call-type");

const acceptIncomingCallButton =
    document.getElementById("accept-incoming-call");

const rejectIncomingCallButton =
    document.getElementById("reject-incoming-call");

let pendingIncomingCall = null;

function closeIncomingCallScreen() {
    incomingCallScreen.hidden = true;
    pendingIncomingCall = null;
}

socket.on("incoming_call", (data) => {
    console.log("Incoming call:", data);

    if (activeCallId || activeGroupCallId || pendingIncomingCall) {
        socket.emit("reject_call", {
            call_id: data.call_id
        });
        return;
    }

    const callType =
        data.call_type === "video" ? "video" : "voice";

    pendingIncomingCall = {
        call_id: data.call_id,
        call_type: callType
    };

    incomingCallerName.textContent =
        data.caller_username || "Unknown caller";

    incomingCallType.textContent =
        callType === "video"
            ? "Incoming Video Call"
            : "Incoming Voice Call";

    incomingCallScreen.hidden = false;
});

acceptIncomingCallButton.addEventListener("click", () => {
    if (!pendingIncomingCall) return;

    const data = pendingIncomingCall;

    closeIncomingCallScreen();

    activeCallId = data.call_id;
    activeCallType = data.call_type;

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

                blackpillAlert(
                    response?.error || "Could not accept call."
                );
                return;
            }

            console.log(
                "Incoming call accepted:",
                data.call_id
            );
        }
    );
});

rejectIncomingCallButton.addEventListener("click", () => {
    if (!pendingIncomingCall) return;

    const callId = pendingIncomingCall.call_id;

    closeIncomingCallScreen();

    socket.emit(
        "reject_call",
        { call_id: callId },
        (response) => {
            if (!response || !response.success) {
                console.error(
                    "Could not reject call:",
                    response
                );
            }
        }
    );
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

    blackpillAlert("Your call was rejected.");
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

        blackpillAlert(
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
        blackpillAlert("Call ended because the other user disconnected.");
    } else {
        blackpillAlert("Call ended.");
    }
});


// ========================================
// Hang Up button
// ========================================

const endCallButton =
    document.getElementById("end-call-button");

function updateCallButtons() {
    const inCall = !!activeCallId || !!activeGroupCallId;
    const privateChat = !!selectedUser && !selectedGroup;
    const groupChat = !!selectedGroup;
    const canStartCall = privateChat || groupChat;

    startVoiceCallButton.disabled = !canStartCall || inCall;
    startVideoCallButton.disabled = !canStartCall || inCall;

    endCallButton.hidden = !inCall;
}

endCallButton.addEventListener("click", () => {
    // Handle group voice and video calls.
    if (activeGroupCallId) {
        const callId = activeGroupCallId;
        const groupId = activeGroupCallGroupId;

        socket.timeout(5000).emit(
            "leave_group_call",
            {
                group_id: groupId,
                call_id: callId
            },
            (error, response) => {
                if (error || !response?.success) {
                    console.warn(
                        "Could not confirm leaving group call:",
                        error || response?.error
                    );
                }
            }
        );

        // Stop local camera, microphone and peer connections.
        cleanupGroupWebRTCCall();

        console.log("Local group call ended:", callId);
        return;
    }

    // Preserve existing private call behavior.
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


// ========================================
// Group WebRTC peer connections
// ========================================


// ========================================
// Group microphone and camera
// ========================================

let groupMediaPromise = null;

async function initializeGroupMedia() {
    if (groupLocalStream) {
        return groupLocalStream;
    }

    if (groupMediaPromise) {
        return groupMediaPromise;
    }

    if (!activeGroupCallId) {
        throw new Error("No active group call.");
    }

    const callId = activeGroupCallId;
    const constraints = {
        audio: true,
        video: activeGroupCallType === "video"
    };

    groupMediaPromise = (async () => {
        const stream = await navigator.mediaDevices.getUserMedia(
            constraints
        );

        if (activeGroupCallId !== callId) {
            stream.getTracks().forEach(track => track.stop());
            throw new Error("Group call ended during media setup.");
        }

        groupLocalStream = stream;

        // Display local camera preview during group video calls.
        if (activeGroupCallType === "video" && localVideo) {
            localVideo.srcObject = stream;
            localVideo.muted = true;
            localVideo.autoplay = true;
            localVideo.playsInline = true;
            localVideo.hidden = false;
            localVideo.style.display = "block";

            localVideo.play().catch((error) => {
                console.warn(
                    "Local group video preview could not autoplay:",
                    error
                );
            });
        }

        for (const connection of groupPeerConnections.values()) {
            for (const track of stream.getTracks()) {
                connection.addTrack(track, stream);
            }
        }

        console.log("Group media initialized.");

        return stream;
    })();

    try {
        return await groupMediaPromise;
    } finally {
        groupMediaPromise = null;
    }
}


// ========================================
// Create a WebRTC offer for a group member
// ========================================


// ========================================
// Receive group WebRTC offers
// ========================================


// ========================================
// Receive group WebRTC answers
// ========================================


// ========================================
// Receive group WebRTC ICE candidates
// ========================================

const pendingGroupIceCandidates = new Map();

async function flushGroupIceCandidates(participantId) {
    const userId = Number(participantId);
    const connection = groupPeerConnections.get(userId);

    if (!connection || !connection.remoteDescription) {
        return;
    }

    const candidates =
        pendingGroupIceCandidates.get(userId) || [];

    pendingGroupIceCandidates.delete(userId);

    for (const candidate of candidates) {
        try {
            await connection.addIceCandidate(candidate);
        } catch (error) {
            console.error(
                "Failed to apply queued group ICE candidate:",
                error
            );
        }
    }
}

socket.on("group_webrtc_ice_candidate", async (data) => {
    if (
        !activeGroupCallId ||
        data.call_id !== activeGroupCallId ||
        Number(data.group_id) !== Number(activeGroupCallGroupId)
    ) {
        return;
    }

    const senderId = Number(data.sender_id);
    const candidate = data.candidate;

    if (!candidate) {
        return;
    }

    const connection = groupPeerConnections.get(senderId);

    if (!connection || !connection.remoteDescription) {
        const pending =
            pendingGroupIceCandidates.get(senderId) || [];

        pending.push(candidate);

        pendingGroupIceCandidates.set(senderId, pending);
        return;
    }

    try {
        await connection.addIceCandidate(candidate);

        console.log(
            "Group ICE candidate added from:",
            senderId
        );
    } catch (error) {
        console.error(
            "Failed to add group ICE candidate:",
            error
        );
    }
});

socket.on("group_webrtc_answer", async (data) => {
    if (
        !activeGroupCallId ||
        data.call_id !== activeGroupCallId ||
        Number(data.group_id) !== Number(activeGroupCallGroupId)
    ) {
        return;
    }

    const senderId = Number(data.sender_id);

    const connection = groupPeerConnections.get(senderId);

    if (!connection) {
        console.warn(
            "No group peer connection for:",
            senderId
        );
        return;
    }

    try {
        if (connection.signalingState !== "have-local-offer") {
            console.warn(
                "Unexpected group WebRTC answer:",
                senderId,
                connection.signalingState
            );
            return;
        }

        await connection.setRemoteDescription(
            new RTCSessionDescription(data.answer)
        );

        await flushGroupIceCandidates(senderId);

        console.log(
            "Group WebRTC answer received from:",
            senderId
        );

    } catch (error) {
        console.error(
            "Failed to process group WebRTC answer:",
            error
        );
    }
});


// ========================================
// Connect new group call participants
// ========================================


// ========================================
// Handle participants leaving group calls
// ========================================

socket.on("group_call_participant_left", (data) => {
    if (
        !activeGroupCallId ||
        data.call_id !== activeGroupCallId ||
        Number(data.group_id) !== Number(activeGroupCallGroupId)
    ) {
        return;
    }

    const participantId = Number(data.user_id);

    if (!Number.isInteger(participantId) || participantId <= 0) {
        return;
    }

    // Close the departed participant's WebRTC connection.
    const connection = groupPeerConnections.get(participantId);

    if (connection) {
        connection.ontrack = null;
        connection.onicecandidate = null;
        connection.onconnectionstatechange = null;

        connection.close();

        groupPeerConnections.delete(participantId);
    }

    // Remove their remote audio/video element.
    const mediaElement = groupRemoteMediaElements.get(participantId);

    if (mediaElement) {
        mediaElement.pause();
        mediaElement.srcObject = null;
        mediaElement.remove();

        groupRemoteMediaElements.delete(participantId);
    }

    // Remove any pending ICE candidates.
    pendingGroupIceCandidates.delete(participantId);

    console.log(
        "Group participant left:",
        participantId
    );
});

socket.on("group_call_participant_joined", async (data) => {
    if (
        !activeGroupCallId ||
        data.call_id !== activeGroupCallId ||
        Number(data.group_id) !== Number(activeGroupCallGroupId)
    ) {
        return;
    }

    const participantId = Number(data.user_id);

    if (!Number.isInteger(participantId) || participantId <= 0) {
        console.warn("Invalid group participant:", data);
        return;
    }

    console.log(
        "New participant joined group call:",
        participantId
    );

    try {
        await createGroupWebRTCOffer(participantId);
    } catch (error) {
        console.error(
            "Could not connect group participant:",
            error
        );
    }
});

// Store offers received before the join acknowledgement.
const pendingGroupOffers = [];

socket.on("group_webrtc_offer", async (data) => {
    if (
        !activeGroupCallId &&
        pendingGroupJoinCallId === data.call_id &&
        Number(pendingGroupJoinGroupId) === Number(data.group_id)
    ) {
        pendingGroupOffers.push(data);

        console.log(
            "Queued early group WebRTC offer:",
            data.sender_id
        );
        return;
    }

    if (
        !activeGroupCallId ||
        data.call_id !== activeGroupCallId ||
        Number(data.group_id) !== Number(activeGroupCallGroupId)
    ) {
        return;
    }

    const senderId = Number(data.sender_id);

    try {
        await initializeGroupMedia();

        const connection = createGroupPeerConnection(senderId);

        await connection.setRemoteDescription(
            new RTCSessionDescription(data.offer)
        );

        await flushGroupIceCandidates(senderId);

        const answer = await connection.createAnswer();

        await connection.setLocalDescription(answer);

        socket.emit("group_webrtc_answer", {
            group_id: activeGroupCallGroupId,
            call_id: activeGroupCallId,
            target_user_id: senderId,
            answer: {
                type: connection.localDescription.type,
                sdp: connection.localDescription.sdp
            }
        });

        console.log(
            "Group WebRTC answer sent to:",
            senderId
        );

    } catch (error) {
        console.error(
            "Failed to answer group WebRTC offer:",
            error
        );
    }
});

async function createGroupWebRTCOffer(participantId) {
    if (!activeGroupCallId) {
        console.warn("No active group call.");
        return;
    }

    const userId = Number(participantId);

    try {
        // Ensure microphone/camera access is ready.
        await initializeGroupMedia();

        const connection = createGroupPeerConnection(userId);

        // Avoid creating overlapping offers.
        if (connection.signalingState !== "stable") {
            console.warn(
                "Group peer is not ready for an offer:",
                userId,
                connection.signalingState
            );
            return;
        }

        const offer = await connection.createOffer();

        await connection.setLocalDescription(offer);

        socket.emit("group_webrtc_offer", {
            group_id: activeGroupCallGroupId,
            call_id: activeGroupCallId,
            target_user_id: userId,
            offer: {
                type: connection.localDescription.type,
                sdp: connection.localDescription.sdp
            }
        });

        console.log(
            "Group WebRTC offer sent to participant:",
            userId
        );

    } catch (error) {
        console.error(
            "Failed to create group WebRTC offer:",
            error
        );
    }
}


// ========================================
// Display group participant audio and video
// ========================================

const groupRemoteMediaElements = new Map();


// ========================================
// Show group call media panel
// ========================================


// ========================================
// Clean up group WebRTC calls
// ========================================


// ========================================
// Handle group microphone/camera failures
// ========================================

function handleGroupMediaFailure(error) {
    console.error("Group media initialization failed:", error);

    if (!activeGroupCallId) {
        return;
    }

    const callId = activeGroupCallId;
    const groupId = activeGroupCallGroupId;

    // Inform the server that this participant is leaving.
    socket.timeout(5000).emit(
        "leave_group_call",
        {
            group_id: groupId,
            call_id: callId
        },
        (timeoutError, response) => {
            if (timeoutError || !response?.success) {
                console.warn(
                    "Could not confirm leaving failed group call:",
                    timeoutError || response?.error
                );
            }
        }
    );

    // Release any microphone, camera or peer connections.
    cleanupGroupWebRTCCall();

    blackpillAlert(
        "Unable to start group call. " +
        "Please check microphone and camera permissions."
    );
}

function cleanupGroupWebRTCCall() {
    // Clear call state first to invalidate pending operations.
    activeGroupCallId = null;
    activeGroupCallType = null;
    activeGroupCallGroupId = null;

    // Clear any unfinished group join attempt.
    pendingGroupJoinCallId = null;
    pendingGroupJoinGroupId = null;

    // Discard WebRTC offers received before joining.
    pendingGroupOffers.length = 0;

    // Close connections to all participants.
    for (const connection of groupPeerConnections.values()) {
        connection.ontrack = null;
        connection.onicecandidate = null;
        connection.onconnectionstatechange = null;
        connection.close();
    }

    groupPeerConnections.clear();

    // Stop microphone and camera.
    if (groupLocalStream) {
        groupLocalStream.getTracks().forEach((track) => {
            track.stop();
        });

        groupLocalStream = null;
    }

    groupMediaPromise = null;

    // Clear queued ICE candidates.
    pendingGroupIceCandidates.clear();

    // Remove remote media elements.
    for (const element of groupRemoteMediaElements.values()) {
        element.pause();
        element.srcObject = null;
        element.remove();
    }

    groupRemoteMediaElements.clear();

    const container = document.getElementById(
        "group-call-media-container"
    );

    if (container) {
        container.remove();
    }

    // Clear local camera preview.
    if (localVideo) {
        localVideo.pause();
        localVideo.srcObject = null;
        localVideo.hidden = true;
        localVideo.style.display = "none";
    }

    // Hide the call panel if no private call is active.
    if (callMediaPanel && !activeCallId) {
        callMediaPanel.hidden = true;
        callMediaPanel.style.display = "none";
    }

    updateCallButtons();

    console.log("Group WebRTC call cleaned up.");
}

function showGroupCallMediaPanel() {
    if (!activeGroupCallId) {
        return;
    }

    if (!callMediaPanel) {
        console.error("Call media panel not found.");
        return;
    }

    callMediaPanel.hidden = false;
    callMediaPanel.style.display = "flex";

    console.log(
        "Group call media panel displayed:",
        activeGroupCallId
    );
}

function displayGroupRemoteStream(participantId, stream) {
    const userId = Number(participantId);

    let container = document.getElementById(
        "group-call-media-container"
    );

    if (!container) {
        container = document.createElement("div");
        container.id = "group-call-media-container";

        container.style.display = "flex";
        container.style.flexWrap = "wrap";
        container.style.gap = "12px";
        container.style.padding = "12px";

        callMediaPanel.appendChild(container);
    }

    let mediaElement = groupRemoteMediaElements.get(userId);

    if (!mediaElement) {
        mediaElement = document.createElement(
            activeGroupCallType === "video" ? "video" : "audio"
        );

        mediaElement.autoplay = true;
        mediaElement.playsInline = true;

        if (mediaElement.tagName === "VIDEO") {
            mediaElement.style.width = "240px";
            mediaElement.style.maxWidth = "100%";
            mediaElement.style.background = "#111";
            mediaElement.style.borderRadius = "8px";
        }

        mediaElement.dataset.participantId = String(userId);

        container.appendChild(mediaElement);

        groupRemoteMediaElements.set(userId, mediaElement);
    }

    mediaElement.srcObject = stream;

    mediaElement.play().catch((error) => {
        console.warn(
            "Group media autoplay was blocked:",
            error
        );
    });

    console.log(
        "Displaying group media for participant:",
        userId
    );
}

function createGroupPeerConnection(participantId) {
    const userId = Number(participantId);

    if (groupPeerConnections.has(userId)) {
        return groupPeerConnections.get(userId);
    }

    const connection = new RTCPeerConnection(rtcConfiguration);

    groupPeerConnections.set(userId, connection);

    // Attach microphone and camera tracks.
    if (groupLocalStream) {
        for (const track of groupLocalStream.getTracks()) {
            connection.addTrack(track, groupLocalStream);
        }
    }

    connection.onicecandidate = (event) => {
        if (!event.candidate || !activeGroupCallId) {
            return;
        }

        socket.emit("group_webrtc_ice_candidate", {
            group_id: activeGroupCallGroupId,
            call_id: activeGroupCallId,
            target_user_id: userId,
            candidate: event.candidate.toJSON()
        });
    };

    // Receive audio and video from this participant.
    const remoteStream = new MediaStream();

    connection.ontrack = (event) => {
        console.log(
            "Received group media track:",
            userId,
            event.track.kind
        );

        if (!remoteStream.getTracks().some(
            track => track.id === event.track.id
        )) {
            remoteStream.addTrack(event.track);
        }

        displayGroupRemoteStream(userId, remoteStream);
    };

    connection.onconnectionstatechange = () => {
        console.log(
            "Group peer connection:",
            userId,
            connection.connectionState
        );
    };

    return connection;
}

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

        blackpillAlert(
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

        blackpillAlert("Failed to establish the WebRTC connection.");
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
const mediaDocumentOption = document.getElementById("media-document-option");

// Hidden document file selector
const documentFileInput = document.createElement("input");
documentFileInput.type = "file";
documentFileInput.accept = ".pdf,.doc,.docx,.xls,.xlsx,.txt";
documentFileInput.hidden = true;
document.body.appendChild(documentFileInput);

// Open document selector for the selected conversation
mediaDocumentOption.addEventListener("click", () => {
    closeMediaDropdown();

    if (!selectedUser && !selectedGroup) {
        blackpillAlert("Please select a conversation first.");
        return;
    }

    documentFileInput.value = "";
    documentFileInput.click();
});
const mediaCameraOption = document.getElementById("media-camera-option");
const cameraInput = document.getElementById("camera-input");

let cameraDestination = null;

// Automatically upload photos captured using the camera.
cameraInput.addEventListener("change", async () => {
    const destination = cameraDestination;
    const photo = cameraInput.files[0];

    cameraDestination = null;

    if (!photo || !destination) {
        cameraInput.value = "";
        return;
    }

    const allowedTypes = new Set([
        "image/jpeg",
        "image/png",
        "image/webp",
        "image/gif"
    ]);

    if (!allowedTypes.has(photo.type)) {
        blackpillAlert("Unsupported camera image format.");
        cameraInput.value = "";
        return;
    }

    if (photo.size > 10 * 1024 * 1024) {
        blackpillAlert("Camera photo must be 10 MB or smaller.");
        cameraInput.value = "";
        return;
    }

    const formData = new FormData();
    let uploadUrl;

    if (destination.type === "group") {
        formData.append("media", photo);
        uploadUrl = `/groups/${destination.id}/upload-media`;
    } else {
        formData.append("receiver_id", destination.id);
        formData.append("image", photo);
        uploadUrl = "/chat/send-image";
    }

    mediaCameraOption.disabled = true;

    try {
        const response = await fetch(uploadUrl, {
            method: "POST",
            body: formData
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || "Could not send camera photo."
            );
        }

        // Private messages are rendered after successful upload.
        if (
            destination.type === "private" &&
            selectedUser &&
            Number(selectedUser.id) === Number(destination.id) &&
            data.data
        ) {
            renderMessage(data.data);
        }

        // Group messages are rendered by the Socket.IO listener.

    } catch (error) {
        console.error("Camera photo upload failed:", error);
        blackpillAlert(error.message || "Could not send camera photo.");

    } finally {
        cameraInput.value = "";
        mediaCameraOption.disabled = false;
    }
});


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



// Upload audio files in private and group conversations.
const mediaAudioOption = document.getElementById("media-audio-option");

const sharedAudioFileInput = document.createElement("input");
sharedAudioFileInput.type = "file";
sharedAudioFileInput.accept = ".mp3,.wav,.m4a,.ogg";
sharedAudioFileInput.hidden = true;
document.body.appendChild(sharedAudioFileInput);

mediaAudioOption.addEventListener("click", () => {
    closeMediaDropdown();

    if (!selectedUser && !selectedGroup) {
        blackpillAlert("Please select a conversation first.");
        return;
    }

    sharedAudioFileInput.value = "";
    sharedAudioFileInput.click();
});

sharedAudioFileInput.addEventListener("change", async () => {
    const file = sharedAudioFileInput.files[0];

    if (!file) return;

    const group = selectedGroup;
    const recipient = group ? null : selectedUser;

    if (!group && !recipient) {
        blackpillAlert("Please select a conversation first.");
        sharedAudioFileInput.value = "";
        return;
    }

    const allowedExtensions = new Set([
        "mp3", "wav", "m4a", "ogg"
    ]);

    const extension = file.name.split(".").pop().toLowerCase();

    if (!allowedExtensions.has(extension)) {
        blackpillAlert("Unsupported audio format.");
        sharedAudioFileInput.value = "";
        return;
    }

    if (file.size === 0 || file.size > 20 * 1024 * 1024) {
        blackpillAlert("Audio must be between 1 byte and 20 MB.");
        sharedAudioFileInput.value = "";
        return;
    }

    const formData = new FormData();

    if (group) {
        formData.append("media", file);
        formData.append("shared_audio", "1");
    } else {
        formData.append("receiver_id", recipient.id);
        formData.append("audio", file);
    }

    const url = group
        ? `/groups/${group.id}/upload-media`
        : "/chat/send-shared-audio";

    mediaAudioOption.disabled = true;

    try {
        const response = await fetch(url, {
            method: "POST",
            body: formData
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(
                result.error || "Could not send audio."
            );
        }

        if (result.data) {
            if (
                group &&
                selectedGroup &&
                Number(selectedGroup.id) === Number(group.id)
            ) {
                renderGroupMessage(result.data);
            } else if (
                recipient &&
                !selectedGroup &&
                selectedUser &&
                Number(selectedUser.id) === Number(recipient.id)
            ) {
                renderMessage(result.data);
            }
        }

    } catch (error) {
        console.error("Audio upload failed:", error);
        blackpillAlert(error.message || "Could not send audio.");

    } finally {
        sharedAudioFileInput.value = "";
        mediaAudioOption.disabled = false;
    }
});


// Upload documents in private and group conversations.
documentFileInput.addEventListener("change", async () => {
    const file = documentFileInput.files[0];

    if (!file) return;

    const group = selectedGroup;
    const recipient = group ? null : selectedUser;

    if (!group && !recipient) {
        blackpillAlert("Please select a conversation first.");
        documentFileInput.value = "";
        return;
    }

    const allowedExtensions = new Set([
        "pdf", "doc", "docx", "xls", "xlsx", "txt"
    ]);

    const extension = file.name.split(".").pop().toLowerCase();

    if (!allowedExtensions.has(extension)) {
        blackpillAlert("Unsupported document type.");
        documentFileInput.value = "";
        return;
    }

    if (file.size === 0 || file.size > 20 * 1024 * 1024) {
        blackpillAlert("Document must be between 1 byte and 20 MB.");
        documentFileInput.value = "";
        return;
    }

    const formData = new FormData();

    if (group) {
        formData.append("media", file);
    } else {
        formData.append("receiver_id", recipient.id);
        formData.append("document", file);
    }

    const url = group
        ? `/groups/${group.id}/upload-media`
        : "/chat/send-document";

    mediaDocumentOption.disabled = true;

    try {
        const response = await fetch(url, {
            method: "POST",
            body: formData
        });

        const result = await response.json();

        if (!response.ok) {
            throw new Error(
                result.error || "Could not send document."
            );
        }

        if (result.data) {
            if (
                group &&
                selectedGroup &&
                Number(selectedGroup.id) === Number(group.id)
            ) {
                renderGroupMessage(result.data);
            } else if (
                recipient &&
                !selectedGroup &&
                selectedUser &&
                Number(selectedUser.id) === Number(recipient.id)
            ) {
                renderMessage(result.data);
            }
        }

    } catch (error) {
        console.error("Document upload failed:", error);
        blackpillAlert(error.message || "Could not send document.");

    } finally {
        documentFileInput.value = "";
        mediaDocumentOption.disabled = false;
    }
});


// Open the phone camera for the currently selected conversation.
mediaCameraOption.addEventListener("click", () => {
    closeMediaDropdown();

    if (!selectedUser && !selectedGroup) {
        return;
    }

    cameraDestination = selectedGroup
        ? { type: "group", id: selectedGroup.id }
        : { type: "private", id: selectedUser.id };

    openChatCamera();
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

// Real-time group message reaction updates
socket.on("group_message_reaction", (data) => {
    if (
        !selectedGroup ||
        Number(data.group_id) !== Number(selectedGroup.id)
    ) {
        return;
    }

    renderGroupMessageReactions(
        data.message_id,
        data.reactions || []
    );
});


// MODERN GROUP MESSAGE ACTION DISMISSAL

function closeGroupMessageActions() {
    document.querySelectorAll(
        ".group-message-actions"
    ).forEach((menu) => {
        menu.hidden = true;
    });
}

// Close the floating menu when clicking outside a group message.
document.addEventListener("click", (event) => {
    if (event.target.closest(
        ".message-row[data-group-message-id] .message-bubble"
    )) {
        return;
    }

    closeGroupMessageActions();
});

// Close the floating menu when pressing Escape.
document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
        closeGroupMessageActions();
    }
});

// Close the floating menu when scrolling the conversation.
messagesElement.addEventListener("scroll", () => {
    closeGroupMessageActions();
}, { passive: true });


// Live camera preview
const cameraModal = document.getElementById("camera-modal");
const cameraPreview = document.getElementById("camera-preview");
const cameraCancelButton = document.getElementById("camera-cancel-button");

let cameraStream = null;

async function openChatCamera() {
    if (!navigator.mediaDevices?.getUserMedia) {
        blackpillAlert("Camera access requires HTTPS or localhost in a supported browser.");
        cameraDestination = null;
        return;
    }

    cameraModal.hidden = false;
    cameraModal.style.display = "flex";

    try {
        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { facingMode: { ideal: "environment" } },
            audio: false
        });

        cameraPreview.srcObject = cameraStream;
        await cameraPreview.play();

    } catch (error) {
        console.error("Camera access failed:", error);
        blackpillAlert("Could not open camera. Check Firefox camera permissions.");
        closeChatCamera();
    }
}

function closeChatCamera() {
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => track.stop());
        cameraStream = null;
    }

    cameraPreview.pause();
    cameraPreview.srcObject = null;

    cameraModal.hidden = true;
    cameraModal.style.display = "none";
    cameraDestination = null;
}

// Capture a photo from the webcam.
const cameraCanvas = document.getElementById("camera-canvas");
const cameraPhotoPreview = document.getElementById("camera-photo-preview");
const cameraCaptureButton = document.getElementById("camera-capture-button");
const cameraRetakeButton = document.getElementById("camera-retake-button");
const cameraSendButton = document.getElementById("camera-send-button");

let capturedCameraPhoto = null;

cameraCancelButton.addEventListener("click", closeChatCamera);

// Send a captured webcam photo to the selected conversation.
cameraSendButton.addEventListener("click", async () => {
    if (!capturedCameraPhoto || !cameraDestination) {
        blackpillAlert("Take a photo before sending.");
        return;
    }

    const destination = { ...cameraDestination };
    const photo = capturedCameraPhoto;

    if (photo.size > 10 * 1024 * 1024) {
        blackpillAlert("Photo must be 10 MB or smaller.");
        return;
    }

    const formData = new FormData();
    let uploadUrl;

    if (destination.type === "group") {
        formData.append(
            "media",
            photo,
            "camera-photo.jpg"
        );

        uploadUrl = `/groups/${destination.id}/upload-media`;

    } else {
        formData.append("receiver_id", destination.id);

        formData.append(
            "image",
            photo,
            "camera-photo.jpg"
        );

        uploadUrl = "/chat/send-image";
    }

    cameraSendButton.disabled = true;

    try {
        const response = await fetch(uploadUrl, {
            method: "POST",
            body: formData
        });

        const data = await response.json();

        if (!response.ok) {
            throw new Error(
                data.error || "Could not send camera photo."
            );
        }

        if (
            destination.type === "private" &&
            selectedUser &&
            Number(selectedUser.id) === Number(destination.id) &&
            data.data
        ) {
            renderMessage(data.data);
        }

        // Group messages are handled by the Socket.IO listener.

        closeChatCamera();

    } catch (error) {
        console.error("Camera photo send failed:", error);
        blackpillAlert(error.message || "Could not send camera photo.");

    } finally {
        cameraSendButton.disabled = false;
    }
});


// Retake a webcam photo.
cameraRetakeButton.addEventListener("click", () => {
    capturedCameraPhoto = null;

    if (cameraPhotoPreview.src.startsWith("blob:")) {
        URL.revokeObjectURL(cameraPhotoPreview.src);
    }

    cameraPhotoPreview.removeAttribute("src");
    cameraPhotoPreview.hidden = true;

    cameraPreview.hidden = false;
    cameraCaptureButton.hidden = false;

    cameraRetakeButton.hidden = true;
    cameraSendButton.hidden = true;
});



cameraCaptureButton.addEventListener("click", () => {
    if (!cameraStream || !cameraPreview.videoWidth) {
        blackpillAlert("Camera is not ready yet.");
        return;
    }

    cameraCanvas.width = cameraPreview.videoWidth;
    cameraCanvas.height = cameraPreview.videoHeight;

    const context = cameraCanvas.getContext("2d");

    context.drawImage(
        cameraPreview,
        0,
        0,
        cameraCanvas.width,
        cameraCanvas.height
    );

    cameraCanvas.toBlob((blob) => {
        if (!blob) {
            blackpillAlert("Could not capture photo.");
            return;
        }

        capturedCameraPhoto = blob;

        cameraPhotoPreview.src = URL.createObjectURL(blob);
        cameraPhotoPreview.hidden = false;

        cameraPreview.hidden = true;
        cameraCaptureButton.hidden = true;

        cameraRetakeButton.hidden = false;
        cameraSendButton.hidden = false;

    }, "image/jpeg", 0.85);
});



// ========================================
// Share Contact — Private and Group Chats
// ========================================

const mediaContactOption = document.getElementById("media-contact-option");

if (mediaContactOption) {
    mediaContactOption.addEventListener("click", async () => {
        closeMediaDropdown();

        if (!selectedUser && !selectedGroup) {
            blackpillAlert("Please select a conversation first.");
            return;
        }

        const destination = selectedGroup
            ? { type: "group", id: selectedGroup.id }
            : { type: "private", id: selectedUser.id };

        // Android: use the native phone contact picker when supported.
        // Desktop: preserve the existing manual contact-sharing method.
        const isAndroid = /Android/i.test(navigator.userAgent);

        let pickedContact = null;

        if (isAndroid && navigator.contacts?.select) {
            try {
                const contacts = await navigator.contacts.select(
                    ["name", "tel"],
                    { multiple: false }
                );

                if (!contacts.length) return;

                const contact = contacts[0];

                pickedContact = {
                    name: (contact.name?.[0] || "").trim(),
                    phone: (contact.tel?.[0] || "").trim()
                };

                if (!pickedContact.name || !pickedContact.phone) {
                    blackpillAlert("The selected contact needs a name and phone number.");
                    return;
                }
            } catch (error) {
                if (error.name === "AbortError") return;

                blackpillAlert("Could not open phone contacts: " + error.message);
                return;
            }
        }

        const nameInput = pickedContact
            ? pickedContact.name
            : await blackpillPrompt(
                "Enter contact name:",
                "",
                "Share Contact"
            );

        if (nameInput === null) return;

        const name = nameInput.trim();

        if (!name || name.length > 100) {
            blackpillAlert("Contact name must be 1–100 characters.");
            return;
        }

        const phoneInput = pickedContact
            ? pickedContact.phone
            : await blackpillPrompt(
                "Enter contact phone number:",
                "",
                "Share Contact"
            );

        if (phoneInput === null) return;

        const phone = phoneInput.trim();

        if (!/^\+?[0-9][0-9 ()-]*$/.test(phone)) {
            blackpillAlert("Please enter a valid phone number.");
            return;
        }

        const url = destination.type === "group"
            ? `/groups/${destination.id}/send-contact`
            : "/chat/send-contact";

        const payload = {
            name,
            phone
        };

        if (destination.type === "private") {
            payload.receiver_id = destination.id;
        }

        try {
            const response = await fetch(url, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json"
                },
                body: JSON.stringify(payload)
            });

            const result = await response.json();

            if (!response.ok) {
                throw new Error(
                    result.error || "Failed to share contact."
                );
            }

            console.log("Contact shared:", result.data);

        } catch (error) {
            blackpillAlert(error.message || "Failed to share contact.");
        }
    });
}

// ========================================
// Shared Contact Card
// ========================================

function createSharedContactCard(message) {
    const card = document.createElement("div");
    card.className = "shared-contact-card";

    let contact;

    try {
        contact = JSON.parse(message.content);
    } catch (error) {
        card.textContent = "Invalid shared contact.";
        return card;
    }

    if (
        !contact ||
        typeof contact.name !== "string" ||
        typeof contact.phone !== "string"
    ) {
        card.textContent = "Invalid shared contact.";
        return card;
    }

    const name = contact.name.trim();
    const phone = contact.phone.trim();

    if (!name || !phone) {
        card.textContent = "Invalid shared contact.";
        return card;
    }

    const contactName = document.createElement("div");
    contactName.textContent = "👤 " + name;
    contactName.style.fontWeight = "bold";
    contactName.style.marginBottom = "6px";

    const contactPhone = document.createElement("div");
    contactPhone.textContent = "📞 " + phone;
    contactPhone.style.marginBottom = "10px";

    const saveButton = document.createElement("button");
    saveButton.type = "button";
    saveButton.textContent = "💾 Save Contact";

    saveButton.style.cssText = `
        padding: 8px 12px;
        border: none;
        border-radius: 8px;
        background: #1976d2;
        color: white;
        cursor: pointer;
        font-weight: 600;
    `;

    saveButton.addEventListener("click", () => {
        const escapeVCard = (value) =>
            value
                .replace(/\\/g, "\\\\")
                .replace(/\n/g, "\\n")
                .replace(/;/g, "\\;")
                .replace(/,/g, "\\,");

        const vcard = [
            "BEGIN:VCARD",
            "VERSION:3.0",
            "FN:" + escapeVCard(name),
            "TEL;TYPE=CELL:" + escapeVCard(phone),
            "END:VCARD",
            ""
        ].join("\r\n");

        const blob = new Blob(
            [vcard],
            { type: "text/vcard;charset=utf-8" }
        );

        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");

        link.href = url;
        link.download =
            name.replace(/[^a-zA-Z0-9_-]/g, "_") + ".vcf";

        document.body.appendChild(link);
        link.click();
        link.remove();

        setTimeout(() => URL.revokeObjectURL(url), 1000);
    });

    card.appendChild(contactName);
    card.appendChild(contactPhone);
    card.appendChild(saveButton);

    return card;
}


// BLACK PILL INCOMING CALL CLEANUP

socket.on("call_ended", (data) => {
    if (
        pendingIncomingCall &&
        String(data.call_id) === String(pendingIncomingCall.call_id)
    ) {
        console.log(
            "Incoming call cancelled before answering:",
            data.call_id
        );

        closeIncomingCallScreen();
    }
});


// BLACK PILL CALL MICROPHONE CONTROLS

function setCallMicrophoneEnabled(enabled) {
    const stream = activeGroupCallId
        ? groupLocalStream
        : activeCallId
            ? localCallStream
            : null;

    const tracks = stream?.getAudioTracks() || [];

    if (!tracks.length) {
        blackpillAlert(
            "No active microphone is available.",
            "Microphone"
        );
        return;
    }

    tracks.forEach(track => {
        track.enabled = enabled;
    });

    document.getElementById("call-microphone-control")
        ?.setAttribute("aria-pressed", String(enabled));

    document.getElementById("call-mute-control")
        ?.setAttribute("aria-pressed", String(!enabled));

    console.log(
        enabled ? "Microphone enabled" : "Microphone muted"
    );
}

document.getElementById("call-microphone-control")
    ?.addEventListener("click", () => {
        setCallMicrophoneEnabled(true);
    });

document.getElementById("call-mute-control")
    ?.addEventListener("click", () => {
        setCallMicrophoneEnabled(false);
    });


// BLACK PILL CALL CAMERA CONTROLS

function setCallCameraEnabled(enabled) {
    const stream = activeGroupCallId
        ? groupLocalStream
        : activeCallId
            ? localCallStream
            : null;

    const tracks = stream?.getVideoTracks() || [];

    if (!tracks.length) {
        blackpillAlert(
            "Camera video is not available in this call. Start a video call to use the camera.",
            "Camera"
        );
        return;
    }

    tracks.forEach(track => {
        track.enabled = enabled;
    });

    const videoButton = document.getElementById(
        "call-video-control"
    );

    const cameraOffButton = document.getElementById(
        "call-camera-off-control"
    );

    videoButton?.setAttribute(
        "aria-pressed",
        String(enabled)
    );

    cameraOffButton?.setAttribute(
        "aria-pressed",
        String(!enabled)
    );

    console.log(
        enabled ? "Camera enabled" : "Camera disabled"
    );
}

document.getElementById("call-video-control")
    ?.addEventListener("click", () => {
        setCallCameraEnabled(true);
    });

document.getElementById("call-camera-off-control")
    ?.addEventListener("click", () => {
        setCallCameraEnabled(false);
    });
