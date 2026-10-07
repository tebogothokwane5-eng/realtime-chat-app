const registerForm = document.getElementById("register-form");
const messageElement = document.getElementById("message");

registerForm.addEventListener("submit", async (event) => {
    event.preventDefault();

    messageElement.textContent = "";
    messageElement.className = "";

    const username =
        document.getElementById("username").value.trim();

    const email =
        document.getElementById("email").value.trim();

    const password =
        document.getElementById("password").value;

    try {
        const response = await fetch("/auth/register", {
            method: "POST",
            headers: {
                "Content-Type": "application/json"
            },
            body: JSON.stringify({
                username: username,
                email: email,
                password: password
            })
        });

        const data = await response.json();

        if (!response.ok) {
            messageElement.textContent =
                data.error || "Registration failed.";

            messageElement.className = "error";
            return;
        }

        messageElement.textContent =
            "Account created. Redirecting to login...";

        messageElement.className = "success";

        setTimeout(() => {
            window.location.href = "/login";
        }, 1000);

    } catch (error) {
        console.error("Registration error:", error);

        messageElement.textContent =
            "Could not connect to the server.";

        messageElement.className = "error";
    }
});
