import { waitForEvenAppBridge } from "@evenrealities/even_hub_sdk";

async function init() {
  console.log("[NoteWriter] Initializing...");
  const bridge = await waitForEvenAppBridge();
  console.log("[NoteWriter] Bridge ready:", bridge);
}

init().catch((err) => {
  console.error("[NoteWriter] Init failed:", err);
});
