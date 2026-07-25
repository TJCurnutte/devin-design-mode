# Devin Design Mode

A Chrome extension that brings **Cursor-style Design Mode** to [Devin](https://devin.ai).

Toggle Design Mode on any web page, click or drag to select UI elements, and send rich visual context directly to your active Devin session — no typing selectors by hand.

> **Unofficial community project.** Not affiliated with or endorsed by Cognition.

## Features

- **Toggle** Design Mode with `Cmd/Ctrl+Shift+D` or the extension icon.
- **Hover** to preview elements.
- **Click** to select an element.
- **Cmd/Ctrl+Click** to multi-select or deselect.
- **Drag a box** to select every element inside an area.
- **Ask Devin** to change the selected elements. The extension sends:
  - Page URL and viewport size
  - Element selectors, computed styles, bounding boxes
  - React / Vue component names (when detectable)
  - Visible text and HTML snippets
  - A cropped screenshot of your selection, uploaded to Devin's own attachments API

## Install

### From the Chrome Web Store

_Once published:_ [Devin Design Mode](#) — click **Add to Chrome**.

### Manual install (developer mode)

1. Download or clone this repository:  
   `git clone https://github.com/TJCurnutte/devin-design-mode.git`
2. Open Chrome → `chrome://extensions`.
3. Turn on **Developer mode**.
4. Click **Load unpacked** and select the `devin-design-mode` folder.

## Setup

1. Click the extension icon and choose **Open Settings**.
2. Add your **Devin API key**:
   - Go to [app.devin.ai/settings/api-keys](https://app.devin.ai/settings/api-keys).
   - Create a personal API key.
3. Add your **Devin session ID**:
   - Open the Devin session you want to send context to.
   - Copy the ID from the URL: `app.devin.ai/sessions/<id>`.
   - Paste only `<id>` (not `devin-`) for v1; the extension handles prefixes for v3.

## Usage

1. Open the local web app or page you want to edit.
2. Press `Cmd/Ctrl+Shift+D` to enter Design Mode.
3. Click or drag to select the elements you want to change.
4. Click **Ask Devin** in the floating toolbar.
5. Type your request (e.g. *"make these buttons use the primary brand color"*) and hit **Send**.
6. Switch to your Devin session to see the agent work with the context.

## API version notes

- **v1 (personal API keys — recommended)** — uploads the cropped screenshot to Devin's v1 attachments endpoint and references it in the message with `ATTACHMENT:"<url>"`. This works with any personal API key and renders reliably in Devin.
- **v3 (service users)** — requires an organization service user with `ManageOrgSessions`, an org ID, and a session ID starting with `devin-`. The cropped screenshot can also be referenced in `attachment_urls`.

## Image mode

- **Attachment (default)** — crop the screenshot to your selection and upload it to Devin. Best quality and reliability.
- **Base64 markdown** — embed the cropped screenshot directly in the message text. Fallback in case attachment upload is unavailable.
- **None** — send only element data and text.

## Privacy & security

- All data is sent **only** to `api.devin.ai` and into **your own session**.
- Your API key and session ID are stored locally in Chrome's encrypted `storage.sync`.
- No analytics, ads, or third-party services.
- See [PRIVACY.md](./PRIVACY.md) for the full policy.

## Permissions

The extension requests `<all_urls>` so it can activate Design Mode on any page you are developing, including `localhost` and internal staging sites. It does not read pages until you toggle Design Mode.

## Development

```bash
git clone https://github.com/TJCurnutte/devin-design-mode.git
cd devin-design-mode
# Load the folder as an unpacked extension in chrome://extensions
```

## Roadmap

- [x] Crop screenshots to the selected area instead of full-page.
- [x] Upload images through Devin's v1 attachments endpoint.
- [ ] Voice-to-prompt input.
- [ ] Save and reuse selection sets.

## License

[MIT](./LICENSE)

## Disclaimer

This is an independent, open-source tool. Use at your own risk. Always review
code changes Devin makes before merging them.