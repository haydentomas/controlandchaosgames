# Frontend Second Life mode notes

Use this behavior when the browser is launched from a rezbed cabinet:

- Read `mode=sl` and `cabinetId` from the URL.
- Apply a `sl-mode` class to the body.
- Hide lobby navigation and non-essential chrome.
- Avoid prompts that make sense for desktop users but not for in-world players.

The main implementation should stay tiny:

```js
const params = new URLSearchParams(window.location.search);
const isSLMode = params.get('mode') === 'sl';
const cabinetId = params.get('cabinetId');

if (isSLMode) {
  document.body.classList.add('sl-mode');
}
```

