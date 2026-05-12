# React + Vite

This template provides a minimal setup to get React working in Vite with HMR and some ESLint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Ark task monitoring

The server owns Ark task state and persists it under `DATA_DIR`.

- `TASK_MONITOR_MODE=poll` keeps polling Ark in the background.
- `TASK_MONITOR_MODE=webhook` sends `callback_url` on task creation and accepts Ark callbacks at `/api/ark/webhook`.
- In webhook mode set `PUBLIC_BASE_URL` or `ARK_CALLBACK_BASE_URL` to the public app origin. If `ARK_WEBHOOK_TOKEN` is set, the token is appended to the callback URL and verified on receipt.

## Expanding the ESLint configuration

If you are developing a production application, we recommend using TypeScript with type-aware lint rules enabled. Check out the [TS template](https://github.com/vitejs/vite/tree/main/packages/create-vite/template-react-ts) for information on how to integrate TypeScript and [`typescript-eslint`](https://typescript-eslint.io) in your project.
