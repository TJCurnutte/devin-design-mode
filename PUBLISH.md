# Publishing to the Chrome Web Store

## 1. Package the extension

```bash
sh package.sh
```

This creates `devin-design-mode-1.0.0.zip` containing only the files needed for
the store.

## 2. Create a Chrome Web Store developer account

1. Go to the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole/).
2. Pay the one-time $5 developer registration fee if you have not already.
3. Click **New item**.

## 3. Upload the extension

1. Click **Browse files** and select `devin-design-mode-1.0.0.zip`.
2. The dashboard reads `manifest.json` and pre-fills some fields.

## 4. Fill out the listing

### Store listing

- **Detailed description** (copy from `README.md` or write your own)
- **Category:** Developer Tools
- **Language:** English
- **Screenshots:** Upload 1280×800 or 640×400 PNGs from `store-assets/`
- **Small promo tile:** `store-assets/promo-small.png` (440×280)
- **Marquee promo tile:** `store-assets/promo-marquee.png` (1400×560)
- **Privacy practices:** Select **Trademark information** if needed, and link to `PRIVACY.md`

### Privacy

- **Privacy policy URL:** `https://github.com/TJCurnutte/devin-design-mode/blob/main/PRIVACY.md`
- Explain that the extension collects page data and sends it only to `api.devin.ai`.

### Distribution

- Choose **Public** so anyone can install it.

## 5. Submit for review

Click **Submit for review**. Review usually takes a few hours to a few days.

## 6. After approval

Copy the store URL into `README.md` and commit the update.