# Devin Design Mode

A Chrome extension that brings Cursor-style Design Mode to Devin sessions.

## What it does

- Press **Cmd/Ctrl+Shift+D** or click the extension icon to toggle Design Mode on any page.
- **Hover** to preview elements.
- **Click** to select an element.
- **Cmd/Ctrl+Click** to multi-select or deselect.
- **Shift+drag** (or just drag) to draw a box and select every element inside it.
- Click **Ask Devin**, type what you want changed, and the extension sends a rich message to your active Devin session with:
  - Page URL and viewport
  - Element selectors, bounding boxes, computed styles, and React/Vue component names
  - A full-page screenshot (as base64 markdown in v1)

## Setup

1. Open Chrome → Extensions → Manage Extensions.
2. Turn on **Developer mode**.
3. Click **Load unpacked** and select this folder.
4. Open the extension popup and click **Open Settings**.
5. Add your Devin API key and session ID.
   - API key: from [app.devin.ai/settings/api-keys](https://app.devin.ai/settings/api-keys)
   - Session ID: from `app.devin.ai/sessions/<id>`

## API notes

- **v1 (recommended for personal keys)**: sends a text message. Screenshots are embedded as base64 markdown inside the message. Whether Devin displays the image depends on the Devin client.
- **v3**: requires a **service user** API key with `ManageOrgSessions`, an **org ID**, and a session ID starting with `devin-` (the extension auto-adds the prefix if missing). v3 supports `attachment_urls`, but this MVP does not upload images; it sends the same base64 markdown as v1.

## Known limitations

- Devin v1 API does not accept native image attachments, so screenshots are embedded as markdown. If Devin does not display them, switch to **No screenshot** mode and rely on the element data.
- Screenshots are full-page captures, not cropped to the selection. The selection bounds are included so Devin knows the area of interest.
- Cross-origin iframes cannot be inspected.
- Very large pages or deeply nested DOMs may produce long messages.

## How to use

1. Open your local web app in Chrome.
2. Toggle Design Mode.
3. Select the elements or area you want changed.
4. Click **Ask Devin** and describe the change.
5. Switch back to your Devin session to see the agent work on it.