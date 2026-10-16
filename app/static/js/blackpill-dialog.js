// ========================================
// BLACK PILL GLASS DIALOG SYSTEM
// ========================================

(() => {
    "use strict";

    const overlay = document.getElementById(
        "blackpill-dialog-overlay"
    );

    const title = document.getElementById(
        "blackpill-dialog-title"
    );

    const message = document.getElementById(
        "blackpill-dialog-message"
    );

    const input = document.getElementById(
        "blackpill-dialog-input"
    );

    const cancelButton = document.getElementById(
        "blackpill-dialog-cancel"
    );

    const okButton = document.getElementById(
        "blackpill-dialog-ok"
    );

    if (
        !overlay ||
        !title ||
        !message ||
        !input ||
        !cancelButton ||
        !okButton
    ) {
        console.error("Black Pill dialog elements are missing.");
        return;
    }

    const queue = [];
    let activeDialog = null;

    function showNextDialog() {
        if (activeDialog || queue.length === 0) {
            return;
        }

        activeDialog = queue.shift();

        title.textContent = activeDialog.title;
        message.textContent = activeDialog.message;

        const mode = activeDialog.mode;

        cancelButton.hidden = mode === "alert";
        input.hidden = mode !== "prompt";

        input.value = activeDialog.defaultValue || "";

        overlay.hidden = false;

        if (mode === "prompt") {
            input.focus();
            input.select();
        } else {
            okButton.focus();
        }
    }

    function finishDialog(accepted) {
        if (!activeDialog) {
            return;
        }

        const dialog = activeDialog;

        let result;

        if (dialog.mode === "alert") {
            result = undefined;
        } else if (dialog.mode === "confirm") {
            result = accepted;
        } else {
            result = accepted ? input.value : null;
        }

        overlay.hidden = true;
        activeDialog = null;

        dialog.resolve(result);

        showNextDialog();
    }

    function openDialog(
        mode,
        text,
        heading = "Black Pill",
        defaultValue = ""
    ) {
        return new Promise((resolve) => {
            queue.push({
                mode,
                message: String(text ?? ""),
                title: String(heading),
                defaultValue: String(defaultValue ?? ""),
                resolve
            });

            showNextDialog();
        });
    }

    window.blackpillAlert = (text, heading) => {
        return openDialog("alert", text, heading);
    };

    window.blackpillConfirm = (text, heading) => {
        return openDialog("confirm", text, heading);
    };

    window.blackpillPrompt = (
        text,
        defaultValue = "",
        heading = "Black Pill"
    ) => {
        return openDialog(
            "prompt",
            text,
            heading,
            defaultValue
        );
    };

    okButton.addEventListener("click", () => {
        finishDialog(true);
    });

    cancelButton.addEventListener("click", () => {
        finishDialog(false);
    });

    overlay.addEventListener("keydown", (event) => {
        if (event.key === "Escape") {
            event.preventDefault();

            if (activeDialog?.mode !== "alert") {
                finishDialog(false);
            }
        }

        if (
            event.key === "Enter" &&
            event.target === input
        ) {
            event.preventDefault();
            finishDialog(true);
        }

        if (event.key === "Tab" && activeDialog) {
            const controls = [
                input,
                cancelButton,
                okButton
            ].filter(element => !element.hidden);

            const first = controls[0];
            const last = controls[controls.length - 1];

            if (event.shiftKey && document.activeElement === first) {
                event.preventDefault();
                last.focus();
            } else if (
                !event.shiftKey &&
                document.activeElement === last
            ) {
                event.preventDefault();
                first.focus();
            }
        }
    });

    console.log("Black Pill glass dialog system ready.");
})();
