const currentUserElement = document.getElementById("current-user");
const usersListElement = document.getElementById("users-list");
const conversationNameElement = document.getElementById("conversation-name");
const conversationStatusElement = document.getElementById("conversation-status");
const messagesElement = document.getElementById("messages");

const messageForm = document.getElementById("message-form");
const messageInput = document.getElementById("message-input");
const sendButton = document.getElementById("send-button");
const logoutButton = document.getElementById("logout-button");

let currentUser = null;
let selectedUser = null;

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
        const userElement = document.createElement("div");

        userElement.className = "user-item";
        userElement.dataset.userId = user.id;

        const nameElement = document.createElement("div");
        nameElement.className = "user-item-name";
        nameElement.textContent = user.username;

        const emailElement = document.createElement("div");
        emailElement.className = "user-item-email";
        emailElement.textContent = user.email;

        userElement.appendChild(nameElement);
        userElement.appendChild(emailElement);

        userElement.addEventListener("click", () => {
            selectUser(user, userElement);
        });

        usersListElement.appendChild(userElement);
    });
}


async function selectUser(user, userElement) {
    selectedUser = user;

    document.querySelectorAll(".user-item").forEach((element) => {
        element.classList.remove("active");
    });

    userElement.classList.add("active");

    conversationNameElement.textContent = user.username;
    conversationStatusElement.textContent = user.email;

    messageInput.disabled = false;
    sendButton.disabled = false;

    messageInput.focus();

    await loadConversation(user.id);
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

    const content = document.createElement("div");
    content.textContent = message.content;

    const time = document.createElement("span");
    time.className = "message-time";
    time.textContent = formatTime(message.created_at);

    bubble.appendChild(content);
    bubble.appendChild(time);
    row.appendChild(bubble);

    messagesElement.appendChild(row);

    scrollToBottom();
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


messageForm.addEventListener("submit", (event) => {
    event.preventDefault();

    if (!selectedUser) {
        return;
    }

    const content = messageInput.value.trim();

    if (!content) {
        return;
    }

    socket.emit("send_message", {
        receiver_id: selectedUser.id,
        content: content
    });

    messageInput.value = "";
    messageInput.focus();
});


socket.on("connect", () => {
    console.log("Socket.IO connected.");
});


socket.on("message_sent", (message) => {
    if (
        selectedUser &&
        message.receiver_id === selectedUser.id
    ) {
        renderMessage(message);
    }
});


socket.on("new_message", (message) => {
    if (
        selectedUser &&
        message.sender_id === selectedUser.id
    ) {
        renderMessage(message);
    }
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

    } catch (error) {
        console.error("Chat initialization error:", error);

        window.location.href = "/login";
    }
}


initializeChat();
