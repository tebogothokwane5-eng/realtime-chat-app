document.addEventListener("DOMContentLoaded", () => {
    const chatsButton = document.getElementById("chats-tab-button");
    const statusButton = document.getElementById("status-tab-button");

    const statusPanel = document.getElementById("status-panel");

    const groupSection = document.querySelector(".group-chat-section");
    const privateSection = document.querySelector(".private-chat-section");
    const usersList = document.getElementById("users-list");

    if (
        !chatsButton ||
        !statusButton ||
        !statusPanel ||
        !groupSection ||
        !privateSection ||
        !usersList
    ) {
        console.error("Black Pill navigation elements not found.");
        return;
    }

    function switchTab(tab) {
        const showingStatus = tab === "status";

        statusPanel.hidden = !showingStatus;

        groupSection.hidden = showingStatus;
        privateSection.hidden = showingStatus;
        usersList.hidden = showingStatus;

        chatsButton.classList.toggle("active", !showingStatus);
        statusButton.classList.toggle("active", showingStatus);

        chatsButton.setAttribute(
            "aria-selected",
            String(!showingStatus)
        );

        statusButton.setAttribute(
            "aria-selected",
            String(showingStatus)
        );
    }

    chatsButton.addEventListener("click", () => {
        switchTab("chats");
    });

    statusButton.addEventListener("click", () => {
        switchTab("status");
    });

    switchTab("chats");

    console.log("Black Pill Status navigation initialized.");
});


// BLACK PILL STATUS FORM CONTROLS

document.addEventListener("DOMContentLoaded", () => {
    const addButton = document.getElementById("add-status-button");
    const cancelButton = document.getElementById("cancel-status-button");
    const form = document.getElementById("create-status-form");
    const content = document.getElementById("status-content");
    const message = document.getElementById("status-form-message");

    if (!addButton || !cancelButton || !form || !content || !message) {
        console.error("Status form elements not found.");
        return;
    }

    addButton.addEventListener("click", () => {
        form.hidden = false;
        addButton.hidden = true;
        message.textContent = "";
        content.focus();
    });

    cancelButton.addEventListener("click", () => {
        form.hidden = true;
        addButton.hidden = false;
        form.reset();
        message.textContent = "";
    });

    console.log("Black Pill Status form controls initialized.");
});


// BLACK PILL TEXT STATUS PUBLISHING

document.addEventListener("DOMContentLoaded", () => {
    const form = document.getElementById("create-status-form");
    const content = document.getElementById("status-content");
    const privacy = document.getElementById("status-privacy");
    const photoInput = document.getElementById("status-photo");
    const videoInput = document.getElementById("status-video");
    const audioInput = document.getElementById("status-audio");
    const message = document.getElementById("status-form-message");
    const publishButton = document.getElementById("publish-status-button");
    const addButton = document.getElementById("add-status-button");

    if (!form || !content || !privacy || !photoInput || !videoInput || !audioInput || !message || !publishButton) {
        console.error("Text status publishing elements not found.");
        return;
    }

    form.addEventListener("submit", async (event) => {
        event.preventDefault();

        const text = content.value.trim();

        // BLACK PILL VIDEO STATUS UPLOAD HANDLER
        const photo = photoInput.files[0];
        const video = videoInput.files[0];
        const audio = audioInput.files[0];

        if (!text && !photo && !video && !audio) {
            message.textContent = "Write a status or choose a photo, video, or audio file.";
            return;
        }

        if ([photo, video, audio].filter(Boolean).length > 1) {
            message.textContent = "Choose only one media file: photo, video, or audio.";
            return;
        }

        if (photo && photo.size > 10 * 1024 * 1024) {
            message.textContent = "Photo exceeds the 10 MB limit.";
            return;
        }

        if (video && video.size > 50 * 1024 * 1024) {
            message.textContent = "Video exceeds the 50 MB limit.";
            return;
        }

        if (video && !/\.(mp4|webm)$/i.test(video.name)) {
            message.textContent = "Only MP4 and WebM videos are supported.";
            return;
        }

        // BLACK PILL AUDIO STATUS FILE VALIDATION
        if (audio && audio.size > 20 * 1024 * 1024) {
            message.textContent = "Audio exceeds the 20 MB limit.";
            return;
        }

        if (audio && !/\.(mp3|wav|m4a|webm)$/i.test(audio.name)) {
            message.textContent = "Only MP3, WAV, M4A, and WebM audio files are supported.";
            return;
        }

        if (audio && text.length > 500) {
            message.textContent = "Audio captions cannot exceed 500 characters.";
            return;
        }

        // BLACK PILL SELECTED CONTACTS PUBLISHING
        const selectedUserIds = Array.from(
            document.querySelectorAll(
                "#status-contact-options .status-contact-checkbox:checked"
            )
        ).map((checkbox) => Number(checkbox.value));

        if (privacy.value === "selected" && selectedUserIds.length === 0) {
            message.textContent = "Please select at least one contact.";
            return;
        }

        publishButton.disabled = true;
        message.textContent = "Publishing status...";

        try {
            let response;

            if (video) {
                const formData = new FormData();

                // BLACK PILL VIDEO CAPTION UPLOAD
                formData.append("video", video);
                formData.append("content", text);
                formData.append("privacy", privacy.value);

                if (privacy.value === "selected") {
                    selectedUserIds.forEach((id) => {
                        formData.append("selected_user_ids", String(id));
                    });
                }

                response = await fetch("/status/video", {
                    method: "POST",
                    credentials: "same-origin",
                    body: formData
                });

            } else if (audio) {
                // BLACK PILL AUDIO STATUS UPLOAD HANDLER
                const formData = new FormData();

                formData.append("audio", audio);
                formData.append("content", text);
                formData.append("privacy", privacy.value);

                if (privacy.value === "selected") {
                    selectedUserIds.forEach((id) => {
                        formData.append("selected_user_ids", String(id));
                    });
                }

                response = await fetch("/status/audio", {
                    method: "POST",
                    credentials: "same-origin",
                    body: formData
                });

            } else if (photo) {
                const formData = new FormData();
                formData.append("photo", photo);
                formData.append("content", text);
                formData.append("privacy", privacy.value);

                if (privacy.value === "selected") {
                    selectedUserIds.forEach((id) => {
                        formData.append("selected_user_ids", String(id));
                    });
                }

                response = await fetch("/status/photo", {
                    method: "POST",
                    credentials: "same-origin",
                    body: formData
                });
            } else {
                response = await fetch("/status/text", {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json"
                    },
                    credentials: "same-origin",
                    body: JSON.stringify({
                        content: text,
                        privacy: privacy.value,
                        selected_user_ids: privacy.value === "selected"
                            ? selectedUserIds
                            : []
                    })
                });
            }

            const result = await response.json();

            if (!response.ok) {
                throw new Error(
                    result.error ||
                    result.message ||
                    "Failed to publish status."
                );
            }

            form.reset();
            form.hidden = true;

            if (addButton) {
                addButton.hidden = false;
            }

            message.textContent = "";

            blackpillAlert("Status published successfully!", "Black Pill");

        } catch (error) {
            message.textContent = error.message;
        } finally {
            publishButton.disabled = false;
        }
    });
});


// BLACK PILL STATUS FEED

document.addEventListener("DOMContentLoaded", () => {
    const myList = document.getElementById("my-status-list");
    const recentList = document.getElementById("recent-status-list");
    const statusButton = document.getElementById("status-tab-button");

    if (!myList || !recentList || !statusButton) {
        console.error("Status feed elements not found.");
        return;
    }

    function createStatusCard(status) {
        const card = document.createElement("div");
        card.className = "blackpill-status-card";

        const username = document.createElement("strong");
        username.textContent = status.username || "Unknown";

        const content = document.createElement("p");
        content.textContent = status.content || "";

        // BLACK PILL PHOTO STATUS DISPLAY
        let photo = null;

        if (status.status_type === "photo" && status.media_url) {
            photo = document.createElement("img");
            photo.src = status.media_url;
            photo.alt = "Status photo from " + (status.username || "user");
            photo.loading = "lazy";
            photo.className = "blackpill-status-photo";
        }

        // BLACK PILL VIDEO STATUS DISPLAY
        let video = null;

        if (status.status_type === "video" && status.media_url) {
            video = document.createElement("video");

            video.src = status.media_url;
            video.controls = true;
            video.preload = "metadata";
            video.playsInline = true;

            video.className = "blackpill-status-video";
        }

        // BLACK PILL AUDIO STATUS DISPLAY
        let audio = null;

        if (status.status_type === "audio" && status.media_url) {
            audio = document.createElement("audio");

            audio.src = status.media_url;
            audio.controls = true;
            audio.preload = "metadata";

            audio.className = "blackpill-status-audio";
        }

        const time = document.createElement("small");

        if (status.created_at) {
            const date = new Date(status.created_at);
            time.textContent = Number.isNaN(date.getTime())
                ? ""
                : date.toLocaleString();
        }

        card.appendChild(username);

        // BLACK PILL VIDEO CAPTION POSITION
        if (status.content && !photo && !video && !audio) {
            card.appendChild(content);
        }

        if (photo) {
            card.appendChild(photo);

            if (status.content) {
                content.className = "blackpill-photo-caption";
                card.appendChild(content);
            }
        }

        if (video) {
            card.appendChild(video);

            if (status.content) {
                content.className = "blackpill-video-caption";
                card.appendChild(content);
            }
        }

        if (audio) {
            card.appendChild(audio);

            if (status.content) {
                content.className = "blackpill-audio-caption";
                card.appendChild(content);
            }
        }

        card.appendChild(time);

        return card;
    }

    async function loadStatuses() {
        myList.textContent = "Loading your statuses...";
        recentList.textContent = "Loading recent updates...";

        try {
            const response = await fetch("/status/feed", {
                credentials: "same-origin"
            });

            if (!response.ok) {
                throw new Error("Unable to load statuses.");
            }

            const data = await response.json();
            const statuses = Array.isArray(data.statuses)
                ? data.statuses
                : [];

            const meResponse = await fetch("/auth/me", {
                credentials: "same-origin"
            });

            if (!meResponse.ok) {
                throw new Error("Unable to identify current user.");
            }

            const meData = await meResponse.json();
            const currentUserId = Number(meData.user.id);

            myList.replaceChildren();
            recentList.replaceChildren();

            let myCount = 0;
            let recentCount = 0;

            for (const status of statuses) {
                const card = createStatusCard(status);

                if (Number(status.user_id) === currentUserId) {
                    myList.appendChild(card);
                    myCount++;
                } else {
                    recentList.appendChild(card);
                    recentCount++;
                }
            }

            if (myCount === 0) {
                myList.textContent =
                    "You haven't posted a status yet.";
            }

            if (recentCount === 0) {
                recentList.textContent =
                    "No recent status updates.";
            }

        } catch (error) {
            myList.textContent = error.message;
            recentList.textContent = "";
        }
    }

    statusButton.addEventListener("click", loadStatuses);

    window.loadBlackPillStatuses = loadStatuses;
});


// BLACK PILL STATUS SOCKET.IO
document.addEventListener("DOMContentLoaded", () => {
    const statusPanel = document.getElementById("status-panel");

    if (!statusPanel) {
        return;
    }

    if (typeof socket === "undefined") {
        console.error("Black Pill Socket.IO connection unavailable.");
        return;
    }

    let refreshInProgress = false;
    let refreshPending = false;

    async function refreshStatusFeed() {
        if (statusPanel.hidden ||
            typeof window.loadBlackPillStatuses !== "function") {
            return;
        }

        if (refreshInProgress) {
            refreshPending = true;
            return;
        }

        refreshInProgress = true;

        try {
            do {
                refreshPending = false;
                await window.loadBlackPillStatuses();
            } while (refreshPending && !statusPanel.hidden);
        } catch (error) {
            console.error("Socket.IO status refresh failed:", error);
        } finally {
            refreshInProgress = false;
        }
    }

    socket.on("status_updated", (data) => {
        console.log("Status updated:", data.action);
        refreshStatusFeed();
    });

    socket.on("connect", () => {
        refreshStatusFeed();
    });

    console.log("Black Pill real-time Status listener enabled.");
});


// BLACK PILL SELECTED CONTACTS UI

document.addEventListener("DOMContentLoaded", () => {
    const privacy = document.getElementById("status-privacy");
    const container = document.getElementById("status-selected-contacts");
    const options = document.getElementById("status-contact-options");

    if (!privacy || !container || !options) {
        return;
    }

    async function loadSelectedContacts() {
        options.replaceChildren();

        const loading = document.createElement("p");
        loading.textContent = "Loading contacts...";
        options.appendChild(loading);

        try {
            const response = await fetch("/contacts/", {
                credentials: "same-origin"
            });

            if (!response.ok) {
                throw new Error("Unable to load contacts.");
            }

            const data = await response.json();
            options.replaceChildren();

            const contacts = data.contacts || [];

            if (contacts.length === 0) {
                const empty = document.createElement("p");
                empty.textContent = "You have no contacts yet.";
                options.appendChild(empty);
                return;
            }

            contacts.forEach((contact) => {
                const label = document.createElement("label");
                const checkbox = document.createElement("input");

                checkbox.type = "checkbox";
                checkbox.className = "status-contact-checkbox";
                checkbox.value = String(contact.user_id);

                label.appendChild(checkbox);
                label.appendChild(
                    document.createTextNode(" " + contact.username)
                );

                options.appendChild(label);
                options.appendChild(document.createElement("br"));
            });

        } catch (error) {
            options.replaceChildren();

            const message = document.createElement("p");
            message.textContent = error.message;
            options.appendChild(message);
        }
    }

    privacy.addEventListener("change", () => {
        const selected = privacy.value === "selected";

        container.hidden = !selected;

        if (selected) {
            loadSelectedContacts();
        } else {
            options.replaceChildren();
        }
    });
});
