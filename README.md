# Booster

Booster is a Windows Electron application with a React and Tailwind dashboard for system maintenance and Fortnite settings.

## Development

Install Node.js 20 and npm, then run:

```sh
npm install
npm run dev
```

## Windows installer

Build the NSIS installer with:

```sh
npm run build
```

The installer is written to `release/`. Push a version tag such as `v1.0.0` to create a GitHub Release with the installer attached. The workflow also supports a manual Actions run.

## Notes

- The network panel requests Windows DNS and TCP configuration changes. ISP routing determines the actual game route and latency; the 145 ms value is an estimate, not a guarantee.
- Standby-list clearing and some network changes may require administrator privileges.
- Fortnite may ignore configuration values after game updates.
